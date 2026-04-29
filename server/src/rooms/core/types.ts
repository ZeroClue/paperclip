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
  HUMAN = 'human',
  SYSTEM = 'system',
  LEADER_PROPOSAL = 'leader_proposal',
  DA_CHALLENGE = 'da_challenge',
  DA_AGREE = 'da_agree',
  LEADER_REVISION = 'leader_revision',
  CONSENSUS_REACHED = 'consensus_reached',
  CONSENSUS_FORCED = 'consensus_forced',
  CONSENSUS_BYPASSED = 'consensus_bypassed',
  TASK_CREATED = 'task_created',
  WORKER_STARTED = 'worker_started',
  WORKER_COMPLETED = 'worker_completed',
  WORKER_FAILED = 'worker_failed',
  SYNTHESIS = 'synthesis',
  ERROR = 'error',
}

export enum ErrorClass {
  TRANSIENT = 'TRANSIENT',
  PERMANENT = 'PERMANENT',
  AGENT_CRASH = 'AGENT_CRASH',
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
  leader: z.object({
    agentId: z.string().uuid(),
    systemPrompt: z.string().min(10),
    model: z.string().optional(),
    thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  }),
  devilsAdvocate: z.object({
    agentId: z.string().uuid(),
    systemPrompt: z.string().min(10),
    model: z.string().optional(),
    aggressionLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  workers: z.object({
    count: z.number().int().min(1).max(3).default(1),
    agentTemplate: z.object({
      systemPrompt: z.string(),
      model: z.string(),
    }),
    piConfig: z.object({
      extensions: z.array(z.string()).default([]),
      skills: z.array(z.string()).default([]),
    }).optional(),
  }),
  consensus: z.object({
    maxRounds: z.number().int().min(1).max(5).default(3),
    forceResolveStrategy: z.enum(['leader-decides', 'escalate-to-operator']).default('leader-decides'),
    escalationThreshold: z.number().min(0).max(1).default(0.6),
  }),
  budget: z.object({
    monthlyUsd: z.number().min(0).default(100),
    warnThreshold: z.number().min(0).max(1).default(0.8),
  }).optional(),
});

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
  targetState: z.nativeEnum(RoomState),
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
  messageCount: number;
  lastActivityAt: Date | null;
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
