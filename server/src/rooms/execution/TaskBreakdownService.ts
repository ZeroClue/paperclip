// server/src/rooms/execution/TaskBreakdownService.ts

import { WorkerSessionStatus } from '../core/types.js';
import type { Room, ConsensusDecision, TaskDefinition, WorkerSession, RoomRepository } from '../core/types.js';

export interface IssueService {
  createIssue(input: {
    companyId: string;
    goalId?: string;
    projectId?: string;
    title: string;
    description: string;
    assigneeAgentId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
  addBlocker(blockerIssueId: string, blockedIssueId: string): Promise<void>;
}

export class TaskBreakdownService {
  constructor(
    private issueService: IssueService,
    private repository: RoomRepository,
  ) {}

  async createTasksFromPlan(
    room: Room,
    consensusDecision: ConsensusDecision,
    tasks: TaskDefinition[],
  ): Promise<WorkerSession[]> {
    const issueIds = new Map<string, string>(); // taskId → issueId

    // Topological sort by dependencies
    const sorted = this.topologicalSort(tasks);

    const sessions: WorkerSession[] = [];

    for (const task of sorted) {
      // Create the Issue
      const issue = await this.issueService.createIssue({
        companyId: room.companyId,
        goalId: room.linkedGoalId ?? undefined,
        projectId: room.linkedProjectId ?? undefined,
        title: task.description.slice(0, 200),
        description: task.description,
        assigneeAgentId: room.config.workers.agentTemplate.model,
        metadata: {
          source_room_id: room.id,
          consensus_decision_id: consensusDecision.id,
          correlation_id: task.correlationId,
          worker_config: task.workerConfig,
          is_idempotent: task.isIdempotent,
        },
      });

      issueIds.set(task.id, issue.id);

      // Link dependencies via blockers
      for (const depId of task.dependencies) {
        const depIssueId = issueIds.get(depId);
        if (depIssueId) {
          await this.issueService.addBlocker(depIssueId, issue.id);
        }
      }

      // Create worker session
      const session = await this.repository.createWorkerSession({
        roomId: room.id,
        consensusDecisionId: consensusDecision.id,
        issueId: issue.id,
        taskDefinition: task,
        status: WorkerSessionStatus.PENDING,
      });

      sessions.push(session);
    }

    return sessions;
  }

  private topologicalSort(tasks: TaskDefinition[]): TaskDefinition[] {
    const sorted: TaskDefinition[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Circular dependency detected involving task: ${taskId}`);
      }

      visiting.add(taskId);

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      for (const depId of task.dependencies) {
        visit(depId);
      }

      visiting.delete(taskId);
      visited.add(taskId);
      sorted.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return sorted;
  }
}
