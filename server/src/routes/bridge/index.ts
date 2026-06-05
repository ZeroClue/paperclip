import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { RouteProbeOutcome } from "@paperclipai/shared";
import { routeEvaluationService } from "../../services/route-evaluation.js";
import { agentService } from "../../services/index.js";
import { assertCompanyAccess } from "../authz.js";

export function bridgeTransferRoutes(db: Db) {
  const router = Router();
  const evaluation = routeEvaluationService(db);
  const agents = agentService(db);

  router.post("/", async (req, res) => {
    const { companyId, sourceAgentId, destinationAgentId, payloadType, payload } = req.body ?? {};

    if (!companyId || !sourceAgentId || !destinationAgentId || !payloadType) {
      res.status(400).json({ error: "Missing required fields: companyId, sourceAgentId, destinationAgentId, payloadType" });
      return;
    }

    assertCompanyAccess(req, companyId);

    const sourceAgent = await agents.getById(sourceAgentId);
    if (!sourceAgent || sourceAgent.companyId !== companyId) {
      res.status(404).json({ error: "Source agent not found in company" });
      return;
    }

    const destinationAgent = await agents.getById(destinationAgentId);
    if (!destinationAgent || destinationAgent.companyId !== companyId) {
      res.status(404).json({ error: "Destination agent not found in company" });
      return;
    }

    const transfer = await evaluation.createBridgeTransfer({
      companyId,
      sourceAgentId,
      destinationAgentId,
      payloadType,
      payload: (payload ?? {}) as Record<string, unknown>,
      probeRunId: "",
    });

    res.status(201).json(transfer);
  });

  router.get("/:id", async (req, res) => {
    const transfer = await evaluation.getBridgeTransfer(req.params.id);
    if (!transfer) {
      res.status(404).json({ error: "Bridge transfer not found" });
      return;
    }

    assertCompanyAccess(req, transfer.companyId);

    res.json(transfer);
  });

  router.patch("/:id/result", async (req, res) => {
    const transfer = await evaluation.getBridgeTransfer(req.params.id);
    if (!transfer) {
      res.status(404).json({ error: "Bridge transfer not found" });
      return;
    }

    assertCompanyAccess(req, transfer.companyId);

    const { outcome, latencyMs, endpoint, error } = req.body ?? {};
    const validOutcomes: RouteProbeOutcome[] = ["reachable", "unreachable", "timeout", "error"];
    if (!outcome || !validOutcomes.includes(outcome)) {
      res.status(400).json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(", ")}` });
      return;
    }

    const result = await evaluation.reportProbeResult(transfer.id, {
      outcome,
      latencyMs: typeof latencyMs === "number" ? latencyMs : null,
      endpoint: typeof endpoint === "string" ? endpoint : null,
      error: typeof error === "string" ? error : null,
      reportedAt: new Date().toISOString(),
    });

    res.json(result);
  });

  return router;
}
