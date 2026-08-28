import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_RULES,
  getLegalActions,
  projectForPlayer,
  type Bid,
  type Die,
  type GameRules,
  type PlayingState,
} from '../../engine'
import type { BotObservation } from '../types'
import {
  chooseRevealIndices,
  evaluateReveal,
  evaluateRevealCurve,
  LEAKAGE_PER_DIE,
  legalRevealKs,
  pickRevealK,
  qualifyingIndices,
  qualifyingProbability,
  revealScore,
} from './tableDiceReveal'

function playing(
  players: Array<{ id: string; hand: Die[]; tableDice?: Die[] }>,
  overrides: Partial<PlayingState> = {},
  rules: Partial<GameRules> = {},
): PlayingState {
  const enginePlayers = players.map(({ id, hand, tableDice = [] }) => ({
    id,
    name: id.toUpperCase(),
    diceCount: hand.length + tableDice.length,
    hand: [...hand],
    tableDice: [...tableDice],
    tableDiceUsed: tableDice.length > 0,
    paloFijoTriggered: false,
  }))
  return {
    phase: 'playing',
    players: enginePlayers,
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES, ...rules },
    currentPlayerId: enginePlayers[0].id,
    currentBid: null,
    lastBidderId: null,
    ...overrides,
  }
}

function observation(state: PlayingState, playerId: string): BotObservation {
  return {
    playerId,
    view: projectForPlayer(state, playerId),
    legalActions: getLegalActions(state, playerId),
    history: [],
  }
}

/** A 4-player table where `hand` is the actor's; everyone else holds five unrelated dice. */
function tableWith(hand: Die[], overrides: Partial<PlayingState> = {}, rules: Partial<GameRules> = {}): BotObservation {
  const state = playing(
    [
      { id: 'me', hand },
      { id: 'b', hand: [2, 2, 2, 2, 2] },
      { id: 'c', hand: [2, 2, 2, 2, 2] },
      { id: 'd', hand: [2, 2, 2, 2, 2] },
    ],
    overrides,
    rules,
  )
  return observation(state, 'me')
}

describe('qualifyingProbability mirrors the engine rule rather than hardcoding it', () => {
  it('is 2/6 for a non-ace bid outside Palo Fijo (the face plus wild aces)', () => {
    expect(qualifyingProbability({ quantity: 3, denomination: 5 }, false)).toBeCloseTo(2 / 6, 12)
  })

  it('is 1/6 for an ace bid, where aces are not additionally wild', () => {
    expect(qualifyingProbability({ quantity: 3, denomination: 1 }, false)).toBeCloseTo(1 / 6, 12)
  })

  it('is 1/6 inside Palo Fijo, where aces stop being wild', () => {
    expect(qualifyingProbability({ quantity: 3, denomination: 5 }, true)).toBeCloseTo(1 / 6, 12)
  })
})

describe('qualifyingIndices only ever names dice that back the claim', () => {
  it('includes the bid face and wild aces, in hand order', () => {
    expect(qualifyingIndices([5, 1, 3, 5, 6], { quantity: 2, denomination: 5 }, false)).toEqual([0, 1, 3])
  })

  it('drops aces inside Palo Fijo, where they are no longer wild', () => {
    expect(qualifyingIndices([5, 1, 3, 5, 6], { quantity: 2, denomination: 5 }, true)).toEqual([0, 3])
  })
})

describe('legalRevealKs respects the engine ceilings', () => {
  it('is 0 only when the mechanic is unavailable this round', () => {
    expect(legalRevealKs([5, 5, 5], { quantity: 2, denomination: 5 }, false, false)).toEqual([0])
  })

  it('caps at hand.length - 1 — at least one die always stays private', () => {
    expect(legalRevealKs([5, 5, 5], { quantity: 2, denomination: 5 }, false, true)).toEqual([0, 1, 2])
  })

  it('caps at the number of qualifiers held when that is the tighter bound', () => {
    expect(legalRevealKs([5, 3, 4, 6, 2], { quantity: 2, denomination: 5 }, false, true)).toEqual([0, 1])
  })

  it('is 0 for a one-die hand, which can never spare a die', () => {
    expect(legalRevealKs([5], { quantity: 1, denomination: 5 }, false, true)).toEqual([0])
  })
})

