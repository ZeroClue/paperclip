// server/src/rooms/__tests__/synthesis.test.ts

import { describe, it, expect, vi } from 'vitest';
import { SynthesisService } from '../execution/SynthesisService.js';
import { MessageType, RoomState } from '../core/types.js';
import type { WorkerSession, Room, LLMClient, RoomRepository, RoomManager } from '../core/types.js';

const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const CONSENSUS_ID = '00000000-0000-0000-0000-000000000100';

const makeRoom = (): Room => ({
  id: ROOM_ID,
  companyId: '00000000-0000-0000-0000-000000000002',
  name: 'engineering',
  displayName: '#engineering',
  description: null,
  config: {
    leader: { agentId: 'leader-1', systemPrompt: 'You are the team leader.' },
    devilsAdvocate: { agentId: 'da-1', systemPrompt: 'DA', aggressionLevel: 'medium' },
    workers: { count: 2, agentTemplate: { systemPrompt: 'Worker', model: 'gpt-4' } },
    consensus: { maxRounds: 3, forceResolveStrategy: 'leader-decides', escalationThreshold: 0.6 },
  },
  state: RoomState.SYNTHESISING,
  currentMessageId: null,
  linkedGoalId: null,
  linkedProjectId: null,
  monthlyBudgetUsd: '100.0000',
  spentUsd: '0.0000',
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('SynthesisService', () => {
  it('generates synthesis message from completed worker sessions', async () => {
    const mockSessions: WorkerSession[] = [
      {
        id: 'session-1',
        roomId: ROOM_ID,
        consensusDecisionId: CONSENSUS_ID,
        issueId: 'issue-1',
        taskDefinition: {
          id: 'task-1',
          description: 'Implement auth module',
          roomId: ROOM_ID,
          dependencies: [],
          workerConfig: { extensions: [], skills: [] },
          isIdempotent: true,
          correlationId: 'corr-1',
        },
        status: 'completed' as any,
        piSessionId: null,
        piSessionFilePath: null,
        output: 'Created auth.ts with JWT validation',
        costUsd: 1.50,
        errorDetails: null,
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'session-2',
        roomId: ROOM_ID,
        consensusDecisionId: CONSENSUS_ID,
        issueId: 'issue-2',
        taskDefinition: {
          id: 'task-2',
          description: 'Add rate limiting',
          roomId: ROOM_ID,
          dependencies: ['task-1'],
          workerConfig: { extensions: [], skills: [] },
          isIdempotent: true,
          correlationId: 'corr-2',
        },
        status: 'completed' as any,
        piSessionId: null,
        piSessionFilePath: null,
        output: 'Added rateLimiter middleware to Express',
        costUsd: 0.80,
        errorDetails: null,
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const mockRepo = {
      getRoom: vi.fn(async () => makeRoom()),
      getWorkerSessions: vi.fn(async () => mockSessions),
      addMessage: vi.fn(),
      updateSpent: vi.fn(),
    } as any;

    const mockManager = {
      transitionState: vi.fn(),
    } as any;

    const mockLLM: LLMClient = {
      generateStructured: vi.fn(async () => ({
        summary: 'All tasks completed successfully. Auth module and rate limiting implemented.',
        outcomes: ['Auth: JWT validation in auth.ts', 'Rate limiting: middleware added'],
      })),
    };

    const service = new SynthesisService(mockRepo, mockManager, mockLLM);

    await service.synthesize(ROOM_ID, CONSENSUS_ID);

    // LLM called with worker outputs
    expect(mockLLM.generateStructured).toHaveBeenCalledWith(
      expect.stringContaining('Implement auth module'),
      expect.any(Object),
    );

    // Synthesis message posted
    expect(mockRepo.addMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        type: MessageType.SYNTHESIS,
        sender: 'leader',
        senderAgentId: 'leader-1',
      }),
    );

    // Budget updated
    expect(mockRepo.updateSpent).toHaveBeenCalledWith(ROOM_ID, '2.3000');

    // Room transitioned to IDLE
    expect(mockManager.transitionState).toHaveBeenCalledWith(ROOM_ID, RoomState.IDLE);
  });

  it('handles partial completion with failed tasks', async () => {
    const mockSessions: WorkerSession[] = [
      {
        id: 'session-1',
        roomId: ROOM_ID,
        consensusDecisionId: CONSENSUS_ID,
        issueId: 'issue-1',
        taskDefinition: {
          id: 'task-1',
          description: 'Working task',
          roomId: ROOM_ID,
          dependencies: [],
          workerConfig: { extensions: [], skills: [] },
          isIdempotent: true,
          correlationId: 'corr-1',
        },
        status: 'completed' as any,
        piSessionId: null,
        piSessionFilePath: null,
        output: 'Done',
        costUsd: 1.00,
        errorDetails: null,
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'session-2',
        roomId: ROOM_ID,
        consensusDecisionId: CONSENSUS_ID,
        issueId: 'issue-2',
        taskDefinition: {
          id: 'task-2',
          description: 'Failed task',
          roomId: ROOM_ID,
          dependencies: [],
          workerConfig: { extensions: [], skills: [] },
          isIdempotent: true,
          correlationId: 'corr-2',
        },
        status: 'failed' as any,
        piSessionId: null,
        piSessionFilePath: null,
        output: null,
        costUsd: 0.50,
        errorDetails: { error: 'API timeout' },
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const mockRepo = {
      getRoom: vi.fn(async () => makeRoom()),
      getWorkerSessions: vi.fn(async () => mockSessions),
      addMessage: vi.fn(),
      updateSpent: vi.fn(),
    } as any;

    const mockManager = {
      transitionState: vi.fn(),
    } as any;

    const mockLLM: LLMClient = {
      generateStructured: vi.fn(async () => ({
        summary: 'Partial completion. 1 of 2 tasks succeeded.',
        outcomes: ['Task 1: Done', 'Task 2: Failed - API timeout'],
      })),
    };

    const service = new SynthesisService(mockRepo, mockManager, mockLLM);

    await service.synthesize(ROOM_ID, CONSENSUS_ID);

    // Synthesis includes failure details (check for error indicator)
    expect(mockLLM.generateStructured).toHaveBeenCalledWith(
      expect.stringContaining('Error:'),
      expect.any(Object),
    );
  });

  it('handles empty sessions array', async () => {
    const mockRepo = {
      getRoom: vi.fn(async () => makeRoom()),
      getWorkerSessions: vi.fn(async () => []),
      addMessage: vi.fn(),
      updateSpent: vi.fn(),
    } as any;

    const mockManager = {
      transitionState: vi.fn(),
    } as any;

    const mockLLM: LLMClient = {
      generateStructured: vi.fn(async () => ({
        summary: 'No worker sessions were executed.',
        outcomes: [],
      })),
    };

    const service = new SynthesisService(mockRepo, mockManager, mockLLM);

    await service.synthesize(ROOM_ID, CONSENSUS_ID);

    // Total cost should be 0
    expect(mockRepo.updateSpent).toHaveBeenCalledWith(ROOM_ID, '0.0000');

    // LLM should be called with empty worker outputs
    expect(mockLLM.generateStructured).toHaveBeenCalledWith(
      expect.stringContaining('Worker Outputs'),
      expect.any(Object),
    );

    // Synthesis message posted
    expect(mockRepo.addMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        type: MessageType.SYNTHESIS,
        metadata: { outcomes: [], totalCost: 0 },
      }),
    );
  });
});
