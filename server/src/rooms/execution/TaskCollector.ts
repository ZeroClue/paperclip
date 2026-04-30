// server/src/rooms/execution/TaskCollector.ts

import { RoomState, WorkerSessionStatus } from '../core/types.js';
import type { RoomRepository, RoomManager } from '../core/types.js';

export interface LiveEvent {
  type: string;
  entityType: string;
  entityId: string;
  entity: {
    metadata?: Record<string, unknown>;
    output?: string;
    error?: unknown;
  };
}

export interface SynthesisService {
  synthesize(roomId: string, consensusDecisionId: string): Promise<void>;
}

export class TaskCollector {
  constructor(
    private roomId: string,
    private repository: RoomRepository,
    private roomManager: RoomManager,
    private synthesisService: SynthesisService,
  ) {}

  async handleIssueEvent(event: LiveEvent): Promise<void> {
    // Filter events by room source - reject events for other rooms early
    const eventRoomId = event.entity.metadata?.source_room_id as string | undefined;
    if (eventRoomId !== this.roomId) return;

    // Fetch session for this issue
    const session = await this.repository.getWorkerSessionByIssue(event.entityId);
    if (!session) return;

    switch (event.type) {
      case 'issue.completed':
        await this.repository.updateWorkerSession(session.id, {
          status: WorkerSessionStatus.COMPLETED,
          output: event.entity.output ?? null,
          completedAt: new Date(),
        });
        await this.checkAllTasksComplete(session.consensusDecisionId, session.roomId);
        break;

      case 'issue.failed':
        await this.repository.updateWorkerSession(session.id, {
          status: WorkerSessionStatus.FAILED,
          errorDetails: { error: event.entity.error },
        });
        // Re-fetch session to get updated status for retry logic
        const updatedSession = await this.repository.getWorkerSessionByIssue(session.issueId);
        if (updatedSession) {
          await this.handleTaskFailure(updatedSession);
        }
        break;
    }
  }

  private async checkAllTasksComplete(consensusDecisionId: string, roomId: string): Promise<void> {
    const sessions = await this.repository.getWorkerSessions(consensusDecisionId);
    const allTerminal = sessions.every((s) =>
      [WorkerSessionStatus.COMPLETED, WorkerSessionStatus.FAILED, WorkerSessionStatus.CANCELLED].includes(s.status)
    );

    if (allTerminal) {
      await this.roomManager.transitionState(roomId, RoomState.SYNTHESISING);
      await this.synthesisService.synthesize(roomId, consensusDecisionId);
    }
  }

  private async handleTaskFailure(session: any): Promise<void> {
    const isIdempotent = session.taskDefinition.isIdempotent;

    // Session is already updated to FAILED by caller
    if (isIdempotent && session.status === WorkerSessionStatus.FAILED) {
      // Re-queue for retry by updating status back to pending
      await this.repository.updateWorkerSession(session.id, {
        status: WorkerSessionStatus.PENDING,
      });
      return;
    }

    // Check if all tasks failed
    const allSessions = await this.repository.getWorkerSessions(session.consensusDecisionId);
    const allFailed = allSessions.every((s) => s.status === WorkerSessionStatus.FAILED);

    if (allFailed) {
      await this.roomManager.transitionState(session.roomId, RoomState.ERROR);
      await this.repository.addMessage(session.roomId, {
        correlationId: 'error',
        type: 'error' as any,
        sender: 'system',
        content: 'All tasks failed. Manual intervention required.',
      });
    }
  }
}
