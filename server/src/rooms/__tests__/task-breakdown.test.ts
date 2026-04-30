// server/src/rooms/__tests__/task-breakdown.test.ts

import { describe, it, expect, vi } from 'vitest';
import { TaskBreakdownService } from '../execution/TaskBreakdownService.js';
import { WorkerSessionStatus } from '../core/types.js';
import type { Room, ConsensusDecision, TaskDefinition, RoomRepository } from '../core/types.js';

const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const CONSENSUS_ID = '00000000-0000-0000-0000-000000000100';
const COMPANY_ID = '00000000-0000-0000-0000-000000000200';

const makeRoom = (): Room => ({
  id: ROOM_ID,
  companyId: COMPANY_ID,
  name: 'engineering',
  displayName: '#engineering',
  description: null,
  config: {
    leader: { agentId: 'leader-1', systemPrompt: 'Leader' },
    devilsAdvocate: { agentId: 'da-1', systemPrompt: 'DA', aggressionLevel: 'medium' },
    workers: {
      count: 2,
      agentTemplate: { systemPrompt: 'Worker', model: 'gpt-4' },
    },
    consensus: { maxRounds: 3, forceResolveStrategy: 'leader-decides', escalationThreshold: 0.6 },
  },
  state: 'IDLE' as any,
  currentMessageId: null,
  linkedGoalId: null,
  linkedProjectId: null,
  monthlyBudgetUsd: '100.0000',
  spentUsd: '0.0000',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeConsensusDecision = (): ConsensusDecision => ({
  id: CONSENSUS_ID,
  roomId: ROOM_ID,
  triggerMessageId: 'msg-001',
  correlationId: 'corr-001',
  plan: {},
  debateRounds: 1,
  debateOutcome: 'unanimous',
  unresolved: null,
  classification: 'complex',
  createdAt: new Date(),
});

describe('TaskBreakdownService', () => {
  it('creates issues from task definitions in dependency order', async () => {
    const tasks: TaskDefinition[] = [
      {
        id: 'task-1',
        description: 'First task (no deps)',
        roomId: ROOM_ID,
        dependencies: [],
        workerConfig: { extensions: [], skills: [] },
        isIdempotent: true,
        correlationId: 'corr-task-1',
      },
      {
        id: 'task-2',
        description: 'Second task (depends on task-1)',
        roomId: ROOM_ID,
        dependencies: ['task-1'],
        workerConfig: { extensions: ['auth'], skills: ['node'] },
        isIdempotent: true,
        correlationId: 'corr-task-2',
      },
    ];

    const createdIssues: any[] = [];
    const mockIssueService = {
      createIssue: vi.fn(async (input: any) => {
        const issue = { id: `issue-${createdIssues.length}`, ...input };
        createdIssues.push(issue);
        return issue;
      }),
      addBlocker: vi.fn(),
    };

    const sessions: any[] = [];
    const mockRepo = {
      createWorkerSession: vi.fn(async (input: any) => {
        const session = { id: `session-${sessions.length}`, ...input, createdAt: new Date() };
        sessions.push(session);
        return session;
      }),
    } as unknown as RoomRepository;

    const service = new TaskBreakdownService(mockIssueService as any, mockRepo);

    const result = await service.createTasksFromPlan(
      makeRoom(),
      makeConsensusDecision(),
      tasks,
    );

    // Tasks created in dependency order (task-1 before task-2)
    expect(createdIssues).toHaveLength(2);
    expect(createdIssues[0].title).toBe('First task (no deps)');
    expect(createdIssues[1].title).toBe('Second task (depends on task-1)');

    // Dependencies linked via blockers
    expect(mockIssueService.addBlocker).toHaveBeenCalledWith(
      createdIssues[0].id,
      createdIssues[1].id,
    );

    // Worker sessions created
    expect(sessions).toHaveLength(2);
    expect(sessions[0].status).toBe(WorkerSessionStatus.PENDING);
    expect(sessions[0].taskDefinition.id).toBe('task-1');

    // Metadata preserved
    expect(createdIssues[0].metadata.source_room_id).toBe(ROOM_ID);
    expect(createdIssues[0].metadata.consensus_decision_id).toBe(CONSENSUS_ID);
    expect(createdIssues[0].metadata.worker_config).toEqual(tasks[0].workerConfig);
  });

  it('handles tasks with multiple dependencies', async () => {
    const tasks: TaskDefinition[] = [
      {
        id: 'task-1',
        description: 'Task 1',
        roomId: ROOM_ID,
        dependencies: [],
        workerConfig: { extensions: [], skills: [] },
        isIdempotent: true,
        correlationId: 'corr-1',
      },
      {
        id: 'task-2',
        description: 'Task 2',
        roomId: ROOM_ID,
        dependencies: [],
        workerConfig: { extensions: [], skills: [] },
        isIdempotent: true,
        correlationId: 'corr-2',
      },
      {
        id: 'task-3',
        description: 'Task 3 (depends on 1 and 2)',
        roomId: ROOM_ID,
        dependencies: ['task-1', 'task-2'],
        workerConfig: { extensions: [], skills: [] },
        isIdempotent: true,
        correlationId: 'corr-3',
      },
    ];

    const createdIssues: any[] = [];
    const mockIssueService = {
      createIssue: vi.fn(async (input: any) => {
        const issue = { id: `issue-${createdIssues.length}`, ...input };
        createdIssues.push(issue);
        return issue;
      }),
      addBlocker: vi.fn(),
    };

    const sessions: any[] = [];
    const mockRepo = {
      createWorkerSession: vi.fn(async (input: any) => {
        const session = { id: `session-${sessions.length}`, ...input, createdAt: new Date() };
        sessions.push(session);
        return session;
      }),
    } as unknown as RoomRepository;

    const service = new TaskBreakdownService(mockIssueService as any, mockRepo);

    await service.createTasksFromPlan(makeRoom(), makeConsensusDecision(), tasks);

    // Task 3 depends on both 1 and 2
    const blockerCalls = mockIssueService.addBlocker.mock.calls;
    expect(blockerCalls).toHaveLength(2);
    expect(blockerCalls.some(([depId, issueId]) =>
      depId === createdIssues[0].id && issueId === createdIssues[2].id
    )).toBe(true);
    expect(blockerCalls.some(([depId, issueId]) =>
      depId === createdIssues[1].id && issueId === createdIssues[2].id
    )).toBe(true);
  });
});
