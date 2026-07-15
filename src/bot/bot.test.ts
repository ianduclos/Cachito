import { describe, expect, it } from 'vitest'
import {
  createSeededRandom,
  DEFAULT_GAME_RULES,
  getLegalActions,
  projectForPlayer,
  type Die,
  type PlayingState,
  type PublicGameView,
} from '../engine'
import {
  binomialAtLeast,
  binomialPmf,
  chooseBotAction,
  createProbabilityPolicy,
  evaluateBidDistribution,
  randomLegalPolicy,
  runBotBatch,
  runBotMatch,
  runSeatBalancedDuel,
  type BotPolicy,
} from './index'

function stateWithHands(
  hands: Record<string, Die[]>,
  overrides: Partial<PlayingState> = {},
): PlayingState {
  const players = Object.entries(hands).map(([id, hand]) => ({
    id,
    name: id.toUpperCase(),
    diceCount: hand.length,
    hand: [...hand],
    paloFijoTriggered: false,
  }))
  return {
    phase: 'playing',
    players,
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    currentPlayerId: players[0].id,
    currentBid: null,
    lastBidderId: null,
    ...overrides,
  }
}

describe('bot probability model', () => {
  it('computes exact binomial probabilities', () => {
    expect(binomialPmf(3, 1, 1 / 3)).toBeCloseTo(4 / 9)
    expect(binomialAtLeast(3, 1, 1 / 3)).toBeCloseTo(19 / 27)
    expect(binomialAtLeast(3, 0, 1 / 3)).toBe(1)
    expect(binomialPmf(3, 4, 1 / 3)).toBe(0)
  })

  it('uses visible qualifiers and treats every hidden die as unknown', () => {
    const normal = projectForPlayer(stateWithHands({ a: [1, 5], b: [2, 3, 4] }), 'a')
    const distribution = evaluateBidDistribution(normal, 'a', { quantity: 3, denomination: 5 })
    expect(distribution).toMatchObject({ knownQualifiers: 2, unknownDice: 3, probabilityPerUnknown: 2 / 6 })
    expect(distribution.atLeast).toBeCloseTo(19 / 27)
    expect(distribution.exact).toBeCloseTo(4 / 9)

    const paloState = stateWithHands({ a: [1, 5], b: [5], c: [2] }, { paloFijo: true })
    const hidden = projectForPlayer(paloState, 'a')
    const paloDistribution = evaluateBidDistribution(hidden, 'a', { quantity: 1, denomination: 5 })
    expect(hidden.players.find((player) => player.id === 'a')).not.toHaveProperty('hand')
    expect(paloDistribution).toMatchObject({ knownQualifiers: 0, unknownDice: 4, probabilityPerUnknown: 1 / 6 })
  })
})

describe('headless bot matches', () => {
  it('is reproducible from a seed and terminates', () => {
    const seats = [
      { id: 'probability', name: 'Probability', policy: createProbabilityPolicy() },
      { id: 'random', name: 'Random', policy: randomLegalPolicy },
      { id: 'random-2', name: 'Random 2', policy: randomLegalPolicy },
    ]
    const first = runBotMatch(seats, { seed: 12345 })
    const second = runBotMatch(seats, { seed: 12345 })
    expect(second).toEqual(first)
    expect(first.actions).toBeGreaterThan(0)
    expect(first.finalState.phase).toBe('gameOver')
  })

  it('passes policies only privacy-safe player views', () => {
    const base = createProbabilityPolicy()
    const privacyCheckingPolicy: BotPolicy = {
      name: 'Privacy checker',
      chooseAction(observation, random) {
        assertPrivateView(observation.view, observation.playerId)
        return base.chooseAction(observation, random)
      },
    }
    const result = runBotMatch([
      { id: 'a', name: 'A', policy: privacyCheckingPolicy },
      { id: 'b', name: 'B', policy: privacyCheckingPolicy },
      { id: 'c', name: 'C', policy: privacyCheckingPolicy },
    ], { seed: 9876 })
    expect(result.finalState.phase).toBe('gameOver')
  })

  it('runs reproducible batches across mixed policies', () => {
    const seats = [
      { id: 'probability', name: 'Probability', policy: createProbabilityPolicy() },
      { id: 'random', name: 'Random', policy: randomLegalPolicy },
    ]
    const seeds = Array.from({ length: 25 }, (_, index) => index + 1)
    const batch = runBotBatch(seats, seeds)
    expect(batch.matches).toBe(25)
    expect(Object.values(batch.wins).reduce((sum, wins) => sum + wins, 0)).toBe(25)
    expect(batch.averageActions).toBeGreaterThan(0)
  })

  it('provides a seat-balanced strength benchmark', () => {
    const duel = runSeatBalancedDuel(createProbabilityPolicy(), randomLegalPolicy, 100, 2026)
    expect(duel.matches).toBe(200)
    expect(duel.candidateWins + duel.opponentWins).toBe(200)
    expect(duel.candidateWinRate).toBeGreaterThan(0.6)
  })
})

