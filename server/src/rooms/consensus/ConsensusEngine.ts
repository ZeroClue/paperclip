import { randomUUID } from 'node:crypto';
import {
  MessageType,
  DAResponseSchema,
  LeaderResponseSchema,
  ClassificationSchema,
} from '../core/types.js';
import type {
  Room,
  RoomMessage,
  LLMClient,
  LLMMessage,
  DAResponse,
  LeaderResponse,
  ConsensusResult,
  MessageClassification,
} from '../core/types.js';
import type { RoomRepository } from '../core/RoomRepository.js';
import { PromptBuilder } from './PromptBuilder.js';

// ---------------------------------------------------------------------------
// Input interface
// ---------------------------------------------------------------------------

export interface ConsensusEngineInput {
  room: Room;
  humanMessage: RoomMessage;
  llmClient: LLMClient;
  repository: RoomRepository;
}

// ---------------------------------------------------------------------------
// Stalemate detection
// ---------------------------------------------------------------------------

/**
 * Detect if the DA is repeating the same challenge points.
 * Fuzzy match: if >80% of current points overlap with previous (case-insensitive), it's a stalemate.
 */
function isSameChallengePoint(
  previousDAContent: string,
  currentDA: DAResponse,
): boolean {
  let previousPoints: string[];
  try {
    previousPoints = JSON.parse(previousDAContent).points as string[];
  } catch {
    return false;
  }

  if (!previousPoints.length || !currentDA.points.length) return false;

  const overlap = currentDA.points.filter((cp) =>
    previousPoints.some((pp) => pp.toLowerCase() === cp.toLowerCase()),
  );

  return overlap.length / currentDA.points.length > 0.8;
}

// ---------------------------------------------------------------------------
// ConsensusEngine
// ---------------------------------------------------------------------------

export class ConsensusEngine {
  /**
   * Classify a human message as "simple" or "complex".
   */
  static async classify(
    humanMessage: RoomMessage,
    room: Room,
    llmClient: LLMClient,
  ): Promise<MessageClassification> {
    const prompt = PromptBuilder.buildClassificationPrompt(humanMessage, room);
    const result = await llmClient.generateStructured(prompt, ClassificationSchema);
    return result.classification;
  }

