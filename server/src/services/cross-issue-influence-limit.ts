import { and, count, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, heartbeatRuns, issues } from "@paperclipai/db";
import { isUuidLike, issueWriteDenialResponse } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { logger } from "../middleware/logger.js";

export const CROSS_ISSUE_INFLUENCE_LIMIT = 20;
export const CROSS_ISSUE_INFLUENCE_ENFORCE_AT = new Date("2026-08-11T00:00:00.000Z");

const CROSS_ISSUE_INFLUENCE_ACTIVITY = "issue.cross_issue_influence_observed";
const CROSS_ISSUE_INFLUENCE_REJECTED_ACTIVITY = "issue.cross_issue_influence_cap_rejected";

/**
 * Every kind shares one per-run counter. `interaction_resolution` covers the
 * issue-thread accept/reject/respond/verdict routes: an open `anyone` resolver
 * audience is not a licence to resolve, wake, and spawn suggested tasks across
 * the whole company from one run.
 */
export type CrossIssueInfluenceKind = "comment" | "update" | "interaction_resolution";

export type CrossIssueInfluenceDecision = {
  allowed: boolean;
  mode: "log_only" | "enforce";
  count: number;
  cap: number;
  enforceAt: string;
};

export function crossIssueInfluenceRunContextError() {
  // Copy comes from the shared issue-write denial contract (the open cross-task write design (failure UX))
  // so the agent reading this 403 is told the fix, not just the refusal.
  const { body } = issueWriteDenialResponse("cross_issue_influence_run_context_required");
  return forbidden(body.error, body.details);
}

function readRunSourceIssueId(contextSnapshot: unknown) {
  if (!contextSnapshot || typeof contextSnapshot !== "object" || Array.isArray(contextSnapshot)) return null;
  const context = contextSnapshot as Record<string, unknown>;
  for (const candidate of [context.issueId, context.taskId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Stamps the checked-out issue onto a run's context snapshot as its source
 * issue.
 *
 * Timer/maintenance wakes intentionally start unscoped ("unscoped timer wake
 * starts fresh"): their context snapshot carries no `issueId`, so every issue
 * write from such a run fails closed with
 * `cross_issue_influence_run_context_required` — the run cannot leave durable
 * progress notes even on the one issue it is working.
 *
 * Checkout is the moment an unscoped run binds itself to exactly one issue:
 * the route already enforces "agent can only checkout as itself", so the run
 * row is unambiguous. From then on the middleware treats writes to that issue
 * as same-issue and counts only genuinely cross-issue attempts against the
 * cap — the guard's fail-closed posture is unchanged.
 *
 * Never re-scopes: if the snapshot already carries a source (`issueId` or
 * `taskId`) it is left untouched, so a scoped run cannot launder its scope or
 * cap history by checking out another issue.
 */
export async function stampRunSourceIssueContext(
  db: Db,
  input: {
    runId: string;
    agentId: string;
    companyId: string;
    issueId: string;
  },
): Promise<boolean> {
  // Same validation the observer applies to the header-supplied run id before
  // it may reach PostgreSQL.
  if (!isUuidLike(input.runId)) return false;

  return db.transaction(async (tx) => {
    const run = await tx
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.id, input.runId),
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.agentId, input.agentId),
      ))
      .for("update")
      .then((rows) => rows[0] ?? null);
    if (!run) return false;

    const context = (run.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
      ? run.contextSnapshot
      : {}) as Record<string, unknown>;
    if (readRunSourceIssueId(context)) return false;

    await tx
      .update(heartbeatRuns)
      .set({ contextSnapshot: { ...context, issueId: input.issueId } })
      .where(eq(heartbeatRuns.id, run.id));

    logger.info(
      {
        event: "run_source_issue_stamped",
        companyId: input.companyId,
        runId: input.runId,
        agentId: input.agentId,
        issueId: input.issueId,
      },
      "run source issue stamped from checkout",
    );
    return true;
  });
}

export function evaluateCrossIssueInfluenceLimit(input: {
  priorCount: number;
  now?: Date;
}): CrossIssueInfluenceDecision {
  const now = input.now ?? new Date();
  const mode = now >= CROSS_ISSUE_INFLUENCE_ENFORCE_AT ? "enforce" : "log_only";
  const nextCount = input.priorCount + 1;
  return {
    allowed: mode === "log_only" || nextCount <= CROSS_ISSUE_INFLUENCE_LIMIT,
    mode,
    count: nextCount,
    cap: CROSS_ISSUE_INFLUENCE_LIMIT,
    enforceAt: CROSS_ISSUE_INFLUENCE_ENFORCE_AT.toISOString(),
  };
}

/**
 * Atomically observes one cross-issue influence attempt for a heartbeat run.
 *
 * Locking the run row serializes concurrent attempts from the same run. The
 * observation is intentionally recorded before the route mutation: once the
 * rollout reaches enforcement, failures cannot be used to race or probe past
 * the fail-closed backstop.
 *
 * An unscoped snapshot is not automatically a refusal: if the run currently
 * holds the target issue's checkout, it scoped itself at pickup and the write
 * is same-issue. Everything else still fails closed.
 */
