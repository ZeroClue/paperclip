import { RoomState } from './types.js';
import type { RoomRepository } from './RoomRepository.js';

/**
 * RoomManager manages room lifecycle and state transitions.
 *
 * This is a thin layer over RoomRepository. It does NOT perform database
 * operations directly -- all persistence is delegated to the repository.
 * The manager adds higher-level concerns like determining whether a room
 * can accept incoming messages.
 */
export class RoomManager {
  constructor(private repository: RoomRepository) {}

  /**
   * Transition a room to a new state.
   * Delegates to the repository which validates the transition.
   */
  async transitionState(roomId: string, newState: RoomState): Promise<void> {
    await this.repository.updateState(roomId, newState);
  }

  /**
   * Check whether a room is in a state that can accept new messages.
   * Only IDLE rooms accept incoming messages.
   */
  async canAcceptMessages(roomId: string): Promise<boolean> {
    const room = await this.repository.getRoom(roomId);
    return room.state === RoomState.IDLE;
  }

  /**
   * Reset a room back to IDLE state.
   * This will throw if the current state does not allow transitioning to IDLE.
   */
  async resetToIdle(roomId: string): Promise<void> {
    await this.transitionState(roomId, RoomState.IDLE);
  }
}
