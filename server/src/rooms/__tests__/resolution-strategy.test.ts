import { describe, it, expect } from 'vitest';
import { ResolutionStrategy } from '../consensus/ResolutionStrategy.js';
import { RoomState } from '../core/types.js';
import type { ConsensusResult } from '../core/types.js';

const makeResult = (overrides?: Partial<ConsensusResult>): ConsensusResult => ({
  decisionId: 'dec-001',
  classification: 'complex',
  plan: [],
  debateOutcome: 'unanimous',
  rounds: 1,
  ...overrides,
});

describe('ResolutionStrategy', () => {
  it('returns BREAKDOWN for unanimous outcome', () => {
    const result = ResolutionStrategy.resolve(makeResult({ debateOutcome: 'unanimous' }));
    expect(result.nextState).toBe(RoomState.BREAKDOWN);
    expect(result.systemMessage).toBeUndefined();
  });

  it('returns BREAKDOWN for bypassed outcome', () => {
    const result = ResolutionStrategy.resolve(makeResult({ debateOutcome: 'bypassed' }));
    expect(result.nextState).toBe(RoomState.BREAKDOWN);
  });

  it('returns BREAKDOWN for forced_leader outcome', () => {
    const result = ResolutionStrategy.resolve(makeResult({
      debateOutcome: 'forced_leader',
      unresolved: ['Point A'],
    }));
    expect(result.nextState).toBe(RoomState.BREAKDOWN);
  });

  it('returns PAUSED for forced_escalated outcome with system message', () => {
    const result = ResolutionStrategy.resolve(makeResult({
      debateOutcome: 'forced_escalated',
      rounds: 3,
      unresolved: ['Auth approach unclear', 'No fallback strategy'],
    }));
    expect(result.nextState).toBe(RoomState.PAUSED);
    expect(result.systemMessage).toContain('3 rounds');
    expect(result.systemMessage).toContain('Auth approach unclear');
    expect(result.systemMessage).toContain('No fallback strategy');
  });

  it('handles forced_escalated with no unresolved points', () => {
    const result = ResolutionStrategy.resolve(makeResult({
      debateOutcome: 'forced_escalated',
      rounds: 3,
      unresolved: [],
    }));
    expect(result.nextState).toBe(RoomState.PAUSED);
    expect(result.systemMessage).toBeDefined();
  });
});
