import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bridgeTransfers } from "@paperclipai/db";
import type {
  BridgeTransfer,
  BridgeTransferStatus,
  RouteEvaluationStrategy,
  RouteProbeResult,
  RouteEvaluationInput,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";

function toBridgeTransfer(row: typeof bridgeTransfers.$inferSelect): BridgeTransfer {
  return {
    id: row.id,
    companyId: row.companyId,
    sourceAgentId: row.sourceAgentId,
    destinationAgentId: row.destinationAgentId,
    payloadType: row.payloadType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as BridgeTransferStatus,
    routeStrategy: row.routeStrategy as RouteEvaluationStrategy | null,
    probeRunId: row.probeRunId,
    probeAttemptedAt: row.probeAttemptedAt,
    probeResult: row.probeResult ? (row.probeResult as unknown as RouteProbeResult) : null,
    evaluatedAt: row.evaluatedAt,
    fallbackReason: row.fallbackReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function routeEvaluationService(db: Db) {
  async function createBridgeTransfer(
    input: RouteEvaluationInput & { probeRunId: string },
  ): Promise<BridgeTransfer> {
    const now = new Date();
    const [row] = await db
      .insert(bridgeTransfers)
      .values({
        companyId: input.companyId,
        sourceAgentId: input.sourceAgentId,
        destinationAgentId: input.destinationAgentId,
        payloadType: input.payloadType,
        payload: input.payload,
        status: "pending",
        routeStrategy: "probe_agent",
        probeRunId: input.probeRunId,
        probeAttemptedAt: now,
        updatedAt: now,
      })
      .returning();

    return toBridgeTransfer(row);
  }

  async function getBridgeTransfer(id: string): Promise<BridgeTransfer | null> {
    const row = await db
      .select()
      .from(bridgeTransfers)
      .where(eq(bridgeTransfers.id, id))
      .then((rows) => rows[0] ?? null);

    return row ? toBridgeTransfer(row) : null;
  }

  async function getBridgeTransferByRunId(runId: string): Promise<BridgeTransfer | null> {
    const row = await db
      .select()
      .from(bridgeTransfers)
      .where(eq(bridgeTransfers.probeRunId, runId))
      .then((rows) => rows[0] ?? null);

    return row ? toBridgeTransfer(row) : null;
  }

  async function reportProbeResult(
    transferId: string,
    result: RouteProbeResult,
  ): Promise<BridgeTransfer> {
    const now = new Date();
    let nextStatus: BridgeTransferStatus;
    let nextStrategy: RouteEvaluationStrategy;
    let fallbackReason: string | null = null;

    switch (result.outcome) {
      case "reachable":
        nextStatus = "direct";
        nextStrategy = "direct";
        break;
      case "unreachable":
        nextStatus = "fallback";
        nextStrategy = "smart_pipe";
        fallbackReason = result.error ?? "destination_unreachable";
        break;
      case "timeout":
        nextStatus = "fallback";
        nextStrategy = "smart_pipe";
        fallbackReason = "probe_timed_out";
        break;
      case "error":
        nextStatus = "failed";
        nextStrategy = "probe_agent";
        fallbackReason = result.error ?? "probe_error";
        break;
    }

    const [row] = await db
      .update(bridgeTransfers)
      .set({
        status: nextStatus,
        routeStrategy: nextStrategy,
        probeResult: result as unknown as Record<string, unknown>,
        evaluatedAt: now,
        fallbackReason,
        updatedAt: now,
      })
      .where(eq(bridgeTransfers.id, transferId))
      .returning();

    if (!row) {
      throw notFound("Bridge transfer not found");
    }

    return toBridgeTransfer(row);
  }

  async function markTransferProbeDispatched(
    transferId: string,
    probeRunId: string,
  ): Promise<BridgeTransfer> {
    const [row] = await db
      .update(bridgeTransfers)
      .set({
        status: "probing",
        probeRunId,
        probeAttemptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bridgeTransfers.id, transferId))
      .returning();

    if (!row) {
      throw notFound("Bridge transfer not found");
    }

    return toBridgeTransfer(row);
  }

  return {
    createBridgeTransfer,
    getBridgeTransfer,
    getBridgeTransferByRunId,
    reportProbeResult,
    markTransferProbeDispatched,
  };
}
