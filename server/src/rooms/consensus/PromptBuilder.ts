import type {
  Room,
  RoomMessage,
  DAResponse,
  LeaderResponse,
  LLMMessage,
} from '../core/types.js';

/**
 * Pure functions for constructing LLM prompts.
 *
 * All methods are static — no instance state, no side effects.
 * Every method takes structured data in and returns a string out.
 */
export class PromptBuilder {
  // -------------------------------------------------------------------------
  // Classification
  // -------------------------------------------------------------------------

  static buildClassificationPrompt(humanMessage: RoomMessage, room: Room): string {
    return `You are a message classifier for a coding task router.
Given a message from a user in the "${room.name}" room, classify it:

- "simple": status checks, questions, config changes, simple queries that don't need planning
- "complex": feature requests, bug fixes, refactors, multi-step tasks that benefit from debate

Message: ${humanMessage.content}

Respond with JSON: {"classification": "simple" | "complex", "reason": "brief explanation"}`.trim();
  }

  // -------------------------------------------------------------------------
  // Leader prompts
  // -------------------------------------------------------------------------

  static buildLeaderProposalPrompt(humanMessage: RoomMessage, room: Room): string {
    return `You are the team leader for the #${room.name} room.

${room.config.leader.systemPrompt}

## Your Task
Create a detailed plan for the following request. Break it into tasks that can be independently executed by coding agents.

## Human Request
${humanMessage.content}

## Your Response (REQUIRED FORMAT)
You MUST respond with valid JSON matching this schema:
{
  "plan": [
    {
      "id": "<uuid>",
      "description": "<detailed task description>",
      "roomId": "${room.id}",
      "dependencies": ["<task uuid>"],
      "workerConfig": {
        "extensions": ["<extension name>"],
        "skills": ["<skill name>"],
        "systemPromptOverride": "<optional override>"
      },
      "isIdempotent": true|false,
      "correlationId": "<uuid>"
    }
  ],
  "reasoning": "<why you chose this approach>",
  "changesFromPrevious": []
}

Generate a new UUID for each task id and correlationId.
The roomId for all tasks is "${room.id}".`.trim();
  }

  static buildLeaderRevisionPrompt(
    humanMessage: RoomMessage,
    currentPlan: LeaderResponse,
    daResponse: DAResponse,
    leaderHistory: LLMMessage[],
    room: Room,
  ): string {
    return `You are the team leader for the #${room.name} room.

${room.config.leader.systemPrompt}

## Human Request
${humanMessage.content}

## Devil's Advocate Challenge
The Devil's Advocate raised these points:
${daResponse.points.map((p) => `- ${p}`).join('\n')}

Confidence in their challenge: ${daResponse.confidence}

## Your Previous Proposals
${leaderHistory.map((h, i) => `Round ${i + 1}: ${h.content}`).join('\n\n')}

## Your Task
Revise your plan to address the Devil's Advocate's challenges. If a challenge is valid, incorporate it. If not, explain why in your reasoning.

## Your Response (REQUIRED FORMAT)
You MUST respond with valid JSON matching this schema:
{
  "plan": [/* same format as before */],
  "reasoning": "<why you made these changes or why you kept your approach>",
  "changesFromPrevious": ["<list what changed from your last proposal>"]
}

Keep the same task UUIDs if the task itself didn't change. Update correlationIds for any new tasks.
The roomId for all tasks is "${room.id}".`.trim();
  }

  // -------------------------------------------------------------------------
  // Devil's Advocate prompts
  // -------------------------------------------------------------------------

  static buildDAPrompt(
    humanMessage: RoomMessage,
    currentPlan: LeaderResponse,
    leaderHistory: LLMMessage[],
    daHistory: LLMMessage[],
    room: Room,
  ): string {
    const aggressionGuidance: Record<string, string> = {
      low: 'Challenge only clearly flawed or risky aspects. Minor preferences are acceptable to let pass.',
      medium: 'Challenge anything that has a reasonable alternative. Push for justification of non-obvious choices.',
      high: 'Challenge everything. Assume the plan is wrong until proven right. Look for hidden assumptions.',
    };
    const aggression = room.config.devilsAdvocate.aggressionLevel;

    const previousChallenges = daHistory.length > 0
      ? `In previous rounds, you raised these challenges:\n${daHistory.map((h, i) => {
          const parsed = JSON.parse(h.content) as DAResponse;
          return `Round ${i + 1}: ${parsed.points.join('; ')}`;
        }).join('\n')}\n\nThe leader addressed these. Do NOT repeat challenges the leader has already addressed.`
      : 'This is the first round.';

    return `You are the Devil's Advocate for the #${room.name} room.

${room.config.devilsAdvocate.systemPrompt}

## Your Role
Critically evaluate the proposed plan. Your job is to find flaws, risks, and better alternatives.

## Aggression Level: ${aggression.toUpperCase()}
${aggressionGuidance[aggression]}

## What Happened Before
${previousChallenges}

## The Leader's Proposal History
${leaderHistory.map((h, i) => `Round ${i + 1}: ${h.content}`).join('\n\n')}

## Current Leader Proposal
${JSON.stringify(currentPlan, null, 2)}

## Human Request
${humanMessage.content}

## Your Response (REQUIRED FORMAT)
You MUST respond with valid JSON matching this schema:
{
  "decision": "agree" | "challenge",
  "points": ["challenge point 1", "challenge point 2"],
  "confidence": 0.0-1.0
}

If decision is "agree", points should be empty.
If decision is "challenge", points must contain specific, actionable challenges.
Confidence reflects how certain you are in your decision.`.trim();
  }
}
