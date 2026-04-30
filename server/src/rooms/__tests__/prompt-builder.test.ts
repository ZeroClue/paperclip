import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../consensus/PromptBuilder.js';
import { MessageType } from '../core/types.js';
import type { Room, RoomMessage, RoomConfig, DAResponse, LeaderResponse, LLMMessage } from '../core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeRoom = (overrides?: Partial<Room>): Room => ({
  id: '00000000-0000-0000-0000-000000000001',
  companyId: '00000000-0000-0000-0000-000000000002',
  name: 'engineering',
  displayName: '#engineering',
  description: 'Engineering tasks',
  config: {
    leader: { agentId: '00000000-0000-0000-0000-000000000010', systemPrompt: 'You are the team leader.' },
    devilsAdvocate: {
      agentId: '00000000-0000-0000-0000-000000000011',
      systemPrompt: 'You are the devil\'s advocate.',
      aggressionLevel: 'medium',
    },
    workers: { count: 2, agentTemplate: { systemPrompt: 'Worker', model: 'gpt-4' } },
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
  ...overrides,
});

const makeHumanMessage = (content = 'Build a login page'): RoomMessage => ({
  id: '00000000-0000-0000-0000-000000000100',
  roomId: '00000000-0000-0000-0000-000000000001',
  correlationId: 'corr-001',
  type: MessageType.HUMAN,
  sender: 'user',
  senderAgentId: null,
  content,
  metadata: {},
  linkedIssueIds: [],
  debateRound: null,
  consensusOutcome: null,
  createdAt: new Date(),
});

const makeLeaderResponse = (overrides?: Partial<LeaderResponse>): LeaderResponse => ({
  plan: [{
    id: '00000000-0000-0000-0000-000000000200',
    description: 'Create auth module with Passport.js',
    roomId: '00000000-0000-0000-0000-000000000001',
    dependencies: [],
    workerConfig: { extensions: ['auth'], skills: ['node'] },
    isIdempotent: true,
    correlationId: '00000000-0000-0000-0000-000000000201',
  }],
  reasoning: 'We need authentication first as a foundation for all other features.',
  changesFromPrevious: [],
  ...overrides,
});

const makeDAResponse = (overrides?: Partial<DAResponse>): DAResponse => ({
  decision: 'challenge',
  points: ['The plan does not handle session expiry', 'Missing rate limiting'],
  confidence: 0.8,
  ...overrides,
});

const leaderHistory: LLMMessage[] = [
  { role: 'assistant', content: JSON.stringify(makeLeaderResponse()) },
];

const daHistory: LLMMessage[] = [
  { role: 'assistant', content: JSON.stringify(makeDAResponse()) },
];

describe('PromptBuilder', () => {
  const room = makeRoom();
  const humanMessage = makeHumanMessage();

  describe('buildClassificationPrompt', () => {
    it('includes room name and message content', () => {
      const prompt = PromptBuilder.buildClassificationPrompt(humanMessage, room);
      expect(prompt).toContain('engineering');
      expect(prompt).toContain('Build a login page');
      expect(prompt).toContain('simple');
      expect(prompt).toContain('complex');
    });

    it('returns a non-empty string', () => {
      const prompt = PromptBuilder.buildClassificationPrompt(humanMessage, room);
      expect(prompt.length).toBeGreaterThan(50);
    });
  });

  describe('buildLeaderProposalPrompt', () => {
    it('includes human message and leader system prompt', () => {
      const prompt = PromptBuilder.buildLeaderProposalPrompt(humanMessage, room);
      expect(prompt).toContain('Build a login page');
      expect(prompt).toContain('You are the team leader.');
    });

    it('includes required JSON format instructions', () => {
      const prompt = PromptBuilder.buildLeaderProposalPrompt(humanMessage, room);
      expect(prompt).toContain('plan');
      expect(prompt).toContain('reasoning');
      expect(prompt).toContain('changesFromPrevious');
    });
  });

  describe('buildDAPrompt', () => {
    it('includes aggression level guidance', () => {
      const prompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        makeLeaderResponse(),
        leaderHistory,
        [],
        room,
      );
      expect(prompt).toContain('MEDIUM');
      expect(prompt).toContain('Challenge anything that has a reasonable alternative');
    });

    it('includes DA system prompt', () => {
      const prompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        makeLeaderResponse(),
        leaderHistory,
        [],
        room,
      );
      expect(prompt).toContain("You are the devil's advocate.");
    });

    it('includes leader history', () => {
      const prompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        makeLeaderResponse(),
        leaderHistory,
        [],
        room,
      );
      expect(prompt).toContain('Round 1:');
    });

    it('includes DA own history with "do not repeat" warning', () => {
      const prompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        makeLeaderResponse(),
        leaderHistory,
        daHistory,
        room,
      );
      expect(prompt).toContain('you raised these challenges');
      expect(prompt).toContain('Do NOT repeat');
    });

    it('shows "first round" when DA history is empty', () => {
      const prompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        makeLeaderResponse(),
        leaderHistory,
        [],
        room,
      );
      expect(prompt).toContain('first round');
    });

    it('uses high aggression guidance when configured', () => {
      const aggressiveRoom = makeRoom({
        config: {
          ...room.config,
          devilsAdvocate: {
            ...room.config.devilsAdvocate,
            aggressionLevel: 'high',
          },
        },
      });
      const prompt = PromptBuilder.buildDAPrompt(
        humanMessage,
        makeLeaderResponse(),
        leaderHistory,
        [],
        aggressiveRoom,
      );
      expect(prompt).toContain('HIGH');
      expect(prompt).toContain('Assume the plan is wrong');
    });
  });

  describe('buildLeaderRevisionPrompt', () => {
    it('includes DA challenge points', () => {
      const daResponse = makeDAResponse();
      const prompt = PromptBuilder.buildLeaderRevisionPrompt(
        humanMessage,
        makeLeaderResponse(),
        daResponse,
        leaderHistory,
        room,
      );
      expect(prompt).toContain('The plan does not handle session expiry');
      expect(prompt).toContain('Missing rate limiting');
    });

    it('includes leader history', () => {
      const prompt = PromptBuilder.buildLeaderRevisionPrompt(
        humanMessage,
        makeLeaderResponse(),
        makeDAResponse(),
        leaderHistory,
        room,
      );
      expect(prompt).toContain('Round 1:');
    });

    it('includes revision instruction', () => {
      const prompt = PromptBuilder.buildLeaderRevisionPrompt(
        humanMessage,
        makeLeaderResponse(),
        makeDAResponse(),
        leaderHistory,
        room,
      );
      expect(prompt).toContain('changesFromPrevious');
    });
  });
});
