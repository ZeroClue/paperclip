import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import type { LiveEventType } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { publishLiveEvent } from "../services/live-events.js";
import { assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";

const TEMPLATE_UPDATE_EVENT = "template:update" as LiveEventType;
const TEMPLATE_DELETE_EVENT = "template:delete" as LiveEventType;

const createTransferTemplateSchema = z.object({
  companyId: z.string(),
  sourceAgentId: z.string(),
  destAgentId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const updateTransferTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  sourceAgentId: z.string().optional(),
  destAgentId: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

interface TransferTemplate {
  id: string;
  companyId: string;
  sourceAgentId: string;
  destAgentId: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const templates = new Map<string, TransferTemplate>();
let nextId = 1;

export function _resetTransferTemplates() {
  templates.clear();
  nextId = 1;
}

function generateId(): string {
  return `tmpl_${Date.now()}_${nextId++}`;
}

function now(): string {
  return new Date().toISOString();
}

function pushTemplateEvent(
  companyId: string,
  eventType: LiveEventType,
  template: TransferTemplate,
) {
  publishLiveEvent({
    companyId,
    type: eventType,
    payload: { template },
  });
}

export function transferTemplateRoutes(_db: Db) {
  const router = Router();

  router.post("/transfer-templates", validate(createTransferTemplateSchema), async (req, res) => {
    const { companyId, sourceAgentId, destAgentId, name, description, config } = req.body;
    assertCompanyAccess(req, companyId);

    const template: TransferTemplate = {
      id: generateId(),
      companyId,
      sourceAgentId,
      destAgentId,
      name,
      description: description ?? "",
      config: config ?? {},
      createdAt: now(),
      updatedAt: now(),
    };

    templates.set(template.id, template);
    pushTemplateEvent(companyId, TEMPLATE_UPDATE_EVENT, template);

    res.status(201).json(template);
  });

  router.get("/transfer-templates", async (req, res) => {
    const { companyId, sourceAgentId, destAgentId } = req.query as Record<string, string>;

    let results = Array.from(templates.values());

    if (companyId) {
      assertCompanyAccess(req, companyId);
      results = results.filter((t) => t.companyId === companyId);
    }

    if (sourceAgentId) {
      results = results.filter((t) => t.sourceAgentId === sourceAgentId);
    }

    if (destAgentId) {
      results = results.filter((t) => t.destAgentId === destAgentId);
    }

    res.json(results);
  });

  router.get("/transfer-templates/:id", async (req, res) => {
    const id = req.params.id as string;
    const template = templates.get(id);
    if (!template) {
      throw notFound("Transfer template not found");
    }
    assertCompanyAccess(req, template.companyId);
    res.json(template);
  });

  router.patch("/transfer-templates/:id", validate(updateTransferTemplateSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = templates.get(id);
    if (!existing) {
      throw notFound("Transfer template not found");
    }
    assertCompanyAccess(req, existing.companyId);

    const updated: TransferTemplate = {
      ...existing,
      ...req.body,
      id: existing.id,
      companyId: existing.companyId,
      createdAt: existing.createdAt,
      updatedAt: now(),
    };

    templates.set(updated.id, updated);
    pushTemplateEvent(updated.companyId, TEMPLATE_UPDATE_EVENT, updated);

    res.json(updated);
  });

  router.delete("/transfer-templates/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = templates.get(id);
    if (!existing) {
      throw notFound("Transfer template not found");
    }
    assertCompanyAccess(req, existing.companyId);

    templates.delete(existing.id);
    pushTemplateEvent(existing.companyId, TEMPLATE_DELETE_EVENT, existing);

    res.status(204).end();
  });

  router.post("/transfer-templates/:id/trigger", async (req, res) => {
    const id = req.params.id as string;
    const template = templates.get(id);
    if (!template) {
      throw notFound("Transfer template not found");
    }
    assertCompanyAccess(req, template.companyId);

    const execution = {
      id: generateId(),
      templateId: template.id,
      companyId: template.companyId,
      sourceAgentId: template.sourceAgentId,
      destAgentId: template.destAgentId,
      status: "queued" as const,
      createdAt: now(),
    };

    pushTemplateEvent(template.companyId, TEMPLATE_UPDATE_EVENT, {
      ...template,
      config: { ...template.config, lastExecution: execution },
    });

    res.status(201).json(execution);
  });

  return router;
}
