import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_RULES, getLegalActions, projectForPlayer, type Die, type PlayingState } from '../engine'
import { assessCanonicalTableDice, canonicalTableDiceIndices } from './tableDice'
import type { BotObservation } from './types'

function observationWith(hand: Die[], overrides: { paloFijo?: boolean } = {}): BotObservation {
  const opponents: Die[][] = [[2, 3, 4, 6], [1, 3, 4, 6]]
  const state: PlayingState = {
    phase: 'playing', round: 2, paloFijo: overrides.paloFijo ?? false,
    // paloFijoBlindDice off so the Palo Fijo case exercises the qualifying
    // rule; with the default rules the engine forbids table dice outright in
    // Palo Fijo rounds and no canonical variant exists.
    rules: { ...DEFAULT_GAME_RULES, tableDiceEnabled: true, paloFijoBlindDice: false },
    players: [hand, ...opponents].map((dice, index) => ({
      id: index === 0 ? 'self' : `p${index}`,
      name: `P${index}`,
      diceCount: dice.length,
      hand: dice,
      tableDice: [],
      tableDiceUsed: false,
      paloFijoTriggered: false,
    })),
    currentPlayerId: 'self',
    currentBid: { quantity: 2, denomination: 4 },
    lastBidderId: 'p1',
  }
  return {
    playerId: 'self',
    view: projectForPlayer(state, 'self'),
    legalActions: getLegalActions(state, 'self'),
    history: [],
  }
}

describe('canonical table dice', () => {
  it('selects every qualifying die, counting wild aces on a normal bid', () => {
    expect(canonicalTableDiceIndices(observationWith([1, 2, 5, 5]), { quantity: 3, denomination: 5 })).toEqual([0, 2, 3])
  })

  it('counts only aces on an ace bid and only the named face under Palo Fijo', () => {
    expect(canonicalTableDiceIndices(observationWith([1, 2, 5, 5]), { quantity: 2, denomination: 1 })).toEqual([0])
    expect(canonicalTableDiceIndices(observationWith([1, 2, 5, 5], { paloFijo: true }), { quantity: 3, denomination: 5 })).toEqual([2, 3])
  })

  it('offers no variant when no die qualifies or when every die would leave the hand empty', () => {
    expect(canonicalTableDiceIndices(observationWith([2, 3, 4, 6]), { quantity: 3, denomination: 5 })).toBeUndefined()
    expect(canonicalTableDiceIndices(observationWith([5, 5]), { quantity: 3, denomination: 5 })).toBeUndefined()
  })

  it('rejects judging an illegal bid and preserves a short stack', () => {
    expect(() => assessCanonicalTableDice(observationWith([1, 2, 5, 5]), { quantity: 1, denomination: 4 })).toThrow(RangeError)
    const shortStack = assessCanonicalTableDice(observationWith([5, 3]), { quantity: 3, denomination: 5 })
    expect(shortStack.recommendation).toBe('avoid')
    expect(shortStack.reasonCode).toBe('short_stack')
  })

  it('always judges the canonical subset itself', () => {
    const observation = observationWith([1, 2, 5, 5])
    const judgment = assessCanonicalTableDice(observation, { quantity: 3, denomination: 5 })
    expect(judgment.available).toBe(true)
    expect(judgment.tableDiceIndices).toEqual(canonicalTableDiceIndices(observation, { quantity: 3, denomination: 5 }))
    expect(judgment.measurable?.revealedQualifiers).toBe(3)
    expect(judgment.measurable?.rerolledPrivateDice).toBe(1)
  })
})
