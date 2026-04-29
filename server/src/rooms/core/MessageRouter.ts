import { randomUUID } from 'node:crypto';
import { RoomState, MessageType, PostMessageSchema } from './types.js';
import type { PostMessageResponse } from './types.js';
import type { RoomRepository } from './RoomRepository.js';
import type { RoomManager } from './RoomManager.js';

export class RoomBusyError extends Error {
  constructor(public currentState: RoomState) {
    super(`Room is in ${currentState} state. Cannot accept new messages.`);
    this.name = 'RoomBusyError';
  }
}

export class MessageRouter {
  constructor(
    private repository: RoomRepository,
    private manager: RoomManager,
  ) {}

  async routeMessage(roomId: string, input: {
    content: string;
    correlationId?: string;
  }): Promise<PostMessageResponse> {
    // 1. Validate input via PostMessageSchema
    const parsed = PostMessageSchema.safeParse({
      type: MessageType.HUMAN,
      content: input.content,
    });
    if (!parsed.success) {
      throw new Error(`Validation failed: ${parsed.error.message}`);
    }

    const correlationId = input.correlationId ?? randomUUID();

    // 2. Check room state — must be IDLE to accept messages
    const canAccept = await this.manager.canAcceptMessages(roomId);
    if (!canAccept) {
      const room = await this.repository.getRoom(roomId);
      throw new RoomBusyError(room.state);
    }

    // 3. Persist human message
    const message = await this.repository.addMessage(roomId, {
      correlationId,
      type: MessageType.HUMAN,
      sender: 'user',
      content: input.content,
    });

    // 4. Transition to CONSENSUS (stub — Plan 2 adds classification + consensus engine)
    await this.manager.transitionState(roomId, RoomState.CONSENSUS);

    // 5. Return result
    return {
      id: message.id,
      roomId,
      correlationId,
      type: MessageType.HUMAN,
      sender: 'user',
      createdAt: message.createdAt,
    };
  }
}