  /**
   * Run the full debate loop between Leader and Devil's Advocate.
   *
   * Returns a ConsensusResult with the final plan, outcome, and round count.
   * All messages and debate rounds are persisted to the repository.
   */
  static async run(input: ConsensusEngineInput): Promise<ConsensusResult> {
    const { room, humanMessage, llmClient, repository } = input;
    const config = room.config;

    // -------------------------------------------------------------------------
    // Step 1: Leader proposes initial plan
    // -------------------------------------------------------------------------
    const leaderPrompt = PromptBuilder.buildLeaderProposalPrompt(humanMessage, room);
    const initialProposal = await llmClient.generateStructured<LeaderResponse>(
      leaderPrompt,
      LeaderResponseSchema,
      { model: config.leader.model, systemPrompt: config.leader.systemPrompt },
    );

    // Persist LEADER_PROPOSAL message
    await repository.addMessage(room.id, {
      correlationId: humanMessage.correlationId,
      type: MessageType.LEADER_PROPOSAL,
      sender: 'leader',
      senderAgentId: config.leader.agentId,
      content: initialProposal.reasoning,
      metadata: { plan: initialProposal.plan },
    });

    // Track histories for prompt context
    const leaderHistory: LLMMessage[] = [
      { role: 'assistant', content: JSON.stringify(initialProposal) },
    ];
    const daHistory: LLMMessage[] = [];

    let currentPlan = initialProposal;
    let finalOutcome: ConsensusResult['debateOutcome'] | null = null;
    let unresolvedPoints: string[] | undefined;
    const roundRecords: Array<{
      roundNumber: number;
      leaderProposal: LeaderResponse;
      daResponse: DAResponse;
      leaderRevision: LeaderResponse | null;
    }> = [];

    // -------------------------------------------------------------------------
    // Step 2: Debate loop
    // -------------------------------------------------------------------------
    const maxRounds = config.consensus.maxRounds;

    for (let round = 1; round <= maxRounds; round++) {
      // DA reviews
      const daPrompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        currentPlan,
        leaderHistory,
        daHistory,
        room,
      );
      const daResponse = await llmClient.generateStructured<DAResponse>(
        daPrompt,
        DAResponseSchema,
        {
          model: config.devilsAdvocate.model,
          systemPrompt: config.devilsAdvocate.systemPrompt,
        },
      );

      // Push to DA history
      daHistory.push({ role: 'assistant', content: JSON.stringify(daResponse) });

      // Check for agreement
      if (daResponse.decision === 'agree') {
        await repository.addMessage(room.id, {
          correlationId: humanMessage.correlationId,
          type: MessageType.DA_AGREE,
          sender: 'devils_advocate',
          senderAgentId: config.devilsAdvocate.agentId,
          content: `Agreed. Confidence: ${daResponse.confidence}`,
        });

        finalOutcome = 'unanimous';
        roundRecords.push({
          roundNumber: round,
          leaderProposal: currentPlan,
          daResponse,
          leaderRevision: null,
        });
        break;
      }

      // Check for stalemate (need at least 2 DA responses to compare)
      let isStalemate = false;
      if (daHistory.length >= 2) {
        isStalemate = isSameChallengePoint(
          daHistory[daHistory.length - 2].content,
          daResponse,
        );
      }

      // Persist DA_CHALLENGE message
      await repository.addMessage(room.id, {
        correlationId: humanMessage.correlationId,
        type: MessageType.DA_CHALLENGE,
        sender: 'devils_advocate',
        senderAgentId: config.devilsAdvocate.agentId,
        content: daResponse.points.join('\n'),
        metadata: { confidence: daResponse.confidence, isStalemate },
      });

      if (isStalemate) {
        finalOutcome = 'forced_leader';
        unresolvedPoints = daResponse.points;
        roundRecords.push({
          roundNumber: round,
          leaderProposal: currentPlan,
          daResponse,
          leaderRevision: null,
        });
        break;
      }

      // Check if this is the last round — force resolution
      if (round === maxRounds) {
        if (config.consensus.forceResolveStrategy === 'escalate-to-operator') {
          finalOutcome = 'forced_escalated';
          unresolvedPoints = daResponse.points;
        } else {
          finalOutcome = 'forced_leader';
          unresolvedPoints = daResponse.points;
        }
        roundRecords.push({
          roundNumber: round,
          leaderProposal: currentPlan,
          daResponse,
          leaderRevision: null,
        });
        break;
      }

      // Leader revises
      const revisionPrompt = PromptBuilder.buildLeaderRevisionPrompt(
        humanMessage,
        currentPlan,
        daResponse,
        leaderHistory,
        room,
      );
      const leaderRevision = await llmClient.generateStructured<LeaderResponse>(
        revisionPrompt,
        LeaderResponseSchema,
        { model: config.leader.model, systemPrompt: config.leader.systemPrompt },
      );

      // Push to leader history
      leaderHistory.push({ role: 'assistant', content: JSON.stringify(leaderRevision) });

      // Persist LEADER_REVISION message
      await repository.addMessage(room.id, {
        correlationId: humanMessage.correlationId,
        type: MessageType.LEADER_REVISION,
        sender: 'leader',
        senderAgentId: config.leader.agentId,
        content: leaderRevision.reasoning,
        metadata: { changesFromPrevious: leaderRevision.changesFromPrevious },
      });

      // Update current plan for next round
      currentPlan = leaderRevision;

      // Record the round
      roundRecords.push({
        roundNumber: round,
        leaderProposal: currentPlan,
        daResponse,
        leaderRevision,
      });
    }

    // -------------------------------------------------------------------------
    // Step 3: Persist consensus decision
    // -------------------------------------------------------------------------
    const classification = await ConsensusEngine.classify(humanMessage, room, llmClient);

    const decision = await repository.createConsensusDecision({
      roomId: room.id,
      triggerMessageId: humanMessage.id,
      correlationId: humanMessage.correlationId,
      plan: currentPlan,
      debateRounds: roundRecords.length,
      debateOutcome: finalOutcome!,
      classification,
      unresolved: unresolvedPoints,
    });

    // -------------------------------------------------------------------------
    // Step 4: Persist debate round records
    // -------------------------------------------------------------------------
    for (const record of roundRecords) {
      await repository.createDebateRound({
        consensusDecisionId: decision.id,
        roundNumber: record.roundNumber,
        leaderProposal: record.leaderProposal,
        leaderReasoning: record.leaderProposal.reasoning,
        daDecision: record.daResponse.decision,
        daChallengePoints: record.daResponse.decision === 'agree' ? [] : record.daResponse.points,
        daConfidence: String(record.daResponse.confidence),
        leaderRevision: record.leaderRevision,
        leaderChanges: record.leaderRevision?.changesFromPrevious ?? [],
      });
    }

    // -------------------------------------------------------------------------
    // Step 5: Return result
    // -------------------------------------------------------------------------
    return {
      decisionId: decision.id,
      classification,
      plan: currentPlan.plan,
      debateOutcome: finalOutcome!,
      rounds: roundRecords.length,
      unresolved: unresolvedPoints,
    };
  }
}
