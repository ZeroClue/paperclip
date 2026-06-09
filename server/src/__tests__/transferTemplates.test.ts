import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../middleware/error-handler.js";
import { transferTemplateRoutes, _resetTransferTemplates } from "../routes/transferTemplates.js";
import { publishLiveEvent } from "../services/live-events.js";

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

const COMPANY_ID = "company-1";
const SOURCE_AGENT_ID = "agent-src-1";
const DEST_AGENT_ID = "agent-dst-1";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      source: "session",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: false,
      memberships: [{ companyId: COMPANY_ID, status: "active", membershipRole: "admin" }],
    };
    next();
  });
  app.use("/api", transferTemplateRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const validTemplate = {
  companyId: COMPANY_ID,
  sourceAgentId: SOURCE_AGENT_ID,
  destAgentId: DEST_AGENT_ID,
  name: "test-template",
};

beforeEach(() => {
  _resetTransferTemplates();
  vi.clearAllMocks();
});

describe("POST /api/transfer-templates", () => {
  it("creates a template and publishes WS event", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/transfer-templates")
      .send(validTemplate)
      .expect(201);

    expect(res.body).toMatchObject({
      companyId: COMPANY_ID,
      sourceAgentId: SOURCE_AGENT_ID,
      destAgentId: DEST_AGENT_ID,
      name: "test-template",
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.updatedAt).toBeDefined();
    expect(publishLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        type: "template:update",
        payload: expect.objectContaining({
          template: expect.objectContaining({ id: res.body.id }),
        }),
      }),
    );
  });

  it("returns 400 for missing required fields", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/transfer-templates")
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /api/transfer-templates", () => {
  it("lists all templates", async () => {
    const app = createApp();
    await request(app).post("/api/transfer-templates").send(validTemplate);
    await request(app).post("/api/transfer-templates").send({
      ...validTemplate,
      name: "template-2",
    });

    const res = await request(app)
      .get("/api/transfer-templates")
      .expect(200);

    expect(res.body).toHaveLength(2);
  });

  it("filters by companyId", async () => {
    const app = createApp();
    await request(app).post("/api/transfer-templates").send(validTemplate);

    const res = await request(app)
      .get("/api/transfer-templates")
      .query({ companyId: COMPANY_ID })
      .expect(200);

    expect(res.body).toHaveLength(1);
  });
});

describe("GET /api/transfer-templates/:id", () => {
  it("returns a single template", async () => {
    const app = createApp();
    const createRes = await request(app).post("/api/transfer-templates").send(validTemplate);
    const id = createRes.body.id;

    const res = await request(app)
      .get(`/api/transfer-templates/${id}`)
      .expect(200);

    expect(res.body.id).toBe(id);
  });

  it("returns 404 for unknown id", async () => {
    const app = createApp();
    await request(app)
      .get("/api/transfer-templates/nonexistent")
      .expect(404);
  });
});

describe("PATCH /api/transfer-templates/:id", () => {
  it("updates a template and publishes WS event", async () => {
    const app = createApp();
    const createRes = await request(app).post("/api/transfer-templates").send(validTemplate);
    const id = createRes.body.id;

    const res = await request(app)
      .patch(`/api/transfer-templates/${id}`)
      .send({ name: "updated-name" })
      .expect(200);

    expect(res.body.name).toBe("updated-name");
    expect(res.body.id).toBe(id);
  });

  it("returns 404 for unknown id", async () => {
    const app = createApp();
    await request(app)
      .patch("/api/transfer-templates/nonexistent")
      .send({ name: "updated" })
      .expect(404);
  });
});

describe("DELETE /api/transfer-templates/:id", () => {
  it("deletes a template and publishes WS event", async () => {
    const app = createApp();
    const createRes = await request(app).post("/api/transfer-templates").send(validTemplate);
    const id = createRes.body.id;

    await request(app)
      .delete(`/api/transfer-templates/${id}`)
      .expect(204);

    const { publishLiveEvent: pD } = await import("../services/live-events.js");
    expect(pD).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "template:delete",
      }),
    );
  });
});

describe("POST /api/transfer-templates/:id/trigger", () => {
  it("triggers a transfer execution", async () => {
    const app = createApp();
    const createRes = await request(app).post("/api/transfer-templates").send(validTemplate);
    const id = createRes.body.id;

    const res = await request(app)
      .post(`/api/transfer-templates/${id}/trigger`)
      .expect(201);

    expect(res.body).toMatchObject({
      templateId: id,
      companyId: COMPANY_ID,
      sourceAgentId: SOURCE_AGENT_ID,
      destAgentId: DEST_AGENT_ID,
      status: "queued",
    });
  });

  it("returns 404 for unknown template", async () => {
    const app = createApp();
    await request(app)
      .post("/api/transfer-templates/nonexistent/trigger")
      .expect(404);
  });
});
