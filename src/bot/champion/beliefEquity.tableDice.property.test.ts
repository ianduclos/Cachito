import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_RULES,
  countsTowardBid,
  getLegalActions,
  projectForPlayer,
  type Bid,
  type Die,
  type GameRules,
  type PlayingState,
} from '../../engine'
import type { BotObservation, PublicActionEntry } from '../types'
import {
  beliefBidProbability,
  initialPosterior,
  uniformLikelihoodModel,
} from './beliefFilter'
import { buildBeliefContext, loadLikelihoodModel } from './beliefEquity'

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

function observation(
  state: PlayingState,
  playerId: string,
  history: PublicActionEntry[] = [],
): BotObservation {
  return {
    playerId,
    view: projectForPlayer(state, playerId),
    legalActions: getLegalActions(state, playerId),
    history,
  }
}

function everyBid(totalDice: number): Bid[] {
  return Array.from({ length: totalDice }, (_, quantity) =>
    Array.from({ length: 6 }, (__, denomination) => ({
      quantity: quantity + 1,
      denomination: (denomination + 1) as Die,
    }))).flat()
}

/**
 * Enumerates every ordered k-tuple of fair six-sided dice. This is intentionally
 * independent of the shipped `enumerateHands` multiset enumeration in
 * `beliefFilter.ts` — the tests below count raw assignments, not compressed
 * count states.
 */
function* generateHands(k: number): Generator<Die[]> {
  if (k === 0) {
    yield []
    return
  }
  for (const prefix of generateHands(k - 1)) {
    for (let die = 1; die <= 6; die += 1) {
      yield [...prefix, die as Die]
    }
  }
}

/**
 * Computes P(bid true) by nested-loop enumeration over every possible assignment
 * of the *private* dice currently held by each player. Public table dice are
 * treated as fixed contributors (they qualify with probability 1). The count
 * rule mirrors the engine's `countsTowardBid` exactly.
 *
 * This function is the brute-force oracle the property tests compare against
 * `buildBeliefContext` + `beliefBidProbability`.
 */
function bruteForceBidProbability(observation: BotObservation, bid: Bid): number {
  const { view, playerId } = observation
  const paloFijo = view.paloFijo
  const players = view.players.filter((candidate) => candidate.diceCount > 0)
  const self = players.find((candidate) => candidate.id === playerId)!
  const selfHandKnown = self.hand !== undefined
  const privateCounts = players.map((candidate) =>
    Math.max(0, candidate.diceCount - candidate.tableDice.length),
  )

  let total = 0
  let success = 0

  function recurse(index: number, assignment: Die[][]): void {
    if (index === players.length) {
      total += 1
      let qualifying = 0
      for (let i = 0; i < players.length; i += 1) {
        const player = players[i]
        const hand = assignment[i]
        for (const die of player.tableDice) {
          if (countsTowardBid(die, bid, paloFijo)) qualifying += 1
        }
        for (const die of hand) {
          if (countsTowardBid(die, bid, paloFijo)) qualifying += 1
        }
      }
      if (qualifying >= bid.quantity) success += 1
      return
    }

    const player = players[index]
    if (player.id === playerId && selfHandKnown) {
      // The projected hand for a visible seat is already the private portion only.
      recurse(index + 1, [...assignment, self.hand!])
    } else {
      for (const hand of generateHands(privateCounts[index])) {
        recurse(index + 1, [...assignment, hand])
      }
    }
  }

  recurse(0, [])
  return total === 0 ? 0 : success / total
}

