import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_RULES } from './index'
import { getLegalActions, isHigherBid } from './rules'
import type { PlayingState } from './types'

describe('bid ordering', () => {
  it('uses ceiling when changing a normal bid to aces', () => {
    expect(isHigherBid({ quantity: 5, denomination: 4 }, { quantity: 3, denomination: 1 }, false, false)).toBe(true)
    expect(isHigherBid({ quantity: 5, denomination: 4 }, { quantity: 2, denomination: 1 }, false, false)).toBe(false)
    expect(isHigherBid({ quantity: 6, denomination: 4 }, { quantity: 3, denomination: 1 }, false, false)).toBe(true)
  })

  it('rounds the halving down before adding one when the half-plus-one rule is selected', () => {
    // Even previous quantity: floor(6/2)+1 = 4, one more than the plain-half ceil of 3.
    expect(isHigherBid({ quantity: 6, denomination: 4 }, { quantity: 3, denomination: 1 }, false, false, 'halfPlusOne')).toBe(false)
    expect(isHigherBid({ quantity: 6, denomination: 4 }, { quantity: 4, denomination: 1 }, false, false, 'halfPlusOne')).toBe(true)
    // Odd previous quantity: floor(5/2)+1 = 3, matching the plain-half ceil.
    expect(isHigherBid({ quantity: 5, denomination: 4 }, { quantity: 2, denomination: 1 }, false, false, 'halfPlusOne')).toBe(false)
    expect(isHigherBid({ quantity: 5, denomination: 4 }, { quantity: 3, denomination: 1 }, false, false, 'halfPlusOne')).toBe(true)
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

  it('lets a one-die palo-fijo player swap to aces at the same quantity, and no further at it', () => {
    // Aces top the equal-quantity ladder in Palo Fijo, so two Cuadras becomes two
    // Aces without raising the quantity — but only for the one-die privilege.
    expect(isHigherBid({ quantity: 2, denomination: 4 }, { quantity: 2, denomination: 1 }, true, true)).toBe(true)
    expect(isHigherBid({ quantity: 2, denomination: 6 }, { quantity: 2, denomination: 1 }, true, true)).toBe(true)
    expect(isHigherBid({ quantity: 2, denomination: 4 }, { quantity: 2, denomination: 1 }, true, false)).toBe(false)
    // From aces the only way up is the quantity — never back down to a face at
    // the same quantity, which would let two players raise in circles.
    expect(isHigherBid({ quantity: 2, denomination: 1 }, { quantity: 2, denomination: 6 }, true, true)).toBe(false)
    expect(isHigherBid({ quantity: 2, denomination: 1 }, { quantity: 2, denomination: 1 }, true, true)).toBe(false)
    expect(isHigherBid({ quantity: 2, denomination: 1 }, { quantity: 3, denomination: 2 }, true, true)).toBe(true)
    expect(isHigherBid({ quantity: 2, denomination: 1 }, { quantity: 3, denomination: 1 }, true, true)).toBe(true)
  })
})

describe('legal action generation', () => {
  const state: PlayingState = {
    phase: 'playing',
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    currentPlayerId: 'b',
    currentBid: { quantity: 2, denomination: 4 },
    lastBidderId: 'a',
    players: [
      { id: 'a', name: 'A', diceCount: 2, hand: [1, 4], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
      { id: 'b', name: 'B', diceCount: 2, hand: [2, 2], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
    ],
  }

  it('offers a one-die palo-fijo player the same-quantity ace switch, and denies it to the table', () => {
    const paloState: PlayingState = {
      ...state,
      paloFijo: true,
      players: [
        { id: 'a', name: 'A', diceCount: 3, hand: [1, 4, 4], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
        { id: 'b', name: 'B', diceCount: 1, hand: [4], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
      ],
    }

    expect(getLegalActions(paloState, 'b').bids).toContainEqual({ quantity: 2, denomination: 1 })
    expect(getLegalActions({ ...paloState, currentPlayerId: 'a', lastBidderId: 'b' }, 'a').bids).not.toContainEqual({ quantity: 2, denomination: 1 })
  })

  it('only offers actions to the current player', () => {
    expect(getLegalActions(state, 'a')).toEqual({ bids: [], canDudo: false, canCalzo: false, canPutDiceOnTable: false })
    const legal = getLegalActions(state, 'b')
    expect(legal.canDudo).toBe(true)
    expect(legal.canCalzo).toBe(true)
    expect(legal.bids).toContainEqual({ quantity: 2, denomination: 1 })
    expect(legal.bids).not.toContainEqual({ quantity: 2, denomination: 3 })
  })
})
