// server/src/rooms/__tests__/task-collector.test.ts

import { describe, it, expect, vi } from 'vitest';
import { TaskCollector } from '../execution/TaskCollector.js';
import { RoomState, MessageType, WorkerSessionStatus } from '../core/types.js';
import type { RoomRepository, RoomManager } from '../core/types.js';

const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const CONSENSUS_ID = '00000000-0000-0000-0000-000000000100';
const ISSUE_ID = '00000000-0000-0000-0000-000000000200';

interface LiveEvent {
  type: string;
  entityType: string;
  entityId: string;
  entity: { metadata?: Record<string, unknown>; output?: string; error?: unknown };
}

describe('TaskCollector', () => {
  it('updates worker session on issue completion', async () => {
    const stateTransitions: Array<{ to: RoomState }> = [];

    const mockRepo = {
      getWorkerSessionByIssue: vi.fn(async () => ({
        id: 'session-1',
        roomId: ROOM_ID,
        consensusDecisionId: CONSENSUS_ID,
        issueId: ISSUE_ID,
        taskDefinition: {} as any,
        status: WorkerSessionStatus.RUNNING,
        piSessionId: null,
        piSessionFilePath: null,
        output: null,
        costUsd: 0,
        errorDetails: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
      })),
      updateWorkerSession: vi.fn(async (id, updates) => ({
        id,
        status: updates.status as any,
        output: updates.output ?? null,
      })),
      getWorkerSessions: vi.fn(async () => [
        {
          id: 'session-1',
          roomId: ROOM_ID,
          consensusDecisionId: CONSENSUS_ID,
          issueId: ISSUE_ID,
          taskDefinition: {} as any,
          status: WorkerSessionStatus.COMPLETED,
          piSessionId: null,
          piSessionFilePath: null,
          output: 'Done',
          costUsd: 0,
          errorDetails: null,
          startedAt: new Date(),
          completedAt: new Date(),
          createdAt: new Date(),
        },
      ]),
      addMessage: vi.fn(),
    } as any;

    const mockManager = {
      transitionState: vi.fn(async (roomId, state) => {
        stateTransitions.push({ to: state });
      }),
    } as any;

    const mockSynthesisService = {
      synthesize: vi.fn(),
    };

    const events: LiveEvent[] = [];
    const collector = new TaskCollector(
      ROOM_ID,
      mockRepo,
      mockManager,
      mockSynthesisService as any,
    );

    // Simulate live event handler registration
    const handler = (event: LiveEvent) => collector.handleIssueEvent(event);

    await handler({
      type: 'issue.completed',
      entityType: 'issue',
      entityId: ISSUE_ID,
      entity: {
        metadata: { source_room_id: ROOM_ID },
        output: 'Task completed successfully',
      },
    });

    // Session updated
    expect(mockRepo.updateWorkerSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: WorkerSessionStatus.COMPLETED,
        output: 'Task completed successfully',
      }),
    );

    // All tasks complete → transition to SYNTHESISING
    expect(stateTransitions).toHaveLength(1);
    expect(stateTransitions[0].to).toBe(RoomState.SYNTHESISING);
    expect(mockSynthesisService.synthesize).toHaveBeenCalledWith(ROOM_ID, CONSENSUS_ID);
  });

  it('updates worker session on issue failure', async () => {
    const mockRepo = {
      getWorkerSessionByIssue: vi.fn(async () => ({
        id: 'session-1',
        roomId: ROOM_ID,
        consensusDecisionId: CONSENSUS_ID,
        issueId: ISSUE_ID,
        taskDefinition: { isIdempotent: true } as any,
        status: WorkerSessionStatus.RUNNING,
        piSessionId: null,
        piSessionFilePath: null,
        output: null,
        costUsd: 0,
        errorDetails: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
      })),
      updateWorkerSession: vi.fn(),
      addMessage: vi.fn(),
      getWorkerSessions: vi.fn(async () => [
        {
          id: 'session-1',
          roomId: ROOM_ID,
          consensusDecisionId: CONSENSUS_ID,
          issueId: ISSUE_ID,
          taskDefinition: { isIdempotent: true } as any,
          status: WorkerSessionStatus.FAILED,
          piSessionId: null,
          piSessionFilePath: null,
          output: null,
          costUsd: 0,
          errorDetails: null,
          startedAt: new Date(),
          completedAt: null,
          createdAt: new Date(),
        },
      ]),
    } as any;

    const mockManager = {
      transitionState: vi.fn(),
    } as any;

    const mockSynthesisService = {
      synthesize: vi.fn(),
    };

    const collector = new TaskCollector(
      ROOM_ID,
      mockRepo,
      mockManager,
      mockSynthesisService as any,
    );

    const handler = (event: LiveEvent) => collector.handleIssueEvent(event);

    await handler({
      type: 'issue.failed',
      entityType: 'issue',
      entityId: ISSUE_ID,
      entity: {
        metadata: { source_room_id: ROOM_ID },
        error: 'Connection timeout',
      },
    });

    expect(mockRepo.updateWorkerSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: WorkerSessionStatus.FAILED,
        errorDetails: { error: 'Connection timeout' },
      }),
    );
  });

  it('ignores events from other rooms', async () => {
    const mockRepo = {
      getWorkerSessionByIssue: vi.fn(),
      updateWorkerSession: vi.fn(),
    } as any;

    const mockManager = { transitionState: vi.fn() } as any;
    const mockSynthesisService = { synthesize: vi.fn() };

    const collector = new TaskCollector(
      ROOM_ID,
      mockRepo,
      mockManager,
      mockSynthesisService as any,
    );

    const handler = (event: LiveEvent) => collector.handleIssueEvent(event);

    await handler({
      type: 'issue.completed',
      entityType: 'issue',
      entityId: ISSUE_ID,
      entity: {
        metadata: { source_room_id: 'different-room-id' },
      },
    });

    expect(mockRepo.getWorkerSessionByIssue).not.toHaveBeenCalled();
  });
});
