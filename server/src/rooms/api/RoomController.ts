import { Router, type Request, type Response } from "express";
import {
  CreateRoomSchema,
  PatchStateSchema,
  ConfigValidationError,
  NotFoundError,
  DuplicateError,
  InvalidTransitionError,
} from "../core/types.js";
import type { RoomRepository } from "../core/RoomRepository.js";
import type { RoomManager } from "../core/RoomManager.js";
import type { MessageRouter } from "../core/MessageRouter.js";
import { RoomBusyError } from "../core/MessageRouter.js";

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function roomRoutes(
  repository: RoomRepository,
  manager: RoomManager,
  router: MessageRouter,
) {
  const r = Router();

  // POST /rooms — create room
  r.post("/rooms", async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId || typeof companyId !== "string") {
      return res.status(400).json({ error: "MISSING_COMPANY_ID" });
    }

    const parsed = CreateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", details: parsed.error.message });
    }

    try {
      const room = await repository.createRoom(companyId, parsed.data);
      return res.status(201).json(room);
    } catch (error: unknown) {
      if (error instanceof ConfigValidationError) {
        return res
          .status(400)
          .json({ error: "INVALID_CONFIG", message: error.message });
      }
      if (error instanceof DuplicateError) {
        return res.status(409).json({
          error: "DUPLICATE_NAME",
          message: error.message,
        });
      }
      // Detect PostgreSQL unique constraint violation (raw DB error)
      if (
        error instanceof Error &&
        (error.message.toLowerCase().includes("unique constraint") ||
          error.message.toLowerCase().includes("duplicate key"))
      ) {
        return res.status(409).json({
          error: "DUPLICATE_NAME",
          message: `Room "${parsed.data.name}" already exists`,
        });
      }
      throw error;
    }
  });

  // GET /rooms — list rooms
  r.get("/rooms", async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId || typeof companyId !== "string") {
      return res.status(400).json({ error: "MISSING_COMPANY_ID" });
    }

    const rooms = await repository.listRooms(companyId);
    return res.json({ data: rooms });
  });

  // GET /rooms/:id — get room details
  r.get("/rooms/:id", async (req: Request, res: Response) => {
    try {
      const room = await repository.getRoom(req.params.id);
      return res.json(room);
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: error.message });
      }
      if (error instanceof ConfigValidationError) {
        return res
          .status(500)
          .json({ error: "CONFIG_CORRUPTED", message: error.message });
      }
      throw error;
    }
  });

  // POST /rooms/:id/messages — submit message
  r.post("/rooms/:id/messages", async (req: Request, res: Response) => {
    const { content } = req.body ?? {};
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "content is required and must be a non-empty string" });
    }

    try {
      const result = await router.routeMessage(req.params.id, {
        content,
        correlationId: req.body?.correlationId,
      });
      return res.status(202).json(result);
    } catch (error: unknown) {
      if (error instanceof RoomBusyError) {
        return res.status(409).json({
          error: "ROOM_BUSY",
          message: error.message,
          currentState: error.currentState,
        });
      }
      throw error;
    }
  });

  // GET /rooms/:id/messages — chat history
  r.get("/rooms/:id/messages", async (req: Request, res: Response) => {
    const { before, after, limit = "50" } = req.query;

    const messages = await repository.getMessages(req.params.id, {
      limit: parseInt(limit as string, 10) || 50,
      before: typeof before === "string" ? before : undefined,
      after: typeof after === "string" ? after : undefined,
    });

    return res.json(messages);
  });

  // PATCH /rooms/:id/state — admin state transition
  r.patch("/rooms/:id/state", async (req: Request, res: Response) => {
    const parsed = PatchStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: parsed.error.message });
    }

    try {
      await manager.transitionState(req.params.id, parsed.data.targetState);
      return res.json({ success: true });
    } catch (error: unknown) {
      if (error instanceof InvalidTransitionError) {
        return res
          .status(409)
          .json({ error: "INVALID_TRANSITION", message: error.message });
      }
      if (error instanceof NotFoundError) {
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: error.message });
      }
      throw error;
    }
  });

  return r;
}
