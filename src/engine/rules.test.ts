import { describe, expect, it } from 'vitest'
import { getLegalActions, isHigherBid } from './rules'
import type { PlayingState } from './types'

describe('bid ordering', () => {
  it('uses ceiling when changing a normal bid to aces', () => {
    expect(isHigherBid({ quantity: 5, denomination: 4 }, { quantity: 3, denomination: 1 }, false, false)).toBe(true)
    expect(isHigherBid({ quantity: 5, denomination: 4 }, { quantity: 2, denomination: 1 }, false, false)).toBe(false)
    expect(isHigherBid({ quantity: 6, denomination: 4 }, { quantity: 3, denomination: 1 }, false, false)).toBe(true)
  })

  it('requires double plus one when changing aces to a normal denomination', () => {
    expect(isHigherBid({ quantity: 3, denomination: 1 }, { quantity: 7, denomination: 2 }, false, false)).toBe(true)
    expect(isHigherBid({ quantity: 3, denomination: 1 }, { quantity: 6, denomination: 6 }, false, false)).toBe(false)
  })

  it('allows more dice or the same quantity at a higher normal denomination', () => {
    expect(isHigherBid({ quantity: 4, denomination: 3 }, { quantity: 4, denomination: 4 }, false, false)).toBe(true)
    expect(isHigherBid({ quantity: 4, denomination: 3 }, { quantity: 5, denomination: 2 }, false, false)).toBe(true)
    expect(isHigherBid({ quantity: 4, denomination: 3 }, { quantity: 4, denomination: 2 }, false, false)).toBe(false)
  })

  it('locks palo-fijo denominations for players with more than one die', () => {
    expect(isHigherBid({ quantity: 2, denomination: 4 }, { quantity: 3, denomination: 5 }, true, false)).toBe(false)
    expect(isHigherBid({ quantity: 2, denomination: 4 }, { quantity: 3, denomination: 4 }, true, false)).toBe(true)
    expect(isHigherBid({ quantity: 2, denomination: 4 }, { quantity: 3, denomination: 2 }, true, true)).toBe(true)
  })
})

describe('legal action generation', () => {
  const state: PlayingState = {
    phase: 'playing',
    round: 1,
    paloFijo: false,
    currentPlayerId: 'b',
    currentBid: { quantity: 2, denomination: 4 },
    lastBidderId: 'a',
    players: [
      { id: 'a', name: 'A', diceCount: 2, hand: [1, 4], paloFijoTriggered: false },
      { id: 'b', name: 'B', diceCount: 2, hand: [2, 2], paloFijoTriggered: false },
    ],
  }

  it('only offers actions to the current player', () => {
    expect(getLegalActions(state, 'a')).toEqual({ bids: [], canDudo: false, canCalzo: false })
    const legal = getLegalActions(state, 'b')
    expect(legal.canDudo).toBe(true)
    expect(legal.canCalzo).toBe(true)
    expect(legal.bids).toContainEqual({ quantity: 1, denomination: 1 })
    expect(legal.bids).not.toContainEqual({ quantity: 2, denomination: 3 })
  })
})
