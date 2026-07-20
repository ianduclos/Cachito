import type { BotDecisionRecord } from '../analytics'
import { evaluateBidDistribution } from '../bot/probability'
import styleModels from '../bot/champion/data/style-models.json'
import { countBid, getLegalActions, type Bid, type Die, type EnginePlayer, type GameAction, type GameOverState, type GameRules, type PlayingState, type PublicGameView, type RoundResolution } from '../engine'

export interface MatchAnalysisAction {
  round?: number
  playerId?: string
  action: GameAction | { type: string }
  tableDice?: Die[]
  /** Private post-reroll hand, retained by the server and never included in the browser payload. */
  rerolledDice?: Die[]
}

export interface MatchAnalysisRound {
  round: number
  paloFijo: boolean
  starterId: string | null
  hands: Array<{ playerId: string; dice: number[] }>
}

export interface MatchAnalysisResolution {
  round: number
  paloFijo: boolean
  resolution: RoundResolution
}

export interface MatchAnalysisSeatInput {
  id: string
  name: string
  controller: 'human' | 'bot'
  persona?: string
}

export interface MatchAnalysisInput {
  rules: GameRules
  seats: MatchAnalysisSeatInput[]
  actions: MatchAnalysisAction[]
  roundDeals: MatchAnalysisRound[]
  roundResolutions: MatchAnalysisResolution[]
  botDecisions: BotDecisionRecord[]
  finalState: GameOverState
}

export interface MatchAnalysisScore {
  value: number
  samples: number
  earlyRead: boolean
}

export interface MatchAnalysisPlayer {
  id: string
  name: string
  controller: 'human' | 'bot'
  persona?: string
  winner: boolean
  verdict: string
  scores: {
    bluff: MatchAnalysisScore
    aggression: MatchAnalysisScore
    challenge: MatchAnalysisScore
  }
  stats: {
    bids: number
    unsupportedFinalBids: number
    unsupportedCaught: number
    unsupportedSurvived: number
    deliberatePersonaBluffs: number
    deliberateBluffsCaught: number
    deliberateBluffsSurvived: number
    forcedEscalations: number
    forcedEscalationsCaught: number
    forcedEscalationsSurvived: number
    dudoAttempts: number
    dudoCorrect: number
    calzoAttempts: number
    calzoCorrect: number
    diceGained: number
    diceLost: number
    tableDicePlays: number
  }
  moment?: string
  botReasoning?: Array<{ round: number; action: string; explanation: string }>
}

/** One public bid on a round's ladder. Everything here was visible at the table. */
export interface MatchAnalysisLadderBid {
  playerId: string
  quantity: number
  denomination: Die
  /** Dice publicly committed to the table with this bid, when any. */
  tableDice?: number
}

/** The public story of one resolved round: the ladder, the call, the reveal. */
export interface MatchAnalysisRoundStory {
  round: number
  paloFijo: boolean
  bids: MatchAnalysisLadderBid[]
  callerId: string
  bidderId: string
  kind: 'dudo' | 'calzo'
  correct: boolean
  actualCount: number
  /** actualCount − bid.quantity: 0 means the final bid was exactly true. */
  margin: number
  diceChanges: Array<{ playerId: string; delta: number }>
}

export interface MatchAnalysis {
  schemaVersion: 3
  generatedAt: string
  rounds: number
  totalTurns: number
  winnerId: string
  headline: string
  keyMoment?: string
  /** Dice each seat started the match with (round-0 baseline for charts). */
  startingDice: Array<{ playerId: string; dice: number }>
  tableAverages: { bluff: number; aggression: number; challenge: number }
  momentum: Array<{ round: number; players: Array<{ playerId: string; dice: number; share: number }> }>
  /** Public round-by-round record; contains no hidden-hand information. */
  roundStories: MatchAnalysisRoundStory[]
  players: MatchAnalysisPlayer[]
}

type MutablePlayer = MatchAnalysisPlayer & {
  aggressionValues: number[]
  challengeValues: number[]
  verifiedBids: number
}

interface FinalBidClassification {
  bidderId: string
  bid: Bid
  deliberatePersonaBluff: boolean
  forcedEscalation: boolean
}

const priors = styleModels.priors
const denominationNames: Record<Die, string> = { 1: 'Aces', 2: 'Dones', 3: 'Trenes', 4: 'Cuadras', 5: 'Chinas', 6: 'Sambas' }

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function score(value: number, samples: number, earlyThreshold: number): MatchAnalysisScore {
  return { value: Math.round(clamp01(value) * 100), samples, earlyRead: samples < earlyThreshold }
}

