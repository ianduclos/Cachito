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
  /** A timeout safety move made for a human; visible in the story but not attributed as their strategy. */
  covered?: boolean
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
  /**
   * Captured from the authoritative reveal state, when every hand was publicly
   * visible at the table. It is deliberately optional for older completed logs
   * that did not retain this public reveal record.
   */
  revealedHands?: Array<{ playerId: string; dice: Die[] }>
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
  /** A match-local, evidence-gated game-language label; never a personality claim. */
  style: string
  /** The factual observation that earned `style`. */
  styleRead: string
  /** Up to two additional literal event or habit reads from attributable actions. */
  badges: Array<{ label: string; read: string }>
  scores: {
    bluff: MatchAnalysisScore
    aggression: MatchAnalysisScore
    challenge: MatchAnalysisScore
  }
  stats: {
    bids: number
    /** Final bids of this player's that actually reached a reveal — the denominator for `unsupportedFinalBids`. */
    verifiedFinalBids: number
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
    /** Attributable bids by literal denomination; always carries all six faces. */
    bidFaceCounts: Record<Die, number>
    /** Bids made on a denomination literally absent from the bidder's visible hand. */
    unheldFaceBids: number
    /** Mean quantity across `unheldFaceBids`; zero when there are no such bids. */
    averageUnheldFaceQuantity: number
  }
  moment?: string
  botReasoning?: Array<{ round: number; action: string; explanation: string }>
}

/** One public bid on a round's ladder. Everything here was visible at the table. */
export interface MatchAnalysisLadderBid {
  playerId: string
  quantity: number
  denomination: Die
  /** Whether this public bid can be credited to the named player in editorial copy. */
  attributable: boolean
  /** Dice publicly committed to the table with this bid, when any. */
  tableDice?: number
}

export interface MatchAnalysisReplayPlayerState {
  playerId: string
  /** The exact private remainder at this retrospective instant. */
  hand: Die[]
  /** Dice already committed publicly by this player at this instant. */
  tableDice: Die[]
}

export type MatchAnalysisReplayAction =
  | { type: 'bid'; bid: Bid; tableDice?: Die[] }
  | { type: 'dudo' | 'calzo' }

/**
 * Postgame-only open-dice chronology. Action frames are snapshots immediately
 * before the named action, so a table-dice bid still shows the hand the bidder
 * actually saw; the following frame shows the rerolled remainder.
 */
export type MatchAnalysisReplayFrame =
  | {
      phase: 'setup'
      actionIndex: -1
      players: MatchAnalysisReplayPlayerState[]
    }
  | {
      phase: 'before-action'
      actionIndex: number
      actorId: string
      attributable: boolean
      action: MatchAnalysisReplayAction
      players: MatchAnalysisReplayPlayerState[]
    }

/** The public story of one resolved round: the ladder, the call, the reveal. */
export interface MatchAnalysisRoundStory {
  round: number
  paloFijo: boolean
  /** Public dice counts at the start of this round, for replay and round context. */
  startingDice: Array<{ playerId: string; dice: number }>
  bids: MatchAnalysisLadderBid[]
  callerId: string
  /** Whether this public resolving call can be credited to `callerId` in copy. */
  callerAttributable: boolean
  bidderId: string
  kind: 'dudo' | 'calzo'
  correct: boolean
  actualCount: number
  /** actualCount − bid.quantity: 0 means the final bid was exactly true. */
  margin: number
  diceChanges: Array<{ playerId: string; delta: number }>
  /** Exact open-dice retrospective; absent when legacy chronology cannot prove every frame. */
  replayFrames?: MatchAnalysisReplayFrame[]
  /**
   * Open dice from the authoritative resolution record. These are serialized
   * only when the same hands were publicly visible during the resolved reveal.
   */
  revealedHands?: Array<{ playerId: string; dice: Die[] }>
}

export interface MatchAnalysis {
  schemaVersion: 5
  generatedAt: string
  rounds: number
  totalTurns: number
  winnerId: string
  headline: string
  /** Legacy prose for older clients. New clients should use `signaturePlay`. */
  keyMoment?: string
  /**
   * A server-selected public play worth remembering. `surprise` is deliberately
   * qualitative: raw probabilities and hands never leave the server.
   */
  signaturePlay?: {
    round: number
    kind: 'correct-calzo' | 'correct-dudo' | 'bid-held'
    actorId: string
    counterpartId: string
    /** Whether UI copy may name the counterpart as choosing their public action. */
    counterpartAttributable: boolean
    bid: Bid
    actualCount: number
    callKind: 'dudo' | 'calzo'
    diceChanges: Array<{ playerId: string; delta: number }>
    ladderLength: number
    tableDice: number
    surprise: 'long-shot' | 'bold' | 'notable'
  }
  /** A playful, choice-based award — never a statement of player intent or character. */
  biggestLiar?: {
    playerId: string
    /** Sum of pre-action choice evidence, rounded to two decimals for display. */
    deceptionPoints: number
    components: {
      scoredBids: number
      inventedFaceBids: number
      singleCopyBids: number
      whiteLieBids: number
      gratuitousOverraises: number
      excessRaiseSteps: number
      scoredUnsupportedCaught: number
      scoredUnsupportedSurvived: number
    }
    widestScoredShortfall?: {
      round: number
      bid: Bid
      actualCount: number
      shortfall: number
      callerId: string
      caught: boolean
    }
  }
  /** Dice each seat started the match with (round-0 baseline for charts). */
  startingDice: Array<{ playerId: string; dice: number }>
  tableAverages: { bluff: number; aggression: number; challenge: number }
  momentum: Array<{ round: number; players: Array<{ playerId: string; dice: number; share: number }> }>
  /** Completed-match round record; replay hands are postgame-only retrospective data. */
  roundStories: MatchAnalysisRoundStory[]
  players: MatchAnalysisPlayer[]
}

