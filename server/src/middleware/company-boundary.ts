import type { RequestHandler } from "express";
import type { TransferExecutionService } from "../services/transfer-execution.js";

function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function companyBoundary(transfers: TransferExecutionService): RequestHandler {
  return (req, res, next) => {
    const transferId = singleParam(req.params.transferId) ?? singleParam(req.params.id);
    if (!transferId) {
      next();
      return;
    }

    const execution = transfers.get(transferId);
    if (!execution) {
      next();
      return;
    }

    if (req.actor.isInstanceAdmin) {
      next();
      return;
    }

    const actorCompanyId = req.actor.companyId;
    if (!actorCompanyId) {
      res.status(403).json({ error: "No company context on actor" });
      return;
    }

    if (execution.customerId !== actorCompanyId) {
      res.status(403).json({
        error: `Agent (company: ${actorCompanyId}) does not own transfer ${transferId} (customer: ${execution.customerId})`,
      });
      return;
    }

    next();
  };
}
