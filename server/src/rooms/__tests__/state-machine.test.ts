import { describe, expect, it } from 'vitest';
import { RoomState, VALID_TRANSITIONS, InvalidTransitionError, NotFoundError } from '../core/types.js';
import type { Room } from '../core/types.js';
import { RoomManager } from '../core/RoomManager.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const createMockRepo = (initialState = RoomState.IDLE) => {
  let state = initialState;
  const room: Room = {
    id: 'room-1',
    companyId: 'company-1',
    name: 'engineering',
    displayName: '#engineering',
    description: null,
    state,
    config: {
      leader: {
        agentId: '00000000-0000-0000-0000-000000000001',
        systemPrompt: 'Leader system prompt for testing.',
      },
      devilsAdvocate: {
        agentId: '00000000-0000-0000-0000-000000000002',
        systemPrompt: 'Devil advocate system prompt for testing.',
      },
      workers: {
        count: 1,
        agentTemplate: {
          systemPrompt: 'Worker system prompt for testing.',
          model: 'gpt-4',
        },
      },
      consensus: {
        maxRounds: 3,
        forceResolveStrategy: 'leader-decides',
        escalationThreshold: 0.6,
      },
    },
    currentMessageId: null,
    linkedGoalId: null,
    linkedProjectId: null,
    monthlyBudgetUsd: '100.0000',
    spentUsd: '0.0000',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    getRoom: async (_id: string) => {
      if (_id === 'nonexistent') throw new NotFoundError('Room', 'nonexistent');
      return { ...room, state };
    },
    updateState: async (_id: string, newState: string) => {
      const validTargets = VALID_TRANSITIONS[room.state as RoomState];
      if (!validTargets?.includes(newState as RoomState)) {
        throw new InvalidTransitionError(room.state as RoomState, newState as RoomState);
      }
      room.state = newState as RoomState;
      return { ...room, state: newState as RoomState };
    },
    /** Expose internal room for test assertions. */
    _getRoom: () => room,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RoomManager', () => {
  // -------------------------------------------------------------------------
  // canAcceptMessages
  // -------------------------------------------------------------------------

  describe('canAcceptMessages', () => {
    it('returns true for IDLE state', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(true);
    });

    it('returns false for CONSENSUS state', async () => {
      const repo = createMockRepo(RoomState.CONSENSUS);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(false);
    });

    it('returns false for BREAKDOWN state', async () => {
      const repo = createMockRepo(RoomState.BREAKDOWN);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(false);
    });

    it('returns false for EXECUTING state', async () => {
      const repo = createMockRepo(RoomState.EXECUTING);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(false);
    });

    it('returns false for SYNTHESISING state', async () => {
      const repo = createMockRepo(RoomState.SYNTHESISING);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(false);
    });

    it('returns false for PAUSED state', async () => {
      const repo = createMockRepo(RoomState.PAUSED);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(false);
    });

    it('returns false for ERROR state', async () => {
      const repo = createMockRepo(RoomState.ERROR);
      const manager = new RoomManager(repo as any);
      expect(await manager.canAcceptMessages('room-1')).toBe(false);
    });

    it('propagates NotFoundError from repository', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      await expect(manager.canAcceptMessages('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // transitionState
  // -------------------------------------------------------------------------

  describe('transitionState', () => {
    it('IDLE -> CONSENSUS succeeds', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      await manager.transitionState('room-1', RoomState.CONSENSUS);
      expect(repo._getRoom().state).toBe(RoomState.CONSENSUS);
    });

    it('IDLE -> BREAKDOWN throws InvalidTransitionError', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      await expect(
        manager.transitionState('room-1', RoomState.BREAKDOWN),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('CONSENSUS -> IDLE throws InvalidTransitionError', async () => {
      const repo = createMockRepo(RoomState.CONSENSUS);
      const manager = new RoomManager(repo as any);
      await expect(
        manager.transitionState('room-1', RoomState.IDLE),
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle paths
  // -------------------------------------------------------------------------

  describe('lifecycle paths', () => {
    it('happy path: IDLE -> CONSENSUS -> BREAKDOWN -> EXECUTING -> SYNTHESISING -> IDLE', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);

      await manager.transitionState('room-1', RoomState.CONSENSUS);
      expect(repo._getRoom().state).toBe(RoomState.CONSENSUS);

      await manager.transitionState('room-1', RoomState.BREAKDOWN);
      expect(repo._getRoom().state).toBe(RoomState.BREAKDOWN);

      await manager.transitionState('room-1', RoomState.EXECUTING);
      expect(repo._getRoom().state).toBe(RoomState.EXECUTING);

      await manager.transitionState('room-1', RoomState.SYNTHESISING);
      expect(repo._getRoom().state).toBe(RoomState.SYNTHESISING);

      await manager.transitionState('room-1', RoomState.IDLE);
      expect(repo._getRoom().state).toBe(RoomState.IDLE);
    });

    it('error path: EXECUTING -> ERROR -> IDLE', async () => {
      const repo = createMockRepo(RoomState.EXECUTING);
      const manager = new RoomManager(repo as any);

      await manager.transitionState('room-1', RoomState.ERROR);
      expect(repo._getRoom().state).toBe(RoomState.ERROR);

      await manager.transitionState('room-1', RoomState.IDLE);
      expect(repo._getRoom().state).toBe(RoomState.IDLE);
    });

    it('pause path: EXECUTING -> PAUSED -> IDLE', async () => {
      const repo = createMockRepo(RoomState.EXECUTING);
      const manager = new RoomManager(repo as any);

      await manager.transitionState('room-1', RoomState.PAUSED);
      expect(repo._getRoom().state).toBe(RoomState.PAUSED);

      await manager.transitionState('room-1', RoomState.IDLE);
      expect(repo._getRoom().state).toBe(RoomState.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // resetToIdle
  // -------------------------------------------------------------------------

  describe('resetToIdle', () => {
    it('transitions from PAUSED to IDLE', async () => {
      const repo = createMockRepo(RoomState.PAUSED);
      const manager = new RoomManager(repo as any);
      await manager.resetToIdle('room-1');
      expect(repo._getRoom().state).toBe(RoomState.IDLE);
    });

    it('transitions from ERROR to IDLE', async () => {
      const repo = createMockRepo(RoomState.ERROR);
      const manager = new RoomManager(repo as any);
      await manager.resetToIdle('room-1');
      expect(repo._getRoom().state).toBe(RoomState.IDLE);
    });

    it('throws InvalidTransitionError when current state cannot go to IDLE', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      // IDLE cannot transition to IDLE (not in VALID_TRANSITIONS[IDLE])
      await expect(manager.resetToIdle('room-1')).rejects.toThrow(InvalidTransitionError);
    });
  });
});