export async function observeCrossIssueInfluence(
  db: Db,
  input: {
    companyId: string;
    runId: string;
    agentId: string;
    responsibleUserId?: string | null;
    targetIssueId: string;
    targetIssueIdentifier?: string | null;
    kind: CrossIssueInfluenceKind;
    now?: Date;
  },
): Promise<CrossIssueInfluenceDecision | null> {
  // API-key callers control the run header. Reject malformed UUIDs before the
  // database can turn an untrusted identifier into a PostgreSQL cast error.
  if (!isUuidLike(input.runId)) throw crossIssueInfluenceRunContextError();
  // The checkout-scope fallback compares this against issues.id (uuid), so it
  // must be a well-formed UUID too.
  if (!isUuidLike(input.targetIssueId)) throw crossIssueInfluenceRunContextError();

  return db.transaction(async (tx) => {
    const run = await tx
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        responsibleUserId: heartbeatRuns.responsibleUserId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.id, input.runId),
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.agentId, input.agentId),
      ))
      .for("update")
      .then((rows) => rows[0] ?? null);
    if (
      !run ||
      run.companyId !== input.companyId ||
      run.agentId !== input.agentId
    ) {
      throw crossIssueInfluenceRunContextError();
    }

    const sourceIssueId = readRunSourceIssueId(run.contextSnapshot);
    if (!sourceIssueId) {
      // Bare timer/maintenance wakes intentionally start with an unscoped
      // snapshot. Checkout is the moment such a run binds itself to exactly
      // one issue, so a run that currently holds the target issue's checkout
      // IS scoped to it: treat the write as same-issue. Read without a row
      // lock — checkout commits atomically and a stale read only keeps the
      // fail-closed throw below.
      const checkedOutRunId = await tx
        .select({ checkoutRunId: issues.checkoutRunId })
        .from(issues)
        .where(and(
          eq(issues.companyId, input.companyId),
          eq(issues.id, input.targetIssueId),
        ))
        .then((rows) => rows[0]?.checkoutRunId ?? null);
      if (checkedOutRunId === input.runId) {
        logger.info(
          {
            event: "cross_issue_influence_checkout_scope",
            companyId: input.companyId,
            runId: input.runId,
            agentId: input.agentId,
            targetIssueId: input.targetIssueId,
            kind: input.kind,
          },
          "unscoped run write allowed via held checkout",
        );
        return null;
      }
      throw crossIssueInfluenceRunContextError();
    }
    if (
      sourceIssueId === input.targetIssueId ||
      (input.targetIssueIdentifier && sourceIssueId.toUpperCase() === input.targetIssueIdentifier.toUpperCase())
    ) {
      return null;
    }

    const priorCount = await tx
      .select({ count: count() })
      .from(activityLog)
      .where(and(
        eq(activityLog.companyId, input.companyId),
        eq(activityLog.runId, input.runId),
        eq(activityLog.action, CROSS_ISSUE_INFLUENCE_ACTIVITY),
      ))
      .then((rows) => Number(rows[0]?.count ?? 0));
    const decision = evaluateCrossIssueInfluenceLimit({ priorCount, now: input.now });

    await tx.insert(activityLog).values({
      companyId: input.companyId,
      actorType: "agent",
      actorId: input.agentId,
      agentId: input.agentId,
      runId: input.runId,
      responsibleUserId: input.responsibleUserId ?? run.responsibleUserId ?? null,
      action: decision.allowed
        ? CROSS_ISSUE_INFLUENCE_ACTIVITY
        : CROSS_ISSUE_INFLUENCE_REJECTED_ACTIVITY,
      entityType: "issue",
      entityId: input.targetIssueId,
      details: {
        kind: input.kind,
        sourceIssueId,
        targetIssueId: input.targetIssueId,
        targetIssueIdentifier: input.targetIssueIdentifier ?? null,
        count: decision.count,
        cap: decision.cap,
        mode: decision.mode,
        enforceAt: decision.enforceAt,
        allowed: decision.allowed,
      },
    });

    const logContext = {
      event: "cross_issue_influence_cap",
      companyId: input.companyId,
      runId: input.runId,
      agentId: input.agentId,
      sourceIssueId,
      targetIssueId: input.targetIssueId,
      kind: input.kind,
      count: decision.count,
      cap: decision.cap,
      mode: decision.mode,
      enforceAt: decision.enforceAt,
      allowed: decision.allowed,
    };
    if (decision.allowed) {
      logger.info(logContext, "cross-issue influence observed");
    } else {
      logger.warn(logContext, "cross-issue influence cap exceeded");
    }

    return decision;
  });
}

export function crossIssueInfluenceLimitError(
  decision: CrossIssueInfluenceDecision,
  context: { actorLabel?: string | null; assigneeLabel?: string | null; issueIdentifier?: string | null } = {},
) {
  // The cap is a rate backstop, not a permission decision — the shared copy
  // contract says so explicitly, and names the next run as the way forward.
  const { body } = issueWriteDenialResponse("cross_issue_influence_cap_exceeded", {
    ...context,
    cap: decision.cap,
    count: decision.count,
    enforceAt: decision.enforceAt,
  });
  return {
    error: body.error,
    details: {
      ...body.details,
      cap: decision.cap,
      count: decision.count,
      mode: decision.mode,
      enforceAt: decision.enforceAt,
    },
  };
}
