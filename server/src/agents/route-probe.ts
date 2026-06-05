import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns } from "@paperclipai/db";
import { notFound, conflict } from "../errors.js";
import { logger } from "../middleware/logger.js";

export interface RouteProbeDispatchInput {
  companyId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  destinationAdapterType: string;
  bridgeTransferId: string;
  probeHint: string | null;
}

export interface RouteProbeDispatchResult {
  runId: string;
}

export async function dispatchRouteProbe(
  db: Db,
  input: RouteProbeDispatchInput,
): Promise<RouteProbeDispatchResult> {
  const agent = await db
    .select({ status: agents.status })
    .from(agents)
    .where(and(eq(agents.id, input.sourceAgentId), eq(agents.companyId, input.companyId)))
    .then((rows) => rows[0] ?? null);

  if (!agent) {
    throw notFound("Source agent not found");
  }

  if (agent.status === "paused" || agent.status === "terminated") {
    throw conflict("Agent is not available for route probing");
  }

  const now = new Date();
  const [run] = await db
    .insert(heartbeatRuns)
    .values({
      companyId: input.companyId,
      agentId: input.sourceAgentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "queued",
      contextSnapshot: {
        type: "route_probe",
        bridgeTransferId: input.bridgeTransferId,
        destinationAgentId: input.destinationAgentId,
        destinationAdapterType: input.destinationAdapterType,
        probeHint: input.probeHint,
      },
      updatedAt: now,
    })
    .returning();

  logger.info(
    { runId: run.id, bridgeTransferId: input.bridgeTransferId, sourceAgentId: input.sourceAgentId },
    "dispatched route probe run",
  );

  return { runId: run.id };
}