function publicView(input: MatchAnalysisInput, deal: MatchAnalysisRound, tableDiceById: Map<string, Die[]>, currentBid: Bid | null): PublicGameView {
  return {
    phase: 'playing', round: deal.round, paloFijo: deal.paloFijo, rules: input.rules,
    players: input.seats.map((seat) => {
      const diceCount = deal.hands.find((hand) => hand.playerId === seat.id)?.dice.length ?? 0
      return { id: seat.id, name: seat.name, diceCount, eliminated: diceCount === 0, tableDice: [...(tableDiceById.get(seat.id) ?? [])] }
    }),
    currentPlayerId: null, currentBid, lastBidderId: null,
  }
}

function facingRisk(view: PublicGameView, playerId: string, bid: Bid, kind: 'raise' | 'dudo' | 'calzo') {
  const distribution = evaluateBidDistribution(view, playerId, bid)
  if (kind === 'raise') return 1 - distribution.atLeast
  if (kind === 'dudo') return distribution.atLeast
  return 1 - distribution.exact
}

function sameBid(left: Bid, right: Bid) {
  return left.quantity === right.quantity && left.denomination === right.denomination
}

function fullySupportedRaiseExists(state: PlayingState, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId)
  if (!player || !state.currentBid) return true
  const supportState: PlayingState = {
    ...state,
    players: state.players.map((candidate) => ({
      ...candidate,
      hand: candidate.id === playerId ? [...player.hand] : [],
      tableDice: [],
    })),
  }
  return getLegalActions(state, playerId).bids.some((bid) => countBid(supportState, bid) >= bid.quantity)
}

function actionLabel(decision: BotDecisionRecord) {
  if (decision.chosenAction.type === 'bid') return `Bid ${decision.chosenAction.bid.quantity} ${denominationNames[decision.chosenAction.bid.denomination]}`
  return decision.chosenAction.type === 'dudo' ? 'Dudo' : 'Calzo'
}

function verdict(player: MutablePlayer, averages: MatchAnalysis['tableAverages']) {
  const aggression = player.scores.aggression.value - averages.aggression
  const challenge = player.scores.challenge.value - averages.challenge
  const style = aggression > 8 ? 'Pressed the table hard' : aggression < -8 ? 'Bid patiently' : 'Kept a balanced bidding pace'
  const nerve = challenge > 8 ? 'and challenged boldly' : challenge < -8 ? 'and chose calls carefully' : 'and picked measured moments to challenge'
  const claims = player.stats.unsupportedFinalBids
    ? ` ${player.stats.unsupportedFinalBids} final ${player.stats.unsupportedFinalBids === 1 ? 'claim was' : 'claims were'} unsupported: ${player.stats.unsupportedCaught} caught, ${player.stats.unsupportedSurvived} survived.`
    : ' Every final claim held up at reveal.'
  return `${style} ${nerve}.${claims}`
}

