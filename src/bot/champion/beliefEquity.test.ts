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
import { evaluateBidDistribution } from '../probability'
import type { BotObservation, PublicActionEntry } from '../types'
import {
  applyBidObservation,
  beliefBidProbability,
  countsFromDice,
  initialPosterior,
  uniformLikelihoodModel,
  type FaceCounts,
} from './beliefFilter'
import {
  buildBeliefContext,
  createBeliefEquityPolicy,
  loadLikelihoodModel,
} from './beliefEquity'
import { loadEquityTable, lookupEquity } from './equity'

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
 * Compares the Gen 2 posterior machinery against `evaluateBidDistribution`, the
 * independent-dice oracle Conservative has always used. The two agree exactly only
 * when every posterior is still the uniform prior, so these sweeps pin down the
 * *bookkeeping* — which dice are known, whose are private, how many are unknown —
 * and deliberately say nothing about the evidence path. `applyBidObservation` under
 * `uniformLikelihoodModel()` is a mathematical identity, which is why the evidence
 * path needs the separate exact checks further down.
 */
function expectOracleAgreement(input: BotObservation, label: string): void {
  const belief = buildBeliefContext(input, uniformLikelihoodModel())
  const totalDice = input.view.players.reduce((sum, player) => sum + player.diceCount, 0)
  for (const bid of everyBid(totalDice)) {
    expect(
      beliefBidProbability(belief.ownCounts, bid, input.view.paloFijo, belief.opponents),
      `${label}: ${bid.quantity}x${bid.denomination}`,
    ).toBeCloseTo(evaluateBidDistribution(input.view, input.playerId, bid).atLeast, 12)
  }
}

