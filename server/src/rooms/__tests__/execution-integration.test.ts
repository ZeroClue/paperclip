// server/src/rooms/__tests__/execution-integration.test.ts

import { describe, it, expect, vi } from 'vitest';
import { TaskBreakdownService } from '../execution/TaskBreakdownService.js';
import { TaskCollector } from '../execution/TaskCollector.js';
import { SynthesisService } from '../execution/SynthesisService.js';
import { RoomState, MessageType, WorkerSessionStatus } from '../core/types.js';
import type { Room, ConsensusDecision, TaskDefinition, RoomRepository, RoomManager } from '../core/types.js';

const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const CONSENSUS_ID = '00000000-0000-0000-0000-000000000100';

function makeRoom(): Room {
  return {
    id: ROOM_ID,
    companyId: '00000000-0000-0000-0000-000000000002',
    name: 'engineering',
    displayName: '#engineering',
    description: null,
    config: {
      leader: { agentId: 'leader-1', systemPrompt: 'Leader' },
      devilsAdvocate: { agentId: 'da-1', systemPrompt: 'DA', aggressionLevel: 'medium' },
      workers: { count: 2, agentTemplate: { systemPrompt: 'Worker', model: 'gpt-4' } },
      consensus: { maxRounds: 3, forceResolveStrategy: 'leader-decides', escalationThreshold: 0.6 },
    },
    state: RoomState.BREAKDOWN,
    currentMessageId: null,
    linkedGoalId: null,
    linkedProjectId: null,
    monthlyBudgetUsd: '100.0000',
    spentUsd: '0.0000',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeConsensusDecision(): ConsensusDecision {
  return {
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
  };
}

describe('Integration: Execution Pipeline', () => {
  it('full pipeline: breakdown → execution → synthesis', async () => {
    const tasks: TaskDefinition[] = [
      {
        id: 'task-1',
        description: 'Implement feature',
        roomId: ROOM_ID,
        dependencies: [],
        workerConfig: { extensions: [], skills: [] },
        isIdempotent: true,
        correlationId: 'corr-task-1',
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
    const stateTransitions: Array<{ to: RoomState }> = [];
    const messages: any[] = [];

    const mockRepo = {
      getRoom: vi.fn(async () => makeRoom()),
      createWorkerSession: vi.fn(async (input: any) => {
        const session = { id: `session-${sessions.length}`, ...input, createdAt: new Date() };
        sessions.push(session);
        return session;
      }),
      getWorkerSessionByIssue: vi.fn(async (issueId: string) => {
        return sessions.find((s) => s.issueId === issueId) || null;
      }),
      updateWorkerSession: vi.fn(async (id: string, updates: any) => {
        const session = sessions.find((s) => s.id === id);
        if (session) Object.assign(session, updates);
        return session;
      }),
      getWorkerSessions: vi.fn(async () => sessions.slice()),
      addMessage: vi.fn(async (_roomId: string, msg: any) => {
        const m = { id: 'msg-' + messages.length, roomId: _roomId, ...msg, createdAt: new Date() };
        messages.push(m);
        return m;
      }),
      updateSpent: vi.fn(),
    } as any;

    const mockManager = {
      transitionState: vi.fn(async (_roomId: string, state: RoomState) => {
        stateTransitions.push({ to: state });
      }),
    } as any;

    const mockLLM = {
      generateStructured: vi.fn(async () => ({
        summary: 'Feature implemented successfully',
        outcomes: ['Task completed'],
        totalCost: 1.50,
      })),
    };

    // Wire up services
    const breakdownService = new TaskBreakdownService(mockIssueService, mockRepo);
    const synthesisService = new SynthesisService(mockRepo, mockManager, mockLLM);
    const taskCollector = new TaskCollector(ROOM_ID, mockRepo, mockManager, synthesisService);

    // Step 1: Breakdown
    const createdSessions = await breakdownService.createTasksFromPlan(
      makeRoom(),
      makeConsensusDecision(),
      tasks,
    );

    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0].status).toBe(WorkerSessionStatus.PENDING);
    expect(createdIssues).toHaveLength(1);

    // Step 2: Simulate worker completion
    await taskCollector.handleIssueEvent({
      type: 'issue.completed',
      entityType: 'issue',
      entityId: createdIssues[0].id,
      entity: {
        metadata: { source_room_id: ROOM_ID },
        output: 'Feature implemented',
      },
    });

    // Verify session updated
    expect(sessions[0].status).toBe(WorkerSessionStatus.COMPLETED);

    // Verify transition to SYNTHESISING
    expect(stateTransitions.some((t) => t.to === RoomState.SYNTHESISING)).toBe(true);

    // Verify synthesis called
    expect(mockLLM.generateStructured).toHaveBeenCalled();

    // Verify synthesis message posted
    expect(messages.some((m) => m.type === MessageType.SYNTHESIS)).toBe(true);

    // Verify final transition to IDLE
    expect(stateTransitions.some((t) => t.to === RoomState.IDLE)).toBe(true);
  });
});
