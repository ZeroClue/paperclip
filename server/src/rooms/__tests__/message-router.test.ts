import { describe, expect, it, vi } from 'vitest';
import { RoomState, MessageType, NotFoundError } from '../core/types.js';
import type { Room, LLMClient } from '../core/types.js';
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
        aggressionLevel: 'medium',
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
    createConsensusDecision: async (data: any) => ({
      id: 'decision-1',
      ...data,
      createdAt: new Date(),
    }),
    createDebateRound: async (data: any) => ({
      id: 'debate-round-1',
      ...data,
      createdAt: new Date(),
    }),
    /** Expose internal state for test assertions. */
    _getState: () => state,
    _setState: (newState: RoomState) => { state = newState; },
    _messages: messages,
  };
};

const createMockManager = (canAccept = true) => ({
  canAcceptMessages: async () => canAccept,
  transitionState: async (_roomId: string, newState: RoomState) => {},
});

/**
 * Create a mock LLM client using a call-sequence approach.
 *
 * The ConsensusEngine calls LLM in this order:
 *   1. classify() -> classification response
 *   2. Leader proposal -> leader response
 *   3. DA review -> DA response (agree)
 *   4. classify() again (inside run()) -> classification response
 *
 * For simple classification, only call 1 happens.
 */
const createMockLLMClient = (classification: 'simple' | 'complex' = 'complex'): LLMClient & { _callLog: any[] } => {
  const callLog: any[] = [];
  let callIndex = 0;

  const leaderResponse = {
    plan: [{
      id: '00000000-0000-0000-0000-000000000010',
      description: 'Test task',
      roomId: 'room-1',
      dependencies: [],
      workerConfig: { extensions: [], skills: [] },
      isIdempotent: true,
      correlationId: 'corr-1',
    }],
    reasoning: 'Test reasoning',
    changesFromPrevious: [],
  };

  const daAgreeResponse = {
    decision: 'agree' as const,
    points: [] as string[],
    confidence: 0.95,
  };

  const classificationResponse = {
    classification,
    reason: 'test classification',
  };

  const mockFn = vi.fn().mockImplementation(async (prompt: string, _schema: any, _options?: any) => {
    const entry = { callIndex, prompt: prompt.substring(0, 80) };
    callLog.push(entry);

    // The ConsensusEngine.classify uses a prompt that mentions "classifier"
    // The ConsensusEngine.run uses prompts that mention "leader", "Devil's Advocate", etc.
    if (prompt.includes('classifier')) {
      return classificationResponse;
    }

    if (prompt.includes('team leader') && !prompt.includes('Devil') && !prompt.includes('challenge')) {
      return leaderResponse;
    }

    if (prompt.includes("Devil's Advocate") || prompt.includes('Devil') || prompt.includes('critically evaluate')) {
      return daAgreeResponse;
    }

    // Leader revision (shouldn't happen with agree, but just in case)
    if (prompt.includes('Revise your plan') || prompt.includes('revision')) {
      return leaderResponse;
    }

    // Fallback: cycle through known responses
    callIndex++;
    const responses = [classificationResponse, leaderResponse, daAgreeResponse, classificationResponse];
    return responses[callIndex % responses.length];
  });

  return {
    generateStructured: mockFn,
    _callLog: callLog,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageRouter', () => {
  describe('routeMessage', () => {
    it('routes a message successfully and returns PostMessageResponse', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

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
      expect(result.classification).toBe('complex');
    });

    it('transitions room to CONSENSUS after routing complex message', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

      await router.routeMessage('room-1', {
        content: 'Build a new feature',
      });

      expect(repo._getState()).toBe(RoomState.CONSENSUS);
    });

    it('rejects message when room is busy (throws RoomBusyError)', async () => {
      const repo = createMockRepo(RoomState.CONSENSUS);
      const manager = new RoomManager(repo as any);
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

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
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

      await expect(
        router.routeMessage('room-1', { content: '' }),
      ).rejects.toThrow('Validation failed');
    });

    it('generates correlationId if not provided (valid UUID v4 format)', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

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
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

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
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

      await router.routeMessage('room-1', {
        content: 'Persist this message',
      });

      // At minimum the human message is persisted (async consensus may add more)
      const humanMsg = repo._messages.find((m: any) => m.type === MessageType.HUMAN);
      expect(humanMsg).toBeDefined();
      expect(humanMsg.content).toBe('Persist this message');
      expect(humanMsg.type).toBe(MessageType.HUMAN);
      expect(humanMsg.sender).toBe('user');
      expect(humanMsg.roomId).toBe('room-1');
    });

    it('propagates NotFoundError when room does not exist', async () => {
      const repo = createMockRepo(RoomState.IDLE);
      const manager = new RoomManager(repo as any);
      const llmClient = createMockLLMClient('complex');
      const router = new MessageRouter(repo as any, manager, llmClient, undefined);

      // canAcceptMessages calls getRoom internally, which throws for 'nonexistent'
      await expect(
        router.routeMessage('nonexistent', { content: 'Hello' }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// Consensus engine integration tests
// ---------------------------------------------------------------------------

describe('MessageRouter with consensus engine', () => {
  it('complex message classifies and runs consensus engine', async () => {
    const repo = createMockRepo(RoomState.IDLE);
    const manager = new RoomManager(repo as any);
    const llmClient = createMockLLMClient('complex');
    const router = new MessageRouter(repo as any, manager, llmClient, undefined);

    const result = await router.routeMessage('room-1', {
      content: 'Build a complex distributed system with authentication',
    });

    // Classification should be complex
    expect(result.classification).toBe('complex');

    // Room should transition to CONSENSUS
    expect(repo._getState()).toBe(RoomState.CONSENSUS);

    // Human message should be persisted
    const humanMsg = repo._messages.find((m: any) => m.type === MessageType.HUMAN);
    expect(humanMsg).toBeDefined();
    expect(humanMsg.content).toBe('Build a complex distributed system with authentication');

    // Wait for async consensus to complete
    await vi.waitFor(() => {
      const consensusMsg = repo._messages.find(
        (m: any) => m.type === MessageType.CONSENSUS_REACHED,
      );
      expect(consensusMsg).toBeDefined();
    }, { timeout: 3000 });

    // Verify the consensus message content
    const consensusMsg = repo._messages.find(
      (m: any) => m.type === MessageType.CONSENSUS_REACHED,
    );
    expect(consensusMsg.content).toContain('Consensus reached');
    expect(consensusMsg.content).toContain('1 round(s)');

    // Verify LLM was called (classification + leader proposal + DA agree + re-classification)
    expect(llmClient.generateStructured).toHaveBeenCalledTimes(4);
  });

  it('simple message bypasses consensus', async () => {
    const repo = createMockRepo(RoomState.IDLE);
    const manager = new RoomManager(repo as any);
    const llmClient = createMockLLMClient('simple');
    const router = new MessageRouter(repo as any, manager, llmClient, undefined);

    const result = await router.routeMessage('room-1', {
      content: 'What is the status of the current sprint?',
    });

    // Classification should be simple
    expect(result.classification).toBe('simple');

    // Room should transition to BREAKDOWN (not CONSENSUS)
    expect(repo._getState()).toBe(RoomState.BREAKDOWN);

    // Human message + CONSENSUS_BYPASSED system message should be persisted
    expect(repo._messages).toHaveLength(2);
    expect(repo._messages[0].type).toBe(MessageType.HUMAN);
    expect(repo._messages[1].type).toBe(MessageType.CONSENSUS_BYPASSED);
    expect(repo._messages[1].sender).toBe('system');
    expect(repo._messages[1].content).toContain('skipping consensus');
  });

  it('handles consensus engine errors gracefully', async () => {
    const errorLLMClient: LLMClient = {
      generateStructured: async () => {
        throw new Error('LLM service unavailable');
      },
    };
    const repo = createMockRepo(RoomState.IDLE);
    const manager = new RoomManager(repo as any);
    const router = new MessageRouter(repo as any, manager, errorLLMClient, undefined);

    // The classification call will throw, so routeMessage itself should throw
    await expect(
      router.routeMessage('room-1', { content: 'Test error handling' }),
    ).rejects.toThrow('LLM service unavailable');
  });

  it('handles consensus engine error in async debate loop', async () => {
    // LLM that succeeds for classification but fails during debate
    let callCount = 0;
    const failDuringDebateLLM: LLMClient = {
      generateStructured: async () => {
        callCount++;
        // First call is classification, second is leader proposal
        if (callCount <= 2) {
          if (callCount === 1) return { classification: 'complex' as const, reason: 'test' };
          return {
            plan: [{
              id: '00000000-0000-0000-0000-000000000010',
              description: 'Test task',
              roomId: 'room-1',
              dependencies: [],
              workerConfig: { extensions: [], skills: [] },
              isIdempotent: true,
              correlationId: 'corr-1',
            }],
            reasoning: 'Test reasoning',
            changesFromPrevious: [],
          };
        }
        // Third call (DA review) throws
        throw new Error('DA LLM call failed');
      },
    };

    const repo = createMockRepo(RoomState.IDLE);
    const manager = new RoomManager(repo as any);
    const router = new MessageRouter(repo as any, manager, failDuringDebateLLM, undefined);

    // routeMessage should succeed (consensus runs async)
    const result = await router.routeMessage('room-1', {
      content: 'Complex task that will fail during debate',
    });

    expect(result.classification).toBe('complex');
    expect(repo._getState()).toBe(RoomState.CONSENSUS);

    // Wait for async error to be handled
    await vi.waitFor(() => {
      const errorMsg = repo._messages.find((m: any) => m.type === MessageType.ERROR);
      expect(errorMsg).toBeDefined();
      expect(errorMsg.content).toContain('Consensus engine error');
    }, { timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// Task breakdown integration tests
// ---------------------------------------------------------------------------

describe('MessageRouter with task breakdown', () => {
  it('triggers task breakdown after consensus', async () => {
    const messages: any[] = [];
    const stateTransitions: Array<{ to: string }> = [];

    const makeRoom = () => ({
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
          aggressionLevel: 'medium',
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
    });

    const repo = {
      getRoom: async () => makeRoom(),
      addMessage: async (_roomId: string, msg: any) => {
        const m = { id: 'msg-' + Math.random(), roomId: _roomId, ...msg, createdAt: new Date() };
        messages.push(m);
        return m;
      },
      updateState: async (_id: string, _state: string) => {
        stateTransitions.push({ to: _state });
      },
      createConsensusDecision: async (data: any) => ({
        id: 'decision-1',
        ...data,
        createdAt: new Date(),
      }),
      createDebateRound: async (data: any) => ({
        id: 'debate-round-1',
        ...data,
        createdAt: new Date(),
      }),
    };

    const manager = {
      canAcceptMessages: async () => true,
      transitionState: async (_id: string, state: RoomState) => {
        stateTransitions.push({ to: state });
      },
    };

    let llmCallIndex = 0;
    const mockLLM = {
      generateStructured: async () => {
        llmCallIndex++;
        if (llmCallIndex === 1) return { classification: 'complex', reason: 'Feature' };
        if (llmCallIndex === 2) return {
          classification: 'complex',
          plan: [{
            id: '00000000-0000-0000-0000-000000000001',
            description: 'Test task',
            roomId: 'room-1',
            dependencies: [],
            workerConfig: { extensions: [], skills: [] },
            isIdempotent: true,
            correlationId: 'corr-1',
          }],
          reasoning: 'Test',
          changesFromPrevious: [],
        };
        return { decision: 'agree', points: [], confidence: 0.95 };
      },
    };

    let breakdownCalled = false;
    const mockBreakdownService = {
      createTasksFromPlan: vi.fn(async () => {
        breakdownCalled = true;
        return [];
      }),
    };

    const router = new MessageRouter(
      repo as any,
      manager as any,
      mockLLM as any,
      mockBreakdownService as any,
    );

    await router.routeMessage('room-1', {
      content: 'Build something',
      correlationId: 'corr-001',
    });

    // Wait for async consensus
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(breakdownCalled).toBe(true);
  });
});
