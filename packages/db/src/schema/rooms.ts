import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { goals } from "./goals.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    state: text("state").notNull().default("IDLE"),
    currentMessageId: uuid("current_message_id"),
    linkedGoalId: uuid("linked_goal_id").references(() => goals.id),
    linkedProjectId: uuid("linked_project_id").references(() => projects.id),
    monthlyBudgetUsd: text("monthly_budget_usd").notNull().default("100.0000"),
    spentUsd: text("spent_usd").notNull().default("0.0000"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("idx_rooms_company").on(table.companyId),
  }),
);

export const roomMessages = pgTable(
  "room_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    correlationId: text("correlation_id").notNull(),
    type: text("type").notNull(),
    sender: text("sender").notNull(),
    senderAgentId: uuid("sender_agent_id").references(() => agents.id),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    linkedIssueIds: jsonb("linked_issue_ids").$type<string[]>().default([]),
    debateRound: integer("debate_round"),
    consensusOutcome: text("consensus_outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedIdx: index("idx_room_messages_room_created").on(table.roomId, table.createdAt),
    correlationIdx: index("idx_room_messages_correlation").on(table.correlationId),
    correlationTypeUniq: uniqueIndex("uq_room_messages_correlation_type").on(table.correlationId, table.type),
  }),
);

export const consensusDecisions = pgTable(
  "consensus_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    triggerMessageId: uuid("trigger_message_id").notNull().references(() => roomMessages.id),
    correlationId: text("correlation_id").notNull().unique(),
    plan: jsonb("plan").notNull(),
    debateRounds: integer("debate_rounds").notNull(),
    debateOutcome: text("debate_outcome").notNull(),
    unresolved: jsonb("unresolved").$type<string[] | null>(),
    classification: text("classification").notNull().default("complex"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("idx_consensus_room").on(table.roomId),
  }),
);

export const debateRounds = pgTable(
  "debate_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consensusDecisionId: uuid("consensus_decision_id").notNull().references(() => consensusDecisions.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    leaderProposal: jsonb("leader_proposal").notNull(),
    leaderReasoning: text("leader_reasoning").notNull(),
    daDecision: text("da_decision").notNull(),
    daChallengePoints: jsonb("da_challenge_points").$type<string[]>().default([]),
    daConfidence: text("da_confidence"),
    leaderRevision: jsonb("leader_revision"),
    leaderChanges: jsonb("leader_changes").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    decisionRoundUniq: uniqueIndex("uq_debate_rounds_decision_round").on(table.consensusDecisionId, table.roundNumber),
  }),
);

export const workerSessions = pgTable(
  "worker_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    consensusDecisionId: uuid("consensus_decision_id").notNull().references(() => consensusDecisions.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    taskDefinition: jsonb("task_definition").notNull(),
    status: text("status").notNull().default("pending"),
    piSessionId: text("pi_session_id"),
    piSessionFilePath: text("pi_session_file_path"),
    output: text("output"),
    costUsd: text("cost_usd").notNull().default("0.0000"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueIdx: index("idx_worker_sessions_issue").on(table.issueId),
    consensusIdx: index("idx_worker_sessions_consensus").on(table.consensusDecisionId),
  }),
);