describe('the two priced axes', () => {
  const bid: Bid = { quantity: 3, denomination: 5 }

  it('scores k = 0 as an exact no-op on both axes', () => {
    const row = evaluateReveal([5, 5, 3, 4, 6], bid, false, 0)
    expect(row.rerollGain).toBe(0)
    expect(row.proofGain).toBe(0)
    expect(row.rerolledDiceCount).toBe(0)
  })

  it('computes rerollGain as closed-form binomial, not simulation', () => {
    // One qualifier held; reveal it and the other four dice reroll at p = 2/6.
    const row = evaluateReveal([5, 3, 4, 6, 2], bid, false, 1)
    expect(row.currentQualifiers).toBe(1)
    expect(row.rerolledDiceCount).toBe(4)
    expect(row.rerollGain).toBeCloseTo(1 + 4 * (2 / 6) - 1, 12)
  })

  it('always scores proofGain as exactly k, since only qualifiers may be shown', () => {
    for (const k of [0, 1, 2]) {
      expect(evaluateReveal([5, 5, 3, 4, 6], bid, false, k).proofGain).toBe(k)
    }
  })
})

describe('the ratified motif at LEAKAGE_PER_DIE = 1.5', () => {
  const bid: Bid = { quantity: 3, denomination: 5 }

  it('shows the die when the hand holds EXACTLY ONE qualifier', () => {
    expect(chooseRevealIndices(tableWith([5, 3, 4, 6, 2]), bid)).toEqual([0])
  })

  it('stays quiet when the hand holds two qualifiers — the motif is never two dice', () => {
    expect(chooseRevealIndices(tableWith([5, 5, 4, 6, 2]), bid)).toBeUndefined()
  })

  it('never reveals more than one die, at any hand shape', () => {
    const hands: Die[][] = [
      [5, 5, 5, 5, 3],
      [5, 1, 5, 1, 3],
      [5, 5, 5, 3, 3],
      [1, 1, 1, 1, 5],
    ]
    for (const hand of hands) {
      const chosen = chooseRevealIndices(tableWith(hand), bid)
      expect(chosen === undefined || chosen.length <= 1).toBe(true)
    }
  })

  it('stays quiet on a two-die hand, where revealing leaves too little to reroll', () => {
    expect(chooseRevealIndices(tableWith([5, 3]), bid)).toBeUndefined()
  })

  it('only ever names dice that count toward the bid', () => {
    const hand: Die[] = [3, 4, 5, 6, 2]
    const chosen = chooseRevealIndices(tableWith(hand), bid)
    for (const index of chosen ?? []) {
      expect(qualifyingIndices(hand, bid, false)).toContain(index)
    }
  })

  it('reveals nothing when the engine says the mechanic is unavailable', () => {
    const blocked = tableWith([5, 3, 4, 6, 2], {}, { tableDiceEnabled: false })
    expect(blocked.legalActions.canPutDiceOnTable).toBe(false)
    expect(chooseRevealIndices(blocked, bid)).toBeUndefined()
  })
})

describe('the leakage constant is load-bearing, not decorative', () => {
  const bid: Bid = { quantity: 3, denomination: 5 }
  const oneQualifier = tableWith([5, 3, 4, 6, 2])
  const twoQualifiers = tableWith([5, 5, 4, 6, 2])

  it('goes silent entirely when leakage is priced prohibitively high', () => {
    expect(chooseRevealIndices(oneQualifier, bid, 99)).toBeUndefined()
  })

  it('shows every qualifier it can when leakage is free', () => {
    expect(chooseRevealIndices(twoQualifiers, bid, 0)).toEqual([0, 1])
  })

  it('rejects a negative or non-finite cost rather than pricing nonsense', () => {
    expect(() => chooseRevealIndices(oneQualifier, bid, -1)).toThrow(RangeError)
    expect(() => chooseRevealIndices(oneQualifier, bid, Number.NaN)).toThrow(RangeError)
  })

  it('is the value the duel ratified', () => {
    expect(LEAKAGE_PER_DIE).toBe(1.5)
  })
})

describe('scoring and tie-breaks', () => {
  const bid: Bid = { quantity: 3, denomination: 5 }

  it('scores exactly rerollGain + proofGain - leakage * k', () => {
    const row = evaluateReveal([5, 5, 4, 6, 2], bid, false, 2)
    expect(revealScore(row, 1.5)).toBeCloseTo(row.rerollGain + row.proofGain - 1.5 * 2, 12)
  })

  it('keeps the smallest k on a tie — the least committal legal choice', () => {
    // Two qualifiers in a five-die hand at p = 2/6 makes k = 2 score exactly 0, the
    // same as never revealing; the tie must resolve to staying quiet.
    const curve = evaluateRevealCurve([5, 5, 4, 6, 2], bid, false, true)
    expect(revealScore(curve[2], LEAKAGE_PER_DIE)).toBeCloseTo(0, 12)
    expect(pickRevealK(curve, LEAKAGE_PER_DIE).k).toBe(0)
  })

  it('refuses to pick from an empty curve rather than inventing a k', () => {
    expect(() => pickRevealK([], LEAKAGE_PER_DIE)).toThrow(RangeError)
  })
})
