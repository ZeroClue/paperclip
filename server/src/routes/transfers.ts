import { Router } from "express";
import type { TransferExecutionService } from "../services/transfer-execution.js";
import { companyBoundary } from "../middleware/company-boundary.js";

export function transferRoutes(transfers: TransferExecutionService) {
  const router = Router();

  router.use("/transfers/:transferId", companyBoundary(transfers));

  router.post("/transfers", (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const customerId = typeof body?.customerId === "string" ? body.customerId : "";
    const sourceAgentId = typeof body?.sourceAgentId === "string" ? body.sourceAgentId : "";
    const targetAgentId = typeof body?.targetAgentId === "string" ? body.targetAgentId : "";
    const metadata = body?.metadata as Record<string, unknown> | undefined;
    const execution = transfers.create({ customerId, sourceAgentId, targetAgentId, metadata });
    res.status(201).json(execution);
  });

  router.get("/transfers", (req, res) => {
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    res.json(transfers.list(customerId));
  });

  router.get("/transfers/:transferId", (req, res) => {
    const execution = transfers.get(req.params.transferId);
    if (!execution) {
      res.status(404).json({ error: "Transfer not found" });
      return;
    }
    res.json(execution);
  });

  router.post("/transfers/:transferId/start", (req, res) => {
    res.json(transfers.update(req.params.transferId, { status: "running" }));
  });

  router.post("/transfers/:transferId/complete", (req, res) => {
    res.json(transfers.update(req.params.transferId, { status: "completed" }));
  });

  router.post("/transfers/:transferId/fail", (req, res) => {
    const { error } = req.body as { error?: string };
    res.json(transfers.update(req.params.transferId, { status: "failed", error: error ?? "Unknown error" }));
  });

  router.get("/transfers/customer/:customerId", (req, res) => {
    res.json(transfers.getByCustomerId(req.params.customerId));
  });

  return router;
}
