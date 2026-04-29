import { describe, expect, it, vi } from "vitest";
import {
  RoomState,
  MessageType,
  ConfigValidationError,
  NotFoundError,
  DuplicateError,
  InvalidTransitionError,
} from "../core/types.js";
import type { Room, RoomListItem, PaginatedMessages } from "../core/types.js";
import { RoomBusyError } from "../core/MessageRouter.js";
import { roomRoutes } from "../api/RoomController.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockRes() {
  const res: Record<string, any> = {
    statusCode: 200,
    body: null,
    headers: {},
    json: vi.fn((data: any) => {
      res.body = data;
      res.statusCode = 200;
      return res;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    set: vi.fn((key: string, val: string) => {
      res.headers[key] = val;
      return res;
    }),
    get: vi.fn((key: string) => res.headers[key]),
  };
  return res as any;
}

function createMockReq(overrides: Record<string, any> = {}) {
  return {
    method: "GET",
    url: "/",
    originalUrl: "/",
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as any;
}

const MOCK_ROOM: Room = {
  id: "room-1",
  companyId: "company-1",
  name: "engineering",
  displayName: "#engineering",
  description: null,
  config: {
    leader: {
      agentId: "00000000-0000-0000-0000-000000000001",
      systemPrompt: "Leader system prompt for testing.",
    },
    devilsAdvocate: {
      agentId: "00000000-0000-0000-0000-000000000002",
      systemPrompt: "Devil advocate system prompt for testing.",
    },
    workers: {
      count: 1,
      agentTemplate: {
        systemPrompt: "Worker system prompt for testing.",
        model: "gpt-4",
      },
    },
    consensus: {
      maxRounds: 3,
      forceResolveStrategy: "leader-decides",
      escalationThreshold: 0.6,
    },
  },
  state: RoomState.IDLE,
  currentMessageId: null,
  linkedGoalId: null,
  linkedProjectId: null,
  monthlyBudgetUsd: "100.0000",
  spentUsd: "0.0000",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_ROOM_LIST_ITEM: RoomListItem = {
  id: "room-1",
  name: "engineering",
  displayName: "#engineering",
  state: RoomState.IDLE,
  linkedGoalId: null,
  linkedProjectId: null,
  spentUsd: "0.0000",
  monthlyBudgetUsd: "100.0000",
  updatedAt: new Date(),
  messageCount: 5,
  lastActivityAt: new Date(),
};

const MOCK_MESSAGE_RESPONSE = {
  id: "msg-1",
  roomId: "room-1",
  correlationId: "corr-1",
  type: MessageType.HUMAN,
  sender: "user",
  createdAt: new Date(),
};

const MOCK_PAGINATED_MESSAGES: PaginatedMessages = {
  data: [
    {
      id: "msg-1",
      roomId: "room-1",
      correlationId: "corr-1",
      type: MessageType.HUMAN,
      sender: "user",
      senderAgentId: null,
      content: "Hello",
      metadata: {},
      linkedIssueIds: [],
      debateRound: null,
      consensusOutcome: null,
      createdAt: new Date(),
    },
  ],
  pagination: { hasMore: false },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("roomRoutes", () => {
  describe("POST /rooms", () => {
    it("creates a room and returns 201", async () => {
      const repository = {
        createRoom: vi.fn().mockResolvedValue(MOCK_ROOM),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms",
        query: { companyId: "company-1" },
        body: { name: "engineering", displayName: "#engineering" },
      });
      const res = createMockRes();
      const next = vi.fn();

      await routes(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(MOCK_ROOM);
      expect(repository.createRoom).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({ name: "engineering", displayName: "#engineering" }),
      );
    });

    it("returns 400 when repository throws ConfigValidationError (INVALID_CONFIG)", async () => {
      const repository = {
        createRoom: vi.fn().mockRejectedValue(
          new ConfigValidationError("Room config exceeds budget constraints"),
        ),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      // Valid body that passes CreateRoomSchema but repository rejects at a deeper level
      const validConfig = MOCK_ROOM.config;
      const req = createMockReq({
        method: "POST",
        url: "/rooms",
        query: { companyId: "company-1" },
        body: {
          name: "eng",
          displayName: "#eng",
          config: validConfig,
        },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "INVALID_CONFIG" }),
      );
    });

    it("returns 400 when companyId is missing", async () => {
      const routes = roomRoutes({} as any, {} as any, {} as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms",
        query: {},
        body: { name: "engineering", displayName: "#engineering" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "MISSING_COMPANY_ID" });
    });

    it("returns 409 on duplicate name", async () => {
      const repository = {
        createRoom: vi.fn().mockRejectedValue(
          new DuplicateError("Room", "name", "engineering"),
        ),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms",
        query: { companyId: "company-1" },
        body: { name: "engineering", displayName: "#engineering" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "DUPLICATE_NAME" }),
      );
    });

    it("returns 400 for invalid request body (validation error)", async () => {
      const routes = roomRoutes({} as any, {} as any, {} as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms",
        query: { companyId: "company-1" },
        body: {}, // missing required name and displayName
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "VALIDATION_ERROR" }),
      );
    });
  });

  describe("GET /rooms", () => {
    it("returns list of rooms", async () => {
      const repository = {
        listRooms: vi.fn().mockResolvedValue([MOCK_ROOM_LIST_ITEM]),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms",
        query: { companyId: "company-1" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ data: [MOCK_ROOM_LIST_ITEM] });
      expect(repository.listRooms).toHaveBeenCalledWith("company-1");
    });

    it("returns 400 when companyId is missing", async () => {
      const routes = roomRoutes({} as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms",
        query: {},
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "MISSING_COMPANY_ID" });
    });
  });

  describe("GET /rooms/:id", () => {
    it("returns room details", async () => {
      const repository = {
        getRoom: vi.fn().mockResolvedValue(MOCK_ROOM),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms/room-1",
        params: { id: "room-1" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(MOCK_ROOM);
      expect(repository.getRoom).toHaveBeenCalledWith("room-1");
    });

    it("returns 404 when room not found", async () => {
      const repository = {
        getRoom: vi.fn().mockRejectedValue(new NotFoundError("Room", "nonexistent")),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms/nonexistent",
        params: { id: "nonexistent" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "NOT_FOUND" }),
      );
    });

    it("returns 500 when room config is corrupted", async () => {
      const repository = {
        getRoom: vi.fn().mockRejectedValue(
          new ConfigValidationError("Stored room config is invalid: ..."),
        ),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms/room-1",
        params: { id: "room-1" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "CONFIG_CORRUPTED" }),
      );
    });
  });

  describe("POST /rooms/:id/messages", () => {
    it("routes a message and returns 202", async () => {
      const router = {
        routeMessage: vi.fn().mockResolvedValue(MOCK_MESSAGE_RESPONSE),
      };
      const routes = roomRoutes({} as any, {} as any, router as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        body: { content: "Build a feature" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(MOCK_MESSAGE_RESPONSE);
      expect(router.routeMessage).toHaveBeenCalledWith("room-1", {
        content: "Build a feature",
        correlationId: undefined,
      });
    });

    it("returns 409 when room is busy", async () => {
      const router = {
        routeMessage: vi.fn().mockRejectedValue(
          new RoomBusyError(RoomState.CONSENSUS),
        ),
      };
      const routes = roomRoutes({} as any, {} as any, router as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        body: { content: "Hello" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "ROOM_BUSY",
          currentState: RoomState.CONSENSUS,
        }),
      );
    });

    it("returns 400 when content is empty", async () => {
      const routes = roomRoutes({} as any, {} as any, {} as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        body: { content: "" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "VALIDATION_ERROR" }),
      );
    });

    it("returns 400 when content is missing", async () => {
      const routes = roomRoutes({} as any, {} as any, {} as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        body: {},
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "VALIDATION_ERROR" }),
      );
    });

    it("passes correlationId from body to router", async () => {
      const router = {
        routeMessage: vi.fn().mockResolvedValue(MOCK_MESSAGE_RESPONSE),
      };
      const routes = roomRoutes({} as any, {} as any, router as any);

      const req = createMockReq({
        method: "POST",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        body: { content: "Hello", correlationId: "my-corr-123" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(router.routeMessage).toHaveBeenCalledWith("room-1", {
        content: "Hello",
        correlationId: "my-corr-123",
      });
    });
  });

  describe("GET /rooms/:id/messages", () => {
    it("returns paginated messages", async () => {
      const repository = {
        getMessages: vi.fn().mockResolvedValue(MOCK_PAGINATED_MESSAGES),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        query: {},
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(MOCK_PAGINATED_MESSAGES);
      expect(repository.getMessages).toHaveBeenCalledWith("room-1", {
        limit: 50,
        before: undefined,
      });
    });

    it("passes pagination parameters", async () => {
      const repository = {
        getMessages: vi.fn().mockResolvedValue(MOCK_PAGINATED_MESSAGES),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        query: { before: "msg-50", limit: "10" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(repository.getMessages).toHaveBeenCalledWith("room-1", {
        limit: 10,
        before: "msg-50",
      });
    });

    it("defaults limit to 50 when not provided", async () => {
      const repository = {
        getMessages: vi.fn().mockResolvedValue(MOCK_PAGINATED_MESSAGES),
      };
      const routes = roomRoutes(repository as any, {} as any, {} as any);

      const req = createMockReq({
        method: "GET",
        url: "/rooms/room-1/messages",
        params: { id: "room-1" },
        query: {},
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(repository.getMessages).toHaveBeenCalledWith("room-1", {
        limit: 50,
        before: undefined,
      });
    });
  });

  describe("PATCH /rooms/:id/state", () => {
    it("transitions state and returns 200", async () => {
      const manager = {
        transitionState: vi.fn().mockResolvedValue(undefined),
      };
      const routes = roomRoutes({} as any, manager as any, {} as any);

      const req = createMockReq({
        method: "PATCH",
        url: "/rooms/room-1/state",
        params: { id: "room-1" },
        body: { state: RoomState.CONSENSUS },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(manager.transitionState).toHaveBeenCalledWith(
        "room-1",
        RoomState.CONSENSUS,
      );
    });

    it("returns 409 for invalid transition", async () => {
      const manager = {
        transitionState: vi.fn().mockRejectedValue(
          new InvalidTransitionError(RoomState.IDLE, RoomState.SYNTHESISING),
        ),
      };
      const routes = roomRoutes({} as any, manager as any, {} as any);

      const req = createMockReq({
        method: "PATCH",
        url: "/rooms/room-1/state",
        params: { id: "room-1" },
        body: { state: RoomState.SYNTHESISING },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "INVALID_TRANSITION" }),
      );
    });

    it("returns 400 when body is missing or invalid", async () => {
      const routes = roomRoutes({} as any, {} as any, {} as any);

      const req = createMockReq({
        method: "PATCH",
        url: "/rooms/room-1/state",
        params: { id: "room-1" },
        body: {}, // missing state
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "VALIDATION_ERROR" }),
      );
    });

    it("returns 404 when room not found", async () => {
      const manager = {
        transitionState: vi.fn().mockRejectedValue(
          new NotFoundError("Room", "nonexistent"),
        ),
      };
      const routes = roomRoutes({} as any, manager as any, {} as any);

      const req = createMockReq({
        method: "PATCH",
        url: "/rooms/nonexistent/state",
        params: { id: "nonexistent" },
        body: { state: RoomState.CONSENSUS },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "NOT_FOUND" }),
      );
    });

    it("accepts reason field in body", async () => {
      const manager = {
        transitionState: vi.fn().mockResolvedValue(undefined),
      };
      const routes = roomRoutes({} as any, manager as any, {} as any);

      const req = createMockReq({
        method: "PATCH",
        url: "/rooms/room-1/state",
        params: { id: "room-1" },
        body: { state: RoomState.PAUSED, reason: "Budget exceeded" },
      });
      const res = createMockRes();

      await routes(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(manager.transitionState).toHaveBeenCalledWith(
        "room-1",
        RoomState.PAUSED,
      );
    });
  });
});