describe('Gen 2 belief truth contracts', () => {
  it('matches the exact independent-dice oracle when public table dice belong to self', () => {
    const state = playing([
      { id: 'self', hand: [2, 3], tableDice: [6] },
      { id: 'b', hand: [4, 5] },
      { id: 'c', hand: [1] },
    ])
    const input = observation(state, 'self')
    expectOracleAgreement(input, 'self-table')

    const belief = buildBeliefContext(input, uniformLikelihoodModel())
    expect(beliefBidProbability(
      belief.ownCounts,
      { quantity: 1, denomination: 6 },
      false,
      belief.opponents,
    )).toBe(1)
  })

  it('matches the exact independent-dice oracle when public table dice belong to an opponent', () => {
    const state = playing([
      { id: 'self', hand: [2, 3] },
      { id: 'b', hand: [4, 5], tableDice: [6] },
      { id: 'c', hand: [1] },
    ])
    const input = observation(state, 'self')
    const belief = buildBeliefContext(input, uniformLikelihoodModel())
    expect(belief.opponents.find((entry) => entry.playerId === 'b')?.k).toBe(2)
    expectOracleAgreement(input, 'opponent-table')
  })

  it('matches the oracle when several players hold public dice in the same round', () => {
    const state = playing([
      { id: 'self', hand: [2, 3], tableDice: [4] },
      { id: 'b', hand: [4, 5], tableDice: [6] },
      { id: 'c', hand: [1], tableDice: [6, 6] },
    ])
    const input = observation(state, 'self', [
      { round: 1, playerId: 'self', action: { type: 'bid', bid: { quantity: 1, denomination: 4 }, tableDiceIndices: [0] } },
      { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 2, denomination: 6 }, tableDiceIndices: [0] } },
      { round: 1, playerId: 'c', action: { type: 'bid', bid: { quantity: 3, denomination: 6 }, tableDiceIndices: [0, 1] } },
    ])
    const belief = buildBeliefContext(input, uniformLikelihoodModel())
    expect(belief.opponents.map((entry) => [entry.playerId, entry.k])).toEqual([['b', 2], ['c', 1]])
    expectOracleAgreement(input, 'multi-reveal')
  })

  it('matches the oracle in Palo Fijo, where aces stop being wild', () => {
    const state = playing([
      { id: 'self', hand: [1, 3], tableDice: [3] },
      { id: 'b', hand: [1, 3] },
      { id: 'c', hand: [1] },
    ], { paloFijo: true }, { paloFijoBlindDice: false })
    const input = observation(state, 'self')
    expect(input.view.players[0].hand).toEqual([1, 3])
    expectOracleAgreement(input, 'palo-fijo')
  })

  it('matches the oracle for a blind multi-die seat in Palo Fijo', () => {
    const state = playing([
      { id: 'self', hand: [2, 3] },
      { id: 'b', hand: [4, 5] },
      { id: 'c', hand: [1] },
    ], { paloFijo: true }, { paloFijoBlindDice: true })
    const input = observation(state, 'self')
    // The rule hides the seat's own dice, so its two dice must be folded back in as
    // unknowns rather than silently counted as zero qualifiers.
    expect(input.view.players[0].hand).toBeUndefined()
    const belief = buildBeliefContext(input, uniformLikelihoodModel())
    expect(belief.ownHandKnown).toBe(false)
    expect(belief.opponents.map((entry) => [entry.playerId, entry.k])).toEqual([['b', 2], ['c', 1], ['self', 2]])
    expectOracleAgreement(input, 'palo-fijo-blind')
  })

  it('matches the oracle when public dice exist but the reveal action is missing from history', () => {
    // Defensive path: a truncated or older history cannot say when the dice went
    // down, so the private remainder must fall back to a fresh prior of the right size.
    const state = playing([
      { id: 'self', hand: [2, 3] },
      { id: 'b', hand: [4, 5], tableDice: [6] },
      { id: 'c', hand: [1] },
    ])
    const input = observation(state, 'self', [
      { round: 1, playerId: 'b', action: { type: 'bid', bid: { quantity: 1, denomination: 6 } } },
    ])
    const belief = buildBeliefContext(input, loadLikelihoodModel())
    const opponent = belief.opponents.find((entry) => entry.playerId === 'b')!
    expect(opponent.k).toBe(2)
    expect([...opponent.posterior]).toEqual([...initialPosterior(2)])
    expectOracleAgreement(input, 'truncated-history')
  })

  it('feeds public table dice into a later bidder’s raise-vs-challenge evidence', () => {
    // The discriminating check for the table-dice replay. B reveals a 6 alongside the
    // opening bid; C then raises. C's posterior must be scored against a prior bid
    // that B's public 6 already helps support, with one fewer unknown die. Reading the
    // reveal as invisible produces a measurably different posterior.
    const model = loadLikelihoodModel()
    const state = playing([
      { id: 'self', hand: [2, 3] },
      { id: 'b', hand: [4, 5], tableDice: [6] },
      { id: 'c', hand: [1, 1] },
    ])
    const priorBid: Bid = { quantity: 2, denomination: 6 }
    const input = observation(state, 'self', [
      { round: 1, playerId: 'b', action: { type: 'bid', bid: priorBid, tableDiceIndices: [0] } },
      { round: 1, playerId: 'c', action: { type: 'bid', bid: { quantity: 3, denomination: 6 } } },
    ])
    const belief = buildBeliefContext(input, model)
    const actual = belief.opponents.find((entry) => entry.playerId === 'c')!

    const publicCounts = countsFromDice([6])
    const totalDice = 7
    const withPublicDie = applyBidObservation(
      initialPosterior(2), 2, false, 6, priorBid, totalDice - 1 - 2, model, publicCounts,
    )
    const ignoringPublicDie = applyBidObservation(
      initialPosterior(2), 2, false, 6, priorBid, totalDice - 2, model,
    )

    expect(actual.k).toBe(2)
    expect([...actual.posterior]).toEqual([...withPublicDie])
    expect([...withPublicDie]).not.toEqual([...ignoringPublicDie])
  })

  it('discards a bidder’s old-hand evidence once their private remainder is rerolled', () => {
    // Control first: a plain bid must move the posterior off the uniform prior, so the
    // reset below is a real erasure rather than a filter that never ran.
    const model = loadLikelihoodModel()
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

  it('prices the caller as next starter when a correct Dudo eliminates the bidder', () => {
    const state = playing([
      { id: 'bidder', hand: [2] },
      { id: 'self', hand: [3, 4] },
      { id: 'other', hand: [5, 6] },
    ], {
      currentPlayerId: 'self',
      currentBid: { quantity: 1, denomination: 2 },
      lastBidderId: 'bidder',
    })
    const history: PublicActionEntry[] = [{
      round: 1,
      playerId: 'bidder',
      action: { type: 'bid', bid: { quantity: 1, denomination: 2 } },
    }]
    const result = createBeliefEquityPolicy({ twoPlayerGate: false, minSamples: 0 })
      .chooseActionWithTrace!(observation(state, 'self', history), () => 0.5)
    const dudo = (result.trace as {
      belief?: { dudo?: { equityAfterBidderLoses: number } }
    }).belief?.dudo
    const table = loadEquityTable()
    const asStarter = lookupEquity(table, 2, [2], true, 3, 0)
    const asNonStarter = lookupEquity(table, 2, [2], false, 3, 0)

    expect(asStarter).not.toBe(asNonStarter)
    expect(dudo?.equityAfterBidderLoses).toBe(asStarter)
  })
})

describe('belief filter public-dice evidence', () => {
  it('scores a hypothesis hand together with the dice already face up', () => {
    const model = loadLikelihoodModel()
    const priorBid: Bid = { quantity: 3, denomination: 6 }
    const publicCounts: FaceCounts = countsFromDice([6, 6])
    const blind: FaceCounts = [0, 0, 0, 0, 0, 0]

    const withPublic = applyBidObservation(initialPosterior(2), 2, false, 6, priorBid, 3, model, publicCounts)
    const withoutPublic = applyBidObservation(initialPosterior(2), 2, false, 6, priorBid, 3, model, blind)
    expect([...withPublic]).not.toEqual([...withoutPublic])

    // Passing the public dice explicitly must equal folding them into the hypothesis
    // hand — the counts are literally the same dice either way.
    const folded = applyBidObservation(initialPosterior(2), 2, false, 6, priorBid, 3, model, blind)
    const shiftedByHand = applyBidObservation(initialPosterior(2), 2, false, 6, { ...priorBid, quantity: 1 }, 3, model, blind)
    expect([...withPublic]).toEqual([...shiftedByHand])
    expect([...folded]).not.toEqual([...shiftedByHand])
  })
})
