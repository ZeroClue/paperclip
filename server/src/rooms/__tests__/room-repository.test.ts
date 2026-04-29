import { describe, expect, it, beforeEach } from "vitest";
import {
  RoomState,
  MessageType,
  RoomConfigSchema,
  ConfigValidationError,
  NotFoundError,
  DuplicateError,
  InvalidTransitionError,
} from "../core/types.js";
import type { RoomMessage } from "../core/types.js";
import {
  RoomRepository,
  type RoomTables,
  type QueryHelpers,
  type ColumnRef,
} from "../core/RoomRepository.js";
import type { AddMessageInput } from "../core/RoomRepository.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MockRow {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Mock table references — symbols act as Drizzle column identifiers
// ---------------------------------------------------------------------------

const col = {
  rooms: {
    id: Symbol("rooms.id"),
    companyId: Symbol("rooms.companyId"),
    createdAt: Symbol("rooms.createdAt"),
    state: Symbol("rooms.state"),
    spentUsd: Symbol("rooms.spentUsd"),
  },
  roomMessages: {
    id: Symbol("roomMessages.id"),
    roomId: Symbol("roomMessages.roomId"),
    createdAt: Symbol("roomMessages.createdAt"),
  },
};

const mockTables: RoomTables = {
  rooms: {
    id: col.rooms.id as unknown as ColumnRef,
    companyId: col.rooms.companyId as unknown as ColumnRef,
    createdAt: col.rooms.createdAt as unknown as ColumnRef,
    state: col.rooms.state as unknown as ColumnRef,
    spentUsd: col.rooms.spentUsd as unknown as ColumnRef,
  } as unknown as RoomTables["rooms"],
  roomMessages: {
    id: col.roomMessages.id as unknown as ColumnRef,
    roomId: col.roomMessages.roomId as unknown as ColumnRef,
    createdAt: col.roomMessages.createdAt as unknown as ColumnRef,
  } as unknown as RoomTables["roomMessages"],
};

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

function symbolToColName(sym: symbol): string | null {
  for (const [, cols] of Object.entries(col)) {
    for (const [name, val] of Object.entries(cols)) {
      if (val === sym) return name;
    }
  }
  return null;
}