describe('table-dice belief path: brute-force properties', () => {
  const uniformModel = uniformLikelihoodModel()

  function assertBruteForceAgreement(label: string, input: BotObservation): void {
    const totalDice = input.view.players.reduce((sum, player) => sum + player.diceCount, 0)
    const belief = buildBeliefContext(input, uniformModel)
    for (const bid of everyBid(totalDice)) {
      const expected = bruteForceBidProbability(input, bid)
      const actual = beliefBidProbability(belief.ownCounts, bid, input.view.paloFijo, belief.opponents)
      expect(actual, `${label}: ${bid.quantity}x${bid.denomination}`).toBeCloseTo(expected, 12)
    }
  }

  describe('property 1: deterministic public contribution', () => {
    it('counts self table dice as fixed contributors', () => {
      const state = playing([
        { id: 'self', hand: [2, 3], tableDice: [6] },
        { id: 'b', hand: [4, 5] },
      ])
      const input = observation(state, 'self')
      assertBruteForceAgreement('self-table', input)

      // A bid for the exact face on the table must be certain at quantity 1.
      const belief = buildBeliefContext(input, uniformModel)
      expect(beliefBidProbability(
        belief.ownCounts,
        { quantity: 1, denomination: 6 },
        false,
        belief.opponents,
      )).toBe(1)
    })

    it('counts opponent table dice as fixed contributors', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5], tableDice: [6] },
      ])
      const input = observation(state, 'self')
      assertBruteForceAgreement('opponent-table', input)

      const belief = buildBeliefContext(input, uniformModel)
      const b = belief.opponents.find((entry) => entry.playerId === 'b')!
      expect(b.k).toBe(2)
    })

    it('counts several players with table dice in the same round', () => {
      const state = playing([
        { id: 'self', hand: [2], tableDice: [4] },
        { id: 'b', hand: [3], tableDice: [6] },
        { id: 'c', hand: [1], tableDice: [6, 6] },
      ])
      const input = observation(state, 'self', [
        { round: 1, playerId: 'self', action: { type: 'bid', bid: { quantity: 1, denomination: 4 }, tableDiceIndices: [0] } },
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 2, denomination: 6 }, tableDiceIndices: [0] } },
        { round: 1, playerId: 'c', action: { type: 'bid', bid: { quantity: 3, denomination: 6 }, tableDiceIndices: [0, 1] } },
      ])
      const belief = buildBeliefContext(input, uniformModel)
      expect(belief.opponents.map((entry) => [entry.playerId, entry.k])).toEqual([
        ['b', 1],
        ['c', 1],
      ])
      assertBruteForceAgreement('multi-reveal', input)
    })

    it('handles aces and non-aces with public dice', () => {
      const state = playing([
        { id: 'self', hand: [1, 2], tableDice: [3] },
        { id: 'b', hand: [1, 4], tableDice: [6] },
      ])
      const input = observation(state, 'self')
      assertBruteForceAgreement('aces-non-aces', input)

      // Aces wild for a non-ace bid: own 1 + table 3 should contribute to a bid on 3s.
      const belief = buildBeliefContext(input, uniformModel)
      expect(beliefBidProbability(
        belief.ownCounts,
        { quantity: 2, denomination: 3 },
        false,
        belief.opponents,
      )).toBe(1)
    })

    it('handles non-blind Palo Fijo, where aces stop being wild', () => {
      const state = playing([
        { id: 'self', hand: [1, 3], tableDice: [3] },
        { id: 'b', hand: [1, 3], tableDice: [3] },
      ], { paloFijo: true }, { paloFijoBlindDice: false })
      const input = observation(state, 'self')
      assertBruteForceAgreement('palo-fijo', input)

      // In Palo Fijo the ace does not help the 3-bid; the brute-force sweep over
      // all private-die assignments checks that the bookkeeping is correct.
      assertBruteForceAgreement('palo-fijo', input)
    })

    it('handles a blind own hand by folding those dice back into uncertainty', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5] },
      ], { paloFijo: true }, { paloFijoBlindDice: true })
      const input = observation(state, 'self')
      expect(input.view.players[0].hand).toBeUndefined()
      assertBruteForceAgreement('blind-own-hand', input)
    })
  })

  describe('property 2: posterior reset after reveal+reroll', () => {
    it('resets the revealing player to a fresh prior over their private remainder', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5], tableDice: [6] },
        { id: 'c', hand: [1] },
      ])
      const input = observation(state, 'self', [
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 }, tableDiceIndices: [0] } },
      ])
      const belief = buildBeliefContext(input, loadLikelihoodModel())
      const b = belief.opponents.find((entry) => entry.playerId === 'b')!
      expect(b.k).toBe(2)
      expect([...b.posterior]).toEqual([...initialPosterior(2)])
    })

    it('erases pre-reveal evidence once the private remainder is rerolled', () => {
      const model = loadLikelihoodModel()
      // Control: an ordinary bid without reveal moves the posterior off the uniform prior.
      const noReveal = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5, 6] },
        { id: 'c', hand: [1] },
      ])
      const informed = buildBeliefContext(observation(noReveal, 'self', [
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 } } },
      ]), model).opponents.find((entry) => entry.playerId === 'b')!
      expect(informed.k).toBe(3)
      expect([...informed.posterior]).not.toEqual([...initialPosterior(3)])

      // The same bid shape, but with a table-dice reveal, must reset to the prior.
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5], tableDice: [6] },
        { id: 'c', hand: [1] },
      ])
      const belief = buildBeliefContext(observation(state, 'self', [
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 }, tableDiceIndices: [0] } },
      ]), model)
      const rerolled = belief.opponents.find((entry) => entry.playerId === 'b')!
      expect(rerolled.k).toBe(2)
      expect([...rerolled.posterior]).toEqual([...initialPosterior(2)])
    })

    it('preserves the reset through later bids by other players', () => {
      const model = loadLikelihoodModel()
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5], tableDice: [6] },
        { id: 'c', hand: [1, 1] },
      ])
      const input = observation(state, 'self', [
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 }, tableDiceIndices: [0] } },
        { round: 1, playerId: 'c', action: { type: 'bid', bid: { quantity: 3, denomination: 6 } } },
      ])
      const belief = buildBeliefContext(input, model)
      const b = belief.opponents.find((entry) => entry.playerId === 'b')!
      const c = belief.opponents.find((entry) => entry.playerId === 'c')!
      expect(b.k).toBe(2)
      expect([...b.posterior]).toEqual([...initialPosterior(2)])
      expect(c.k).toBe(2)
      expect([...c.posterior]).not.toEqual([...initialPosterior(2)])
    })
  })

  describe('property 3: conservation', () => {
    it('sums opponent posterior probabilities to 1 after every legal sequence', () => {
      const model = loadLikelihoodModel()
      const cases: Array<{ label: string; state: PlayingState; history: PublicActionEntry[] }> = [
        {
          label: 'no history',
          state: playing([
            { id: 'self', hand: [2, 3] },
            { id: 'b', hand: [4, 5], tableDice: [6] },
            { id: 'c', hand: [1] },
          ]),
          history: [],
        },
        {
          label: 'reveal only',
          state: playing([
            { id: 'self', hand: [2, 3] },
            { id: 'b', hand: [4, 5], tableDice: [6] },
            { id: 'c', hand: [1] },
          ]),
          history: [
            { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 }, tableDiceIndices: [0] } },
          ],
        },
        {
          label: 'pre-reveal bid then reveal then later bid',
          state: playing([
            { id: 'self', hand: [2, 3] },
            { id: 'b', hand: [4, 5], tableDice: [6] },
            { id: 'c', hand: [1, 1] },
          ]),
          history: [
            { round: 1, playerId: 'c', action: { type: 'bid', bid: { quantity: 1, denomination: 1 } } },
            { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 2, denomination: 6 }, tableDiceIndices: [0] } },
            { round: 1, playerId: 'c', action: { type: 'bid', bid: { quantity: 3, denomination: 6 } } },
          ],
        },
        {
          label: 'truncated history',
          state: playing([
            { id: 'self', hand: [2, 3] },
            { id: 'b', hand: [4, 5], tableDice: [6] },
            { id: 'c', hand: [1] },
          ]),
          history: [
            { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 } } },
          ],
        },
      ]

      for (const { label, state, history } of cases) {
        const input = observation(state, 'self', history)
        const belief = buildBeliefContext(input, model)
        for (const opponent of belief.opponents) {
          const sum = opponent.posterior.reduce((acc, value) => acc + value, 0)
          expect(sum, `${label}: ${opponent.playerId}`).toBeCloseTo(1, 12)
        }
      }
    })
  })

  describe('property 4: truncation defense', () => {
    it('falls back to a fresh private prior when the reveal entry is missing', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5], tableDice: [6] },
        { id: 'c', hand: [1] },
      ])
      const input = observation(state, 'self', [
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 } } },
      ])
      expect(() => buildBeliefContext(input, loadLikelihoodModel())).not.toThrow()
      const belief = buildBeliefContext(input, loadLikelihoodModel())
      const b = belief.opponents.find((entry) => entry.playerId === 'b')!
      expect(b.k).toBe(2)
      expect([...b.posterior]).toEqual([...initialPosterior(2)])
    })

    it('does not throw for a complete reveal history', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5], tableDice: [6] },
        { id: 'c', hand: [1] },
      ])
      const input = observation(state, 'self', [
        { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 }, tableDiceIndices: [0] } },
      ])
      expect(() => buildBeliefContext(input, loadLikelihoodModel())).not.toThrow()
    })
  })

  describe('property 5: blind Palo Fijo', () => {
    it('treats a blind own hand without table dice as unknown opponent dice', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5] },
        { id: 'c', hand: [1] },
      ], { paloFijo: true }, { paloFijoBlindDice: true })
      const input = observation(state, 'self')
      expect(input.view.players[0].hand).toBeUndefined()
      const belief = buildBeliefContext(input, uniformModel)
      expect(belief.ownHandKnown).toBe(false)
      expect(belief.opponents.map((entry) => [entry.playerId, entry.k])).toEqual([
        ['b', 2],
        ['c', 1],
        ['self', 2],
      ])
      assertBruteForceAgreement('blind-palo-fijo', input)
    })

    it('keeps conservation for the folded-in self belief in blind Palo Fijo', () => {
      const state = playing([
        { id: 'self', hand: [2, 3] },
        { id: 'b', hand: [4, 5] },
      ], { paloFijo: true }, { paloFijoBlindDice: true })
      const input = observation(state, 'self')
      const belief = buildBeliefContext(input, loadLikelihoodModel())
      const selfEntry = belief.opponents.find((entry) => entry.playerId === 'self')!
      expect(selfEntry).toBeDefined()
      const sum = selfEntry.posterior.reduce((acc, value) => acc + value, 0)
      expect(sum).toBeCloseTo(1, 12)
    })
  })
})
