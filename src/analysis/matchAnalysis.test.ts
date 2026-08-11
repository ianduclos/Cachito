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
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'bot', hands: [{ playerId: 'human', dice: [1, 2, 3, 5, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution, revealedHands: [{ playerId: 'human', dice: [1, 2, 3, 5, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      botDecisions: [botDecision],
      finalState,
    }, '2026-07-18T00:00:00.000Z')

    expect(analysis.headline).toContain('Ana María')
    expect(analysis.keyMoment).toContain('called Dudo on the final claim and was right')
    expect(analysis.signaturePlay).toMatchObject({
      round: 1, kind: 'correct-dudo', actorId: 'human', counterpartId: 'bot',
      counterpartAttributable: true,
      bid: { quantity: 4, denomination: 5 }, actualCount: 2, callKind: 'dudo',
    })
    expect(analysis.players.find((player) => player.id === 'bot')).toMatchObject({
      persona: 'Bold storyteller',
      stats: {
        bidFaceCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 0 },
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
    expect(human).toMatchObject({ style: 'Opening Moves', styleRead: 'Made 1 attributable bids and 1 attributable calls.', badges: [] })
    expect(bot.styleRead).toContain('Made 1 attributable bids')
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
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'bot', hands: [{ playerId: 'human', dice: [1, 2, 3, 5, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution, revealedHands: [{ playerId: 'human', dice: [1, 2, 3, 5, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }] }],
      botDecisions: [botDecision],
      finalState,
    }, '2026-07-18T00:00:00.000Z')

    expect(analysis.schemaVersion).toBe(5)
    expect(analysis.startingDice).toEqual([
      { playerId: 'human', dice: 5 },
      { playerId: 'bot', dice: 5 },
    ])
    expect(analysis.roundStories).toEqual([{
      round: 1,
      paloFijo: false,
      startingDice: [
        { playerId: 'human', dice: 5 },
        { playerId: 'bot', dice: 5 },
      ],
      bids: [{ playerId: 'bot', quantity: 4, denomination: 5, attributable: true, tableDice: 2 }],
      callerId: 'human',
      callerAttributable: true,
      bidderId: 'bot',
      kind: 'dudo',
      correct: true,
      actualCount: 2,
      margin: -2,
      diceChanges: [{ playerId: 'bot', delta: -1 }],
      revealedHands: [{ playerId: 'human', dice: [1, 2, 3, 5, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] }],
    }])
    // The only dice values in the browser payload come from the recorded public
    // reveal—not the round deal, a reroll log, or an unresolved private hand.
    const serialized = JSON.stringify(analysis)
    expect(serialized).not.toContain('"hands"')
    expect(serialized).not.toContain('"hand"')
    expect(serialized).not.toContain('rerolledDice')
    expect(serialized).not.toContain('successProbability')
    expect(serialized).not.toContain('surpriseValue')
    // This legacy-shaped table-dice entry lacks its post-action reroll, so the
    // builder must not invent intermediate open hands from the final reveal.
    expect(analysis.roundStories[0].replayFrames).toBeUndefined()
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

  it('keeps covered moves in the public story without attributing them as human strategy', () => {
    const coveredResolution: RoundResolution = {
      ...resolution,
      callerId: 'bot',
      bidderId: 'human',
      bid: { quantity: 4, denomination: 5 },
      actualCount: 2,
      correct: true,
      diceChanges: [{ playerId: 'human', before: 5, after: 4, delta: -1, reason: 'dudo' }],
    }
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot' },
      ],
      actions: [
        {
          round: 1,
          playerId: 'human',
          action: { type: 'bid', playerId: 'human', bid: { quantity: 4, denomination: 5 } },
          covered: true,
        },
        { round: 1, playerId: 'bot', action: { type: 'dudo', playerId: 'bot' } },
      ],
      roundDeals: [{
        round: 1,
        paloFijo: false,
        starterId: 'human',
        hands: [
          { playerId: 'human', dice: [1, 2, 3, 4, 6] },
          { playerId: 'bot', dice: [5, 2, 3, 4, 6] },
        ],
      }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: coveredResolution }],
      botDecisions: [],
      finalState,
    })

    const human = analysis.players.find((player) => player.id === 'human')!
    const bot = analysis.players.find((player) => player.id === 'bot')!
    expect(human.stats).toMatchObject({
      bids: 0,
      bidFaceCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      verifiedFinalBids: 0,
      unsupportedFinalBids: 0,
      forcedEscalations: 0,
    })
    expect(human.scores.bluff.samples).toBe(0)
    expect(human).toMatchObject({ style: 'Off the Record', styleRead: 'No attributable actions were recorded.', badges: [] })
    expect(bot.stats).toMatchObject({ dudoAttempts: 1, dudoCorrect: 1 })
    expect(analysis.roundStories[0].bids).toEqual([
      { playerId: 'human', quantity: 4, denomination: 5, attributable: false },
    ])
  })

  it('never writes a defining moment for a covered call, but still records its dice', () => {
    // A correct Calzo is the one resolution whose dice change names the CALLER, so
    // it is the only path that can hand a timeout safety move to a human as their
    // defining moment. Ana's ace plus Min-chi's two Chinas make the claim exact.
    const calzoResolution: RoundResolution = {
      kind: 'calzo', callerId: 'human', bidderId: 'bot', bid: { quantity: 3, denomination: 5 },
      actualCount: 3, correct: true,
      diceChanges: [{ playerId: 'human', before: 4, after: 5, delta: 1, reason: 'calzo-correct' }],
      nextStarterId: 'human', paloFijoNextRound: false,
    }
    const build = (covered: boolean) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot' },
      ],
      actions: [
        { round: 1, playerId: 'bot', action: { type: 'bid', playerId: 'bot', bid: { quantity: 3, denomination: 5 } } },
        { round: 1, playerId: 'human', action: { type: 'calzo', playerId: 'human' }, ...(covered ? { covered: true } : {}) },
      ],
      roundDeals: [{
        round: 1,
        paloFijo: false,
        starterId: 'bot',
        hands: [
          { playerId: 'human', dice: [1, 2, 3, 4] },
          { playerId: 'bot', dice: [5, 5, 2, 3, 6] },
        ],
      }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: calzoResolution }],
      botDecisions: [],
      finalState,
    })

    const coveredHuman = build(true).players.find((player) => player.id === 'human')!
    expect(coveredHuman.moment).toBeUndefined()
    expect(build(true).keyMoment).toBeUndefined()
    expect(build(true).signaturePlay).toBeUndefined()
    expect(coveredHuman.stats).toMatchObject({ calzoAttempts: 0, calzoCorrect: 0 })
    // The die really was won, so the match fact survives the attribution filter.
    expect(coveredHuman.stats.diceGained).toBe(1)
    expect(build(true).roundStories[0]).toMatchObject({ callerId: 'human', callerAttributable: false, kind: 'calzo', correct: true })
    // The bot's real bid is still verified against the reveal.
    expect(build(true).players.find((player) => player.id === 'bot')!.stats.verifiedFinalBids).toBe(1)

    // Control: the same call made by the human earns the moment and the credit.
    const realHuman = build(false).players.find((player) => player.id === 'human')!
    expect(realHuman.moment).toContain('Calzo call was right')
    expect(realHuman.stats).toMatchObject({ calzoAttempts: 1, calzoCorrect: 1 })
  })

  it('attributes signature eligibility to the featured actor across every covered combination', () => {
    const build = (correct: boolean, bidCovered: boolean, callCovered: boolean) => {
      const bid = { quantity: correct ? 4 : 1, denomination: 5 as const }
      return buildMatchAnalysis({
        rules: { ...DEFAULT_GAME_RULES },
        seats: [{ id: 'human', name: 'Ana María', controller: 'human' }, { id: 'bot', name: 'Min-chi Park', controller: 'bot' }],
        actions: [
          { round: 1, playerId: 'bot', action: { type: 'bid' as const, playerId: 'bot', bid }, ...(bidCovered ? { covered: true } : {}) },
          { round: 1, playerId: 'human', action: { type: 'dudo' as const, playerId: 'human' }, ...(callCovered ? { covered: true } : {}) },
        ],
        roundDeals: [{ round: 1, paloFijo: false, starterId: 'bot', hands: [
          { playerId: 'human', dice: [1, 2, 3, 4, 6] }, { playerId: 'bot', dice: [5, 2, 3, 4, 6] },
        ] }],
        roundResolutions: [{ round: 1, paloFijo: false, resolution: {
          ...resolution, bid, actualCount: correct ? 2 : 1, correct,
          diceChanges: [{ playerId: correct ? 'bot' : 'human', before: 5, after: 4, delta: -1, reason: 'dudo' }],
        } }],
        botDecisions: [], finalState,
      })
    }
    for (const bidCovered of [false, true]) {
      for (const callCovered of [false, true]) {
        const story = build(true, bidCovered, callCovered).roundStories[0]
        expect(story.bids.at(-1)?.attributable, `bid covered=${bidCovered}`).toBe(!bidCovered)
        expect(story.callerAttributable, `call covered=${callCovered}`).toBe(!callCovered)
        const serializedStory = JSON.parse(JSON.stringify(story))
        expect(serializedStory.bids.at(-1).attributable, `serialized bid covered=${bidCovered}`).toBe(!bidCovered)
        expect(serializedStory.callerAttributable, `serialized call covered=${callCovered}`).toBe(!callCovered)
        expect(story.replayFrames?.[1]).toMatchObject({ phase: 'before-action', actorId: 'bot', attributable: !bidCovered })
        expect(story.replayFrames?.[2]).toMatchObject({ phase: 'before-action', actorId: 'human', attributable: !callCovered })
        const correctCall = build(true, bidCovered, callCovered).signaturePlay
        expect(correctCall?.kind, `correct call; bid covered=${bidCovered}, call covered=${callCovered}`)
          .toBe(callCovered ? undefined : 'correct-dudo')
        if (correctCall) {
          expect(correctCall.counterpartAttributable).toBe(!bidCovered)
          const copy = build(true, bidCovered, callCovered).keyMoment!
          expect(copy).toContain('Ana María called Dudo on the final claim and was right')
          if (bidCovered) expect(copy).not.toContain('Min-chi Park')
        }

        const heldAnalysis = build(false, bidCovered, callCovered)
        const heldBid = heldAnalysis.signaturePlay
        expect(heldBid?.kind, `held bid; bid covered=${bidCovered}, call covered=${callCovered}`)
          .toBe(bidCovered ? undefined : 'bid-held')
        if (heldBid) {
          expect(heldBid.counterpartAttributable).toBe(!callCovered)
          if (callCovered) {
            expect(heldAnalysis.keyMoment).toContain('a Dudo followed')
            expect(heldAnalysis.keyMoment).not.toContain('Ana María')
          } else {
            expect(heldAnalysis.keyMoment).toContain('Ana María said Dudo')
          }
          expect(heldAnalysis.keyMoment).toContain('1 was there')
        }
      }
    }
    const coveredCatch = build(true, false, true)
    const caughtBidderMoment = coveredCatch.players.find((player) => player.id === 'bot')?.moment
    expect(caughtBidderMoment).toContain('it was caught')
    expect(caughtBidderMoment).not.toContain('Ana María')
  })

  it('records literal unheld-face bids before table dice or rerolls, without treating aces as every face', () => {
    const build = (paloFijo: boolean) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES, paloFijoBlindDice: true },
      seats: [
        { id: 'human', name: 'Ana María', controller: 'human' },
        { id: 'bot', name: 'Min-chi Park', controller: 'bot' },
      ],
      actions: [
        // Min-chi has an Ace but no Samba. The public commitment and later reroll
        // must not rewrite what was visibly absent when this claim was made.
        { round: 1, playerId: 'bot', action: { type: 'bid' as const, playerId: 'bot', bid: { quantity: 3, denomination: 6 } }, tableDice: [5], rerolledDice: [6, 6, 6, 6] },
        { round: 1, playerId: 'human', action: { type: 'dudo' as const, playerId: 'human' } },
      ],
      roundDeals: [{ round: 1, paloFijo, starterId: 'bot', hands: [
        { playerId: 'human', dice: [2, 3, 4, 5, 6] },
        { playerId: 'bot', dice: [1, 2, 3, 4, 5] },
      ] }],
      roundResolutions: [{ round: 1, paloFijo, resolution: {
        ...resolution, bid: { quantity: 3, denomination: 6 }, actualCount: 2,
      } }],
      botDecisions: [],
      finalState,
    })
    const sighted = build(false).players.find((player) => player.id === 'bot')!
    expect(sighted.stats).toMatchObject({
      bidFaceCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1 },
      unheldFaceBids: 1,
      averageUnheldFaceQuantity: 3,
    })

    // With five dice in blind Palo Fijo, Min-chi could not see the hand at all.
    const blind = build(true).players.find((player) => player.id === 'bot')!
    expect(blind.stats).toMatchObject({ unheldFaceBids: 0, averageUnheldFaceQuantity: 0 })
  })

  it('models a table-dice signature from fixed commitments and unknown rerolls', () => {
    const build = (oldUncommitted: number[], rerolledDice: number[], actualCount: number) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'actor', name: 'Actor', controller: 'human' },
        { id: 'caller', name: 'Caller', controller: 'human' },
        { id: 'third', name: 'Third', controller: 'human' },
      ],
      actions: [
        { round: 1, playerId: 'actor', action: { type: 'bid' as const, playerId: 'actor', bid: { quantity: 6, denomination: 6 } }, tableDice: [2], rerolledDice: rerolledDice as Array<1 | 2 | 3 | 4 | 5 | 6> },
        { round: 1, playerId: 'caller', action: { type: 'dudo' as const, playerId: 'caller' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'actor', hands: [
        { playerId: 'actor', dice: [...oldUncommitted, 2] },
        { playerId: 'caller', dice: [6, 6, 6, 6, 6] },
        { playerId: 'third', dice: [6] },
      ] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: {
        kind: 'dudo', callerId: 'caller', bidderId: 'actor', bid: { quantity: 6, denomination: 6 }, actualCount, correct: false,
        diceChanges: [{ playerId: 'caller', before: 5, after: 4, delta: -1, reason: 'dudo' }], nextStarterId: 'caller', paloFijoNextRound: false,
      } }],
      botDecisions: [], finalState: { ...finalState, winnerId: 'actor' },
    })
    const formerlyStrongHand = build([6, 6, 6, 6], [3, 3, 3, 3], 6)
    const fortunateReroll = build([3, 3, 3, 3], [6, 6, 6, 6], 10)

    // Only the committed 2 was fixed at decision time. Four old Sambas cannot
    // inflate the read, and four later rerolled Sambas cannot retroactively do so.
    expect(formerlyStrongHand.signaturePlay?.surprise).toBe('long-shot')
    expect(fortunateReroll.signaturePlay?.surprise).toBe('long-shot')
    expect(formerlyStrongHand.signaturePlay).toMatchObject({ kind: 'bid-held', tableDice: 1 })
    expect(fortunateReroll.signaturePlay).toMatchObject({ kind: 'bid-held', tableDice: 1 })
    expect(formerlyStrongHand.biggestLiar).toBeUndefined()
    expect(fortunateReroll.biggestLiar).toMatchObject({ playerId: 'actor', deceptionPoints: 2, components: { inventedFaceBids: 1 } })
    const strongFrames = formerlyStrongHand.roundStories[0].replayFrames!
    expect(strongFrames).toHaveLength(3)
    expect(strongFrames[0]).toMatchObject({ phase: 'setup', actionIndex: -1 })
    expect(strongFrames[0].players.find((player) => player.playerId === 'actor')).toEqual({ playerId: 'actor', hand: [6, 6, 6, 6, 2], tableDice: [] })
    expect(strongFrames[1]).toMatchObject({ phase: 'before-action', actionIndex: 0, actorId: 'actor', attributable: true, action: { type: 'bid', tableDice: [2] } })
    expect(strongFrames[1].players.find((player) => player.playerId === 'actor')).toEqual({ playerId: 'actor', hand: [6, 6, 6, 6, 2], tableDice: [] })
    expect(strongFrames[2]).toMatchObject({ phase: 'before-action', actionIndex: 1, actorId: 'caller', attributable: true, action: { type: 'dudo' } })
    expect(strongFrames[2].players.find((player) => player.playerId === 'actor')).toEqual({ playerId: 'actor', hand: [3, 3, 3, 3], tableDice: [2] })
    const fortunateCallFrame = fortunateReroll.roundStories[0].replayFrames?.[2]
    expect(fortunateCallFrame?.players.find((player) => player.playerId === 'actor')).toEqual({ playerId: 'actor', hand: [6, 6, 6, 6], tableDice: [2] })
  })

  it('selects a privacy-safe signature for a long-shot bid that held under Dudo', () => {
    const bid: { quantity: number; denomination: 6 } = { quantity: 10, denomination: 6 }
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'la-hoha', name: 'La Hoha', controller: 'human' },
        { id: 'caller', name: 'Caller', controller: 'human' },
        { id: 'third', name: 'Third', controller: 'human' },
        { id: 'fourth', name: 'Fourth', controller: 'human' },
      ],
      actions: [
        { round: 5, playerId: 'la-hoha', action: { type: 'bid', playerId: 'la-hoha', bid } },
        { round: 5, playerId: 'caller', action: { type: 'dudo', playerId: 'caller' } },
      ],
      roundDeals: [{ round: 5, paloFijo: false, starterId: 'la-hoha', hands: [
        { playerId: 'la-hoha', dice: [1, 2, 3, 4, 5] },
        { playerId: 'caller', dice: [6, 6, 6, 6, 6] },
        { playerId: 'third', dice: [6, 6, 6, 6, 6] },
        { playerId: 'fourth', dice: [6] },
      ] }],
      roundResolutions: [{ round: 5, paloFijo: false, resolution: {
        kind: 'dudo', callerId: 'caller', bidderId: 'la-hoha', bid, actualCount: 12, correct: false,
        diceChanges: [{ playerId: 'caller', before: 5, after: 4, delta: -1, reason: 'dudo' }],
        nextStarterId: 'caller', paloFijoNextRound: false,
      } }],
      botDecisions: [],
      finalState: { ...finalState, round: 5, winnerId: 'la-hoha' },
    })
    expect(analysis.signaturePlay).toMatchObject({
      round: 5, kind: 'bid-held', actorId: 'la-hoha', counterpartId: 'caller', counterpartAttributable: true, bid,
      actualCount: 12, callKind: 'dudo', surprise: 'long-shot',
    })
    expect(JSON.stringify(analysis.signaturePlay)).not.toContain('probability')
    expect(JSON.stringify(analysis.signaturePlay)).not.toContain('hand')
    expect(JSON.parse(JSON.stringify(analysis.roundStories[0]))).toMatchObject({
      callerAttributable: true,
      bids: [{ attributable: true }],
    })
  })

  it('selects Biggest liar from attributable pre-action choice evidence and keeps outcome as evidence only', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [
        { id: 'ana', name: 'Ana', controller: 'human' },
        { id: 'min', name: 'Min', controller: 'bot' },
      ],
      actions: [
        { round: 1, playerId: 'ana', action: { type: 'bid', playerId: 'ana', bid: { quantity: 6, denomination: 6 } } },
        { round: 1, playerId: 'min', action: { type: 'bid', playerId: 'min', bid: { quantity: 7, denomination: 5 } } },
        { round: 1, playerId: 'ana', action: { type: 'dudo', playerId: 'ana' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'ana', hands: [
        { playerId: 'ana', dice: [6, 6, 2, 3, 4] }, { playerId: 'min', dice: [1, 2, 3, 4, 6] },
      ] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: {
        kind: 'dudo', callerId: 'ana', bidderId: 'min', bid: { quantity: 7, denomination: 5 }, actualCount: 2, correct: true,
        diceChanges: [{ playerId: 'min', before: 5, after: 4, delta: -1, reason: 'dudo' }],
        nextStarterId: 'min', paloFijoNextRound: false,
      } }],
      botDecisions: [], finalState,
    })
    expect(analysis.biggestLiar).toEqual({
      playerId: 'min', deceptionPoints: 2,
      components: {
        scoredBids: 1, inventedFaceBids: 1, singleCopyBids: 0, whiteLieBids: 0,
        gratuitousOverraises: 0, excessRaiseSteps: 0,
        scoredUnsupportedCaught: 1, scoredUnsupportedSurvived: 0,
      },
      widestScoredShortfall: {
        round: 1, bid: { quantity: 7, denomination: 5 }, actualCount: 2, shortfall: 5, callerId: 'ana', caught: true,
      },
    })
  })

  it('scores literal pre-action support without treating wild Aces as copies of another face', () => {
    const build = (hand: Array<1 | 2 | 3 | 4 | 5 | 6>, options: { covered?: boolean; paloFijo?: boolean } = {}) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES, paloFijoBlindDice: true },
      seats: [{ id: 'bidder', name: 'Bidder', controller: 'human' }, { id: 'caller', name: 'Caller', controller: 'human' }],
      actions: [
        { round: 1, playerId: 'bidder', action: { type: 'bid' as const, playerId: 'bidder', bid: { quantity: 7, denomination: 6 as const } }, ...(options.covered ? { covered: true } : {}) },
        { round: 1, playerId: 'caller', action: { type: 'dudo' as const, playerId: 'caller' } },
      ],
      roundDeals: [{ round: 1, paloFijo: options.paloFijo === true, starterId: 'bidder', hands: [{ playerId: 'bidder', dice: hand }, { playerId: 'caller', dice: [2, 3, 4, 5, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: options.paloFijo === true, resolution: { kind: 'dudo' as const, callerId: 'caller', bidderId: 'bidder', bid: { quantity: 7, denomination: 6 as const }, actualCount: 1, correct: true, diceChanges: [{ playerId: 'bidder', before: 5, after: 4, delta: -1, reason: 'dudo' as const }], nextStarterId: 'bidder', paloFijoNextRound: false } }],
      botDecisions: [],
      finalState: { ...finalState, winnerId: 'caller', players: [{ ...finalState.players[0], id: 'bidder', name: 'Bidder' }, { ...finalState.players[1], id: 'caller', name: 'Caller' }] },
    })

    const zeroCopies = build([2, 3, 4, 5, 5])
    expect(zeroCopies.biggestLiar).toMatchObject({ playerId: 'bidder', deceptionPoints: 2, components: { inventedFaceBids: 1, singleCopyBids: 0 } })
    const oneCopy = build([6, 2, 3, 4, 5])
    expect(oneCopy.biggestLiar).toMatchObject({ playerId: 'bidder', deceptionPoints: 0.8, components: { inventedFaceBids: 0, singleCopyBids: 1 } })
    // Wild Aces support the game bid, but do not become literal Sambas for this
    // choice-language score.
    const wildAces = build([1, 1, 2, 3, 4])
    expect(wildAces.biggestLiar).toMatchObject({ playerId: 'bidder', deceptionPoints: 2, components: { inventedFaceBids: 1 } })
    for (const hand of [[6, 6, 2, 3, 4], [6, 6, 6, 2, 3]] as Array<Array<1 | 2 | 3 | 4 | 5 | 6>>) {
      const analysis = build(hand)
      expect(analysis.players[0].stats).toMatchObject({ unsupportedFinalBids: 1 })
      expect(analysis.biggestLiar).toBeUndefined()
    }
    const covered = build([2, 3, 4, 5, 5], { covered: true })
    expect(covered.players[0].stats).toMatchObject({ unsupportedFinalBids: 0 })
    expect(covered.biggestLiar).toBeUndefined()
    const blind = build([2, 3, 4, 5, 5], { paloFijo: true })
    expect(blind.players[0].stats).toMatchObject({ unsupportedFinalBids: 1 })
    expect(blind.biggestLiar).toBeUndefined()
  })

  it('breaks Biggest liar ties by seat order and omits it when there is no evidence', () => {
    const tied = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'first', name: 'First', controller: 'human' }, { id: 'second', name: 'Second', controller: 'human' }],
      actions: [
        { round: 1, playerId: 'first', action: { type: 'bid', playerId: 'first', bid: { quantity: 4, denomination: 6 } } },
        { round: 1, playerId: 'second', action: { type: 'dudo', playerId: 'second' } },
        { round: 2, playerId: 'second', action: { type: 'bid', playerId: 'second', bid: { quantity: 4, denomination: 6 } } },
        { round: 2, playerId: 'first', action: { type: 'dudo', playerId: 'first' } },
      ],
      roundDeals: [
        { round: 1, paloFijo: false, starterId: 'first', hands: [{ playerId: 'first', dice: [1, 2, 3, 4, 5] }, { playerId: 'second', dice: [1, 2, 3, 4, 5] }] },
        { round: 2, paloFijo: false, starterId: 'second', hands: [{ playerId: 'first', dice: [1, 2, 3, 4] }, { playerId: 'second', dice: [1, 2, 3, 4, 5] }] },
      ],
      roundResolutions: [1, 2].map((round) => ({ round, paloFijo: false, resolution: {
        kind: 'dudo' as const, callerId: round === 1 ? 'second' : 'first', bidderId: round === 1 ? 'first' : 'second', bid: { quantity: 4, denomination: 6 }, actualCount: 1, correct: true,
        diceChanges: [{ playerId: round === 1 ? 'first' : 'second', before: 5, after: 4, delta: -1, reason: 'dudo' as const }], nextStarterId: 'first', paloFijoNextRound: false,
      } })),
      botDecisions: [], finalState: { ...finalState, round: 2, winnerId: 'first' },
    })
    expect(tied.biggestLiar?.playerId).toBe('first')
    // Both players invented one opening face for two points, so fixed seat order
    // resolves the exact choice-evidence tie.
    expect(tied.biggestLiar?.deceptionPoints).toBe(2)

    const quiet = buildMatchAnalysis({ ...{
      rules: { ...DEFAULT_GAME_RULES }, seats: [{ id: 'only', name: 'Only', controller: 'human' as const }], actions: [], roundDeals: [], roundResolutions: [], botDecisions: [],
    }, finalState: { ...finalState, winnerId: 'only', players: [{ ...finalState.players[0], id: 'only', name: 'Only' }] } })
    expect(quiet.biggestLiar).toBeUndefined()
  })

  it('can bestow Biggest liar from a scored choice even when no final outcome was revealed', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'storyteller', name: 'Storyteller', controller: 'human' }],
      actions: [
        { round: 1, playerId: 'storyteller', action: { type: 'bid', playerId: 'storyteller', bid: { quantity: 5, denomination: 6 } } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'storyteller', hands: [
        { playerId: 'storyteller', dice: [1, 2, 3, 4, 5] },
      ] }],
      roundResolutions: [], botDecisions: [],
      finalState: { ...finalState, winnerId: 'storyteller', players: [{ ...finalState.players[0], id: 'storyteller', name: 'Storyteller' }] },
    })

    expect(analysis.players[0].stats).toMatchObject({ unheldFaceBids: 1, averageUnheldFaceQuantity: 5, unsupportedFinalBids: 0 })
    expect(analysis.biggestLiar).toMatchObject({ playerId: 'storyteller', deceptionPoints: 2, components: { inventedFaceBids: 1, scoredUnsupportedCaught: 0, scoredUnsupportedSurvived: 0 } })
  })

  it('uses engine-generated same-face minimums to distinguish white lies from gratuitous overraises', () => {
    const build = (quantity: number, oneCopy = false) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'opener', name: 'Opener', controller: 'human' }, { id: 'actor', name: 'Actor', controller: 'human' }],
      actions: [
        { round: 1, playerId: 'opener', action: { type: 'bid' as const, playerId: 'opener', bid: { quantity: 2, denomination: 5 as const } } },
        { round: 1, playerId: 'actor', action: { type: 'bid' as const, playerId: 'actor', bid: { quantity, denomination: 5 as const } } },
        { round: 1, playerId: 'opener', action: { type: 'dudo' as const, playerId: 'opener' } },
      ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'opener', hands: [{ playerId: 'opener', dice: [5, 5, 2, 3, 4] }, { playerId: 'actor', dice: oneCopy ? [5, 2, 3, 4, 6] : [2, 2, 3, 4, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: { kind: 'dudo' as const, callerId: 'opener', bidderId: 'actor', bid: { quantity, denomination: 5 as const }, actualCount: 1, correct: true, diceChanges: [{ playerId: 'actor', before: 5, after: 4, delta: -1, reason: 'dudo' as const }], nextStarterId: 'actor', paloFijoNextRound: false } }],
      botDecisions: [], finalState: { ...finalState, winnerId: 'opener', players: [{ ...finalState.players[0], id: 'opener', name: 'Opener' }, { ...finalState.players[1], id: 'actor', name: 'Actor' }] },
    })

    // For 2 Chinas, the engine-generated minimum same-face continuation is 3.
    expect(build(3).biggestLiar).toMatchObject({ playerId: 'actor', deceptionPoints: 0.25, components: { whiteLieBids: 1, gratuitousOverraises: 0, excessRaiseSteps: 0 } })
    // 5 Chinas skips the legal 3 and 4 quantities: .25 + .5 × 2 = 1.25.
    expect(build(5).biggestLiar).toMatchObject({ playerId: 'actor', deceptionPoints: 1.25, components: { whiteLieBids: 0, gratuitousOverraises: 1, excessRaiseSteps: 2 } })
    // One literal copy applies the .4 partial-backing factor to the same choice.
    expect(build(5, true).biggestLiar).toMatchObject({ playerId: 'actor', deceptionPoints: 0.5, components: { singleCopyBids: 1, whiteLieBids: 0, gratuitousOverraises: 1, excessRaiseSteps: 2 } })
  })

  it('scores introduced or switched denominations strongly, including literal Ace choices', () => {
    const build = (opening: boolean, actorHand: Array<1 | 2 | 3 | 4 | 5 | 6> = [2, 2, 3, 4, 5]) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'actor', name: 'Actor', controller: 'human' }, { id: 'other', name: 'Other', controller: 'human' }],
      actions: opening
        ? [{ round: 1, playerId: 'actor', action: { type: 'bid' as const, playerId: 'actor', bid: { quantity: 1, denomination: 1 as const } } }]
        : [
            { round: 1, playerId: 'other', action: { type: 'bid' as const, playerId: 'other', bid: { quantity: 2, denomination: 5 as const } } },
            { round: 1, playerId: 'actor', action: { type: 'bid' as const, playerId: 'actor', bid: { quantity: 2, denomination: 6 as const } } },
          ],
      roundDeals: [{ round: 1, paloFijo: false, starterId: opening ? 'actor' : 'other', hands: [{ playerId: 'actor', dice: actorHand }, { playerId: 'other', dice: [5, 5, 2, 3, 4] }] }],
      roundResolutions: [], botDecisions: [], finalState: { ...finalState, winnerId: 'actor', players: [{ ...finalState.players[0], id: 'actor', name: 'Actor' }, { ...finalState.players[1], id: 'other', name: 'Other' }] },
    })
    expect(build(true).biggestLiar).toMatchObject({ playerId: 'actor', deceptionPoints: 2, components: { inventedFaceBids: 1 } })
    expect(build(true, [1, 1, 2, 3, 4]).biggestLiar).toBeUndefined()
    expect(build(false).biggestLiar).toMatchObject({ playerId: 'actor', deceptionPoints: 2, components: { inventedFaceBids: 1 } })
  })

  it('keeps reveal outcome out of Biggest liar ranking and points', () => {
    const build = (actualCount: number) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'actor', name: 'Actor', controller: 'human' }, { id: 'caller', name: 'Caller', controller: 'human' }],
      actions: [{ round: 1, playerId: 'actor', action: { type: 'bid' as const, playerId: 'actor', bid: { quantity: 4, denomination: 6 as const } } }, { round: 1, playerId: 'caller', action: { type: 'dudo' as const, playerId: 'caller' } }],
      roundDeals: [{ round: 1, paloFijo: false, starterId: 'actor', hands: [{ playerId: 'actor', dice: [2, 2, 3, 4, 5] }, { playerId: 'caller', dice: [2, 3, 4, 5, 6] }] }],
      roundResolutions: [{ round: 1, paloFijo: false, resolution: { kind: 'dudo' as const, callerId: 'caller', bidderId: 'actor', bid: { quantity: 4, denomination: 6 as const }, actualCount, correct: actualCount < 4, diceChanges: [{ playerId: actualCount < 4 ? 'actor' : 'caller', before: 5, after: 4, delta: -1, reason: 'dudo' as const }], nextStarterId: 'caller', paloFijoNextRound: false } }],
      botDecisions: [], finalState: { ...finalState, winnerId: 'actor', players: [{ ...finalState.players[0], id: 'actor', name: 'Actor' }, { ...finalState.players[1], id: 'caller', name: 'Caller' }] },
    })
    const caught = build(1).biggestLiar!
    const held = build(5).biggestLiar!
    expect({ playerId: caught.playerId, deceptionPoints: caught.deceptionPoints }).toEqual({ playerId: held.playerId, deceptionPoints: held.deceptionPoints })
    expect(caught.components).toMatchObject({ scoredUnsupportedCaught: 1, scoredUnsupportedSurvived: 0 })
    expect(held.components).toMatchObject({ scoredUnsupportedCaught: 0, scoredUnsupportedSurvived: 0 })
  })

  it('does not double-count one final bid that was both unsupported and a forced escalation when it survived', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'bidder', name: 'Bidder', controller: 'human' }, { id: 'caller', name: 'Caller', controller: 'human' }],
      actions: [1, 2].flatMap((round) => [
        { round, playerId: 'caller', action: { type: 'bid' as const, playerId: 'caller', bid: { quantity: 7, denomination: 6 as const } } },
        { round, playerId: 'bidder', action: { type: 'bid' as const, playerId: 'bidder', bid: { quantity: 8, denomination: 6 as const } } },
        { round, playerId: 'caller', action: { type: 'calzo' as const, playerId: 'caller' } },
      ]),
      roundDeals: [1, 2].map((round) => ({ round, paloFijo: false, starterId: 'caller', hands: [{ playerId: 'bidder', dice: [2, 2, 2, 2, 2] }, { playerId: 'caller', dice: [3, 3, 3, 3, 3] }] })),
      roundResolutions: [1, 2].map((round) => ({ round, paloFijo: false, resolution: { kind: 'calzo' as const, callerId: 'caller', bidderId: 'bidder', bid: { quantity: 8, denomination: 6 as const }, actualCount: 0, correct: false, diceChanges: [{ playerId: 'caller', before: 5, after: 4, delta: -1, reason: 'calzo-wrong' as const }], nextStarterId: 'caller', paloFijoNextRound: false } })),
      botDecisions: [],
      finalState: { ...finalState, round: 2, winnerId: 'bidder', players: [{ ...finalState.players[0], id: 'bidder', name: 'Bidder' }, { ...finalState.players[1], id: 'caller', name: 'Caller' }] },
    })
    const bidder = analysis.players.find((player) => player.id === 'bidder')!
    expect(bidder.stats).toMatchObject({ unsupportedSurvived: 2, forcedEscalationsSurvived: 2 })
    expect(bidder).toMatchObject({ style: 'Somehow Still Here', styleRead: 'Had at least 2 final claims survive the round.' })
    expect(bidder.styleRead).not.toContain('4 final claims')
  })

  it('selects high and low claim-risk labels only after the report’s six-bid gate', () => {
    const buildClaimStyle = (id: string, bid: { quantity: number; denomination: 1 | 6 }, hand: Array<1 | 2 | 3 | 4 | 5 | 6>) => buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id, name: id, controller: 'human' }, { id: 'other', name: 'Other', controller: 'human' }],
      actions: Array.from({ length: 6 }, (_, index) => ({ round: index + 1, playerId: id, action: { type: 'bid' as const, playerId: id, bid } })),
      roundDeals: Array.from({ length: 6 }, (_, index) => ({ round: index + 1, paloFijo: false, starterId: id, hands: [{ playerId: id, dice: hand }, { playerId: 'other', dice: [2, 3, 4, 5, 6] as Array<1 | 2 | 3 | 4 | 5 | 6> }] })),
      roundResolutions: [], botDecisions: [],
      finalState: { ...finalState, round: 6, winnerId: id, players: [{ ...finalState.players[0], id, name: id }, { ...finalState.players[1], id: 'other', name: 'Other' }] },
    }).players.find((player) => player.id === id)!

    const low = buildClaimStyle('low', { quantity: 1, denomination: 1 }, [1, 2, 3, 4, 5])
    const high = buildClaimStyle('high', { quantity: 6, denomination: 6 }, [1, 2, 3, 4, 5])
    expect(low).toMatchObject({ style: 'Receipts Attached', styleRead: 'Kept most claims close to the dice they could see.' })
    expect(high).toMatchObject({ style: 'Stretch Merchant', styleRead: 'Sent more claims beyond the cup than most of this table.' })
  })

  it('uses literal event labels when no style axis clears its sample gate, and does so deterministically', () => {
    const input = {
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'caller', name: 'Caller', controller: 'human' as const }, { id: 'bidder', name: 'Bidder', controller: 'human' as const }],
      actions: [1, 2].flatMap((round) => [
        { round, playerId: 'bidder', action: { type: 'bid' as const, playerId: 'bidder', bid: { quantity: 2, denomination: 5 as const } } },
        { round, playerId: 'caller', action: { type: 'calzo' as const, playerId: 'caller' } },
      ]),
      roundDeals: [1, 2].map((round) => ({ round, paloFijo: false, starterId: 'bidder', hands: [{ playerId: 'caller', dice: [1, 2, 3, 4, 5] }, { playerId: 'bidder', dice: [5, 5, 2, 3, 4] }] })),
      roundResolutions: [1, 2].map((round) => ({ round, paloFijo: false, resolution: { kind: 'calzo' as const, callerId: 'caller', bidderId: 'bidder', bid: { quantity: 2, denomination: 5 as const }, actualCount: 2, correct: true, diceChanges: [{ playerId: 'caller', before: 4, after: 5, delta: 1, reason: 'calzo-correct' as const }], nextStarterId: 'caller', paloFijoNextRound: false } })),
      botDecisions: [],
      finalState: { ...finalState, round: 2, winnerId: 'caller', players: [{ ...finalState.players[0], id: 'caller', name: 'Caller' }, { ...finalState.players[1], id: 'bidder', name: 'Bidder' }] },
    }
    const first = buildMatchAnalysis(input)
    const second = buildMatchAnalysis(input)
    const caller = first.players.find((player) => player.id === 'caller')!
    expect(caller).toMatchObject({ style: 'Exact-Count Gremlin', styleRead: 'Hit every one of 2 Calzo calls.', badges: [] })
    expect(second.players.map((player) => ({ style: player.style, styleRead: player.styleRead, badges: player.badges }))).toEqual(first.players.map((player) => ({ style: player.style, styleRead: player.styleRead, badges: player.badges })))
  })

  it('keeps replay dice out of unresolved rounds and copies only logged public reveals', () => {
    const analysis = buildMatchAnalysis({
      rules: { ...DEFAULT_GAME_RULES },
      seats: [{ id: 'a', name: 'A', controller: 'human' }, { id: 'b', name: 'B', controller: 'human' }],
      actions: [{ round: 2, playerId: 'a', action: { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 5 } } }, { round: 2, playerId: 'b', action: { type: 'dudo', playerId: 'b' } }],
      roundDeals: [
        { round: 1, paloFijo: false, starterId: 'a', hands: [{ playerId: 'a', dice: [1, 1, 1] }, { playerId: 'b', dice: [2, 2, 2] }] },
        { round: 2, paloFijo: false, starterId: 'a', hands: [{ playerId: 'a', dice: [5, 5, 1] }, { playerId: 'b', dice: [2, 3, 4] }] },
      ],
      roundResolutions: [{ round: 2, paloFijo: false, resolution: { kind: 'dudo', callerId: 'b', bidderId: 'a', bid: { quantity: 2, denomination: 5 }, actualCount: 2, correct: false, diceChanges: [{ playerId: 'b', before: 3, after: 2, delta: -1, reason: 'dudo' }], nextStarterId: 'b', paloFijoNextRound: false }, revealedHands: [{ playerId: 'a', dice: [5, 5, 1] }, { playerId: 'b', dice: [2, 3, 4] }] }],
      botDecisions: [], finalState: { ...finalState, round: 2, winnerId: 'a', players: [{ ...finalState.players[0], id: 'a', name: 'A' }, { ...finalState.players[1], id: 'b', name: 'B' }] },
    })
    expect(analysis.roundStories).toHaveLength(1)
    expect(analysis.roundStories[0]).toMatchObject({ round: 2, startingDice: [{ playerId: 'a', dice: 3 }, { playerId: 'b', dice: 3 }], revealedHands: [{ playerId: 'a', dice: [5, 5, 1] }, { playerId: 'b', dice: [2, 3, 4] }] })
    expect(JSON.stringify(analysis.roundStories)).not.toContain('[1,1,1]')
  })
})
