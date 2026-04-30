import { randomUUID } from 'node:crypto';
import { RoomState, MessageType, PostMessageSchema } from './types.js';
import type { PostMessageResponse, LLMClient, MessageClassification } from './types.js';
import type { RoomRepository } from './RoomRepository.js';
import type { RoomManager } from './RoomManager.js';
import { ConsensusEngine } from '../consensus/ConsensusEngine.js';
import { ResolutionStrategy } from '../consensus/ResolutionStrategy.js';
import { TaskBreakdownService } from '../execution/TaskBreakdownService.js';

export class RoomBusyError extends Error {
  constructor(public currentState: RoomState) {
    super(`Room is in ${currentState} state. Cannot accept new messages.`);
    this.name = 'RoomBusyError';
  }
}

export class MessageRouter {
  constructor(
    private repository: RoomRepository,
    private manager: RoomManager,
    private llmClient: LLMClient,
    private taskBreakdownService?: TaskBreakdownService,
  ) {}

  async routeMessage(roomId: string, input: {
    content: string;
    correlationId?: string;
  }): Promise<PostMessageResponse> {
    // 1. Validate input
    const parsed = PostMessageSchema.safeParse({
      type: MessageType.HUMAN,
      content: input.content,
    });
    if (!parsed.success) {
      throw new Error(`Validation failed: ${parsed.error.message}`);
    }

    const correlationId = input.correlationId ?? randomUUID();

    // 2. Check room state
    const canAccept = await this.manager.canAcceptMessages(roomId);
    if (!canAccept) {
      const room = await this.repository.getRoom(roomId);
      throw new RoomBusyError(room.state);
    }

    // 3. Persist human message
    const message = await this.repository.addMessage(roomId, {
      correlationId,
      type: MessageType.HUMAN,
      sender: 'user',
      content: input.content,
    });

    // 4. Classify message complexity
    const room = await this.repository.getRoom(roomId);
    const classification = await ConsensusEngine.classify(
      { ...message, roomId } as any,
      room,
      this.llmClient,
    );

    // 5. Route based on classification
    if (classification === 'simple') {
      await this.manager.transitionState(roomId, RoomState.BREAKDOWN);
      await this.repository.addMessage(roomId, {
        correlationId,
        type: MessageType.CONSENSUS_BYPASSED,
        sender: 'system',
        content: 'Message classified as simple — skipping consensus debate.',
      });

      return {
        id: message.id,
        roomId,
        correlationId,
        type: MessageType.HUMAN,
        sender: 'user',
        createdAt: message.createdAt,
        classification,
      };
    }

    // 6. Complex message: enter CONSENSUS and run debate asynchronously
    await this.manager.transitionState(roomId, RoomState.CONSENSUS);

    this.runConsensus(room, { ...message, roomId } as any).catch((error) => {
      console.error(`[rooms] Consensus failed for room ${roomId}:`, error);
    });

    return {
      id: message.id,
      roomId,
      correlationId,
      type: MessageType.HUMAN,
      sender: 'user',
      createdAt: message.createdAt,
      classification,
    };
  }

  private async runConsensus(room: any, humanMessage: any): Promise<void> {
    try {
      const result = await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient: this.llmClient,
        repository: this.repository,
      });

      const resolution = ResolutionStrategy.resolve(result);

      if (resolution.systemMessage) {
        await this.repository.addMessage(room.id, {
          correlationId: humanMessage.correlationId,
          type: result.debateOutcome === 'forced_escalated'
            ? MessageType.CONSENSUS_FORCED
            : MessageType.CONSENSUS_REACHED,
          sender: 'system',
          content: resolution.systemMessage,
        });
      } else {
        await this.repository.addMessage(room.id, {
          correlationId: humanMessage.correlationId,
          type: result.debateOutcome === 'unanimous'
            ? MessageType.CONSENSUS_REACHED
            : MessageType.CONSENSUS_FORCED,
          sender: 'system',
          content: result.debateOutcome === 'unanimous'
            ? `Consensus reached after ${result.rounds} round(s).`
            : `Consensus forced after ${result.rounds} round(s). ${result.unresolved?.length ? 'Unresolved: ' + result.unresolved.join('; ') : ''}`,
        });
      }

      await this.manager.transitionState(room.id, resolution.nextState);

      // If entering BREAKDOWN and we have a task breakdown service, create tasks
      if (resolution.nextState === RoomState.BREAKDOWN && this.taskBreakdownService) {
        try {
          await this.taskBreakdownService.createTasksFromPlan(
            room,
            { id: result.decisionId } as any, // ConsensusDecision stub
            result.plan,
          );
          await this.manager.transitionState(room.id, RoomState.EXECUTING);
        } catch (error) {
          await this.repository.addMessage(room.id, {
            correlationId: humanMessage.correlationId,
            type: MessageType.ERROR,
            sender: 'system',
            content: `Failed to create tasks: ${error instanceof Error ? error.message : String(error)}`,
          });
          await this.manager.transitionState(room.id, RoomState.ERROR);
        }
      }
    } catch (error: unknown) {
      await this.repository.addMessage(room.id, {
        correlationId: humanMessage.correlationId,
        type: MessageType.ERROR,
        sender: 'system',
        content: `Consensus engine error: ${error instanceof Error ? error.message : String(error)}`,
      });
      try {
        await this.manager.transitionState(room.id, RoomState.ERROR);
      } catch {
        // If we can't transition to ERROR, something is very wrong
      }
    }
  }
}
