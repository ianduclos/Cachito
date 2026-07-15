import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_RULES, getLegalActions, projectForPlayer, type PlayingState } from '../engine'
import { createProbabilityPolicy, randomLegalPolicy, runBotMatch, type BotObservation } from '../bot'
import { createBotDecisionRecord, serializeGameLog } from './index'

describe('game analysis log', () => {
  it('records a complete deterministic bot match', () => {
    const seats = [
      { id: 'a', name: 'A', policy: createProbabilityPolicy() },
      { id: 'b', name: 'B', policy: randomLegalPolicy },
      { id: 'c', name: 'C', policy: randomLegalPolicy },
    ]
    const first = runBotMatch(seats, { seed: 404 })
    const second = runBotMatch(seats, { seed: 404 })

    expect(second.log).toEqual(first.log)
    expect(first.log.schemaVersion).toBe(1)
    expect(first.log.metadata.seed).toBe(404)
    expect(first.log.metadata).not.toHaveProperty('startedAt')
    expect(first.log.publicActions).toHaveLength(first.actions)
    expect(first.log.botDecisions).toHaveLength(first.actions)
    expect(first.log.botDecisions.every((decision) => decision.trace?.model)).toBe(true)
    expect(first.log.botDecisions.every((decision) => (decision.trace?.consideredCandidates.length ?? 0) <= 8)).toBe(true)
    expect(first.log.roundResolutions).toHaveLength(first.rounds)
    expect(first.log.winnerId).toBe(first.winnerId)
    expect(new Set(first.log.roundResolutions.map((entry) => entry.round)).size).toBe(first.rounds)
    expect(first.log.roundResolutions.every((entry) => entry.revealedHands.length === seats.length)).toBe(true)
    expect(first.log.publicActions.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: first.actions }, (_, index) => index),
    )

    const parsed = JSON.parse(serializeGameLog(first.log))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.winnerId).toBe(first.winnerId)
    expect(parsed.publicActions).toHaveLength(first.actions)
  })

  it('derives telemetry only from the privacy-restricted observation', () => {
    const state: PlayingState = {
      phase: 'playing',
      round: 7,
      paloFijo: true,
      rules: { ...DEFAULT_GAME_RULES },
      currentPlayerId: 'a',
      currentBid: { quantity: 2, denomination: 3 },
      lastBidderId: 'c',
      players: [
        { id: 'a', name: 'A', diceCount: 2, hand: [4, 6], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
        { id: 'b', name: 'B', diceCount: 1, hand: [2], tableDice: [], tableDiceUsed: false, paloFijoTriggered: true },
        { id: 'c', name: 'C', diceCount: 3, hand: [1, 3, 5], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
      ],
    }
    const observation: BotObservation = {
      playerId: 'a',
      view: projectForPlayer(state, 'a'),
      legalActions: getLegalActions(state, 'a'),
      history: [{ round: 7, playerId: 'c', action: { type: 'bid', bid: { quantity: 2, denomination: 3 } } }],
    }
    const decision = createBotDecisionRecord(observation, 'Test policy', { type: 'dudo' })

    expect(decision.visibleHand).toBeUndefined()
    expect(decision).not.toHaveProperty('players')
    expect(decision.publicDiceCounts).toEqual([
      { playerId: 'a', diceCount: 2 },
      { playerId: 'b', diceCount: 1 },
      { playerId: 'c', diceCount: 3 },
    ])
    expect(decision.historyLength).toBe(1)
    expect(decision.probabilities.currentBid).toMatchObject({
      bid: { quantity: 2, denomination: 3 },
      knownQualifiers: 0,
      unknownDice: 6,
      probabilityPerUnknown: 1 / 6,
    })
    expect(decision.probabilities).not.toHaveProperty('chosenBid')
    expect(serializeGameLog({
      schemaVersion: 1,
      metadata: { seats: [] },
      publicActions: [],
      roundResolutions: [],
      botDecisions: [{ ...decision, sequence: 0 }],
      winnerId: null,
    })).not.toContain('visibleHand')
  })

  it('records current and chosen bid diagnostics when bidding', () => {
    const state: PlayingState = {
      phase: 'playing', round: 2, paloFijo: false, rules: { ...DEFAULT_GAME_RULES }, currentPlayerId: 'a',
      currentBid: { quantity: 2, denomination: 4 }, lastBidderId: 'b',
      players: [
        { id: 'a', name: 'A', diceCount: 2, hand: [1, 5], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
        { id: 'b', name: 'B', diceCount: 2, hand: [4, 6], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
      ],
    }
    const view = projectForPlayer(state, 'a')
    const observation: BotObservation = {
      playerId: 'a', view, legalActions: getLegalActions(state, 'a'), history: [],
    }
    const chosen = { type: 'bid' as const, bid: observation.legalActions.bids[0] }
    const decision = createBotDecisionRecord(observation, 'Test', chosen)

    expect(decision.visibleHand).toEqual([1, 5])
    expect(decision.probabilities.currentBid?.bid).toEqual(state.currentBid)
    expect(decision.probabilities.chosenBid?.bid).toEqual(chosen.bid)
    expect(decision.legalActions.bidCount).toBe(observation.legalActions.bids.length)
  })
})
