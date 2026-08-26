import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  getEmbeddedPostgresTestSupport,
  heartbeatRuns,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import {
  observeCrossIssueInfluence,
  stampRunSourceIssueContext,
} from "./cross-issue-influence-limit.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping run source-issue stamp tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("stampRunSourceIssueContext (embedded postgres)", () => {
  let stopDb: (() => Promise<void>) | undefined;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("cross-issue-influence-stamp");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      status: "active",
      issuePrefix: companyId.slice(0, 8),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return companyId;
  }

  async function seedAgent(companyId: string): Promise<string> {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `agent-${agentId.slice(0, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return agentId;
  }

  // Mirrors a bare timer/maintenance wake: unscoped scheduler context.
  async function seedRun(
    companyId: string,
    agentId: string,
    contextSnapshot: Record<string, unknown> | null,
  ): Promise<string> {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      contextSnapshot,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return runId;
  }

  async function readContext(runId: string): Promise<Record<string, unknown> | null> {
    const row = await db
      .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    return row?.contextSnapshot ?? null;
  }

  it("stamps issueId onto an unscoped timer-wake snapshot and preserves other fields", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const runId = await seedRun(companyId, agentId, {
      source: "scheduler",
      reason: "interval_elapsed",
      wakeReason: "heartbeat_timer",
    });

    const issueId = randomUUID();
    await expect(
      stampRunSourceIssueContext(db, { runId, agentId, companyId, issueId }),
    ).resolves.toBe(true);

    expect(await readContext(runId)).toEqual({
      source: "scheduler",
      reason: "interval_elapsed",
      wakeReason: "heartbeat_timer",
      issueId,
    });
  });

  it("treats a null snapshot like an empty one", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const runId = await seedRun(companyId, agentId, null);

    const issueId = randomUUID();
    await expect(
      stampRunSourceIssueContext(db, { runId, agentId, companyId, issueId }),
    ).resolves.toBe(true);
    expect(await readContext(runId)).toEqual({ issueId });
  });

  it("never re-scopes a run that already carries a taskId", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const existingTaskId = randomUUID();
    const runId = await seedRun(companyId, agentId, { taskId: existingTaskId, wakeReason: "issue_assigned" });

    await expect(
      stampRunSourceIssueContext(db, { runId, agentId, companyId, issueId: randomUUID() }),
    ).resolves.toBe(false);
    expect(await readContext(runId)).toEqual({ taskId: existingTaskId, wakeReason: "issue_assigned" });
  });

  it("never re-scopes a run that already carries a different issueId", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const existingIssueId = randomUUID();
    const runId = await seedRun(companyId, agentId, { issueId: existingIssueId });

    await expect(
      stampRunSourceIssueContext(db, { runId, agentId, companyId, issueId: randomUUID() }),
    ).resolves.toBe(false);
    expect(await readContext(runId)).toEqual({ issueId: existingIssueId });
  });

  it("returns false when the run row does not match company and agent", async () => {
    const companyId = await seedCompany();
    const otherCompanyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const otherAgentId = await seedAgent(otherCompanyId);
    const runId = await seedRun(companyId, agentId, null);

    await expect(
      stampRunSourceIssueContext(db, { runId, agentId: otherAgentId, companyId, issueId: randomUUID() }),
    ).resolves.toBe(false);
    await expect(
      stampRunSourceIssueContext(db, { runId, agentId, companyId: otherCompanyId, issueId: randomUUID() }),
    ).resolves.toBe(false);
    await expect(
      stampRunSourceIssueContext(db, { runId: randomUUID(), agentId, companyId, issueId: randomUUID() }),
    ).resolves.toBe(false);
    expect(await readContext(runId)).toBeNull();
  });

  it("rejects non-uuid run ids without a database round trip", async () => {
    await expect(
      stampRunSourceIssueContext(db, {
        runId: "not-a-uuid; drop table heartbeat_runs",
        agentId: randomUUID(),
        companyId: randomUUID(),
        issueId: randomUUID(),
      }),
    ).resolves.toBe(false);
  });

  it("moves writes from fail-closed to same-issue allowed once stamped", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const runId = await seedRun(companyId, agentId, { source: "scheduler", reason: "interval_elapsed" });
    const issueId = randomUUID();

    // Before the stamp the observer fails closed for ANY target — the reported
    // COO-824 symptom.
    await expect(
      observeCrossIssueInfluence(db, {
        companyId,
        runId,
        agentId,
        targetIssueId: issueId,
        kind: "comment",
      }),
    ).rejects.toMatchObject({ status: 403 });

    await stampRunSourceIssueContext(db, { runId, agentId, companyId, issueId });

    // Same-issue write: no observation needed at all.
    await expect(
      observeCrossIssueInfluence(db, {
        companyId,
        runId,
        agentId,
        targetIssueId: issueId,
        targetIssueIdentifier: "COO-1",
        kind: "comment",
      }),
    ).resolves.toBeNull();

    // Cross-issue write: observed and counted against the cap.
    const decision = await observeCrossIssueInfluence(db, {
      companyId,
      runId,
      agentId,
      targetIssueId: randomUUID(),
      kind: "update",
    });
    expect(decision).toMatchObject({ allowed: true, mode: "enforce", count: 1 });
  });
});
