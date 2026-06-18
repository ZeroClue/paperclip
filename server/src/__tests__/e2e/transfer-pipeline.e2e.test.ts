import { describe, expect, it } from "vitest";
import { createTransferExecutionService } from "../../services/transfer-execution.js";

describe("Transfer Pipeline E2E", () => {
  describe("Full pipeline: create → running → completed", () => {
    it("executes a complete transfer lifecycle", () => {
      const svc = createTransferExecutionService();

      const execution = svc.create({
        customerId: "acme-corp",
        sourceAgentId: "agent-alpha",
        targetAgentId: "agent-beta",
        metadata: { fileCount: 42 },
      });
      expect(execution.status).toBe("pending");
      expect(execution.customerId).toBe("acme-corp");
      expect(execution.sourceAgentId).toBe("agent-alpha");
      expect(execution.targetAgentId).toBe("agent-beta");
      expect(execution.metadata).toEqual({ fileCount: 42 });

      const started = svc.update(execution.id, { status: "running" });
      expect(started.status).toBe("running");
      expect(started.updatedAt.getTime()).toBeGreaterThanOrEqual(started.createdAt.getTime());

      const completed = svc.update(execution.id, { status: "completed" });
      expect(completed.status).toBe("completed");

      const fromStore = svc.get(execution.id);
      expect(fromStore?.status).toBe("completed");
    });
  });

  describe("Failure path: create → running → failed", () => {
    it("transitions to failed with error message", () => {
      const svc = createTransferExecutionService();

      const execution = svc.create({
        customerId: "acme-corp",
        sourceAgentId: "agent-alpha",
        targetAgentId: "agent-beta",
      });

      svc.update(execution.id, { status: "running" });
      const failed = svc.update(execution.id, { status: "failed", error: "Connection lost" });
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("Connection lost");

      const fromStore = svc.get(execution.id);
      expect(fromStore?.status).toBe("failed");
      expect(fromStore?.error).toBe("Connection lost");
    });
  });

  describe("State machine enforcement", () => {
    it("rejects completed → running transition", () => {
      const svc = createTransferExecutionService();
      const execution = svc.create({ customerId: "c1", sourceAgentId: "a1", targetAgentId: "a2" });
      svc.update(execution.id, { status: "running" });
      svc.update(execution.id, { status: "completed" });
      expect(() => svc.update(execution.id, { status: "running" })).toThrow();
    });

    it("rejects pending → completed transition (skips running)", () => {
      const svc = createTransferExecutionService();
      const execution = svc.create({ customerId: "c1", sourceAgentId: "a1", targetAgentId: "a2" });
      expect(() => svc.update(execution.id, { status: "completed" })).toThrow();
    });

    it("rejects failed → running transition", () => {
      const svc = createTransferExecutionService();
      const execution = svc.create({ customerId: "c1", sourceAgentId: "a1", targetAgentId: "a2" });
      svc.update(execution.id, { status: "running" });
      svc.update(execution.id, { status: "failed", error: "err" });
      expect(() => svc.update(execution.id, { status: "running" })).toThrow();
    });
  });

  describe("Company boundary enforcement", () => {
    it("lists transfers scoped to customerId", () => {
      const svc = createTransferExecutionService();

      svc.create({ customerId: "acme", sourceAgentId: "a1", targetAgentId: "a2" });
      svc.create({ customerId: "globex", sourceAgentId: "a3", targetAgentId: "a4" });
      svc.create({ customerId: "acme", sourceAgentId: "a5", targetAgentId: "a6" });

      const acmeTransfers = svc.getByCustomerId("acme");
      expect(acmeTransfers).toHaveLength(2);
      acmeTransfers.forEach((t) => expect(t.customerId).toBe("acme"));

      const allTransfers = svc.list();
      expect(allTransfers).toHaveLength(3);
    });

    it("returns empty list for unknown customer", () => {
      const svc = createTransferExecutionService();
      svc.create({ customerId: "acme", sourceAgentId: "a1", targetAgentId: "a2" });
      expect(svc.getByCustomerId("nonexistent")).toHaveLength(0);
    });
  });

  describe("Event subscription", () => {
    it("fires events through the lifecycle", () => {
      const svc = createTransferExecutionService();
      const events: string[] = [];

      svc.onEvent((event) => {
        events.push(event.type);
      });

      const execution = svc.create({ customerId: "c1", sourceAgentId: "a1", targetAgentId: "a2" });
      expect(events).toEqual(["created"]);

      svc.update(execution.id, { status: "running" });
      expect(events).toEqual(["created", "started"]);

      svc.update(execution.id, { status: "completed" });
      expect(events).toEqual(["created", "started", "completed"]);
    });

    it("allows unsubscribe", () => {
      const svc = createTransferExecutionService();
      const events: string[] = [];

      const unsubscribe = svc.onEvent((event) => {
        events.push(event.type);
      });

      const execution = svc.create({ customerId: "c1", sourceAgentId: "a1", targetAgentId: "a2" });
      expect(events).toEqual(["created"]);

      unsubscribe();

      svc.update(execution.id, { status: "running" });
      expect(events).toEqual(["created"]);
    });
  });

  describe("Validation", () => {
    it("rejects create with missing customerId", () => {
      const svc = createTransferExecutionService();
      expect(() =>
        svc.create({ customerId: "", sourceAgentId: "a1", targetAgentId: "a2" })
      ).toThrow();
    });

    it("rejects create with missing sourceAgentId", () => {
      const svc = createTransferExecutionService();
      expect(() =>
        svc.create({ customerId: "c1", sourceAgentId: "", targetAgentId: "a2" })
      ).toThrow();
    });

    it("throws on get for unknown id", () => {
      const svc = createTransferExecutionService();
      expect(svc.get("nonexistent")).toBeUndefined();
    });
  });
});
