import { eq, desc, and, lt, gt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { rooms, roomMessages, consensusDecisions, debateRounds } from "@paperclipai/db";
import {
  RoomState,
  MessageType,
  VALID_TRANSITIONS,
  RoomConfigSchema,
  CreateRoomSchema,
  ConfigValidationError,
  NotFoundError,
  DuplicateError,
  InvalidTransitionError,
} from "./types.js";
import type {
  Room,
  RoomMessage,
  RoomConfig,
  RoomListItem,
  CreateRoomInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types for repository method parameters
// ---------------------------------------------------------------------------

export interface AddMessageInput {
  correlationId: string;
  type: MessageType;
  sender: string;
  senderAgentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  linkedIssueIds?: string[];
  debateRound?: number;
  consensusOutcome?: string;
}

export interface GetMessagesOptions {
  limit?: number;
  before?: string; // message ID for cursor pagination (fetch older messages)
  after?: string; // message ID for SSE reconnection (fetch newer messages)
}

export interface PaginatedMessages {
  data: RoomMessage[];
  pagination: {
    hasMore: boolean;
    nextBefore?: string;
  };
}

// ---------------------------------------------------------------------------
// Consensus decision & debate round types
// ---------------------------------------------------------------------------

export interface CreateConsensusDecisionInput {
  roomId: string;
  triggerMessageId: string;
  correlationId: string;
  plan: unknown;
  debateRounds: number;
  debateOutcome: string;
  classification: string;
  unresolved?: string[];
}

export interface ConsensusDecision {
  id: string;
  roomId: string;
  triggerMessageId: string;
  correlationId: string;
  plan: unknown;
  debateRounds: number;
  debateOutcome: string;
  unresolved: string[] | null;
  classification: string;
  createdAt: Date;
}

export interface CreateDebateRoundInput {
  consensusDecisionId: string;
  roundNumber: number;
  leaderProposal: unknown;
  leaderReasoning: string;
  daDecision: string;
  daChallengePoints: string[];
  daConfidence: string;
  leaderRevision: unknown;
  leaderChanges: string[];
}

export interface DebateRound {
  id: string;
  consensusDecisionId: string;
  roundNumber: number;
  leaderProposal: unknown;
  leaderReasoning: string;
  daDecision: string;
  daChallengePoints: string[];
  daConfidence: string;
  leaderRevision: unknown;
  leaderChanges: string[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Table / query helper references (for dependency injection in tests)
// ---------------------------------------------------------------------------

/** Column reference type — matches Drizzle's PgColumn. */
export type ColumnRef = { _: unknown; columnType: { data: unknown } };

/** Table reference type — matches Drizzle's PgTable. */
export interface TableRef {
  [key: string]: ColumnRef;
}

/** Drizzle condition expression. */
export type Condition = unknown;

/** Drizzle order-by expression. */
export type OrderExpr = unknown;

export interface QueryHelpers {
  eq(col: ColumnRef, val: unknown): Condition;
  and(...conds: Condition[]): Condition;
  lt(col: ColumnRef, val: unknown): Condition;
  gt(col: ColumnRef, val: unknown): Condition;
  desc(col: ColumnRef): OrderExpr;
}

export interface RoomTables {
  rooms: TableRef & { id: ColumnRef; companyId: ColumnRef; createdAt: ColumnRef; state: ColumnRef; spentUsd: ColumnRef };
  roomMessages: TableRef & { id: ColumnRef; roomId: ColumnRef; createdAt: ColumnRef };
  consensusDecisions: TableRef & { id: ColumnRef; consensusDecisionId: ColumnRef };
  debateRounds: TableRef & { id: ColumnRef; consensusDecisionId: ColumnRef; roundNumber: ColumnRef; createdAt: ColumnRef };
}

// ---------------------------------------------------------------------------
// Default table references (production imports)
// ---------------------------------------------------------------------------

const defaultTables: RoomTables = {
  rooms: rooms as unknown as RoomTables["rooms"],
  roomMessages: roomMessages as unknown as RoomTables["roomMessages"],
  consensusDecisions: consensusDecisions as unknown as RoomTables["consensusDecisions"],
  debateRounds: debateRounds as unknown as RoomTables["debateRounds"],
};

const defaultHelpers: QueryHelpers = { eq, and, lt, gt, desc };

// ---------------------------------------------------------------------------
// Row mapper helpers
// ---------------------------------------------------------------------------

function mapRowToRoom(row: Record<string, unknown>): Room {
  const rawConfig = row.config as Record<string, unknown>;
  const parsed = RoomConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new ConfigValidationError(
      `Stored room config is invalid: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  return {
    id: row.id as string,
    companyId: row.companyId as string,
    name: row.name as string,
    displayName: row.displayName as string,
    description: (row.description as string) ?? null,
    config: parsed.data as RoomConfig,
    state: row.state as RoomState,
    currentMessageId: (row.currentMessageId as string) ?? null,
    linkedGoalId: (row.linkedGoalId as string) ?? null,
    linkedProjectId: (row.linkedProjectId as string) ?? null,
    monthlyBudgetUsd: row.monthlyBudgetUsd as string,
    spentUsd: row.spentUsd as string,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function mapRowToRoomMessage(row: Record<string, unknown>): RoomMessage {
  return {
    id: row.id as string,
    roomId: row.roomId as string,
    correlationId: row.correlationId as string,
    type: row.type as MessageType,
    sender: row.sender as string,
    senderAgentId: (row.senderAgentId as string) ?? null,
    content: row.content as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    linkedIssueIds: (row.linkedIssueIds as string[]) ?? [],
    debateRound: (row.debateRound as number) ?? null,
    consensusOutcome: (row.consensusOutcome as string) ?? null,
    createdAt: row.createdAt as Date,
  };
}

function mapRowToRoomListItem(
  row: Record<string, unknown>,
  messageCount = 0,
  lastActivityAt: Date | null = null,
): RoomListItem {
  return {
    id: row.id as string,
    name: row.name as string,
    displayName: row.displayName as string,
    state: row.state as RoomState,
    linkedGoalId: (row.linkedGoalId as string) ?? null,
    linkedProjectId: (row.linkedProjectId as string) ?? null,
    spentUsd: row.spentUsd as string,
    monthlyBudgetUsd: row.monthlyBudgetUsd as string,
    updatedAt: row.updatedAt as Date,
    messageCount,
    lastActivityAt,
  };
}

function mapRowToConsensusDecision(row: Record<string, unknown>): ConsensusDecision {
  return {
    id: row.id as string,
    roomId: row.roomId as string,
    triggerMessageId: row.triggerMessageId as string,
    correlationId: row.correlationId as string,
    plan: row.plan,
    debateRounds: row.debateRounds as number,
    debateOutcome: row.debateOutcome as string,
    unresolved: (row.unresolved as string[]) ?? null,
    classification: row.classification as string,
    createdAt: row.createdAt as Date,
  };
}

function mapRowToDebateRound(row: Record<string, unknown>): DebateRound {
  return {
    id: row.id as string,
    consensusDecisionId: row.consensusDecisionId as string,
    roundNumber: row.roundNumber as number,
    leaderProposal: row.leaderProposal,
    leaderReasoning: row.leaderReasoning as string,
    daDecision: row.daDecision as string,
    daChallengePoints: (row.daChallengePoints as string[]) ?? [],
    daConfidence: (row.daConfidence as string) ?? null,
    leaderRevision: row.leaderRevision,
    leaderChanges: (row.leaderChanges as string[]) ?? [],
    createdAt: row.createdAt as Date,
  };
}

// ---------------------------------------------------------------------------
// Default config (used when no config is provided on creation)
// ---------------------------------------------------------------------------

const DEFAULT_ROOM_CONFIG: RoomConfig = {
  leader: {
    agentId: "00000000-0000-0000-0000-000000000000",
    systemPrompt: "Default room leader system prompt.",
  },
  devilsAdvocate: {
    agentId: "00000000-0000-0000-0000-000000000000",
    systemPrompt: "Default devil's advocate system prompt.",
  },
  workers: {
    count: 1,
    agentTemplate: {
      systemPrompt: "Default worker system prompt.",
      model: "gpt-4",
    },
  },
  consensus: {
    maxRounds: 3,
    forceResolveStrategy: "leader-decides",
    escalationThreshold: 0.6,
  },
};

// ---------------------------------------------------------------------------
// RoomRepository
// ---------------------------------------------------------------------------

export interface RoomRepositoryDeps {
  db: Db;
  tables?: RoomTables;
  helpers?: QueryHelpers;
}

export class RoomRepository {
  private readonly db: Db;
  private readonly tables: RoomTables;
  private readonly h: QueryHelpers;

  constructor(deps: RoomRepositoryDeps) {
    this.db = deps.db;
    this.tables = deps.tables ?? defaultTables;
    this.h = deps.helpers ?? defaultHelpers;
  }

  // -------------------------------------------------------------------------
  // Room CRUD
  // -------------------------------------------------------------------------

  async createRoom(companyId: string, input: CreateRoomInput): Promise<Room> {
    // Validate the full input schema
    const parsed = CreateRoomSchema.safeParse(input);
    if (!parsed.success) {
      throw new ConfigValidationError(
        `Invalid room input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    // Validate config separately if provided
    const config = input.config
      ? RoomConfigSchema.parse(input.config)
      : DEFAULT_ROOM_CONFIG;

    const row = await this.db
      .insert(this.tables.rooms)
      .values({
        companyId,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        config: config as unknown as Record<string, unknown>,
        state: RoomState.IDLE,
        monthlyBudgetUsd: input.monthlyBudgetUsd ?? "100.0000",
        spentUsd: "0.0000",
        linkedGoalId: input.linkedGoalId ?? null,
        linkedProjectId: input.linkedProjectId ?? null,
      } as any)
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw new Error("Failed to insert room");
    }

    return mapRowToRoom(row as unknown as Record<string, unknown>);
  }

  async getRoom(roomId: string): Promise<Room> {
    const row = await this.db
      .select()
      .from(this.tables.rooms)
      .where(this.h.eq(this.tables.rooms.id, roomId))
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw new NotFoundError("Room", roomId);
    }

    return mapRowToRoom(row as unknown as Record<string, unknown>);
  }

  async listRooms(companyId: string): Promise<RoomListItem[]> {
    const rows = await this.db
      .select()
      .from(this.tables.rooms)
      .where(this.h.eq(this.tables.rooms.companyId, companyId));

    if (rows.length === 0) return [];

    const roomIds = rows.map((r) => (r as unknown as Record<string, unknown>).id as string);

    // Count messages per room
    const countRows = await this.db
      .select({
        roomId: this.tables.roomMessages.roomId,
        count: sql<number>`count(*)::int`,
      })
      .from(this.tables.roomMessages)
      .where(sql`${this.tables.roomMessages.roomId} = ANY(${roomIds})`)
      .groupBy(this.tables.roomMessages.roomId) as unknown as Array<{ roomId: string; count: number }>;

    const countMap = new Map(countRows.map((r) => [r.roomId, r.count]));

    // Get latest message timestamp per room
    const activityRows = await this.db
      .select({
        roomId: this.tables.roomMessages.roomId,
        lastActivityAt: sql<Date | null>`max(${this.tables.roomMessages.createdAt})`,
      })
      .from(this.tables.roomMessages)
      .where(sql`${this.tables.roomMessages.roomId} = ANY(${roomIds})`)
      .groupBy(this.tables.roomMessages.roomId) as unknown as Array<{ roomId: string; lastActivityAt: Date | null }>;

    const activityMap = new Map(activityRows.map((r) => [r.roomId, r.lastActivityAt]));

    return rows.map((row) => {
      const id = (row as unknown as Record<string, unknown>).id as string;
      return mapRowToRoomListItem(
        row as unknown as Record<string, unknown>,
        countMap.get(id) ?? 0,
        activityMap.get(id) ?? null,
      );
    });
  }

  async updateState(roomId: string, newState: RoomState): Promise<Room> {
    // Fetch current room to validate transition
    const current = await this.getRoom(roomId);
    const allowedTargets = VALID_TRANSITIONS[current.state];

    if (!allowedTargets.includes(newState)) {
      throw new InvalidTransitionError(current.state, newState);
    }

    const updated = await this.db
      .update(this.tables.rooms)
      .set({
        state: newState,
        updatedAt: new Date(),
      } as any)
      .where(this.h.eq(this.tables.rooms.id, roomId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!updated) {
      throw new NotFoundError("Room", roomId);
    }

    return mapRowToRoom(updated as unknown as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async addMessage(roomId: string, input: AddMessageInput): Promise<RoomMessage> {
    try {
      const row = await this.db
        .insert(this.tables.roomMessages)
        .values({
          roomId,
          correlationId: input.correlationId,
          type: input.type,
          sender: input.sender,
          senderAgentId: input.senderAgentId ?? null,
          content: input.content,
          metadata: input.metadata ?? {},
          linkedIssueIds: input.linkedIssueIds ?? [],
          debateRound: input.debateRound ?? null,
          consensusOutcome: input.consensusOutcome ?? null,
        } as any)
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!row) {
        throw new Error("Failed to insert message");
      }

      return mapRowToRoomMessage(row as unknown as Record<string, unknown>);
    } catch (err: unknown) {
      // Detect unique constraint violation on (correlationId, type)
      if (isUniqueConstraintError(err)) {
        throw new DuplicateError(
          "RoomMessage",
          "correlationId+type",
          `${input.correlationId}/${input.type}`,
        );
      }
      throw err;
    }
  }

  async getMessages(
    roomId: string,
    opts: GetMessagesOptions = {},
  ): Promise<PaginatedMessages> {
    const limit = opts.limit ?? 50;

    const conditions = [this.h.eq(this.tables.roomMessages.roomId, roomId)];
    if (opts.before) {
      // Cursor pagination: fetch messages created before the given message ID's timestamp
      const cursorRow = await this.db
        .select({ createdAt: this.tables.roomMessages.createdAt })
        .from(this.tables.roomMessages)
        .where(this.h.eq(this.tables.roomMessages.id, opts.before))
        .then((rows) => rows[0] ?? null);

      if (cursorRow) {
        conditions.push(this.h.lt(this.tables.roomMessages.createdAt, cursorRow.createdAt));
      }
    }
    if (opts.after) {
      // SSE reconnection: fetch messages created after the given message ID's timestamp
      const cursorRow = await this.db
        .select({ createdAt: this.tables.roomMessages.createdAt })
        .from(this.tables.roomMessages)
        .where(this.h.eq(this.tables.roomMessages.id, opts.after))
        .then((rows) => rows[0] ?? null);

      if (cursorRow) {
        conditions.push(this.h.gt(this.tables.roomMessages.createdAt, cursorRow.createdAt));
      }
    }

    const rows = await this.db
      .select()
      .from(this.tables.roomMessages)
      .where(this.h.and(...conditions))
      .orderBy(this.h.desc(this.tables.roomMessages.createdAt))
      .limit(limit + 1); // Fetch one extra to determine hasMore

    const hasMore = rows.length > limit;
    const data = rows
      .slice(0, limit)
      .map((row) =>
        mapRowToRoomMessage(row as unknown as Record<string, unknown>),
      );

    const pagination: PaginatedMessages["pagination"] = { hasMore };
    if (hasMore && data.length > 0) {
      pagination.nextBefore = data[data.length - 1].id;
    }

    return { data, pagination };
  }

  // -------------------------------------------------------------------------
  // Budget
  // -------------------------------------------------------------------------

  async updateSpent(roomId: string, additionalUsd: string): Promise<void> {
    const result = await this.db
      .update(this.tables.rooms)
      .set({
        spentUsd: sql`${this.tables.rooms.spentUsd}::numeric + ${additionalUsd}::numeric`,
        updatedAt: new Date(),
      } as any)
      .where(this.h.eq(this.tables.rooms.id, roomId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!result) {
      throw new NotFoundError("Room", roomId);
    }
  }

  async getRoomSpend(roomId: string): Promise<string> {
    const row = await this.db
      .select({ spentUsd: this.tables.rooms.spentUsd })
      .from(this.tables.rooms)
      .where(this.h.eq(this.tables.rooms.id, roomId))
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw new NotFoundError("Room", roomId);
    }

    return row.spentUsd as string;
  }

  // -------------------------------------------------------------------------
  // Consensus decisions
  // -------------------------------------------------------------------------

  async createConsensusDecision(input: CreateConsensusDecisionInput): Promise<ConsensusDecision> {
    const row = await this.db
      .insert(this.tables.consensusDecisions)
      .values({
        roomId: input.roomId,
        triggerMessageId: input.triggerMessageId,
        correlationId: input.correlationId,
        plan: input.plan,
        debateRounds: input.debateRounds,
        debateOutcome: input.debateOutcome,
        unresolved: input.unresolved ?? null,
        classification: input.classification,
      } as any)
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw new Error("Failed to insert consensus decision");
    }

    return mapRowToConsensusDecision(row as unknown as Record<string, unknown>);
  }

  async getConsensusDecision(decisionId: string): Promise<ConsensusDecision> {
    const row = await this.db
      .select()
      .from(this.tables.consensusDecisions)
      .where(this.h.eq(this.tables.consensusDecisions.id, decisionId))
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw new NotFoundError("ConsensusDecision", decisionId);
    }

    return mapRowToConsensusDecision(row as unknown as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // Debate rounds
  // -------------------------------------------------------------------------

  async createDebateRound(input: CreateDebateRoundInput): Promise<DebateRound> {
    const row = await this.db
      .insert(this.tables.debateRounds)
      .values({
        consensusDecisionId: input.consensusDecisionId,
        roundNumber: input.roundNumber,
        leaderProposal: input.leaderProposal,
        leaderReasoning: input.leaderReasoning,
        daDecision: input.daDecision,
        daChallengePoints: input.daChallengePoints,
        daConfidence: input.daConfidence,
        leaderRevision: input.leaderRevision,
        leaderChanges: input.leaderChanges,
      } as any)
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!row) {
      throw new Error("Failed to insert debate round");
    }

    return mapRowToDebateRound(row as unknown as Record<string, unknown>);
  }

  async getDebateRounds(consensusDecisionId: string): Promise<DebateRound[]> {
    const rows = await this.db
      .select()
      .from(this.tables.debateRounds)
      .where(this.h.eq(this.tables.debateRounds.consensusDecisionId, consensusDecisionId))
      .orderBy(this.h.desc(this.tables.debateRounds.roundNumber))
      .then((rows) => rows as unknown[]);

    return rows.map((row) => mapRowToDebateRound(row as Record<string, unknown>));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect PostgreSQL unique constraint violation errors.
 * Both pg and node-postgres wrap constraint errors differently;
 * this heuristic checks the common patterns.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("unique constraint") ||
      msg.includes("duplicate key") ||
      msg.includes("uq_room_messages_correlation_type")
    );
  }
  return false;
}
