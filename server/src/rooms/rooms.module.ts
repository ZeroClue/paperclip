import type { Db } from "@paperclipai/db";
import type { Router } from "express";
import { RoomRepository } from "./core/RoomRepository.js";
import { RoomManager } from "./core/RoomManager.js";
import { MessageRouter } from "./core/MessageRouter.js";
import { RoomSSEController } from "./api/RoomSSEController.js";
import { roomRoutes } from "./api/RoomController.js";

/**
 * Wire up the Rooms feature module and mount its routes on the API router.
 *
 * The entire module is gated behind the ROOMS_ENABLED=true environment variable.
 * When the flag is off the function returns immediately and no routes are
 * registered, keeping the production surface area unchanged.
 */
export function registerRoomsModule(db: Db, api: Router): void {
  if (process.env.ROOMS_ENABLED !== "true") {
    return;
  }

  const repository = new RoomRepository({ db });
  const manager = new RoomManager(repository);
  const messageRouter = new MessageRouter(repository, manager);
  const sseController = new RoomSSEController();

  api.use(roomRoutes(repository, manager, messageRouter));
}
