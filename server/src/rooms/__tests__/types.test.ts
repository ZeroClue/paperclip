import { describe, expect, it } from "vitest";
import {
  RoomState,
  VALID_TRANSITIONS,
  MessageType,
  ErrorClass,
  RoomConfigSchema,
  CreateRoomSchema,
  PostMessageSchema,
  ConfigValidationError,
  NotFoundError,
  DuplicateError,
  InvalidTransitionError,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// RoomConfigSchema
// ---------------------------------------------------------------------------

describe("RoomConfigSchema", () => {
  const validConfig = {
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

  it("accepts a valid config with all top-level sections", () => {
    const result = RoomConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const result = RoomConfigSchema.parse(validConfig);
    expect(result.devilsAdvocate.aggressionLevel).toBe('medium');
    expect(result.consensus.maxRounds).toBe(3);
    expect(result.consensus.forceResolveStrategy).toBe('leader-decides');
    expect(result.consensus.escalationThreshold).toBe(0.6);
    expect(result.workers.count).toBe(1);
  });

  it("rejects config missing required leader.agentId", () => {
    const result = RoomConfigSchema.safeParse({
      ...validConfig,
      leader: { systemPrompt: "You are the room leader." },
    });
    expect(result.success).toBe(false);
  });

  it("rejects leader.systemPrompt shorter than 10 characters", () => {
    const result = RoomConfigSchema.safeParse({
      ...validConfig,
      leader: { agentId: "550e8400-e29b-41d4-a716-446655440000", systemPrompt: "short" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects devilsAdvocate.systemPrompt shorter than 10 characters", () => {
    const result = RoomConfigSchema.safeParse({
      ...validConfig,
      devilsAdvocate: { agentId: "660e8400-e29b-41d4-a716-446655440001", systemPrompt: "short" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID agent IDs", () => {
    const result = RoomConfigSchema.safeParse({
      ...validConfig,
      leader: { agentId: "not-a-uuid", systemPrompt: "You are the room leader." },
    });
    expect(result.success).toBe(false);
  });

  it("rejects workers.count outside 1-3 range", () => {
    expect(
      RoomConfigSchema.safeParse({ ...validConfig, workers: { ...validConfig.workers, count: 0 } }).success
    ).toBe(false);
    expect(
      RoomConfigSchema.safeParse({ ...validConfig, workers: { ...validConfig.workers, count: 5 } }).success
    ).toBe(false);
  });

  it("accepts optional budget section", () => {
    const result = RoomConfigSchema.safeParse({
      ...validConfig,
      budget: { monthlyUsd: 200, warnThreshold: 0.9 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects config missing required devilsAdvocate section", () => {
    const result = RoomConfigSchema.safeParse({
      leader: validConfig.leader,
      workers: validConfig.workers,
      consensus: validConfig.consensus,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateRoomSchema
// ---------------------------------------------------------------------------

describe("CreateRoomSchema", () => {
  it("accepts required fields only", () => {
    const result = CreateRoomSchema.safeParse({
      name: "my-room",
      displayName: "My Room",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all fields", () => {
    const result = CreateRoomSchema.safeParse({
      name: "my-room",
      displayName: "My Room",
      description: "A room for testing",
      linkedGoalId: "550e8400-e29b-41d4-a716-446655440000",
      linkedProjectId: "660e8400-e29b-41d4-a716-446655440001",
      monthlyBudgetUsd: "500.0000",
      config: {
        leader: {
          agentId: "770e8400-e29b-41d4-a716-446655440002",
          systemPrompt: "A reasonable system prompt for the room.",
        },
        devilsAdvocate: {
          agentId: "880e8400-e29b-41d4-a716-446655440003",
          systemPrompt: "Challenge proposals carefully.",
        },
        workers: {
          agentTemplate: { systemPrompt: "Worker prompt", model: "gpt-4" },
        },
        consensus: {},
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateRoomSchema.safeParse({
      name: "",
      displayName: "My Room",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 100 characters", () => {
    const result = CreateRoomSchema.safeParse({
      name: "a".repeat(101),
      displayName: "My Room",
    });
    expect(result.success).toBe(false);
  });

  it("rejects displayName exceeding 255 characters", () => {
    const result = CreateRoomSchema.safeParse({
      name: "my-room",
      displayName: "a".repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed monthlyBudgetUsd", () => {
    const result = CreateRoomSchema.safeParse({
      name: "my-room",
      displayName: "My Room",
      monthlyBudgetUsd: "100",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid config inside CreateRoomSchema", () => {
    const result = CreateRoomSchema.safeParse({
      name: "my-room",
      displayName: "My Room",
      config: { leader: { agentId: "not-a-uuid", systemPrompt: "short" } },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PostMessageSchema
// ---------------------------------------------------------------------------

describe("PostMessageSchema", () => {
  it("accepts required fields only", () => {
    const result = PostMessageSchema.safeParse({
      type: MessageType.HUMAN,
      content: "Build a new feature",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all fields", () => {
    const result = PostMessageSchema.safeParse({
      type: MessageType.LEADER_PROPOSAL,
      content: "Here is my proposal",
      senderAgentId: "550e8400-e29b-41d4-a716-446655440000",
      metadata: { confidence: 0.9 },
      linkedIssueIds: ["660e8400-e29b-41d4-a716-446655440001"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    const result = PostMessageSchema.safeParse({
      type: MessageType.HUMAN,
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid message type", () => {
    const result = PostMessageSchema.safeParse({
      type: "INVALID_TYPE",
      content: "some content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID linkedIssueIds", () => {
    const result = PostMessageSchema.safeParse({
      type: MessageType.HUMAN,
      content: "some content",
      linkedIssueIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS
// ---------------------------------------------------------------------------

describe("VALID_TRANSITIONS", () => {
  const allStates = Object.values(RoomState);

  it("covers all RoomState values as keys", () => {
    for (const state of allStates) {
      expect(VALID_TRANSITIONS).toHaveProperty(state);
    }
  });

  it("IDLE can transition to CONSENSUS and PAUSED", () => {
    expect(VALID_TRANSITIONS[RoomState.IDLE]).toContain(RoomState.CONSENSUS);
    expect(VALID_TRANSITIONS[RoomState.IDLE]).toContain(RoomState.PAUSED);
    expect(VALID_TRANSITIONS[RoomState.IDLE]).not.toContain(RoomState.EXECUTING);
  });

  it("CONSENSUS can transition to BREAKDOWN, EXECUTING, PAUSED, ERROR", () => {
    expect(VALID_TRANSITIONS[RoomState.CONSENSUS]).toContain(RoomState.BREAKDOWN);
    expect(VALID_TRANSITIONS[RoomState.CONSENSUS]).toContain(RoomState.EXECUTING);
    expect(VALID_TRANSITIONS[RoomState.CONSENSUS]).toContain(RoomState.PAUSED);
    expect(VALID_TRANSITIONS[RoomState.CONSENSUS]).toContain(RoomState.ERROR);
    expect(VALID_TRANSITIONS[RoomState.CONSENSUS]).not.toContain(RoomState.IDLE);
  });

  it("ERROR can only transition to IDLE", () => {
    expect(VALID_TRANSITIONS[RoomState.ERROR]).toEqual([RoomState.IDLE]);
  });

  it("PAUSED can only transition to IDLE", () => {
    expect(VALID_TRANSITIONS[RoomState.PAUSED]).toEqual([RoomState.IDLE]);
  });

  it("EXECUTING cannot transition directly to IDLE", () => {
    expect(VALID_TRANSITIONS[RoomState.EXECUTING]).not.toContain(RoomState.IDLE);
  });

  it("SYNTHESISING can transition to IDLE", () => {
    expect(VALID_TRANSITIONS[RoomState.SYNTHESISING]).toContain(RoomState.IDLE);
  });

  it("every target state in transitions is a valid RoomState", () => {
    for (const state of allStates) {
      for (const target of VALID_TRANSITIONS[state]) {
        expect(allStates).toContain(target);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

describe("Error classes", () => {
  it("ConfigValidationError has correct name and message", () => {
    const err = new ConfigValidationError("bad config");
    expect(err.name).toBe("ConfigValidationError");
    expect(err.message).toBe("bad config");
    expect(err).toBeInstanceOf(Error);
  });

  it("NotFoundError formats message correctly", () => {
    const err = new NotFoundError("Room", "abc-123");
    expect(err.name).toBe("NotFoundError");
    expect(err.message).toBe("Room with id abc-123 not found");
    expect(err).toBeInstanceOf(Error);
  });

  it("DuplicateError formats message correctly", () => {
    const err = new DuplicateError("Room", "name", "my-room");
    expect(err.name).toBe("DuplicateError");
    expect(err.message).toBe("Room with name 'my-room' already exists");
    expect(err).toBeInstanceOf(Error);
  });

  it("InvalidTransitionError formats message correctly", () => {
    const err = new InvalidTransitionError(RoomState.IDLE, RoomState.EXECUTING);
    expect(err.name).toBe("InvalidTransitionError");
    expect(err.message).toBe("Invalid state transition from IDLE to EXECUTING");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe("Enums", () => {
  it("RoomState has 7 values", () => {
    expect(Object.keys(RoomState)).toHaveLength(7);
  });

  it("MessageType has 15 values", () => {
    expect(Object.keys(MessageType)).toHaveLength(15);
  });

  it("ErrorClass has 3 values", () => {
    expect(Object.keys(ErrorClass)).toHaveLength(3);
  });
});
