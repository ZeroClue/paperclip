import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsensusEngine } from '../consensus/ConsensusEngine.js';
import { MessageType, RoomState } from '../core/types.js';
import type {
  Room,
  RoomMessage,
  LLMClient,
  DAResponse,
  LeaderResponse,
  MessageClassification,
} from '../core/types.js';
import type {
  AddMessageInput,
  CreateConsensusDecisionInput,
  CreateDebateRoundInput,
} from '../core/RoomRepository.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEADER_AGENT_ID = '00000000-0000-0000-0000-000000000010';
const DA_AGENT_ID = '00000000-0000-0000-0000-000000000011';
const ROOM_ID = '00000000-0000-0000-0000-000000000001';
const CORRELATION_ID = 'corr-001';

const makeRoom = (overrides?: Partial<Room>): Room => ({
  id: ROOM_ID,
  companyId: '00000000-0000-0000-0000-000000000002',
  name: 'engineering',
  displayName: '#engineering',
  description: 'Engineering tasks',
  config: {
    leader: { agentId: LEADER_AGENT_ID, systemPrompt: 'You are the team leader.' },
    devilsAdvocate: {
      agentId: DA_AGENT_ID,
      systemPrompt: "You are the devil's advocate.",
      aggressionLevel: 'medium',
    },
    workers: { count: 2, agentTemplate: { systemPrompt: 'Worker', model: 'gpt-4' } },
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
  ...overrides,
});

const makeHumanMessage = (content = 'Build a login page'): RoomMessage => ({
  id: 'msg-100',
  roomId: ROOM_ID,
  correlationId: CORRELATION_ID,
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
    roomId: ROOM_ID,
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

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

let messageIdCounter = 0;

function createMockRepository() {
  const addedMessages: Array<{ roomId: string; input: AddMessageInput }> = [];
  const createdDecisions: CreateConsensusDecisionInput[] = [];
  const createdRounds: CreateDebateRoundInput[] = [];

  return {
    addedMessages,
    createdDecisions,
    createdRounds,
    addMessage: vi.fn().mockImplementation((_roomId: string, input: AddMessageInput) => {
      addedMessages.push({ roomId: _roomId, input });
      messageIdCounter++;
      return Promise.resolve({
        id: `msg-${messageIdCounter}`,
        roomId: _roomId,
        correlationId: input.correlationId,
        type: input.type,
        sender: input.sender,
        senderAgentId: input.senderAgentId ?? null,
        content: input.content,
        metadata: input.metadata ?? {},
        linkedIssueIds: input.linkedIssueIds ?? [],
        debateRound: input.debateRound ?? null,
        consensusOutcome: input.consensusOutcome ?? null,
        createdAt: new Date(),
      });
    }),
    createConsensusDecision: vi.fn().mockImplementation((input: CreateConsensusDecisionInput) => {
      createdDecisions.push(input);
      return Promise.resolve({
        id: 'dec-1',
        roomId: input.roomId,
        triggerMessageId: input.triggerMessageId,
        correlationId: input.correlationId,
        plan: input.plan as Record<string, unknown>,
        debateRounds: input.debateRounds,
        debateOutcome: input.debateOutcome,
        unresolved: input.unresolved ?? null,
        classification: input.classification,
        createdAt: new Date(),
      });
    }),
    createDebateRound: vi.fn().mockImplementation((input: CreateDebateRoundInput) => {
      createdRounds.push(input);
      return Promise.resolve({
        id: 'round-1',
        consensusDecisionId: input.consensusDecisionId,
        roundNumber: input.roundNumber,
        leaderProposal: input.leaderProposal as Record<string, unknown>,
        leaderReasoning: input.leaderReasoning,
        daDecision: input.daDecision,
        daChallengePoints: input.daChallengePoints,
        daConfidence: input.daConfidence,
        leaderRevision: input.leaderRevision as Record<string, unknown> | null,
        leaderChanges: input.leaderChanges,
        createdAt: new Date(),
      });
    }),
    updateState: vi.fn().mockResolvedValue(makeRoom()),
  };
}

function createMockLLMClient(responses: unknown[]) {
  let callIndex = 0;
  return {
    generateStructured: vi.fn().mockImplementation(async () => {
      const result = responses[callIndex];
      callIndex++;
      return result;
    }),
    // Expose for test assertions
    _getCallCount: () => callIndex,
  } as unknown as LLMClient & { _getCallCount: () => number };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsensusEngine', () => {
  beforeEach(() => {
    messageIdCounter = 0;
  });

  describe('classify', () => {
    it('returns classification from LLM', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const classification: MessageClassification = 'complex';
      const llmClient = createMockLLMClient([{ classification, reason: 'Multi-step task' }]);

      const result = await ConsensusEngine.classify(humanMessage, room, llmClient);

      expect(result).toBe('complex');
      expect(llmClient.generateStructured).toHaveBeenCalledTimes(1);
    });
  });

  describe('run', () => {
    it('unanimous agreement on first round', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.95 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daAgree, classification]);
      const repository = createMockRepository();

      const result = await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      // Verify outcome
      expect(result.debateOutcome).toBe('unanimous');
      expect(result.rounds).toBe(1);
      expect(result.plan).toEqual(leaderProposal.plan);

      // Verify messages: LEADER_PROPOSAL + DA_AGREE
      expect(repository.addMessage).toHaveBeenCalledTimes(2);
      const messageTypes = repository.addedMessages.map((m) => m.input.type);
      expect(messageTypes).toEqual([MessageType.LEADER_PROPOSAL, MessageType.DA_AGREE]);

      // Verify DA_AGREE content format
      const daAgreeMsg = repository.addedMessages[1];
      expect(daAgreeMsg.input.content).toBe('Agreed. Confidence: 0.95');

      // Verify consensus decision persisted
      expect(repository.createConsensusDecision).toHaveBeenCalledTimes(1);
      const decisionInput = repository.createdDecisions[0];
      expect(decisionInput.debateOutcome).toBe('unanimous');
      expect(decisionInput.debateRounds).toBe(1);
      expect(decisionInput.classification).toBe('complex');
    });

    it('DA challenges then agrees on round 2', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daChallenge = makeDAResponse({ decision: 'challenge', confidence: 0.7 });
      const leaderRevision = makeLeaderResponse({
        reasoning: 'Revised plan addressing session expiry and rate limiting.',
        changesFromPrevious: ['Added session expiry handling', 'Added rate limiting middleware'],
      });
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.9 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daChallenge, leaderRevision, daAgree, classification]);
      const repository = createMockRepository();

      const result = await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      expect(result.debateOutcome).toBe('unanimous');
      expect(result.rounds).toBe(2);

      // Verify message types in order
      const messageTypes = repository.addedMessages.map((m) => m.input.type);
      expect(messageTypes).toEqual([
        MessageType.LEADER_PROPOSAL,
        MessageType.DA_CHALLENGE,
        MessageType.LEADER_REVISION,
        MessageType.DA_AGREE,
      ]);
    });

    it('max rounds exceeded with leader-decides', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daChallenge1 = makeDAResponse({
        decision: 'challenge',
        points: ['Issue A', 'Issue B'],
        confidence: 0.7,
      });
      const leaderRevision1 = makeLeaderResponse({
        reasoning: 'Revised to address A and B.',
        changesFromPrevious: ['Addressed A', 'Addressed B'],
      });
      const daChallenge2 = makeDAResponse({
        decision: 'challenge',
        points: ['New Issue C', 'Still not enough on D'],
        confidence: 0.75,
      });
      const leaderRevision2 = makeLeaderResponse({
        reasoning: 'Revised to address C and D.',
        changesFromPrevious: ['Addressed C', 'Addressed D'],
      });
      const daChallenge3 = makeDAResponse({
        decision: 'challenge',
        points: ['Issue C still not resolved'],
        confidence: 0.8,
      });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([
        leaderProposal,
        daChallenge1,
        leaderRevision1,
        daChallenge2,
        leaderRevision2,
        daChallenge3,
        classification,
      ]);
      const repository = createMockRepository();

      const result = await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      // maxRounds=3, leader-decides -> forced_leader
      expect(result.debateOutcome).toBe('forced_leader');
      expect(result.rounds).toBe(3);
    });

    it('max rounds exceeded with escalate-to-operator', async () => {
      const room = makeRoom({
        config: {
          ...makeRoom().config,
          consensus: { maxRounds: 2, forceResolveStrategy: 'escalate-to-operator', escalationThreshold: 0.6 },
        },
      });
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daChallenge1 = makeDAResponse({
        decision: 'challenge',
        points: ['Security concern'],
        confidence: 0.8,
      });
      const leaderRevision1 = makeLeaderResponse({
        reasoning: 'Added security layer.',
        changesFromPrevious: ['Added security middleware'],
      });
      const daChallenge2 = makeDAResponse({
        decision: 'challenge',
        points: ['Still not secure enough'],
        confidence: 0.85,
      });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([
        leaderProposal,
        daChallenge1,
        leaderRevision1,
        daChallenge2,
        classification,
      ]);
      const repository = createMockRepository();

      const result = await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      expect(result.debateOutcome).toBe('forced_escalated');
      expect(result.rounds).toBe(2);
      expect(result.unresolved).toBeDefined();
      expect(result.unresolved!.length).toBeGreaterThan(0);
    });

    it('stalemate detection', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      // Same challenge points in both rounds
      const daChallenge1 = makeDAResponse({
        decision: 'challenge',
        points: ['The plan does not handle session expiry', 'Missing rate limiting'],
        confidence: 0.8,
      });
      const leaderRevision1 = makeLeaderResponse({
        reasoning: 'Revised plan.',
        changesFromPrevious: ['Some changes'],
      });
      const daChallenge2 = makeDAResponse({
        decision: 'challenge',
        points: ['The plan does not handle session expiry', 'Missing rate limiting'],
        confidence: 0.8,
      });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daChallenge1, leaderRevision1, daChallenge2, classification]);
      const repository = createMockRepository();

      const result = await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      expect(result.debateOutcome).toBe('forced_leader');
      expect(result.rounds).toBe(2);
    });

    it('creates debate round records', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.95 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daAgree, classification]);
      const repository = createMockRepository();

      await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      // Should create exactly 1 debate round
      expect(repository.createDebateRound).toHaveBeenCalledTimes(1);

      const roundInput = repository.createdRounds[0];
      expect(roundInput.roundNumber).toBe(1);
      expect(roundInput.daDecision).toBe('agree');
      expect(roundInput.daConfidence).toBe('0.95');
      expect(roundInput.leaderProposal).toEqual(leaderProposal);
      expect(roundInput.leaderReasoning).toBe(leaderProposal.reasoning);
      expect(roundInput.daChallengePoints).toEqual([]);
      expect(roundInput.leaderRevision).toBeNull();
      expect(roundInput.leaderChanges).toEqual([]);
    });

    it('uses correct sender agent IDs for messages', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.95 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daAgree, classification]);
      const repository = createMockRepository();

      await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      // LEADER_PROPOSAL uses leader agent ID
      expect(repository.addedMessages[0].input.senderAgentId).toBe(LEADER_AGENT_ID);
      // DA_AGREE uses DA agent ID
      expect(repository.addedMessages[1].input.senderAgentId).toBe(DA_AGENT_ID);
    });

    it('includes correlation ID on all debate messages', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.95 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daAgree, classification]);
      const repository = createMockRepository();

      await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      for (const msg of repository.addedMessages) {
        expect(msg.input.correlationId).toBe(CORRELATION_ID);
      }
    });

    it('includes metadata on DA_CHALLENGE messages', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daChallenge = makeDAResponse({ decision: 'challenge', confidence: 0.7 });
      const leaderRevision = makeLeaderResponse({
        reasoning: 'Revised.',
        changesFromPrevious: ['Change 1'],
      });
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.9 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daChallenge, leaderRevision, daAgree, classification]);
      const repository = createMockRepository();

      await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      const daChallengeMsg = repository.addedMessages.find(
        (m) => m.input.type === MessageType.DA_CHALLENGE,
      );
      expect(daChallengeMsg).toBeDefined();
      expect(daChallengeMsg!.input.metadata).toEqual({
        confidence: 0.7,
        isStalemate: false,
      });
    });

    it('includes metadata on LEADER_PROPOSAL messages', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.95 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daAgree, classification]);
      const repository = createMockRepository();

      await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      const proposalMsg = repository.addedMessages.find(
        (m) => m.input.type === MessageType.LEADER_PROPOSAL,
      );
      expect(proposalMsg).toBeDefined();
      expect(proposalMsg!.input.metadata).toEqual({ plan: leaderProposal.plan });
    });

    it('includes metadata on LEADER_REVISION messages', async () => {
      const room = makeRoom();
      const humanMessage = makeHumanMessage();
      const leaderProposal = makeLeaderResponse();
      const daChallenge = makeDAResponse({ decision: 'challenge', confidence: 0.7 });
      const leaderRevision = makeLeaderResponse({
        reasoning: 'Revised.',
        changesFromPrevious: ['Change A', 'Change B'],
      });
      const daAgree = makeDAResponse({ decision: 'agree', points: [], confidence: 0.9 });
      const classification = { classification: 'complex' as const, reason: 'Multi-step' };

      const llmClient = createMockLLMClient([leaderProposal, daChallenge, leaderRevision, daAgree, classification]);
      const repository = createMockRepository();

      await ConsensusEngine.run({
        room,
        humanMessage,
        llmClient,
        repository,
      });

      const revisionMsg = repository.addedMessages.find(
        (m) => m.input.type === MessageType.LEADER_REVISION,
      );
      expect(revisionMsg).toBeDefined();
      expect(revisionMsg!.input.metadata).toEqual({
        changesFromPrevious: ['Change A', 'Change B'],
      });
    });
  });
});