describe('bot decision traces', () => {
  it('records a complete, bounded, reproducible probability decision process', () => {
    const state = stateWithHands({ a: [1, 5, 5], b: [2, 3, 4], c: [2, 6] })
    const observation = {
      playerId: 'a',
      view: projectForPlayer(state, 'a'),
      legalActions: getLegalActions(state, 'a'),
      history: [],
    }
    const policy = createProbabilityPolicy({ bluffRate: 0 })
    const first = chooseBotAction(policy, observation, createSeededRandom(8128))
    const second = chooseBotAction(policy, observation, createSeededRandom(8128))

    expect(second).toEqual(first)
    expect(first.trace).toMatchObject({
      model: 'probability-heuristic',
      version: 1,
      decisionReason: 'supported_bid',
      candidateCount: observation.legalActions.bids.length,
    })
    expect(first.trace?.consideredCandidates.length).toBeGreaterThan(0)
    expect(first.trace?.consideredCandidates.length).toBeLessThanOrEqual(8)
    expect(first.trace?.selectedCandidate?.rank).toBeGreaterThan(0)
    expect(first.trace?.random).toMatchObject({ selectionPoolSize: expect.any(Number), selectedIndex: expect.any(Number) })
    expect(first.trace?.actionValues).toEqual([
      expect.objectContaining({ action: 'bid', bid: expect.any(Object), expectedValue: expect.any(Number) }),
    ])
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(first.trace).not.toHaveProperty('view')
    expect(first.trace).not.toHaveProperty('players')
    expect(JSON.stringify(first.trace)).not.toContain('randomState')
  })

  it('compares the expected values of Dudo, Calzo, and a raise', () => {
    const state = stateWithHands(
      { a: [2, 3, 4], b: [1, 5, 6] },
      { currentBid: { quantity: 3, denomination: 6 }, lastBidderId: 'b' },
    )
    const observation = {
      playerId: 'a', view: projectForPlayer(state, 'a'), legalActions: getLegalActions(state, 'a'), history: [],
    }
    const result = chooseBotAction(createProbabilityPolicy(), observation, createSeededRandom(9))
    expect(result.trace?.actionValues?.map(({ action }) => action)).toEqual(expect.arrayContaining(['dudo', 'calzo', 'bid']))
    expect(result.choice.type).toBe('dudo')
  })

  it('identifies threshold, controlled-bluff, and fallback reasons', () => {
    const state = stateWithHands(
      { a: [2], b: [3] },
      { currentBid: { quantity: 2, denomination: 6 }, lastBidderId: 'b' },
    )
    const observation = {
      playerId: 'a', view: projectForPlayer(state, 'a'), legalActions: getLegalActions(state, 'a'), history: [],
    }
    const dudo = chooseBotAction(
      createProbabilityPolicy({ dudoThreshold: 0 }), observation, createSeededRandom(1),
    )
    expect(dudo.trace?.decisionReason).toBe('dudo_threshold')
    expect(dudo.trace?.currentBidAnalysis).toMatchObject({
      supportProbability: expect.any(Number), exactProbability: expect.any(Number),
      dudoConfidence: expect.any(Number), effectiveDudoThreshold: expect.any(Number),
      effectiveCalzoThreshold: expect.any(Number),
    })

    const opening = stateWithHands({ a: [1, 5], b: [2, 3, 4] })
    const openingObservation = {
      playerId: 'a', view: projectForPlayer(opening, 'a'), legalActions: getLegalActions(opening, 'a'), history: [],
    }
    const bluff = chooseBotAction(
      createProbabilityPolicy({ bluffRate: 1, targetBidConfidence: 0.99 }), openingObservation, () => 0,
    )
    expect(bluff.trace?.decisionReason).toBe('controlled_bluff')

    const fallbackObservation = {
      ...observation,
      view: { ...observation.view, currentBid: null },
      legalActions: { bids: [], canDudo: true, canCalzo: false },
    }
    const fallback = chooseBotAction(createProbabilityPolicy(), fallbackObservation, () => 0)
    expect(fallback.trace?.decisionReason).toBe('forced_fallback')
  })
})

function assertPrivateView(view: PublicGameView, playerId: string): void {
  for (const player of view.players) {
    if (player.id !== playerId) expect(player).not.toHaveProperty('hand')
  }
  const viewer = view.players.find((player) => player.id === playerId)!
  if (view.paloFijo && viewer.diceCount > 1) expect(viewer).not.toHaveProperty('hand')
  else expect(viewer.hand).toHaveLength(viewer.diceCount)
}
