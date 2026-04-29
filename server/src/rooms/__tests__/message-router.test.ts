import { describe, expect, it } from 'vitest';
import { RoomState, MessageType, NotFoundError } from '../core/types.js';
import type { Room } from '../core/types.js';
import { RoomManager } from '../core/RoomManager.js';
import { MessageRouter, RoomBusyError } from '../core/MessageRouter.js';

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

  const messages: any[] = [];

  return {
    getRoom: async (id: string) => {
      if (id === 'nonexistent') throw new NotFoundError('Room', 'nonexistent');
      return { ...room, state };
    },
    addMessage: async (roomId: string, msg: any) => {
      const m = { id: 'msg-' + Math.random(), roomId, createdAt: new Date(), ...msg };
      messages.push(m);
      return m;
    },
    updateState: async (_id: string, newState: string) => {
      state = newState as RoomState;
      return { ...room, state: newState as RoomState };
    },
    /** Expose internal state for test assertions. */
    _getState: () => state,
    _messages: messages,
  };
};

const createMockManager = (canAccept = true) => ({
  canAcceptMessages: async () => canAccept,
  transitionState: async () => {},
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageRouter', () => {
  describe('routeMessage', () => {
    it('routes a message successfully and returns PostMessageResponse', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      const result = await router.routeMessage('room-1', {
        content: 'Build a new feature',
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.roomId).toBe('room-1');
      expect(result.correlationId).toBeDefined();
      expect(result.type).toBe(MessageType.HUMAN);
      expect(result.sender).toBe('user');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('transitions room to CONSENSUS after routing', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      await router.routeMessage('room-1', {
        content: 'Build a new feature',
      });

      expect(repo._getState()).toBe(RoomState.CONSENSUS);
    });

    it('rejects message when room is busy (throws RoomBusyError)', async () => {
      const repo = createMockRepo(RoomState.CONSENSUS);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      try {
        await router.routeMessage('room-1', {
          content: 'This should fail',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoomBusyError);
        expect((err as RoomBusyError).currentState).toBe(RoomState.CONSENSUS);
        expect((err as RoomBusyError).message).toContain('CONSENSUS');
      }
    });

    it('rejects empty content with validation error', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      await expect(
        router.routeMessage('room-1', { content: '' }),
      ).rejects.toThrow('Validation failed');
    });

    it('generates correlationId if not provided (valid UUID v4 format)', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      const result = await router.routeMessage('room-1', {
        content: 'No correlation ID given',
      });

      // UUID v4 format: 8-4-4-4-12 hex chars
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(result.correlationId).toMatch(uuidRegex);
    });

    it('uses provided correlationId if given', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      const customId = 'custom-correlation-123';
      const result = await router.routeMessage('room-1', {
        content: 'Custom correlation ID',
        correlationId: customId,
      });

      expect(result.correlationId).toBe(customId);
    });

    it('persists message to repository', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      await router.routeMessage('room-1', {
        content: 'Persist this message',
      });

      expect(repo._messages).toHaveLength(1);
      expect(repo._messages[0].content).toBe('Persist this message');
      expect(repo._messages[0].type).toBe(MessageType.HUMAN);
      expect(repo._messages[0].sender).toBe('user');
      expect(repo._messages[0].roomId).toBe('room-1');
    });

    it('propagates NotFoundError when room does not exist', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const router = new MessageRouter(repo as any, manager);

      // canAcceptMessages calls getRoom internally, which throws for 'nonexistent'
      await expect(
        router.routeMessage('nonexistent', { content: 'Hello' }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