type MutablePlayer = MatchAnalysisPlayer & {
  claimValues: number[]
  aggressionValues: number[]
  challengeValues: number[]
  unheldFaceQuantities: number[]
  deceptionPoints: number
  deceptionBids: number
  inventedFaceBids: number
  singleCopyBids: number
  whiteLieBids: number
  gratuitousOverraises: number
  excessRaiseSteps: number
  scoredUnsupportedCaught: number
  scoredUnsupportedSurvived: number
  widestScoredShortfall?: {
    round: number
    bid: Bid
    actualCount: number
    shortfall: number
    callerId: string
    caught: boolean
  }
}

interface FinalBidClassification {
  bidderId: string
  bid: Bid
  covered: boolean
  deliberatePersonaBluff: boolean
  forcedEscalation: boolean
  /** Success likelihood from the bidder's legal information, retained server-side only. */
  successProbability: number
  ladderLength: number
  tableDice: number
  deceptionPoints: number
}

interface FinalCallContext {
  callerId: string
  kind: 'dudo' | 'calzo'
  covered: boolean
  /** Success likelihood from the caller's legal information, retained server-side only. */
  successProbability: number
}

interface SignatureCandidate {
  round: number
  kind: 'correct-calzo' | 'correct-dudo' | 'bid-held'
  actorId: string
  counterpartId: string
  counterpartAttributable: boolean
  bid: Bid
  actualCount: number
  callKind: 'dudo' | 'calzo'
  diceChanges: Array<{ playerId: string; delta: number }>
  ladderLength: number
  tableDice: number
  surpriseValue: number
  stakes: number
  drama: number
}

const priors = styleModels.priors
const denominationNames: Record<Die, string> = { 1: 'Aces', 2: 'Dones', 3: 'Trenes', 4: 'Cuadras', 5: 'Chinas', 6: 'Sambas' }

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function emptyFaceCounts(): Record<Die, number> { return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } }
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

/**
 * The table as the bidder themselves saw it: the public view plus their own dice,
 * but only when the round's rules let them look. During blind Palo Fijo a player
 * holding more than one die bids without seeing their hand, so scoring that claim
 * against it would credit them with knowledge they never had.
 */
function bidderView(view: PublicGameView, playerId: string, hand: Die[], paloFijo: boolean, rules: GameRules): PublicGameView {
  if (paloFijo && rules.paloFijoBlindDice && hand.length > 1) return view
  return { ...view, players: view.players.map((player) => player.id === playerId ? { ...player, hand: [...hand] } : player) }
}

/**
 * The view created by a table-dice bid itself. Selected dice are fixed and
 * public; every uncommitted die is about to be rerolled, so neither the old hand
 * nor the later logged reroll result is information available to this choice.
 */
function tableDiceBidderView(view: PublicGameView, playerId: string, tableDice: Die[]): PublicGameView {
  return {
    ...view,
    players: view.players.map((player) => player.id === playerId
      ? { ...player, tableDice: [...tableDice] }
      : player),
  }
}

function sameBid(left: Bid, right: Bid) {
  return left.quantity === right.quantity && left.denomination === right.denomination
}

/**
 * Whether `playerId` has any legal raise its OWN hand fully covers, ignoring every
 * other seat's dice. A player with none is "cornered": every raise available to it is
 * a claim it cannot back alone. Exported because the lab's forced-escalation work must
 * label decisions with the exact definition the game's own analysis reports, not a
 * second copy of it that can drift.
 */
