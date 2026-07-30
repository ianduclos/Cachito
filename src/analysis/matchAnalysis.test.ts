import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_RULES, type GameOverState, type RoundResolution } from '../engine'
import type { BotDecisionRecord } from '../analytics'
import { buildMatchAnalysis } from './matchAnalysis'

const resolution: RoundResolution = {
  kind: 'dudo', callerId: 'human', bidderId: 'bot', bid: { quantity: 4, denomination: 5 },
  actualCount: 2, correct: true,
  diceChanges: [{ playerId: 'bot', before: 5, after: 4, delta: -1, reason: 'dudo' }],
  nextStarterId: 'bot', paloFijoNextRound: false,
}

const finalState: GameOverState = {
  phase: 'gameOver', round: 1, paloFijo: false, rules: { ...DEFAULT_GAME_RULES },
  currentPlayerId: null, currentBid: null, lastBidderId: null, winnerId: 'human',
  players: [
    { id: 'human', name: 'Ana María', diceCount: 4, hand: [1, 2, 3, 4], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
    { id: 'bot', name: 'Min-chi Park', diceCount: 0, hand: [], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false },
  ],
}

const botDecision: BotDecisionRecord = {
  sequence: 0, policyName: 'Gen 2 · Bold storyteller', playerId: 'bot', round: 1, paloFijo: false,
  ownDiceCount: 5, visibleHand: [5, 2, 3, 4, 6], publicDiceCounts: [{ playerId: 'human', diceCount: 5 }, { playerId: 'bot', diceCount: 5 }],
  currentBid: null, historyLength: 0, legalActions: { bidCount: 20, canDudo: false, canCalzo: false },
  chosenAction: { type: 'bid', bid: { quantity: 4, denomination: 5 } },
  trace: { model: 'persona-bluff', version: 1, decisionReason: 'controlled_bluff', candidateCount: 20, consideredCandidates: [], random: {}, settings: { personaBluffFired: 1 }, plainReason: 'It found a cheap moment to sell a believable story on a face it genuinely held.' },
  probabilities: {},
}

describe('completed match analysis', () => {
  it('turns verified outcomes and privacy-safe bot traces into readable player summaries', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot', persona: 'Bold storyteller' },
      ],
      actions: [
        { round: 1, playerId: 'bot', action: { type: 'bid', playerId: 'bot', bid: { quantity: 4, denomination: 5 } } },
        { round: 1, playerId: 'human', action: { type: 'dudo', playerId: 'human' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'bot', hands: [{ playerId: 'human', dice: [1, 2, 3, 4, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution }],
      botDecisions: [botDecision],
      finalState,
    }, '2026-07-18T00:00:00.000Z')

    expect(analysis.headline).toContain('Ana María')
    expect(analysis.keyMoment).toContain('claimed 4 Chinas with 2 actually there')
    expect(analysis.players.find((player) => player.id === 'bot')).toMatchObject({
      persona: 'Bold storyteller',
      stats: {
        unsupportedFinalBids: 1,
        unsupportedCaught: 1,
        unsupportedSurvived: 0,
        deliberatePersonaBluffs: 1,
        deliberateBluffsCaught: 1,
        forcedEscalations: 0,
      },
      botReasoning: [{ round: 1, action: 'Bid 4 Chinas', explanation: expect.stringContaining('believable story') }],
    })
    expect(analysis.players.find((player) => player.id === 'human')?.botReasoning).toBeUndefined()
    expect(analysis.players.every((player) => player.scores.aggression.value >= 0 && player.scores.aggression.value <= 100)).toBe(true)
    expect(analysis.momentum[0].players.find((player) => player.playerId === 'bot')?.dice).toBe(0)
  })

  it('scores claim risk per bid from the bidder’s own dice, not from the reveal', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot', persona: 'Bold storyteller' },
      ],
      actions: [
        // Ana holds a Dones and a wild ace, so one Dones is a claim she covers alone.
        { round: 1, playerId: 'human', action: { type: 'bid', playerId: 'human', bid: { quantity: 1, denomination: 2 } } },
        // Min-chi holds one China of the ten dice on the table and claims four.
        { round: 1, playerId: 'bot', action: { type: 'bid', playerId: 'bot', bid: { quantity: 4, denomination: 5 } } },
        { round: 1, playerId: 'human', action: { type: 'dudo', playerId: 'human' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'human', hands: [{ playerId: 'human', dice: [1, 2, 3, 4, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution }],
      botDecisions: [botDecision],
      finalState,
    }, '2026-07-18T00:00:00.000Z')

    const human = analysis.players.find((player) => player.id === 'human')!
    const bot = analysis.players.find((player) => player.id === 'bot')!
    expect(human.scores.bluff.value).toBe(0)
    expect(bot.scores.bluff.value).toBeGreaterThan(70)
    // One sample per bid made — not per reveal, which is what left the old score
    // sitting on its prior all match.
    expect(human.scores.bluff.samples).toBe(1)
    expect(bot.scores.bluff.samples).toBe(1)
    // Only Min-chi's claim was challenged, so only Min-chi's has a denominator.
    expect(bot.stats.verifiedFinalBids).toBe(1)
    expect(human.stats.verifiedFinalBids).toBe(0)
    expect(human.verdict).toContain('No claim of theirs ever reached a reveal.')
    expect(bot.verdict).toContain('1 of 1 revealed claim fell short')
  })

  it('never scores a blind Palo Fijo claim against dice the bidder could not see', () => {
    const blindInput = {
      rules: { ...DEFAULT_GAME_RULES, paloFijoBlindDice: true },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' as const },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot' as const, persona: 'Bold storyteller' },
      ],
      actions: [
        { round: 1, playerId: 'bot', action: { type: 'bid' as const, playerId: 'bot', bid: { quantity: 4, denomination: 5 } } },
        { round: 1, playerId: 'human', action: { type: 'dudo' as const, playerId: 'human' } },
      ],
      roundDeals: [{ round: 1, paloFijo: true, starterId: 'bot', hands: [{ playerId: 'human', dice: [1, 2, 3, 4, 6] }, { playerId: 'bot', dice: [5, 5, 5, 5, 5] }] }],
      roundResolutions: [{ round: 1, paloFijo: true, resolution }],
      botDecisions: [botDecision],
      finalState,
    }
    const blind = buildMatchAnalysis(blindInput, '2026-07-18T00:00:00.000Z')
    const sighted = buildMatchAnalysis({ ...blindInput, rules: { ...DEFAULT_GAME_RULES, paloFijoBlindDice: false } }, '2026-07-18T00:00:00.000Z')

    // Five Chinas in hand makes "four Chinas" a certainty — but only to a player
    // allowed to look. Blind, the same claim is scored on the public table alone.
    expect(sighted.players.find((player) => player.id === 'bot')!.scores.bluff.value).toBe(0)
    expect(blind.players.find((player) => player.id === 'bot')!.scores.bluff.value).toBeGreaterThan(70)
  })

  it('tells each round as a public story with ladder, call, and margin — and no hidden hands', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot', persona: 'Bold storyteller' },
      ],
      actions: [
        { round: 1, playerId: 'bot', action: { type: 'bid', playerId: 'bot', bid: { quantity: 4, denomination: 5 } }, tableDice: [5, 5] },
        { round: 1, playerId: 'human', action: { type: 'dudo', playerId: 'human' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'bot', hands: [{ playerId: 'human', dice: [1, 2, 3, 4, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution }],
      botDecisions: [botDecision],
      finalState,
    }, '2026-07-18T00:00:00.000Z')

    expect(analysis.schemaVersion).toBe(4)
    expect(analysis.startingDice).toEqual([
      { playerId: 'human', dice: 5 },
      { playerId: 'bot', dice: 5 },
    ])
    expect(analysis.roundStories).toEqual([{
      round: 1,
      paloFijo: false,
      bids: [{ playerId: 'bot', quantity: 4, denomination: 5, tableDice: 2 }],
      callerId: 'human',
      bidderId: 'bot',
      kind: 'dudo',
      correct: true,
      actualCount: 2,
      margin: -2,
      diceChanges: [{ playerId: 'bot', delta: -1 }],
    }])
    // Privacy: the browser payload must never carry dealt or revealed hand values.
    const serialized = JSON.stringify(analysis)
    expect(serialized).not.toContain('"hands"')
    expect(serialized).not.toContain('"hand"')
    expect(serialized).not.toContain('rerolledDice')
  })

  it('labels a ladder-top fallback as forced without inventing deliberate bluff intent', () => {
    const forcedDecision: BotDecisionRecord = {
      ...botDecision,
      currentBid: { quantity: 4, denomination: 5 },
      chosenAction: { type: 'bid', bid: { quantity: 5, denomination: 5 } },
      trace: { ...botDecision.trace!, settings: {}, decisionReason: 'controlled_bluff' },
    }
    const forcedResolution: RoundResolution = {
      ...resolution,
      bid: { quantity: 5, denomination: 5 },
      actualCount: 2,
    }
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot', persona: 'Conservative' },
      ],
      actions: [
        { round: 1, playerId: 'human', action: { type: 'bid', playerId: 'human', bid: { quantity: 4, denomination: 5 } } },
        { round: 1, playerId: 'bot', action: { type: 'bid', playerId: 'bot', bid: { quantity: 5, denomination: 5 } } },
        { round: 1, playerId: 'human', action: { type: 'dudo', playerId: 'human' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'human', hands: [{ playerId: 'human', dice: [1, 2, 3, 4, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: forcedResolution }],
      botDecisions: [forcedDecision],
      finalState,
    })

    expect(analysis.players.find((player) => player.id === 'bot')?.stats).toMatchObject({
      unsupportedFinalBids: 1,
      unsupportedCaught: 1,
      deliberatePersonaBluffs: 0,
      forcedEscalations: 1,
      forcedEscalationsCaught: 1,
      forcedEscalationsSurvived: 0,
    })
  })
})
