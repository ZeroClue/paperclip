import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum RoomState {
  IDLE = "IDLE",
  CONSENSUS = "CONSENSUS",
  BREAKDOWN = "BREAKDOWN",
  EXECUTING = "EXECUTING",
  SYNTHESISING = "SYNTHESISING",
  PAUSED = "PAUSED",
  ERROR = "ERROR",
}

export const VALID_TRANSITIONS: Record<RoomState, RoomState[]> = {
  [RoomState.IDLE]: [RoomState.CONSENSUS, RoomState.PAUSED],
  [RoomState.CONSENSUS]: [RoomState.BREAKDOWN, RoomState.EXECUTING, RoomState.PAUSED, RoomState.ERROR],
  [RoomState.BREAKDOWN]: [RoomState.CONSENSUS, RoomState.EXECUTING, RoomState.PAUSED, RoomState.ERROR],
  [RoomState.EXECUTING]: [RoomState.SYNTHESISING, RoomState.PAUSED, RoomState.ERROR],
  [RoomState.SYNTHESISING]: [RoomState.CONSENSUS, RoomState.IDLE, RoomState.PAUSED, RoomState.ERROR],
  [RoomState.PAUSED]: [RoomState.IDLE],
  [RoomState.ERROR]: [RoomState.IDLE],
};

export enum MessageType {
  TASK_REQUEST = "TASK_REQUEST",
  TASK_CLARIFICATION = "TASK_CLARIFICATION",
  LEADER_PROPOSAL = "LEADER_PROPOSAL",
  DA_CHALLENGE = "DA_CHALLENGE",
  DA_APPROVAL = "DA_APPROVAL",
  LEADER_REVISION = "LEADER_REVISION",
  CONSENSUS_REACHED = "CONSENSUS_REACHED",
  CONSENSUS_FAILED = "CONSENSUS_FAILED",
  TASK_DELEGATION = "TASK_DELEGATION",
  WORKER_OUTPUT = "WORKER_OUTPUT",
  WORKER_ERROR = "WORKER_ERROR",
  SYNTHESIS = "SYNTHESIS",
  SYSTEM = "SYSTEM",
  CONTROL = "CONTROL",
}

export enum ErrorClass {
  BAD_REQUEST = "BAD_REQUEST",
  NOT_FOUND = "NOT_FOUND",
  DUPLICATE = "DUPLICATE",
  INVALID_TRANSITION = "INVALID_TRANSITION",
  INTERNAL = "INTERNAL",
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  companyId: string;
  name: string;
  displayName: string;
  description: string | null;
  config: RoomConfig;
  state: RoomState;
  currentMessageId: string | null;
  linkedGoalId: string | null;
  linkedProjectId: string | null;
  monthlyBudgetUsd: string;
  spentUsd: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  correlationId: string;
  type: MessageType;
  sender: string;
  senderAgentId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  linkedIssueIds: string[];
  debateRound: number | null;
  consensusOutcome: string | null;
  createdAt: Date;
}

export interface ConsensusDecision {
  id: string;
  roomId: string;
  triggerMessageId: string;
  correlationId: string;
  plan: Record<string, unknown>;
  debateRounds: number;
  debateOutcome: string;
  unresolved: string[] | null;
  classification: string;
  createdAt: Date;
}

export interface DebateRound {
  id: string;
  consensusDecisionId: string;
  roundNumber: number;
  leaderProposal: Record<string, unknown>;
  leaderReasoning: string;
  daDecision: string;
  daChallengePoints: string[];
  daConfidence: string | null;
  leaderRevision: Record<string, unknown> | null;
  leaderChanges: string[];
  createdAt: Date;
}

export interface WorkerSession {
  id: string;
  roomId: string;
  consensusDecisionId: string;
  issueId: string;
  taskDefinition: Record<string, unknown>;
  status: string;
  piSessionId: string | null;
  piSessionFilePath: string | null;
  output: string | null;
  costUsd: string;
  errorDetails: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const RoomConfigSchema = z.object({
  leaderAgentId: z.string().uuid().optional(),
  daAgentId: z.string().uuid().optional(),
  workerAgentIds: z.array(z.string().uuid()).optional(),
  systemPrompt: z.string().min(10).optional(),
  maxDebateRounds: z.number().int().min(1).max(10).optional(),
  consensusThreshold: z.number().min(0.5).max(1.0).optional(),
  autoApproveSimple: z.boolean().optional(),
  maxWorkers: z.number().int().min(1).max(20).optional(),
}).strict();

export type RoomConfig = z.infer<typeof RoomConfigSchema>;

export const CreateRoomSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  linkedGoalId: z.string().uuid().optional(),
  linkedProjectId: z.string().uuid().optional(),
  monthlyBudgetUsd: z.string().regex(/^\d+\.\d{4}$/).optional(),
  config: RoomConfigSchema.optional(),
});

export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;

export const PostMessageSchema = z.object({
  type: z.nativeEnum(MessageType),
  content: z.string().min(1),
  senderAgentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
  linkedIssueIds: z.array(z.string().uuid()).optional(),
});

export type PostMessageInput = z.infer<typeof PostMessageSchema>;

export const PatchStateSchema = z.object({
  state: z.nativeEnum(RoomState),
  reason: z.string().optional(),
});

export type PatchStateInput = z.infer<typeof PatchStateSchema>;

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

export interface RoomListItem {
  id: string;
  name: string;
  displayName: string;
  state: RoomState;
  linkedGoalId: string | null;
  linkedProjectId: string | null;
  spentUsd: string;
  monthlyBudgetUsd: string;
  updatedAt: Date;
}

export interface PostMessageResponse {
  id: string;
  roomId: string;
  correlationId: string;
  type: MessageType;
  sender: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp: Date;
}

export interface SSEMessageEvent extends SSEEvent {
  type: "message";
  data: RoomMessage;
}

export interface SSEStateEvent extends SSEEvent {
  type: "state_change";
  data: { from: RoomState; to: RoomState; reason?: string };
}

export interface SSEErrorEvent extends SSEEvent {
  type: "error";
  data: { errorClass: ErrorClass; message: string };
}

export type SSEEventType = SSEMessageEvent | SSEStateEvent | SSEErrorEvent;

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} with id ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class DuplicateError extends Error {
  constructor(entity: string, field: string, value: string) {
    super(`${entity} with ${field} '${value}' already exists`);
    this.name = "DuplicateError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: RoomState, to: RoomState) {
    super(`Invalid state transition from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}