export function buildMatchAnalysis(input: MatchAnalysisInput, now = new Date().toISOString()): MatchAnalysis {
  const resolutionByRound = new Map(input.roundResolutions.map((entry) => [entry.round, entry]))
  const mutable = new Map<string, MutablePlayer>(input.seats.map((seat) => [seat.id, {
    ...seat,
    winner: seat.id === input.finalState.winnerId,
    verdict: '',
    scores: { bluff: score(priors.bluffRate, 0, 4), aggression: score(priors.aggressionMean, 0, 3), challenge: score(priors.challengeMean, 0, 2) },
    stats: { bids: 0, unsupportedFinalBids: 0, unsupportedCaught: 0, unsupportedSurvived: 0, deliberatePersonaBluffs: 0, deliberateBluffsCaught: 0, deliberateBluffsSurvived: 0, forcedEscalations: 0, forcedEscalationsCaught: 0, forcedEscalationsSurvived: 0, dudoAttempts: 0, dudoCorrect: 0, calzoAttempts: 0, calzoCorrect: 0, diceGained: 0, diceLost: 0, tableDicePlays: 0 },
    aggressionValues: [], challengeValues: [], verifiedBids: 0,
  }]))

  for (const deal of input.roundDeals) {
    let currentBid: Bid | null = null
    let lastBidderId: string | null = null
    let finalBidClassification: FinalBidClassification | undefined
    const tableDiceById = new Map<string, Die[]>()
    const handsById = new Map(deal.hands.map((hand) => [hand.playerId, [...hand.dice] as Die[]]))
    const usedBotDecisions = new Set<number>()
    const roundActions = input.actions.filter((entry) => entry.round === deal.round)
    for (const entry of roundActions) {
      const actor = entry.playerId ? mutable.get(entry.playerId) : undefined
      if (!actor || !('playerId' in entry.action)) continue
      const action = entry.action
      const view = publicView(input, deal, tableDiceById, currentBid)
      if (action.type === 'bid') {
        const players: EnginePlayer[] = input.seats.map((seat) => {
          const hand = handsById.get(seat.id) ?? []
          const tableDice = tableDiceById.get(seat.id) ?? []
          return { id: seat.id, name: seat.name, diceCount: hand.length + tableDice.length, hand: [...hand], tableDice: [...tableDice], tableDiceUsed: tableDice.length > 0, paloFijoTriggered: false }
        })
        const decision = input.botDecisions.find((candidate) => !usedBotDecisions.has(candidate.sequence) && candidate.round === deal.round && candidate.playerId === actor.id && candidate.chosenAction.type === 'bid' && sameBid(candidate.chosenAction.bid, action.bid))
        if (decision) usedBotDecisions.add(decision.sequence)
        const stateBeforeBid: PlayingState = { phase: 'playing', round: deal.round, paloFijo: deal.paloFijo, rules: input.rules, players, currentPlayerId: actor.id, currentBid, lastBidderId }
        actor.stats.bids += 1
        if (currentBid) actor.aggressionValues.push(facingRisk(view, actor.id, currentBid, 'raise'))
        if (entry.tableDice?.length) { actor.stats.tableDicePlays += 1; tableDiceById.set(actor.id, [...entry.tableDice]) }
        finalBidClassification = {
          bidderId: actor.id,
          bid: action.bid,
          deliberatePersonaBluff: decision?.trace?.settings?.personaBluffFired === 1,
          forcedEscalation: Boolean(currentBid && !fullySupportedRaiseExists(stateBeforeBid, actor.id)),
        }
        currentBid = action.bid
        lastBidderId = actor.id
        if (entry.rerolledDice) handsById.set(actor.id, [...entry.rerolledDice])
      } else if (action.type === 'dudo' && currentBid) {
        actor.stats.dudoAttempts += 1
        actor.challengeValues.push(facingRisk(view, actor.id, currentBid, 'dudo'))
      } else if (action.type === 'calzo' && currentBid) {
        actor.stats.calzoAttempts += 1
        actor.challengeValues.push(facingRisk(view, actor.id, currentBid, 'calzo'))
      }
    }

    const resolved = resolutionByRound.get(deal.round)?.resolution
    if (!resolved) continue
    const caller = mutable.get(resolved.callerId)
    const bidder = mutable.get(resolved.bidderId)
    if (caller) {
      if (resolved.kind === 'dudo' && resolved.correct) caller.stats.dudoCorrect += 1
      if (resolved.kind === 'calzo' && resolved.correct) caller.stats.calzoCorrect += 1
    }
    if (bidder) {
      bidder.verifiedBids += 1
      const caught = resolved.kind === 'dudo' && resolved.correct
      const matchingFinalBid = finalBidClassification?.bidderId === resolved.bidderId && sameBid(finalBidClassification.bid, resolved.bid)
        ? finalBidClassification
        : undefined
      if (resolved.actualCount < resolved.bid.quantity) {
        bidder.stats.unsupportedFinalBids += 1
        if (caught) bidder.stats.unsupportedCaught += 1
        else bidder.stats.unsupportedSurvived += 1
        const gap = resolved.bid.quantity - resolved.actualCount
        const candidate = `Round ${deal.round}: claimed ${resolved.bid.quantity} ${denominationNames[resolved.bid.denomination]} with ${resolved.actualCount} actually there${caught ? ` — ${input.seats.find((seat) => seat.id === resolved.callerId)?.name ?? 'the caller'} caught it` : ' — it survived the call'}.`
        const priorGap = bidder.moment?.match(/gap:(\d+)/)?.[1]
        if (!priorGap || gap > Number(priorGap)) bidder.moment = `${candidate} gap:${gap}`
      }
      if (matchingFinalBid?.deliberatePersonaBluff) {
        bidder.stats.deliberatePersonaBluffs += 1
        if (caught) bidder.stats.deliberateBluffsCaught += 1
        else bidder.stats.deliberateBluffsSurvived += 1
      }
      if (matchingFinalBid?.forcedEscalation) {
        bidder.stats.forcedEscalations += 1
        if (caught) bidder.stats.forcedEscalationsCaught += 1
        else bidder.stats.forcedEscalationsSurvived += 1
      }
    }
    for (const change of resolved.diceChanges) {
      const changed = mutable.get(change.playerId)
      if (!changed) continue
      if (change.delta > 0) changed.stats.diceGained += change.delta
      else changed.stats.diceLost += Math.abs(change.delta)
      if (caller?.id === changed.id && resolved.correct && !changed.moment) {
        changed.moment = `Round ${deal.round}: the ${resolved.kind === 'dudo' ? 'Dudo' : 'Calzo'} call was right and changed the direction of the table.`
      }
    }
  }

  const mean = (values: number[], prior: number, strength: number) => (prior * strength + values.reduce((sum, value) => sum + value, 0)) / (strength + values.length)
  for (const player of mutable.values()) {
    const bluffMean = (priors.bluffRate * priors.bluffPriorStrength + player.stats.unsupportedFinalBids) / (priors.bluffPriorStrength + player.verifiedBids)
    player.scores = {
      bluff: score(bluffMean, player.verifiedBids, 4),
      aggression: score(mean(player.aggressionValues, priors.aggressionMean, 5), player.aggressionValues.length, 3),
      challenge: score(mean(player.challengeValues, priors.challengeMean, 5), player.challengeValues.length, 2),
    }
    const reasoning = input.botDecisions
      .filter((decision) => decision.playerId === player.id && decision.trace?.plainReason)
      .map((decision) => ({ round: decision.round, action: actionLabel(decision), explanation: decision.trace!.plainReason! }))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.explanation === item.explanation) === index)
      .slice(-3)
    if (reasoning.length) player.botReasoning = reasoning
    if (player.moment?.includes(' gap:')) player.moment = player.moment.replace(/ gap:\d+$/, '')
  }

  const players = [...mutable.values()]
  const average = (key: keyof MatchAnalysisPlayer['scores']) => Math.round(players.reduce((sum, player) => sum + player.scores[key].value, 0) / Math.max(1, players.length))
  const tableAverages = { bluff: average('bluff'), aggression: average('aggression'), challenge: average('challenge') }
  for (const player of players) player.verdict = verdict(player, tableAverages)

  const momentum = input.roundDeals.map((deal) => {
    const dice = new Map(deal.hands.map((hand) => [hand.playerId, hand.dice.length]))
    for (const change of resolutionByRound.get(deal.round)?.resolution.diceChanges ?? []) dice.set(change.playerId, change.after)
    if (deal.round === input.finalState.round) {
      for (const finalPlayer of input.finalState.players) dice.set(finalPlayer.id, finalPlayer.diceCount)
    }
    const total = [...dice.values()].reduce((sum, value) => sum + value, 0)
    return { round: deal.round, players: input.seats.map((seat) => ({ playerId: seat.id, dice: dice.get(seat.id) ?? 0, share: total ? Math.round(((dice.get(seat.id) ?? 0) / total) * 100) : 0 })) }
  })
  const roundStories: MatchAnalysisRoundStory[] = input.roundDeals.flatMap((deal) => {
    const resolvedEntry = resolutionByRound.get(deal.round)
    if (!resolvedEntry) return []
    const resolved = resolvedEntry.resolution
    const bids: MatchAnalysisLadderBid[] = input.actions
      .filter((entry) => entry.round === deal.round && entry.playerId && entry.action.type === 'bid')
      .map((entry) => {
        const action = entry.action as Extract<GameAction, { type: 'bid' }>
        return {
          playerId: entry.playerId!,
          quantity: action.bid.quantity,
          denomination: action.bid.denomination,
          ...(entry.tableDice?.length ? { tableDice: entry.tableDice.length } : {}),
        }
      })
    return [{
      round: deal.round,
      paloFijo: deal.paloFijo,
      bids,
      callerId: resolved.callerId,
      bidderId: resolved.bidderId,
      kind: resolved.kind,
      correct: resolved.correct,
      actualCount: resolved.actualCount,
      margin: resolved.actualCount - resolved.bid.quantity,
      diceChanges: resolved.diceChanges.map((change) => ({ playerId: change.playerId, delta: change.delta })),
    }]
  })
  const startingDice = input.seats.map((seat) => ({
    playerId: seat.id,
    dice: input.roundDeals[0]?.hands.find((hand) => hand.playerId === seat.id)?.dice.length ?? 0,
  }))
  const winner = input.seats.find((seat) => seat.id === input.finalState.winnerId)
  const keyMoment = players.map((player) => player.moment).find(Boolean)
  const publicPlayers: MatchAnalysisPlayer[] = players.map((player) => ({
    id: player.id, name: player.name, controller: player.controller, ...(player.persona ? { persona: player.persona } : {}),
    winner: player.winner, verdict: player.verdict, scores: player.scores, stats: player.stats,
    ...(player.moment ? { moment: player.moment } : {}), ...(player.botReasoning ? { botReasoning: player.botReasoning } : {}),
  }))
  return {
    schemaVersion: 3,
    generatedAt: now,
    rounds: input.finalState.round,
    totalTurns: input.actions.filter((entry) => 'playerId' in entry.action && ['bid', 'dudo', 'calzo'].includes(entry.action.type)).length,
    winnerId: input.finalState.winnerId,
    headline: `${winner?.name ?? 'The winner'} took the table after ${input.finalState.round} ${input.finalState.round === 1 ? 'round' : 'rounds'}.`,
    ...(keyMoment ? { keyMoment } : {}),
    startingDice,
    tableAverages,
    momentum,
    roundStories,
    players: publicPlayers,
  }
}
