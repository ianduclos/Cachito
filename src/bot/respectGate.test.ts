import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_RULES,
  getLegalActions,
  projectForPlayer,
  type Die,
  type PlayingState,
} from '../engine'
import { evaluateBidDistribution } from './probability'
import { createRespectGatedPolicy } from './respectGate'
import type {
  BotDecisionTrace,
  BotObservation,
  BotPolicy,
  PublicActionEntry,
} from './types'

/** A challenged bid of this opponent's that HELD — the evidence the gate reads. */
function heldOutcome(round: number, actualCount = 5): PublicActionEntry {
  return {
    round,
    playerId: 'self',
    action: { type: 'dudo' },
    outcome: { kind: 'dudo', bidderId: 'opp', bid: { quantity: 5, denomination: 4 }, correct: false, actualCount },
  }
}

function observation(history: PublicActionEntry[]): BotObservation {
  const state: PlayingState = {
    phase: 'playing',
    round: 5,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    players: [
      { id: 'self', name: 'Self', diceCount: 5, hand: [2, 3, 3, 5, 6] as Die[], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
      { id: 'opp', name: 'Opp', diceCount: 5, hand: [1, 2, 4, 4, 6] as Die[], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
    ],
    currentPlayerId: 'self',
    currentBid: { quantity: 4, denomination: 3 },
    lastBidderId: 'opp',
  }
  return {
    playerId: 'self',
    view: projectForPlayer(state, 'self'),
    legalActions: getLegalActions(state, 'self'),
    history,
  }
}

function marginalDudoTrace(): BotDecisionTrace {
  return {
    model: 'stub',
    version: 1,
    decisionReason: 'dudo_threshold',
    // Slack is 0.02, below the 0.08 the gate demands of a respected bidder.
    currentBidAnalysis: {
      supportProbability: 0.34,
      exactProbability: 0.1,
      dudoConfidence: 0.66,
      effectiveDudoThreshold: 0.64,
      effectiveCalzoThreshold: 0.8,
    },
    candidateCount: 3,
    consideredCandidates: [
      { bid: { quantity: 9, denomination: 6 }, supportProbability: 0.01, exactProbability: 0.01, score: 0.5, scoreComponents: { confidenceDistance: 0.1, quantityPenalty: 0.001, visiblePreference: 0 } },
    ],
    selectedCandidate: { rank: 2, score: 0.5 },
    random: {},
  }
}

function dudoPolicy(trace?: BotDecisionTrace): BotPolicy {
  return {
    name: 'Stub',
    chooseAction: () => ({ type: 'dudo' }),
    ...(trace ? { chooseActionWithTrace: () => ({ choice: { type: 'dudo' as const }, trace }) } : {}),
  }
}

const neverRandom = () => {
  throw new Error('the respect gate must stay deterministic')
}
const respected = [heldOutcome(2), heldOutcome(3), heldOutcome(4)]

describe('respect gate', () => {
  it('describes the raise it chose, not the Dudo it suppressed', () => {
    const gated = createRespectGatedPolicy(dudoPolicy(marginalDudoTrace()))
    const result = gated.chooseActionWithTrace!(observation(respected), neverRandom)

    expect(result.choice.type).toBe('bid')
    const trace = result.trace as BotDecisionTrace & { respectGate?: { overrode: boolean } }
    expect(trace.respectGate?.overrode).toBe(true)
    // A Dudo-shaped reason on a bid action corrupts the postgame explanation and
    // any replay metric keyed on decisionReason.
    expect(trace.decisionReason).toBe('supported_bid')
    expect(trace.settings?.respectGateOverride).toBe(1)

    const chosen = result.choice.type === 'bid' ? result.choice.bid : undefined
    expect(trace.consideredCandidates[0].bid).toEqual(chosen)
    expect(trace.selectedCandidate).toEqual({ rank: 1, score: trace.consideredCandidates[0].score })
    expect(trace.candidateCount).toBe(observation(respected).legalActions.bids.length)
    // The wrapped policy's own shortlist described the Dudo branch; it must be gone.
    expect(trace.consideredCandidates.some((candidate) => candidate.bid.quantity === 9)).toBe(false)
  })

  it('picks the most supportable legal raise and keeps the trace honest about it', () => {
    const input = observation(respected)
    const gated = createRespectGatedPolicy(dudoPolicy(marginalDudoTrace()))
    const result = gated.chooseActionWithTrace!(input, neverRandom)
    const chosen = result.choice.type === 'bid' ? result.choice.bid : undefined

    const best = Math.max(...input.legalActions.bids
      .map((bid) => evaluateBidDistribution(input.view, 'self', bid).atLeast))
    expect(chosen).toBeDefined()
    expect(evaluateBidDistribution(input.view, 'self', chosen!).atLeast).toBeCloseTo(best, 12)
    // Published support must be the real support, so an audit can price the raise.
    expect((result.trace as BotDecisionTrace).consideredCandidates[0].supportProbability).toBeCloseTo(best, 12)
  })

  it('leaves a Dudo with enough slack, and its trace, untouched', () => {
    const trace = marginalDudoTrace()
    trace.currentBidAnalysis!.dudoConfidence = 0.9 // slack 0.26, well past the 0.08 bar
    const result = createRespectGatedPolicy(dudoPolicy(trace)).chooseActionWithTrace!(observation(respected), neverRandom)

    expect(result.choice.type).toBe('dudo')
    const annotated = result.trace as BotDecisionTrace & { respectGate?: { overrode: boolean } }
    expect(annotated.respectGate?.overrode).toBe(false)
    expect(annotated.decisionReason).toBe('dudo_threshold')
  })

  it('never overrides without public evidence that this bidder keeps holding', () => {
    const result = createRespectGatedPolicy(dudoPolicy(marginalDudoTrace()))
      .chooseActionWithTrace!(observation([]), neverRandom)

    expect(result.choice.type).toBe('dudo')
    expect((result.trace as { respectGate?: unknown }).respectGate).toBeUndefined()
  })

  it('passes a Dudo through untouched when the wrapped policy exposes no margin', () => {
    // No trace means no way to know how marginal the call was, so the gate must
    // not guess. Same rule as lab exp-015: no trace margin, no override, ever.
    const result = createRespectGatedPolicy(dudoPolicy())
      .chooseActionWithTrace!(observation(respected), neverRandom)
    expect(result.choice.type).toBe('dudo')
  })
})