function matchCondition(row: MockRow, cond: unknown): boolean {
  if (!cond) return true;
  if (typeof cond !== "object" || cond === null) return true;

  const c = cond as Record<string, unknown>;

  if (c._type === "eq") {
    const colName = symbolToColName(c.col as symbol);
    if (!colName) return true;
    return row[colName] === c.val;
  }

  if (c._type === "and") {
    return (c.conds as unknown[]).every((sub) => matchCondition(row, sub));
  }

  if (c._type === "lt") {
    const colName = symbolToColName(c.col as symbol);
    if (!colName) return true;
    const rowVal = new Date(row[colName] as string).getTime();
    const cmpVal = new Date(c.val as string).getTime();
    return rowVal < cmpVal;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Mock query helpers
// ---------------------------------------------------------------------------

const mockHelpers: QueryHelpers = {
  eq(colRef: ColumnRef, val: unknown) {
    return { _type: "eq", col: colRef, val };
  },
  and(...conds: unknown[]) {
    return { _type: "and", conds };
  },
  lt(colRef: ColumnRef, val: unknown) {
    return { _type: "lt", col: colRef, val };
  },
  desc(colRef: ColumnRef) {
    return { _type: "desc", col: colRef };
  },
};

// ---------------------------------------------------------------------------
// Thenable chain builder — allows the repository to call
// .select().from().where().orderBy().limit() and then await the result
// ---------------------------------------------------------------------------

class QueryChain implements PromiseLike<MockRow[]> {
  private fromTable: any = null;
  private whereCond: unknown = null;
  private orderCol: symbol | null = null;
  private orderDir: "asc" | "desc" = "asc";
  private limitCount = 1000;
  private selectFields: Record<string, symbol> | null = null;
  private resolved = false;

  // -- chainable methods --

  from(table: any): this {
    this.fromTable = table;
    return this;
  }

  where(cond: unknown): this {
    this.whereCond = cond;
    return this;
  }

  orderBy(orderExpr: unknown): this {
    if (typeof orderExpr === "object" && orderExpr !== null) {
      const expr = orderExpr as Record<string, unknown>;
      if (expr._type === "desc") {
        this.orderCol = expr.col as symbol;
        this.orderDir = "desc";
      }
    }
    return this;
  }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  // -- PromiseLike interface --

  then<TResult1 = MockRow[], TResult2 = never>(
    onfulfilled?: ((value: MockRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // -- execution --

  private async execute(): Promise<MockRow[]> {
    if (this.resolved) return [];
    this.resolved = true;

    if (!this.fromTable) return [];

    const isMessageTable = this.fromTable === mockTables.roomMessages;
    const store = isMessageTable ? getStore("messages") : getStore("rooms");
    let results = Array.from(store.values());

    // Apply where filter
    if (this.whereCond) {
      results = results.filter((row) => matchCondition(row, this.whereCond));
    }

    // Sort by createdAt descending
    results.sort((a, b) => {
      const aTime = new Date(a.createdAt as string).getTime();
      const bTime = new Date(b.createdAt as string).getTime();
      return this.orderDir === "desc" ? bTime - aTime : aTime - bTime;
    });

    const limited = results.slice(0, this.limitCount);

    // If selectFields was specified, project the results
    if (this.selectFields) {
      return limited.map((row) => {
        const projected: MockRow = {};
        for (const [alias, sym] of Object.entries(this.selectFields!)) {
          const colName = symbolToColName(sym as symbol);
          if (colName && colName in row) {
            projected[alias] = row[colName];
          }
        }
        return projected;
      });
    }

    return limited;
  }
}

// ---------------------------------------------------------------------------
// Store management (module-level so QueryChain can access it)
// ---------------------------------------------------------------------------

const stores = {
  rooms: new Map<string, MockRow>(),
  messages: new Map<string, MockRow>(),
};

function getStore(type: "rooms" | "messages"): Map<string, MockRow> {
  return stores[type];
}

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

function createMockDb() {
  let nextRoomId = 1;
  let nextMessageId = 1;

  function makeRoomId() { return `room-${nextRoomId++}`; }
  function makeMessageId() { return `msg-${nextMessageId++}`; }

  function addRoom(row: MockRow) { stores.rooms.set(row.id as string, row); }
  function addMessage(row: MockRow) { stores.messages.set(row.id as string, row); }
  function clearStores() {
    stores.rooms.clear();
    stores.messages.clear();
    nextRoomId = 1;
    nextMessageId = 1;
  }

  const mockDb: any = {
    insert(table: any) {
      return {
        values(data: MockRow) {
          return {
            async returning() {
              const now = new Date();
              const isMessage = "roomId" in data && "correlationId" in data;
              const id = isMessage ? makeMessageId() : makeRoomId();
              const row: MockRow = {
                ...data,
                id,
                createdAt: data.createdAt ?? now,
                updatedAt: data.updatedAt ?? now,
              };
              if (isMessage) {
                stores.messages.set(id, row);
              } else {
                stores.rooms.set(id, row);
              }
              return [row];
            },
          };
        },
      };
    },

    select(fields?: Record<string, symbol>) {
      const chain = new QueryChain();
      if (fields) {
        (chain as any).selectFields = fields;
      }
      return chain;
    },

    update(table: any) {
      return {
        set(data: MockRow) {
          return {
            where(cond: unknown) {
              return {
                async returning() {
                  const isMessageTable = table === mockTables.roomMessages;
                  const store = isMessageTable ? stores.messages : stores.rooms;
                  const results = Array.from(store.values());

                  const matched = results.filter((row) => matchCondition(row, cond));
                  if (matched.length === 0) return [];

                  const updated = matched.map((row) => {
                    const setPayload: MockRow = {};
                    for (const [k, v] of Object.entries(data)) {
                      if (v && typeof v === "object" && (v as Record<string, unknown>)._type === "sql") {
                        continue; // SQL template — skip in mock
                      }
                      setPayload[k] = v;
                    }
                    const updatedRow = { ...row, ...setPayload, updatedAt: new Date() };
                    return updatedRow;
                  });

                  for (const row of updated) {
                    store.set(row.id as string, row);
                  }

                  return updated;
                },
              };
            },
          };
        },
      };
    },
  };

  return { mockDb, addRoom, addMessage, clearStores, makeRoomId, makeMessageId };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  leader: {
    agentId: "550e8400-e29b-41d4-a716-446655440000",
    systemPrompt: "You are the room leader coordinating tasks.",
  },
  devilsAdvocate: {
    agentId: "660e8400-e29b-41d4-a716-446655440001",
    systemPrompt: "You are the devil's advocate challenging proposals.",
  },
  workers: {
    agentTemplate: {
      systemPrompt: "You are a worker agent.",
      model: "gpt-4",
    },
  },
  consensus: {},
};

function makeMockRoomRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "room-1",
    companyId: "company-1",
    name: "test-room",
    displayName: "Test Room",
    description: null,
    config: VALID_CONFIG,
    state: RoomState.IDLE,
    currentMessageId: null,
    linkedGoalId: null,
    linkedProjectId: null,
    monthlyBudgetUsd: "100.0000",
    spentUsd: "0.0000",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeMockMessageRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "msg-1",
    roomId: "room-1",
    correlationId: "corr-1",
    type: MessageType.HUMAN,
    sender: "operator",
    senderAgentId: null,
    content: "Hello world",
    metadata: {},
    linkedIssueIds: [],
    debateRound: null,
    consensusOutcome: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function createRepo(db: ReturnType<typeof createMockDb>): RoomRepository {
  return new RoomRepository({
    db: db.mockDb,
    tables: mockTables,
    helpers: mockHelpers,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RoomRepository", () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: RoomRepository;

  beforeEach(() => {
    // Clear shared stores from any previous test
    stores.rooms.clear();
    stores.messages.clear();
    db = createMockDb();
    repo = createRepo(db);
  });

  // =========================================================================
  // createRoom
  // =========================================================================

  describe("createRoom", () => {
    it("creates a room with validated config and returns it", async () => {
      const room = await repo.createRoom("company-1", {
        name: "my-room",
        displayName: "My Room",
        config: VALID_CONFIG,
      });

      expect(room).toBeDefined();
      expect(room.name).toBe("my-room");
      expect(room.displayName).toBe("My Room");
      expect(room.companyId).toBe("company-1");
      expect(room.state).toBe(RoomState.IDLE);
      expect(room.config).toBeDefined();
      expect(room.config.leader.agentId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(room.monthlyBudgetUsd).toBe("100.0000");
      expect(room.spentUsd).toBe("0.0000");
      expect(room.createdAt).toBeInstanceOf(Date);
    });

    it("applies default budget when not provided", async () => {
      const room = await repo.createRoom("company-1", {
        name: "default-budget-room",
        displayName: "Default Budget",
        config: VALID_CONFIG,
      });

      expect(room.monthlyBudgetUsd).toBe("100.0000");
    });

    it("rejects invalid config with ConfigValidationError", async () => {
      await expect(
        repo.createRoom("company-1", {
          name: "bad-room",
          displayName: "Bad Room",
          config: {
            leader: {
              agentId: "not-a-uuid",
              systemPrompt: "short",
            },
            devilsAdvocate: {
              agentId: "660e8400-e29b-41d4-a716-446655440001",
              systemPrompt: "You are the devil's advocate.",
            },
            workers: {
              agentTemplate: { systemPrompt: "Worker.", model: "gpt-4" },
            },
            consensus: {},
          },
        }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("rejects invalid input with ConfigValidationError", async () => {
      await expect(
        repo.createRoom("company-1", {
          name: "",
          displayName: "Bad Room",
        }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("accepts custom monthlyBudgetUsd", async () => {
      const room = await repo.createRoom("company-1", {
        name: "custom-budget",
        displayName: "Custom Budget",
        monthlyBudgetUsd: "500.0000",
        config: VALID_CONFIG,
      });

      expect(room.monthlyBudgetUsd).toBe("500.0000");
    });
  });

  // =========================================================================
  // getRoom
  // =========================================================================

  describe("getRoom", () => {
    it("returns a room with validated config", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", companyId: "company-1" }));

      const room = await repo.getRoom("room-1");

      expect(room.id).toBe("room-1");
      expect(room.name).toBe("test-room");
      expect(room.state).toBe(RoomState.IDLE);
      expect(room.config.leader.agentId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("throws NotFoundError for missing room", async () => {
      await expect(repo.getRoom("nonexistent")).rejects.toThrow(NotFoundError);
      await expect(repo.getRoom("nonexistent")).rejects.toThrow(
        "Room with id nonexistent not found",
      );
    });

    it("throws ConfigValidationError for corrupted config", async () => {
      db.addRoom(
        makeMockRoomRow({
          id: "room-corrupt",
          config: { invalid: true, data: "here" },
        }),
      );

      await expect(repo.getRoom("room-corrupt")).rejects.toThrow(
        ConfigValidationError,
      );
    });
  });

  // =========================================================================
  // listRooms
  // =========================================================================

  describe("listRooms", () => {
    it("returns rooms filtered by company", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", companyId: "company-1", name: "room-a" }));
      db.addRoom(makeMockRoomRow({ id: "room-2", companyId: "company-1", name: "room-b" }));
      db.addRoom(makeMockRoomRow({ id: "room-3", companyId: "company-2", name: "room-c" }));

      const result = await repo.listRooms("company-1");

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toContain("room-a");
      expect(result.map((r) => r.name)).toContain("room-b");
      expect(result.map((r) => r.name)).not.toContain("room-c");
    });

    it("returns empty array for company with no rooms", async () => {
      const result = await repo.listRooms("empty-company");

      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // updateState
  // =========================================================================

  describe("updateState", () => {
    it("valid transition from IDLE to CONSENSUS succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.IDLE }));

      const updated = await repo.updateState("room-1", RoomState.CONSENSUS);

      expect(updated.state).toBe(RoomState.CONSENSUS);
    });

    it("valid transition from CONSENSUS to EXECUTING succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.CONSENSUS }));

      const updated = await repo.updateState("room-1", RoomState.EXECUTING);

      expect(updated.state).toBe(RoomState.EXECUTING);
    });

    it("invalid transition throws InvalidTransitionError", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.IDLE }));

      await expect(
        repo.updateState("room-1", RoomState.EXECUTING),
      ).rejects.toThrow(InvalidTransitionError);
      await expect(
        repo.updateState("room-1", RoomState.EXECUTING),
      ).rejects.toThrow("Invalid state transition from IDLE to EXECUTING");
    });

    it("transition from ERROR to IDLE succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.ERROR }));

      const updated = await repo.updateState("room-1", RoomState.IDLE);

      expect(updated.state).toBe(RoomState.IDLE);
    });

    it("transition from PAUSED to IDLE succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.PAUSED }));

      const updated = await repo.updateState("room-1", RoomState.IDLE);

      expect(updated.state).toBe(RoomState.IDLE);
    });

    it("transition from EXECUTING to SYNTHESISING succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.EXECUTING }));

      const updated = await repo.updateState("room-1", RoomState.SYNTHESISING);

      expect(updated.state).toBe(RoomState.SYNTHESISING);
    });

    it("transition from SYNTHESISING back to IDLE succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.SYNTHESISING }));

      const updated = await repo.updateState("room-1", RoomState.IDLE);

      expect(updated.state).toBe(RoomState.IDLE);
    });

    it("transition from CONSENSUS to BREAKDOWN succeeds", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1", state: RoomState.CONSENSUS }));

      const updated = await repo.updateState("room-1", RoomState.BREAKDOWN);

      expect(updated.state).toBe(RoomState.BREAKDOWN);
    });
  });

  // =========================================================================
  // addMessage
  // =========================================================================

  describe("addMessage", () => {
    it("adds a message and returns it", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const message = await repo.addMessage("room-1", {
        correlationId: "corr-1",
        type: MessageType.HUMAN,
        sender: "operator",
        content: "Hello world",
      });

      expect(message).toBeDefined();
      expect(message.roomId).toBe("room-1");
      expect(message.correlationId).toBe("corr-1");
      expect(message.type).toBe(MessageType.HUMAN);
      expect(message.sender).toBe("operator");
      expect(message.content).toBe("Hello world");
      expect(message.createdAt).toBeInstanceOf(Date);
    });

    it("adds message with optional fields", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const message = await repo.addMessage("room-1", {
        correlationId: "corr-2",
        type: MessageType.LEADER_PROPOSAL,
        sender: "leader",
        senderAgentId: "agent-1",
        content: "My proposal",
        metadata: { confidence: 0.9 },
        linkedIssueIds: ["issue-1"],
        debateRound: 1,
        consensusOutcome: null,
      });

      expect(message.senderAgentId).toBe("agent-1");
      expect(message.metadata).toEqual({ confidence: 0.9 });
      expect(message.linkedIssueIds).toEqual(["issue-1"]);
      expect(message.debateRound).toBe(1);
    });

    it("rejects duplicate correlationId + type with DuplicateError", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      // First insert succeeds
      await repo.addMessage("room-1", {
        correlationId: "corr-dup",
        type: MessageType.HUMAN,
        sender: "operator",
        content: "First",
      });

      // Swap in a mock that throws on insert (the first insert already happened above)
      const originalInsert = db.mockDb.insert;
      db.mockDb.insert = (table: any) => {
        return {
          values(data: MockRow) {
            return {
              async returning() {
                throw new Error(
                  'duplicate key value violates unique constraint "uq_room_messages_correlation_type"',
                );
              },
            };
          },
        };
      };

      // Second insert with same correlationId+type should throw DuplicateError
      await expect(
        repo.addMessage("room-1", {
          correlationId: "corr-dup",
          type: MessageType.HUMAN,
          sender: "operator",
          content: "Duplicate",
        }),
      ).rejects.toThrow(DuplicateError);

      // Restore original
      db.mockDb.insert = originalInsert;
    });
  });

  // =========================================================================
  // getMessages
  // =========================================================================

  describe("getMessages", () => {
    it("returns paginated messages", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const baseTime = new Date("2025-01-01T00:00:00Z");
      for (let i = 0; i < 5; i++) {
        db.addMessage(
          makeMockMessageRow({
            id: `msg-${i + 1}`,
            roomId: "room-1",
            correlationId: `corr-${i + 1}`,
            createdAt: new Date(baseTime.getTime() + i * 1000),
          }),
        );
      }

      const result = await repo.getMessages("room-1", { limit: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextBefore).toBeDefined();
    });

    it("cursor pagination returns next page correctly", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const baseTime = new Date("2025-01-01T00:00:00Z");
      for (let i = 0; i < 5; i++) {
        db.addMessage(
          makeMockMessageRow({
            id: `msg-${i + 1}`,
            roomId: "room-1",
            correlationId: `corr-${i + 1}`,
            createdAt: new Date(baseTime.getTime() + i * 1000),
          }),
        );
      }

      // Page 1
      const page1 = await repo.getMessages("room-1", { limit: 3 });
      expect(page1.data).toHaveLength(3);
      expect(page1.pagination.hasMore).toBe(true);

      // Page 2 using cursor
      const page2 = await repo.getMessages("room-1", {
        limit: 3,
        before: page1.pagination.nextBefore,
      });
      expect(page2.data).toHaveLength(2);
      expect(page2.pagination.hasMore).toBe(false);
      expect(page2.pagination.nextBefore).toBeUndefined();
    });

    it("returns empty array when room has no messages", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const result = await repo.getMessages("room-1");

      expect(result.data).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("uses default limit of 50", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const result = await repo.getMessages("room-1");
      // No messages, so just verify it doesn't throw
      expect(result.data).toHaveLength(0);
    });

    it("messages are returned in descending createdAt order", async () => {
      db.addRoom(makeMockRoomRow({ id: "room-1" }));

      const baseTime = new Date("2025-01-01T00:00:00Z");
      for (let i = 0; i < 3; i++) {
        db.addMessage(
          makeMockMessageRow({
            id: `msg-${i + 1}`,
            roomId: "room-1",
            correlationId: `corr-${i + 1}`,
            content: `Message ${i + 1}`,
            createdAt: new Date(baseTime.getTime() + i * 1000),
          }),
        );
      }

      const result = await repo.getMessages("room-1", { limit: 10 });

      // Newest first (msg-3, msg-2, msg-1)
      expect(result.data[0].content).toBe("Message 3");
      expect(result.data[1].content).toBe("Message 2");
      expect(result.data[2].content).toBe("Message 1");
    });
  });

  // =========================================================================
  // updateSpent
  // =========================================================================

  describe("updateSpent", () => {
    it("updates spend for an existing room without error", async () => {
      db.addRoom(
        makeMockRoomRow({
          id: "room-1",
          spentUsd: "10.0000",
          monthlyBudgetUsd: "100.0000",
        }),
      );

      // Should not throw
      await repo.updateSpent("room-1", "5.5000");
    });

    it("throws NotFoundError for missing room", async () => {
      await expect(repo.updateSpent("nonexistent", "5.0000")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // =========================================================================
  // getRoomSpend
  // =========================================================================

  describe("getRoomSpend", () => {
    it("returns current spent amount", async () => {
      db.addRoom(
        makeMockRoomRow({
          id: "room-1",
          spentUsd: "42.5000",
        }),
      );

      const spent = await repo.getRoomSpend("room-1");
      expect(spent).toBe("42.5000");
    });

    it("throws NotFoundError for missing room", async () => {
      await expect(repo.getRoomSpend("nonexistent")).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
