import { describe, it, expect } from 'vitest';
import { ConsensusEngine } from '../consensus/ConsensusEngine.js';
import { ResolutionStrategy } from '../consensus/ResolutionStrategy.js';
import { PromptBuilder } from '../consensus/PromptBuilder.js';
import { RoomState, MessageType } from '../core/types.js';
import type { Room, RoomMessage, LLMClient, LeaderResponse, DAResponse } from '../core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const LEADER_ID = '00000000-0000-0000-0000-000000000010';
const DA_ID = '00000000-0000-0000-0000-000000000011';

function makeRoom(): Room {
  return {
    id: ROOM_ID,
    companyId: '00000000-0000-0000-0000-000000000002',
    name: 'engineering',
    displayName: '#engineering',
    description: null,
    config: {
      leader: { agentId: LEADER_ID, systemPrompt: 'You are the team leader.' },
      devilsAdvocate: { agentId: DA_ID, systemPrompt: 'You are the DA.', aggressionLevel: 'medium' },
      workers: { count: 1, agentTemplate: { systemPrompt: 'Worker', model: 'gpt-4' } },
      consensus: { maxRounds: 3, forceResolveStrategy: 'leader-decides', escalationThreshold: 0.6 },
    },
    state: RoomState.CONSENSUS,
    currentMessageId: null,
    linkedGoalId: null,
    linkedProjectId: null,
    monthlyBudgetUsd: '100.0000',
    spentUsd: '0.0000',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeHumanMessage(): RoomMessage {
  return {
    id: '00000000-0000-0000-0000-000000000100',
    roomId: ROOM_ID,
    correlationId: 'corr-integ-001',
    type: MessageType.HUMAN,
    sender: 'user',
    senderAgentId: null,
    content: 'Implement OAuth2 login with refresh tokens',
    metadata: {},
    linkedIssueIds: [],
    debateRound: null,
    consensusOutcome: null,
    createdAt: new Date(),
  };
}

describe('Integration: full consensus flow', () => {
  it('complex message: classify -> debate -> unanimous -> BREAKDOWN', async () => {
    const messages: any[] = [];
    const decisions: any[] = [];
    const rounds: any[] = [];
    let callIdx = 0;

    const repo = {
      addMessage: async (_rid: string, msg: any) => {
        messages.push(msg);
        return { id: `msg-${messages.length}`, ...msg, createdAt: new Date() };
      },
      createConsensusDecision: async (input: any) => {
        const d = { id: 'dec-1', ...input, createdAt: new Date() };
        decisions.push(d);
        return d;
      },
      createDebateRound: async (input: any) => {
        const r = { id: `round-${rounds.length}`, ...input, createdAt: new Date() };
        rounds.push(r);
        return r;
      },
    };

    // Responses ordered by call sequence:
    // 0: classify (standalone)
    // 1: leader proposal (inside run)
    // 2: DA review (inside run, round 1 — agree)
    // 3: classify (inside run, step 3)
    const responses: any[] = [
      { classification: 'complex', reason: 'Feature request' },
      {
        plan: [{
          id: '00000000-0000-0000-0000-000000000001',
          description: 'Implement OAuth2 authorization code flow',
          roomId: ROOM_ID,
          dependencies: [],
          workerConfig: { extensions: ['oauth'], skills: ['node'] },
          isIdempotent: true,
          correlationId: '00000000-0000-0000-0000-000000000002',
        }, {
          id: '00000000-0000-0000-0000-000000000003',
          description: 'Implement refresh token rotation',
          roomId: ROOM_ID,
          dependencies: ['00000000-0000-0000-0000-000000000001'],
          workerConfig: { extensions: ['oauth'], skills: ['node'] },
          isIdempotent: true,
          correlationId: '00000000-0000-0000-0000-000000000004',
        }],
        reasoning: 'Two-phase approach: auth flow first, then token management.',
        changesFromPrevious: [],
      },
      { decision: 'agree', points: [], confidence: 0.9 },
      { classification: 'complex', reason: 'Feature request' },
    ];

    const llm: LLMClient = {
      generateStructured: async () => responses[callIdx++]!,
    };

    // Step 1: Classify
    const room = makeRoom();
    const humanMessage = makeHumanMessage();
    const classification = await ConsensusEngine.classify(humanMessage, room, llm);
    expect(classification).toBe('complex');

    // Step 2: Run consensus
    const result = await ConsensusEngine.run({
      room,
      humanMessage,
      llmClient: llm,
      repository: repo as any,
    });

    // Step 3: Verify result
    expect(result.debateOutcome).toBe('unanimous');
    expect(result.rounds).toBe(1);
    expect(result.plan).toHaveLength(2);
    expect(result.plan[1].dependencies).toContain(result.plan[0].id);

    // Step 4: Verify resolution
    const resolution = ResolutionStrategy.resolve(result);
    expect(resolution.nextState).toBe(RoomState.BREAKDOWN);

    // Step 5: Verify persistence
    expect(decisions).toHaveLength(1);
    expect(decisions[0].debateOutcome).toBe('unanimous');
    expect(rounds).toHaveLength(1);

    // Step 6: Verify message sequence
    const messageTypes = messages.map(m => m.type);
    expect(messageTypes).toContain(MessageType.LEADER_PROPOSAL);
    expect(messageTypes).toContain(MessageType.DA_AGREE);
  });

  it('complex message: 2-round debate with challenge then agree', async () => {
    const messages: any[] = [];
    const decisions: any[] = [];
    let callIdx = 0;

    const repo = {
      addMessage: async (_rid: string, msg: any) => {
        messages.push(msg);
        return { id: `msg-${messages.length}`, ...msg, createdAt: new Date() };
      },
      createConsensusDecision: async (input: any) => {
        const d = { id: 'dec-1', ...input, createdAt: new Date() };
        decisions.push(d);
        return d;
      },
      createDebateRound: async (input: any) => {
        return { id: `round-0`, ...input, createdAt: new Date() };
      },
    };

    const plan = [{
      id: '00000000-0000-0000-0000-000000000001',
      description: 'Task',
      roomId: ROOM_ID,
      dependencies: [],
      workerConfig: { extensions: [], skills: [] },
      isIdempotent: true,
      correlationId: '00000000-0000-0000-0000-000000000002',
    }];

    // Responses ordered by call sequence inside run():
    // 0: leader proposal
    // 1: DA review (round 1 — challenge)
    // 2: leader revision
    // 3: DA review (round 2 — agree)
    // 4: classify (inside run, step 3)
    const responses: any[] = [
      { plan, reasoning: 'Initial', changesFromPrevious: [] },
      { decision: 'challenge', points: ['No rate limiting on token endpoint'], confidence: 0.8 },
      { plan, reasoning: 'Revised with rate limiting', changesFromPrevious: ['Added rate limiting'] },
      { decision: 'agree', points: [], confidence: 0.9 },
      { classification: 'complex', reason: 'Feature' },
    ];

    const llm: LLMClient = {
      generateStructured: async () => responses[callIdx++]!,
    };

    const result = await ConsensusEngine.run({
      room: makeRoom(),
      humanMessage: makeHumanMessage(),
      llmClient: llm,
      repository: repo as any,
    });

    expect(result.debateOutcome).toBe('unanimous');
    expect(result.rounds).toBe(2);

    const messageTypes = messages.map(m => m.type);
    expect(messageTypes).toEqual([
      MessageType.LEADER_PROPOSAL,
      MessageType.DA_CHALLENGE,
      MessageType.LEADER_REVISION,
      MessageType.DA_AGREE,
    ]);
  });
});
