import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const bridgeTransfers = pgTable(
  "bridge_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceAgentId: uuid("source_agent_id").notNull().references(() => agents.id),
    destinationAgentId: uuid("destination_agent_id").notNull().references(() => agents.id),
    payloadType: text("payload_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    routeStrategy: text("route_strategy"),
    probeRunId: uuid("probe_run_id"),
    probeAttemptedAt: timestamp("probe_attempted_at", { withTimezone: true }),
    probeResult: jsonb("probe_result").$type<Record<string, unknown>>(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    fallbackReason: text("fallback_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("bridge_transfers_company_status_idx").on(table.companyId, table.status),
    sourceAgentIdx: index("bridge_transfers_source_agent_idx").on(table.companyId, table.sourceAgentId),
    destinationAgentIdx: index("bridge_transfers_destination_agent_idx").on(table.companyId, table.destinationAgentId),
  }),
);