export function fullySupportedRaiseExists(state: PlayingState, playerId: string) {
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

type EditorialRead = { label: string; read: string }
type StyleAxisCandidate = EditorialRead & { salience: number; samples: number; concreteness: number; index: number }

/**
 * The report's provisional eligible-population quartiles. These are selection
 * gates, not player-facing scores or a claim about a person's temperament.
 * A primary axis must be both adequately sampled and meaningfully away from its
 * eligible median; otherwise a literal match habit carries the story instead.
 */
const styleAxisRules = [
  { key: 'bluff' as const, minSamples: 6, low: 32, median: 37, high: 43, iqr: 11, lowLabel: 'Receipts Attached', lowRead: 'Kept most claims close to the dice they could see.', highLabel: 'Stretch Merchant', highRead: 'Sent more claims beyond the cup than most of this table.', concreteness: 3 },
  { key: 'aggression' as const, minSamples: 5, low: 26, median: 29, high: 33, iqr: 6, lowLabel: 'Slow Cooker', lowRead: 'Built the ladder a step at a time.', highLabel: 'Bid Bulldozer', highRead: 'Kept pushing when the ladder tightened.', concreteness: 2 },
  { key: 'challenge' as const, minSamples: 4, low: 42, median: 44, high: 47, iqr: 5, lowLabel: 'Button Saver', lowRead: 'Waited for narrower calling windows.', highLabel: 'Dudo Daredevil', highRead: 'Made calls in the table’s least comfortable spots.', concreteness: 1 },
] as const

function habitReads(player: MutablePlayer): EditorialRead[] {
  const stats = player.stats
  // These categories can describe the same final bid. A sum would invent extra
  // surviving claims, so use the strongest independently known lower bound.
  const survived = Math.max(stats.unsupportedSurvived, stats.forcedEscalationsSurvived)
  const candidates: Array<EditorialRead & { priority: number }> = []
  const add = (priority: number, label: string, read: string) => candidates.push({ priority, label, read })

  if (stats.calzoAttempts >= 2 && stats.calzoCorrect === stats.calzoAttempts) add(100, 'Exact-Count Gremlin', `Hit every one of ${stats.calzoAttempts} Calzo calls.`)
  else if (stats.calzoCorrect >= 2) add(90, 'Calzo Magnet', `Found ${stats.calzoCorrect} exact Calzos.`)
  else if (stats.calzoAttempts >= 2) add(70, 'Exact-Count Gremlin', `Called Calzo ${stats.calzoAttempts} times.`)
  if (stats.dudoAttempts >= 3 && stats.dudoCorrect === stats.dudoAttempts) add(95, 'Dudo Perfect', `Hit every one of ${stats.dudoAttempts} Dudo calls.`)
  else if (stats.dudoCorrect >= 2) add(85, 'Receipts Inspector', `Hit ${stats.dudoCorrect} of ${stats.dudoAttempts} Dudos.`)
  else if (stats.dudoAttempts >= 4) add(65, 'Dudo Button', `Pressed Dudo ${stats.dudoAttempts} times.`)
  if (stats.verifiedFinalBids >= 3 && stats.unsupportedFinalBids === 0) add(88, 'Receipts Attached', `Kept every one of ${stats.verifiedFinalBids} revealed final claims standing.`)
  if (stats.unsupportedSurvived >= 2 || stats.forcedEscalationsSurvived >= 3) add(80, 'Somehow Still Here', `Had at least ${survived} final claims survive the round.`)
  if (stats.bids >= 8 && stats.tableDicePlays >= 3 && stats.tableDicePlays / stats.bids >= 0.25) add(75, 'Cup Decorator', `Put dice on the table ${stats.tableDicePlays} times.`)
  if (stats.verifiedFinalBids >= 4 && stats.forcedEscalations >= 3) add(55, 'No Support, No Problem', `Climbed without a fully backed raise ${stats.forcedEscalations} times.`)

  return candidates.sort((left, right) => right.priority - left.priority || left.label.localeCompare(right.label))
}

function editorialRead(player: MutablePlayer): { style: EditorialRead; badges: EditorialRead[] } {
  const axisCandidates: StyleAxisCandidate[] = []
  for (const [index, rule] of styleAxisRules.entries()) {
    const axis = player.scores[rule.key]
    if (axis.samples < rule.minSamples) continue
    if (axis.value >= rule.high) axisCandidates.push({ label: rule.highLabel, read: rule.highRead, salience: (axis.value - rule.median) / rule.iqr, samples: axis.samples, concreteness: rule.concreteness, index })
    else if (axis.value <= rule.low) axisCandidates.push({ label: rule.lowLabel, read: rule.lowRead, salience: (rule.median - axis.value) / rule.iqr, samples: axis.samples, concreteness: rule.concreteness, index })
  }
  axisCandidates.sort((left, right) => right.salience - left.salience || right.samples - left.samples || right.concreteness - left.concreteness || left.index - right.index)
  const habits = habitReads(player)
  const primary = axisCandidates[0]
    ? { label: axisCandidates[0].label, read: axisCandidates[0].read }
    : habits[0] ?? (player.stats.bids + player.stats.dudoAttempts + player.stats.calzoAttempts > 0
      ? { label: 'Opening Moves', read: `Made ${player.stats.bids} attributable bids and ${player.stats.dudoAttempts + player.stats.calzoAttempts} attributable calls.` }
      : { label: 'Off the Record', read: 'No attributable actions were recorded.' })
  const badges = habits.filter((habit) => habit.label !== primary.label).slice(0, 2).map(({ label, read }) => ({ label, read }))
  return { style: primary, badges }
}

function verdict(player: MutablePlayer) {
  return player.styleRead
}

function replaySnapshot(input: MatchAnalysisInput, handsById: Map<string, Die[]>, tableDiceById: Map<string, Die[]>): MatchAnalysisReplayPlayerState[] {
  return input.seats.map((seat) => ({
    playerId: seat.id,
    hand: [...(handsById.get(seat.id) ?? [])],
    tableDice: [...(tableDiceById.get(seat.id) ?? [])],
  }))
}

function containsDice(hand: Die[], selected: Die[]) {
  const remaining = [...hand]
  return selected.every((die) => {
    const index = remaining.indexOf(die)
    if (index < 0) return false
    remaining.splice(index, 1)
    return true
  })
}

function buildReplayFrames(input: MatchAnalysisInput, deal: MatchAnalysisRound, resolution: RoundResolution): MatchAnalysisReplayFrame[] | undefined {
  if (input.seats.some((seat) => !deal.hands.some((hand) => hand.playerId === seat.id))) return undefined
  const handsById = new Map(deal.hands.map((hand) => [hand.playerId, [...hand.dice] as Die[]]))
  const tableDiceById = new Map<string, Die[]>()
  const actions = input.actions.filter((entry) => entry.round === deal.round && entry.playerId && ['bid', 'dudo', 'calzo'].includes(entry.action.type))
  const finalCall = actions.at(-1)
  const finalBid = [...actions].reverse().find((entry) => entry.action.type === 'bid')
  if (!finalCall || finalCall.playerId !== resolution.callerId || finalCall.action.type !== resolution.kind || !finalBid || finalBid.playerId !== resolution.bidderId) return undefined
  if (finalBid.action.type !== 'bid') return undefined
  const finalBidAction = finalBid.action as Extract<GameAction, { type: 'bid' }>
  if (!sameBid(finalBidAction.bid, resolution.bid)) return undefined

  const frames: MatchAnalysisReplayFrame[] = [{ phase: 'setup', actionIndex: -1, players: replaySnapshot(input, handsById, tableDiceById) }]
  for (const [actionIndex, entry] of actions.entries()) {
    const actorId = entry.playerId!
    const action = entry.action
    if (!handsById.has(actorId)) return undefined
    if (action.type === 'bid') {
      const bidAction = action as Extract<GameAction, { type: 'bid' }>
      frames.push({
        phase: 'before-action', actionIndex, actorId, attributable: entry.covered !== true,
        action: { type: 'bid', bid: { ...bidAction.bid }, ...(entry.tableDice?.length ? { tableDice: [...entry.tableDice] } : {}) },
        players: replaySnapshot(input, handsById, tableDiceById),
      })
      if (entry.tableDice?.length) {
        const preActionHand = handsById.get(actorId)!
        if (!entry.rerolledDice || entry.rerolledDice.length + entry.tableDice.length !== preActionHand.length || !containsDice(preActionHand, entry.tableDice)) return undefined
        tableDiceById.set(actorId, [...entry.tableDice])
        handsById.set(actorId, [...entry.rerolledDice])
      }
    } else if (action.type === 'dudo' || action.type === 'calzo') {
      frames.push({
        phase: 'before-action', actionIndex, actorId, attributable: entry.covered !== true,
        action: { type: action.type },
        players: replaySnapshot(input, handsById, tableDiceById),
      })
    } else return undefined
  }
  return frames
}

export function buildMatchAnalysis(input: MatchAnalysisInput, now = new Date().toISOString()): MatchAnalysis {
  const resolutionByRound = new Map(input.roundResolutions.map((entry) => [entry.round, entry]))
  const coveredCallByRound = new Map<number, boolean>()
  const signatureCandidates: SignatureCandidate[] = []
  const mutable = new Map<string, MutablePlayer>(input.seats.map((seat) => [seat.id, {
    ...seat,
    winner: seat.id === input.finalState.winnerId,
    verdict: '',
    style: '',
    styleRead: '',
    badges: [],
    scores: { bluff: score(0, 0, 4), aggression: score(priors.aggressionMean, 0, 3), challenge: score(priors.challengeMean, 0, 2) },
    stats: { bids: 0, verifiedFinalBids: 0, unsupportedFinalBids: 0, unsupportedCaught: 0, unsupportedSurvived: 0, deliberatePersonaBluffs: 0, deliberateBluffsCaught: 0, deliberateBluffsSurvived: 0, forcedEscalations: 0, forcedEscalationsCaught: 0, forcedEscalationsSurvived: 0, dudoAttempts: 0, dudoCorrect: 0, calzoAttempts: 0, calzoCorrect: 0, diceGained: 0, diceLost: 0, tableDicePlays: 0, bidFaceCounts: emptyFaceCounts(), unheldFaceBids: 0, averageUnheldFaceQuantity: 0 },
    claimValues: [], aggressionValues: [], challengeValues: [], unheldFaceQuantities: [],
    deceptionPoints: 0, deceptionBids: 0, inventedFaceBids: 0, singleCopyBids: 0, whiteLieBids: 0, gratuitousOverraises: 0, excessRaiseSteps: 0, scoredUnsupportedCaught: 0, scoredUnsupportedSurvived: 0,
  }]))

  for (const deal of input.roundDeals) {
    let currentBid: Bid | null = null
    let lastBidderId: string | null = null
    let finalBidClassification: FinalBidClassification | undefined
    let finalCallContext: FinalCallContext | undefined
    let ladderLength = 0
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
        const hand = handsById.get(actor.id) ?? []
        const canSeeHand = !(deal.paloFijo && input.rules.paloFijoBlindDice && hand.length > 1)
        const visibleBidderView = bidderView(view, actor.id, hand, deal.paloFijo, input.rules)
        const actionBidderView = entry.tableDice?.length
          ? tableDiceBidderView(view, actor.id, entry.tableDice)
          : visibleBidderView
        let deceptionPoints = 0
        if (!entry.covered) {
          actor.stats.bids += 1
          // Claim risk: the chance this player's own claim was false at the moment they
          // made it, judged from their own dice. Every player-made bid counts — including
          // openings and claims nobody challenged. Timeout safety moves remain visible in
          // the round story but are not attributed as that human's strategy.
          actor.claimValues.push(facingRisk(actionBidderView, actor.id, action.bid, 'raise'))
          actor.stats.bidFaceCounts[action.bid.denomination] += 1
          if (currentBid) actor.aggressionValues.push(facingRisk(view, actor.id, currentBid, 'raise'))
          if (entry.tableDice?.length) actor.stats.tableDicePlays += 1
          // This is deliberately literal, not game-rule support: Aces do not count
          // as holding another face. Assess the private hand before this action can
          // commit dice or replace it with a reroll. A multi-die blind Palo Fijo
          // bidder never saw that hand, so there is no fair attribution to make.
          if (canSeeHand && !hand.includes(action.bid.denomination)) {
            actor.stats.unheldFaceBids += 1
            actor.unheldFaceQuantities.push(action.bid.quantity)
          }
          if (canSeeHand) {
            const legalBids = getLegalActions(stateBeforeBid, actor.id).bids
            const chosenIsLegal = legalBids.some((bid) => sameBid(bid, action.bid))
            if (chosenIsLegal) {
              const literalCopies = hand.filter((die) => die === action.bid.denomination).length
              const supportFactor = literalCopies === 0 ? 1 : literalCopies === 1 ? 0.4 : 0
              const introducedOrSwitched = !currentBid || currentBid.denomination !== action.bid.denomination
              // Count only engine-generated legal choices below the chosen
              // same-face quantity. This measures excess without reproducing
              // Aces/Palo Fijo ordering in analysis code.
              const excessSteps = introducedOrSwitched ? 0 : legalBids.filter((bid) => bid.denomination === action.bid.denomination && bid.quantity < action.bid.quantity).length
              const choiceFactor = introducedOrSwitched ? 2 : 0.25 + 0.5 * excessSteps
              deceptionPoints = supportFactor * choiceFactor
              if (deceptionPoints > 0) {
                actor.deceptionPoints += deceptionPoints
                actor.deceptionBids += 1
                if (literalCopies === 0 && introducedOrSwitched) actor.inventedFaceBids += 1
                if (literalCopies === 1) actor.singleCopyBids += 1
                if (literalCopies === 0 && !introducedOrSwitched && excessSteps === 0) actor.whiteLieBids += 1
                if (!introducedOrSwitched && excessSteps > 0) {
                  actor.gratuitousOverraises += 1
                  actor.excessRaiseSteps += excessSteps
                }
              }
            }
          }
        }
        if (entry.tableDice?.length) tableDiceById.set(actor.id, [...entry.tableDice])
        ladderLength += 1
        finalBidClassification = {
          bidderId: actor.id,
          bid: action.bid,
          covered: entry.covered === true,
          deliberatePersonaBluff: decision?.trace?.settings?.personaBluffFired === 1,
          forcedEscalation: Boolean(currentBid && !fullySupportedRaiseExists(stateBeforeBid, actor.id)),
          successProbability: 1 - facingRisk(actionBidderView, actor.id, action.bid, 'raise'),
          ladderLength,
          tableDice: [...tableDiceById.values()].reduce((sum, dice) => sum + dice.length, 0),
          deceptionPoints,
        }
        currentBid = action.bid
        lastBidderId = actor.id
        if (entry.rerolledDice) handsById.set(actor.id, [...entry.rerolledDice])
      } else if (action.type === 'dudo' && currentBid) {
        coveredCallByRound.set(deal.round, entry.covered === true)
        const hand = handsById.get(actor.id) ?? []
        const visibleCallerView = bidderView(view, actor.id, hand, deal.paloFijo, input.rules)
        finalCallContext = {
          callerId: actor.id,
          kind: 'dudo',
          covered: entry.covered === true,
          successProbability: 1 - facingRisk(visibleCallerView, actor.id, currentBid, 'dudo'),
        }
        if (!entry.covered) {
          actor.stats.dudoAttempts += 1
          actor.challengeValues.push(facingRisk(view, actor.id, currentBid, 'dudo'))
        }
      } else if (action.type === 'calzo' && currentBid) {
        coveredCallByRound.set(deal.round, entry.covered === true)
        const hand = handsById.get(actor.id) ?? []
        const visibleCallerView = bidderView(view, actor.id, hand, deal.paloFijo, input.rules)
        finalCallContext = {
          callerId: actor.id,
          kind: 'calzo',
          covered: entry.covered === true,
          successProbability: 1 - facingRisk(visibleCallerView, actor.id, currentBid, 'calzo'),
        }
        if (!entry.covered) {
          actor.stats.calzoAttempts += 1
          actor.challengeValues.push(facingRisk(view, actor.id, currentBid, 'calzo'))
        }
      }
    }

    const resolved = resolutionByRound.get(deal.round)?.resolution
    if (!resolved) continue
    const caller = mutable.get(resolved.callerId)
    const bidder = mutable.get(resolved.bidderId)
    const coveredCall = coveredCallByRound.get(deal.round) === true
    if (caller && !coveredCall) {
      if (resolved.kind === 'dudo' && resolved.correct) caller.stats.dudoCorrect += 1
      if (resolved.kind === 'calzo' && resolved.correct) caller.stats.calzoCorrect += 1
    }
    const matchingFinalBid = finalBidClassification?.bidderId === resolved.bidderId && sameBid(finalBidClassification.bid, resolved.bid)
      ? finalBidClassification
      : undefined
    if (bidder && !matchingFinalBid?.covered) {
      bidder.stats.verifiedFinalBids += 1
      const caught = resolved.kind === 'dudo' && resolved.correct
      if (resolved.actualCount < resolved.bid.quantity) {
        bidder.stats.unsupportedFinalBids += 1
        if (caught) bidder.stats.unsupportedCaught += 1
        else bidder.stats.unsupportedSurvived += 1
        const gap = resolved.bid.quantity - resolved.actualCount
        const candidate = `Round ${deal.round}: claimed ${resolved.bid.quantity} ${denominationNames[resolved.bid.denomination]} with ${resolved.actualCount} actually there${caught ? coveredCall ? ' — it was caught' : ` — ${input.seats.find((seat) => seat.id === resolved.callerId)?.name ?? 'the caller'} caught it` : ' — it survived the call'}.`
        const priorGap = bidder.moment?.match(/gap:(\d+)/)?.[1]
        if (!priorGap || gap > Number(priorGap)) bidder.moment = `${candidate} gap:${gap}`
        if ((matchingFinalBid?.deceptionPoints ?? 0) > 0) {
          if (caught) bidder.scoredUnsupportedCaught += 1
          else bidder.scoredUnsupportedSurvived += 1
        }
        if ((matchingFinalBid?.deceptionPoints ?? 0) > 0 && (!bidder.widestScoredShortfall || gap > bidder.widestScoredShortfall.shortfall)) {
          bidder.widestScoredShortfall = {
            round: deal.round,
            bid: resolved.bid,
            actualCount: resolved.actualCount,
            shortfall: gap,
            callerId: resolved.callerId,
            caught,
          }
        }
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

    // A signature play is a public, attributable action. Keep the actor's
    // likelihood only long enough to rank it; the payload emits a coarse label.
    // Eligibility follows the featured actor: a correct call belongs to its
    // caller, while a held bid belongs to its bidder. A covered counterpart is
    // still part of the public event but does not erase the real actor's play.
    const signatureBid = matchingFinalBid
    const signatureCall = finalCallContext
    const actionIsAttributable = signatureBid && signatureCall
      && (resolved.correct ? !signatureCall.covered : !signatureBid.covered)
    if (actionIsAttributable) {
      const actorId = resolved.kind === 'dudo' && !resolved.correct ? resolved.bidderId : resolved.callerId
      const counterpartId = actorId === resolved.callerId ? resolved.bidderId : resolved.callerId
      const successProbability = actorId === resolved.callerId ? signatureCall.successProbability : signatureBid.successProbability
      const actorStartingDice = deal.hands.find((hand) => hand.playerId === actorId)?.dice.length ?? 0
      const actorDelta = resolved.diceChanges.find((change) => change.playerId === actorId)?.delta ?? 0
      const counterpartLoss = Math.max(0, -(resolved.diceChanges.find((change) => change.playerId === counterpartId)?.delta ?? 0))
      const elimination = resolved.diceChanges.some((change) => change.after === 0)
      const lowDice = actorStartingDice <= 1 ? 1 : actorStartingDice === 2 ? 0.5 : 0
      const stakes = Math.max(lowDice, elimination ? 1 : 0, Math.min(1, (Math.max(0, actorDelta) + counterpartLoss) / 2))
      const drama = clamp01(
        0.5 * Math.min(1, Math.max(0, signatureBid.ladderLength - 1) / 6)
        + 0.25 * (resolved.actualCount === resolved.bid.quantity ? 1 : 0)
        + 0.25 * Math.min(1, signatureBid.tableDice / 3),
      )
      const common = {
        round: deal.round,
        actorId,
        counterpartId,
        counterpartAttributable: resolved.correct ? !signatureBid.covered : !signatureCall.covered,
        bid: resolved.bid,
        actualCount: resolved.actualCount,
        callKind: resolved.kind,
        diceChanges: resolved.diceChanges.map((change) => ({ playerId: change.playerId, delta: change.delta })),
        ladderLength: signatureBid.ladderLength,
        tableDice: signatureBid.tableDice,
        surpriseValue: clamp01(1 - successProbability),
        stakes,
        drama,
      }
      if (resolved.kind === 'calzo' && resolved.correct) signatureCandidates.push({ ...common, kind: 'correct-calzo' })
      else if (resolved.kind === 'dudo' && resolved.correct) signatureCandidates.push({ ...common, kind: 'correct-dudo' })
      else if (resolved.kind === 'dudo' && !resolved.correct) signatureCandidates.push({ ...common, kind: 'bid-held' })
    }
    for (const change of resolved.diceChanges) {
      const changed = mutable.get(change.playerId)
      if (!changed) continue
      if (change.delta > 0) changed.stats.diceGained += change.delta
      else changed.stats.diceLost += Math.abs(change.delta)
      // A defining moment describes a choice, so a timeout safety call never earns
      // one — the dice change above is a match fact, this is attribution.
      if (caller?.id === changed.id && resolved.correct && !coveredCall && !changed.moment) {
        changed.moment = `Round ${deal.round}: the ${resolved.kind === 'dudo' ? 'Dudo' : 'Calzo'} call was right and changed the direction of the table.`
      }
    }
  }

  const mean = (values: number[], prior: number, strength: number) => (prior * strength + values.reduce((sum, value) => sum + value, 0)) / (strength + values.length)
  for (const player of mutable.values()) {
    // No population prior here: claim risk has one sample per bid, so a match's own
    // bids carry it. Priors stay on aggression and challenge, which have fewer.
    const claimRisk = player.claimValues.length ? player.claimValues.reduce((sum, value) => sum + value, 0) / player.claimValues.length : 0
    player.scores = {
      bluff: score(claimRisk, player.claimValues.length, 4),
      aggression: score(mean(player.aggressionValues, priors.aggressionMean, 5), player.aggressionValues.length, 3),
      challenge: score(mean(player.challengeValues, priors.challengeMean, 5), player.challengeValues.length, 2),
    }
    player.stats.averageUnheldFaceQuantity = player.unheldFaceQuantities.length
      ? player.unheldFaceQuantities.reduce((sum, quantity) => sum + quantity, 0) / player.unheldFaceQuantities.length
      : 0
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
  for (const player of players) {
    const editorial = editorialRead(player)
    player.style = editorial.style.label
    player.styleRead = editorial.style.read
    player.badges = editorial.badges
    player.verdict = verdict(player)
  }

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
          attributable: entry.covered !== true,
          ...(entry.tableDice?.length ? { tableDice: entry.tableDice.length } : {}),
        }
      })
    const resolvingCall = input.actions
      .filter((entry) => entry.round === deal.round && entry.playerId === resolved.callerId && entry.action.type === resolved.kind)
      .at(-1)
    const replayFrames = buildReplayFrames(input, deal, resolved)
    return [{
      round: deal.round,
      paloFijo: deal.paloFijo,
      startingDice: input.seats.map((seat) => ({
        playerId: seat.id,
        dice: deal.hands.find((hand) => hand.playerId === seat.id)?.dice.length ?? 0,
      })),
      bids,
      callerId: resolved.callerId,
      // Absence is not proof of attribution in old/incomplete logs. Covered
      // calls still appear in the tape but must not become editorial credit.
      callerAttributable: resolvingCall ? resolvingCall.covered !== true : false,
      bidderId: resolved.bidderId,
      kind: resolved.kind,
      correct: resolved.correct,
      actualCount: resolved.actualCount,
      margin: resolved.actualCount - resolved.bid.quantity,
      diceChanges: resolved.diceChanges.map((change) => ({ playerId: change.playerId, delta: change.delta })),
      ...(replayFrames ? { replayFrames } : {}),
      ...(resolvedEntry.revealedHands ? {
        // This value exists only because the room captured it from the all-hands
        // reveal projection. Never substitute a deal or current private hand.
        revealedHands: resolvedEntry.revealedHands.map((hand) => ({ playerId: hand.playerId, dice: [...hand.dice] })),
      } : {}),
    }]
  })
  const startingDice = input.seats.map((seat) => ({
    playerId: seat.id,
    dice: input.roundDeals[0]?.hands.find((hand) => hand.playerId === seat.id)?.dice.length ?? 0,
  }))
  const winner = input.seats.find((seat) => seat.id === input.finalState.winnerId)
  const seatIndex = new Map(input.seats.map((seat, index) => [seat.id, index]))
  const rankedSignatureCandidates = [...signatureCandidates].sort((left, right) => {
    const leftScore = 0.55 * left.surpriseValue + 0.30 * left.stakes + 0.15 * left.drama
    const rightScore = 0.55 * right.surpriseValue + 0.30 * right.stakes + 0.15 * right.drama
    return rightScore - leftScore
      || right.surpriseValue - left.surpriseValue
      || right.stakes - left.stakes
      || right.drama - left.drama
      || left.round - right.round
      || (seatIndex.get(left.actorId) ?? Number.MAX_SAFE_INTEGER) - (seatIndex.get(right.actorId) ?? Number.MAX_SAFE_INTEGER)
  })
  const selectedSignature = rankedSignatureCandidates[0]
  const signaturePlay = selectedSignature && {
    round: selectedSignature.round,
    kind: selectedSignature.kind,
    actorId: selectedSignature.actorId,
    counterpartId: selectedSignature.counterpartId,
    counterpartAttributable: selectedSignature.counterpartAttributable,
    bid: selectedSignature.bid,
    actualCount: selectedSignature.actualCount,
    callKind: selectedSignature.callKind,
    diceChanges: selectedSignature.diceChanges,
    ladderLength: selectedSignature.ladderLength,
    tableDice: selectedSignature.tableDice,
    surprise: selectedSignature.surpriseValue >= 0.75 ? 'long-shot' as const : selectedSignature.surpriseValue >= 0.5 ? 'bold' as const : 'notable' as const,
  }
  const signatureActor = signaturePlay && input.seats.find((seat) => seat.id === signaturePlay.actorId)?.name
  const signatureCounterpart = signaturePlay && input.seats.find((seat) => seat.id === signaturePlay.counterpartId)?.name
  const keyMoment = signaturePlay
    ? signaturePlay.kind === 'bid-held'
      ? `Round ${signaturePlay.round}: ${signatureActor ?? 'The bidder'} claimed ${signaturePlay.bid.quantity} ${denominationNames[signaturePlay.bid.denomination]}; ${signaturePlay.counterpartAttributable ? `${signatureCounterpart ?? 'the caller'} said Dudo` : 'a Dudo followed'}, but ${signaturePlay.actualCount} ${signaturePlay.actualCount === 1 ? 'was' : 'were'} there.`
      : `Round ${signaturePlay.round}: ${signatureActor ?? 'The caller'} called ${signaturePlay.callKind === 'calzo' ? 'Calzo' : 'Dudo'} on the final claim and was right.`
    : undefined

  const rankedBiggestLiars = players.filter((player) => player.deceptionPoints > 0)
    .sort((left, right) => right.deceptionPoints - left.deceptionPoints
      || right.inventedFaceBids - left.inventedFaceBids
      || right.gratuitousOverraises - left.gratuitousOverraises
      || right.excessRaiseSteps - left.excessRaiseSteps
      || right.deceptionBids - left.deceptionBids
      || (seatIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (seatIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  const selectedBiggestLiar = rankedBiggestLiars[0]
  const biggestLiar = selectedBiggestLiar && {
    playerId: selectedBiggestLiar.id,
    deceptionPoints: Math.round(selectedBiggestLiar.deceptionPoints * 100) / 100,
    components: {
      scoredBids: selectedBiggestLiar.deceptionBids,
      inventedFaceBids: selectedBiggestLiar.inventedFaceBids,
      singleCopyBids: selectedBiggestLiar.singleCopyBids,
      whiteLieBids: selectedBiggestLiar.whiteLieBids,
      gratuitousOverraises: selectedBiggestLiar.gratuitousOverraises,
      excessRaiseSteps: selectedBiggestLiar.excessRaiseSteps,
      scoredUnsupportedCaught: selectedBiggestLiar.scoredUnsupportedCaught,
      scoredUnsupportedSurvived: selectedBiggestLiar.scoredUnsupportedSurvived,
    },
    ...(selectedBiggestLiar.widestScoredShortfall ? { widestScoredShortfall: selectedBiggestLiar.widestScoredShortfall } : {}),
  }
  const publicPlayers: MatchAnalysisPlayer[] = players.map((player) => ({
    id: player.id, name: player.name, controller: player.controller, ...(player.persona ? { persona: player.persona } : {}),
    winner: player.winner, verdict: player.verdict, style: player.style, styleRead: player.styleRead, badges: player.badges, scores: player.scores, stats: player.stats,
    ...(player.moment ? { moment: player.moment } : {}), ...(player.botReasoning ? { botReasoning: player.botReasoning } : {}),
  }))
  return {
    schemaVersion: 5,
    generatedAt: now,
    rounds: input.finalState.round,
    totalTurns: input.actions.filter((entry) => 'playerId' in entry.action && ['bid', 'dudo', 'calzo'].includes(entry.action.type)).length,
    winnerId: input.finalState.winnerId,
    headline: `${winner?.name ?? 'The winner'} took the table after ${input.finalState.round} ${input.finalState.round === 1 ? 'round' : 'rounds'}.`,
    ...(keyMoment ? { keyMoment } : {}),
    ...(signaturePlay ? { signaturePlay } : {}),
    ...(biggestLiar ? { biggestLiar } : {}),
    startingDice,
    tableAverages,
    momentum,
    roundStories,
    players: publicPlayers,
  }
}
