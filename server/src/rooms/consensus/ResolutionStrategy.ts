import { RoomState } from '../core/types.js';
import type { ConsensusResult } from '../core/types.js';

export interface ResolutionOutcome {
  nextState: RoomState;
  systemMessage?: string;
}

/**
 * Pure function: given a consensus result, determine the next room state.
 *
 * Never throws. Returns a result object that the caller acts on.
 */
export class ResolutionStrategy {
  static resolve(result: ConsensusResult): ResolutionOutcome {
    switch (result.debateOutcome) {
      case 'unanimous':
      case 'bypassed':
      case 'forced_leader':
        return { nextState: RoomState.BREAKDOWN };

      case 'forced_escalated':
        return {
          nextState: RoomState.PAUSED,
          systemMessage: [
            `Consensus could not be reached after ${result.rounds} rounds.`,
            result.unresolved && result.unresolved.length > 0
              ? ` Unresolved points: ${result.unresolved.join('; ')}.`
              : '',
            " Approve the leader's plan, modify, or cancel.",
          ].join(''),
        };

      default:
        return { nextState: RoomState.BREAKDOWN };
    }
  }
}
