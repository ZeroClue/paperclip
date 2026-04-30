// server/src/rooms/execution/SynthesisService.ts

import { z } from 'zod';
import { MessageType, RoomState } from '../core/types.js';
import type { WorkerSession, Room, RoomRepository, RoomManager, LLMClient } from '../core/types.js';

// Zod schema for synthesis response from LLM
const SynthesisResponseSchema = z.object({
  summary: z.string(),
  outcomes: z.array(z.string()),
});

export class SynthesisService {
  constructor(
    private repository: RoomRepository,
    private roomManager: RoomManager,
    private llmClient: LLMClient,
  ) {}

  async synthesize(roomId: string, consensusDecisionId: string): Promise<void> {
    // Note: Errors from repository or LLM calls propagate to caller for handling at workflow level
    const room = await this.repository.getRoom(roomId);
    const sessions = await this.repository.getWorkerSessions(consensusDecisionId);

    // Calculate total cost locally
    const totalCost = sessions.reduce((sum, s) => sum + s.costUsd, 0);

    // Build synthesis prompt
    const workerOutputs = sessions.map((s) => {
      const status = s.status === 'completed' ? '[OK]' : '[FAILED]';
      const error = s.errorDetails ? ` (Error: ${JSON.stringify(s.errorDetails)})` : '';
      return `${status} ${s.taskDefinition.description}: ${s.output ?? 'No output'}${error}`;
    }).join('\n');

    const prompt = `You are the team leader for the #${room.name} room.

Summarize the work completed by your team. Be concise but informative.

## Worker Outputs
${workerOutputs}

## Total Cost
$${totalCost.toFixed(2)}

## Your Response (REQUIRED FORMAT)
You MUST respond with valid JSON matching this schema:
{
  "summary": "<brief summary of what was accomplished>",
  "outcomes": ["<specific outcome 1>", "<specific outcome 2>"]
}`;

    const response = await this.llmClient.generateStructured(
      prompt,
      SynthesisResponseSchema,
    );

    // Post synthesis message
    await this.repository.addMessage(roomId, {
      correlationId: `synthesis-${consensusDecisionId}`,
      type: MessageType.SYNTHESIS,
      sender: 'leader',
      senderAgentId: room.config.leader.agentId,
      content: response.summary,
      metadata: {
        outcomes: response.outcomes,
        totalCost: totalCost,
      },
    });

    // Update budget
    await this.repository.updateSpent(roomId, totalCost.toFixed(4));

    // Return to IDLE
    await this.roomManager.transitionState(roomId, RoomState.IDLE);
  }
}
