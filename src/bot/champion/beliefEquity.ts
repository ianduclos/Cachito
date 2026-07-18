// exp-004 — "Belief Equity": the first bot combining the L2 exact Bayesian
// hand-belief filter (lab/tools/beliefFilter.ts, exp-003) with the L1
// equity-priced Dudo/Calzo thresholds (lab/bots/equityAware.ts, exp-002/
// exp-002b). See lab/notes/bot-sophistication.md ("L2"/"L3") and lab/LOG.md
// for the lineage this file completes.
//
// Design (v1, deliberately minimal — "isolate the probability-source effect"):
// this file starts from equityAware.ts's exact structure (2p gate, Calzo
// breakeven pricing, Dudo EV pricing, all read-verbatim from that module) and
// replaces every probability equityAware/Conservative sourced from the
// independent-binomial assumption with the L2 belief filter's exact posterior
// version:
//   1. P(current bid true) for the Dudo EV branch (`beliefBidProbability`,
//      replacing Conservative's `evaluateBidDistribution(...).atLeast` /
//      opponent-model-adjusted support).
//   2. P(exact) for the Calzo branch (derived from the SAME posterior count
//      distribution via a P(>=q) - P(>=q+1) difference of two
//      `beliefBidProbability` calls — the filter exposes a survival function,
//      not a raw pmf array, so this is the correct way to read off P(count =
//      q) without reimplementing the convolution beliefFilter.ts already does
//      internally).
//   3. The support probability used to score CANDIDATE bids (i.e. which raise
//      to make when neither Calzo nor Dudo fires). Conservative's own bid
//      selection is a private closure inside src/bot/policies.ts that cannot
//      be parameterized from outside, so this file reimplements only the
//      probability-consuming piece of it (`expectedBidValue`,
//      `denominationPreference`, and the target-bid-confidence formula from
//      `strategyContext`) verbatim — same weights, same constants, cited
//      inline — swapping only the `evaluateBidDistribution(...).atLeast` input
//      for `beliefBidProbability`. This is the one place v1 genuinely
//      reimplements (rather than reuses) a piece of Conservative, because
//      there is no other way to inject a different probability source into
//      its bid-selection loop without editing src/bot/policies.ts (out of
//      scope for lab/). Everything else about bid selection (bluffing,
//      near-equal-window pooling, table-dice pressure) is NOT reproduced —
//      the belief-scored bid is a single deterministic argmax, a documented
//      v1 simplification.
//
// Equity pricing (Calzo breakeven, Dudo's EV(best bid) approximation) is
// UNCHANGED from equityAware.ts — those are pure lab/data/exp-001 equity-table
// reads, no probability-of-a-bid involved, so there is nothing to swap there
// (see design point (c) in the task brief: "Thresholds/EV pricing stay
// equity-based exactly as in equityAware").
//
// Statelessness: BotPolicy.chooseAction receives the full public history in
// BotObservation (identical shape/construction in lab/tools/simulate.ts and
// the live room server, dev/onlineRooms.ts:316 `room.botHistory`). Opponent
// posteriors are rebuilt from scratch on every call, replaying only this
// round's bid actions (`entry.round === view.round`) in order — hands reroll
// every round, so nothing from a prior round is informative and nothing needs
// to persist between calls.
//
// Privacy: the only inputs are BotObservation fields (own hand when visible,
// public bids, public dice counts) plus the two static model files
// (equity table, likelihood model) baked in at construction — never reveal
// data, controller identity, or per-opponent profiling beyond what the fitted
// likelihood (same file for every opponent) already encodes.

import likelihoodData from './data/likelihood.json'
import { createAdversarialPolicyLeague } from '../adversarial'
import type {
  BotActionResult,
  BotActionValueTrace,
  BotCandidateTrace,
  BotChoice,
  BotDecisionTrace,
  BotObservation,
  BotPolicy,
} from '../types'
import type { Bid, Die, PublicGameView, PublicPlayer } from '../../engine'
import {
  breakevenFromEquities,
  loadEquityTable,
  lookupEquity,
  type CalzoDetail,
  type DudoDetail,
  type EquityTable,
} from './equity'
import {
  applyBidObservation,
  beliefBidProbability,
  countsFromDice,
  initialPosterior,
  type FaceCounts,
  type LikelihoodModel,
  type OpponentBelief,
} from './beliefFilter'

const DEFAULT_MIN_SAMPLES = 300
const DEFAULT_CALZO_MARGIN = 0.02
/** Conservative's configured targetBidConfidence (src/bot/adversarial.ts) — this file always wraps Conservative. */
const CONSERVATIVE_TARGET_BID_CONFIDENCE = 0.72

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/** Validates the promoted likelihood model bundled with the production policy. */
export function loadLikelihoodModel(source: unknown = likelihoodData): LikelihoodModel {
  const raw = source as Partial<LikelihoodModel> | null
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.denomChoice || !raw.raiseVsChallenge) {
    throw new Error('The bundled Gen 2 likelihood model is invalid')
  }
  return raw as LikelihoodModel
}

/** Mirror of equityAware.ts's private `activeOtherStacks` — not exported there, duplicated verbatim (equityAware.ts is out of scope for lab/ edits). */
function activeOtherStacks(view: PublicGameView, selfId: string): number[] {
  return view.players.filter((candidate) => candidate.id !== selfId && candidate.diceCount > 0).map((candidate) => candidate.diceCount)
}

/** Mirror of equityAware.ts's private `isCurrentRoundStarter` — same reasoning (no starterId on PublicGameView), duplicated verbatim. */
function isCurrentRoundStarter(observation: BotObservation): boolean {
  const roundEntries = observation.history.filter((entry) => entry.round === observation.view.round)
  if (roundEntries.length === 0) return true
  return roundEntries[0].playerId === observation.playerId
}

// --- Belief context: rebuild every active opponent's posterior from this round's history ---

export interface BeliefContext {
  /** Own hand's face counts. All-zero (contributes nothing) when the hand is hidden (blind Palo Fijo). */
  ownCounts: FaceCounts
  ownHandKnown: boolean
  /** One entry per other active player, PLUS a self entry (uninformative prior) when own hand is hidden. */
  opponents: OpponentBelief[]
}

/**
 * Rebuilds posteriors for every other active player by replaying this round's bid actions in
 * order (dudo/calzo end a round, so they never appear mid-round for an in-progress decision).
 * `priorBid` for each replayed bid is the running current bid immediately before that action —
 * reconstructed here since PublicActionEntry (lab/tools/simulate.ts, dev/onlineRooms.ts) does not
 * itself carry a `currentBid` field, unlike lab/tools/evalBelief.ts's richer decision-line format.
 *
 * Blind Palo Fijo (src/engine/projections.ts: `paloFijoBlindDice` rule, multi-die viewer): own hand
 * is hidden even from self. Handled by folding self's own k dice into the belief as an extra
 * "opponent" with an uninformative prior — never updated, since there is no observation that could
 * inform it (beliefFilter.ts's `applyBidObservation` already skips the denomination-choice evidence
 * for ALL players whenever `paloFijo` is true, and the raise-vs-challenge evidence only concerns the
 * hypothesis hand being evaluated, never the observer's own hand). This exactly matches how
 * Conservative treats a blind self (`player.hand ?? []`, own dice folded into "unknown").
 */
export function buildBeliefContext(observation: BotObservation, model: LikelihoodModel): BeliefContext {
  const { view, playerId } = observation
  const paloFijo = view.paloFijo
  const player = view.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error(`Unknown player: ${playerId}`)

  const activePlayers = view.players.filter((candidate) => candidate.diceCount > 0)
  const activeOpponentPlayers = activePlayers.filter((candidate) => candidate.id !== playerId)
  const totalDice = activePlayers.reduce((sum, candidate) => sum + candidate.diceCount, 0)

  const posteriors = new Map<string, Float64Array>()
  for (const opponent of activeOpponentPlayers) posteriors.set(opponent.id, initialPosterior(opponent.diceCount))

  const roundEntries = observation.history.filter((entry) => entry.round === view.round)
  let runningBid: Bid | null = null
  for (const entry of roundEntries) {
    if (entry.action.type !== 'bid') break // round-ending action; should not precede an in-progress decision, but fail safe rather than throw
    const posterior = posteriors.get(entry.playerId)
    const bidderDice = activeOpponentPlayers.find((candidate) => candidate.id === entry.playerId)?.diceCount
    if (posterior && bidderDice !== undefined) {
      const unknown = totalDice - bidderDice
      posteriors.set(entry.playerId, applyBidObservation(posterior, bidderDice, paloFijo, entry.action.bid.denomination, runningBid, unknown, model))
    }
    runningBid = entry.action.bid
  }

  const ownHandKnown = player.hand !== undefined
  const ownCounts: FaceCounts = ownHandKnown ? countsFromDice(player.hand!) : [0, 0, 0, 0, 0, 0]
  const opponents: OpponentBelief[] = activeOpponentPlayers.map((candidate) => ({
    playerId: candidate.id,
    k: candidate.diceCount,
    posterior: posteriors.get(candidate.id)!,
  }))
  if (!ownHandKnown) opponents.push({ playerId, k: player.diceCount, posterior: initialPosterior(player.diceCount) })

  return { ownCounts, ownHandKnown, opponents }
}

/**
 * P(count of `bid.denomination` == bid.quantity), read off the SAME posterior count distribution
 * `beliefBidProbability` already convolves, via P(>=q) - P(>=q+1) — the filter exposes a survival
 * function (P(bid true) = P(total >= quantity)), and this difference is exactly its pmf at `quantity`
 * for a non-negative integer-valued distribution. Reuses `beliefBidProbability` rather than
 * reimplementing the private convolution in lab/tools/beliefFilter.ts.
 */
export function beliefExactProbability(ownCounts: FaceCounts, bid: Bid, paloFijo: boolean, opponents: readonly OpponentBelief[]): number {
  const atLeastQ = beliefBidProbability(ownCounts, bid, paloFijo, opponents)
  const atLeastQPlus1 = beliefBidProbability(ownCounts, { ...bid, quantity: bid.quantity + 1 }, paloFijo, opponents)
  return Math.max(0, Math.min(1, atLeastQ - atLeastQPlus1))
}

// --- Belief-scored candidate bid selection (design point b.3) ---

/**
 * Verbatim mirror of src/bot/policies.ts `strategyContext`'s target-bid-confidence formula, fixed
 * to Conservative's configured settings (targetBidConfidence=0.72 — src/bot/adversarial.ts). Only
 * the confidence *target* is reproduced (a fixed heuristic constant, not a probability estimate);
 * the probability compared against it is exactly what this file replaces with belief-filter output.
 * Duplicated because policies.ts's `strategyContext` is a private closure with no external hook and
 * lab/ may not edit src/.
 */
function conservativeTargetBidConfidence(view: PublicGameView, player: PublicPlayer): number {
  const activeDice = view.players.filter((candidate) => !candidate.eliminated).map((candidate) => candidate.diceCount)
  const fewestDice = Math.min(...activeDice)
  const trailing = player.diceCount >= fewestDice + 2
  const leading = player.diceCount === fewestDice
  const endgame = player.diceCount <= 2
  const posture = [...player.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 3
  const pressurePersona = posture === 1
  const carefulPersona = posture === 2
  const pressure = (trailing ? 0.22 : 0) + (pressurePersona ? 0.14 : 0) - (leading ? 0.12 : 0) - (endgame ? 0.14 : 0) - (carefulPersona ? 0.08 : 0)
  return clamp(CONSERVATIVE_TARGET_BID_CONFIDENCE - pressure * 0.45, 0.48, 0.76)
}

/** Verbatim mirror of src/bot/policies.ts `denominationPreference` (private, duplicated for the same reason as above). */
function denominationPreference(hand: Die[] | undefined, denomination: Die, paloFijo: boolean): number {
  if (!hand) return 0
  const matches = hand.filter((die) => die === denomination || (!paloFijo && denomination !== 1 && die === 1)).length
  return matches * 0.008
}

/**
 * Verbatim mirror of src/bot/policies.ts `expectedBidValue`. The only change from Conservative's use
 * of this formula is the `supportProbability` input: belief-filter P(bid true) instead of
 * `evaluateBidDistribution(...).atLeast` (independent binomial).
 */
function expectedBidValue(supportProbability: number, quantityPenalty: number, visiblePreference: number, confidenceDistance: number): number {
  return supportProbability * 0.28 - (1 - supportProbability) * 0.16 - quantityPenalty + visiblePreference - confidenceDistance * 0.04
}

export interface BeliefCandidateBid extends BotCandidateTrace {
  expectedValue: number
}

/**
 * Scores every legal bid with belief-filter support probability plugged into Conservative's own
 * bid-value formula (weights unchanged, only the probability source swapped — see module docstring
 * point 3) and returns the argmax, plus a bounded shortlist for the trace. Deliberately does NOT
 * reproduce Conservative's bluffing / near-equal-window random pool / table-dice pressure layers —
 * those are non-probability stochastic embellishments on top of this base choice, out of scope for
 * "isolate the probability-source effect" (documented v1 simplification, see module docstring).
 */
export function selectBeliefBid(observation: BotObservation, belief: BeliefContext): { best: BeliefCandidateBid; shortlist: BeliefCandidateBid[] } | undefined {
  const { view, playerId, legalActions } = observation
  const player = view.players.find((candidate) => candidate.id === playerId)
  if (!player || legalActions.bids.length === 0) return undefined
  const paloFijo = view.paloFijo
  const targetBidConfidence = conservativeTargetBidConfidence(view, player)

  const scored: BeliefCandidateBid[] = legalActions.bids.map((bid) => {
    const supportProbability = beliefBidProbability(belief.ownCounts, bid, paloFijo, belief.opponents)
    const exactProbability = beliefExactProbability(belief.ownCounts, bid, paloFijo, belief.opponents)
    const quantityPenalty = bid.quantity / 10_000
    const visiblePreference = denominationPreference(player.hand, bid.denomination, paloFijo)
    const confidenceDistance = Math.abs(supportProbability - targetBidConfidence)
    const score = -confidenceDistance - quantityPenalty + visiblePreference
    const expectedValue = expectedBidValue(supportProbability, quantityPenalty, visiblePreference, confidenceDistance)
    return {
      bid: { ...bid },
      supportProbability,
      exactProbability,
      score,
      scoreComponents: { confidenceDistance, quantityPenalty, visiblePreference },
      expectedValue,
    }
  })

  const best = scored.reduce((champion, candidate) => (candidate.expectedValue > champion.expectedValue ? candidate : champion))
  const shortlist = [...scored].sort((left, right) => right.expectedValue - left.expectedValue).slice(0, 8)
  return { best, shortlist }
}

// --- Policy ---

export interface BeliefEquityPolicyOptions {
  name?: string
  /** Safety margin added to the derived Calzo breakeven p*. Default +0.02 (same default as equityAware.ts). */
  calzoMargin?: number
  /** Minimum sample count for a state-level equity lookup before falling back. Default 300 (same as equityAware.ts). */
  minSamples?: number
  /**
   * When true (default), games whose original table size is 2 players delegate wholly to
   * Conservative — same gate, same reasoning as equityAware.ts's `twoPlayerGate` (exp-002b).
   */
  twoPlayerGate?: boolean
}

interface BeliefDecisionTrace extends BotDecisionTrace {
  belief?: {
    calzo?: CalzoDetail
    dudo?: DudoDetail
    bidSelection?: { targetBidConfidence: number; best: BeliefCandidateBid }
  }
}

export function createBeliefEquityPolicy(options: BeliefEquityPolicyOptions): BotPolicy {
  const table: EquityTable = loadEquityTable()
  const model = loadLikelihoodModel()
  const name = options.name ?? 'Belief Equity'
  const calzoMargin = options.calzoMargin ?? DEFAULT_CALZO_MARGIN
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES
  const twoPlayerGate = options.twoPlayerGate ?? true

  const conservative = createAdversarialPolicyLeague().find((policy) => policy.name === 'Conservative')
  if (!conservative || !conservative.chooseActionWithTrace) {
    throw new Error('Expected createAdversarialPolicyLeague() to include a traced "Conservative" policy')
  }

  const decide = (observation: BotObservation, random: () => number): BotActionResult => {
    const base = conservative.chooseActionWithTrace!(observation, random)
    const baseTrace = base.trace
    if (!baseTrace) return base

    const { view, playerId, legalActions } = observation
    const player = view.players.find((candidate) => candidate.id === playerId)
    const bidderId = view.lastBidderId
    const bidder = bidderId ? view.players.find((candidate) => candidate.id === bidderId) : undefined

    const trace: BeliefDecisionTrace = { ...baseTrace, model: 'belief-equity', version: 1 }

    // Same heads-up gate as equityAware.ts / exp-002b: delegate wholly to Conservative when the
    // GAME's original table size is 2 players (view.players.length is stable for the whole game).
    if (twoPlayerGate && view.players.length === 2) {
      trace.plainReason = 'At a two-player table, it used the proven cautious heads-up approach.'
      return { choice: base.choice, trace }
    }

    // No current bid (opening the round): Dudo/Calzo are not legal, defer entirely to Conservative.
    if (!view.currentBid || !player || !bidder || !bidderId) {
      trace.plainReason = 'With no claim to read yet, it opened on a line its hand could reasonably support.'
      return { choice: base.choice, trace }
    }

    // Forced fallback (no legal bid left): defer entirely, same as equityAware.ts.
    if (legalActions.bids.length === 0) {
      trace.plainReason = 'There was no useful raise left, so it took the safest legal fallback.'
      return { choice: base.choice, trace }
    }

    const paloFijo = view.paloFijo
    const belief = buildBeliefContext(observation, model)
    const currentBid = view.currentBid

    const supportProbability = beliefBidProbability(belief.ownCounts, currentBid, paloFijo, belief.opponents)
    const exactProbability = beliefExactProbability(belief.ownCounts, currentBid, paloFijo, belief.opponents)

    const playerCount = view.players.length
    const others = activeOtherStacks(view, playerId)
    const nowStarter = isCurrentRoundStarter(observation)
    const equityNow = lookupEquity(table, player.diceCount, others, nowStarter, playerCount, minSamples)

    // Calzo/Dudo EV pricing: byte-identical to equityAware.ts, only the probability inputs
    // (exactProbability, supportProbability) are now belief-sourced instead of binomial-sourced.
    let calzoChoice: { threshold: number; worthwhile: boolean; detail: CalzoDetail } | undefined
    if (legalActions.canCalzo) {
      const afterLossDice = player.diceCount - 2
      const afterLoss = afterLossDice <= 0 ? 0 : lookupEquity(table, afterLossDice, others, true, playerCount, minSamples)
      const afterGainDice = Math.min(player.diceCount + 1, 5)
      const afterGain = lookupEquity(table, afterGainDice, others, true, playerCount, minSamples)
      const breakeven = breakevenFromEquities(equityNow, afterLoss, afterGain, calzoMargin)
      calzoChoice = {
        threshold: breakeven.threshold,
        worthwhile: exactProbability >= breakeven.threshold,
        detail: { ...breakeven, now: equityNow, afterLoss, afterGain, exactProbability },
      }
    }

    let dudoChoice: { evDudo: number; evBestBid: number; worthwhile: boolean; detail: DudoDetail } | undefined
    if (legalActions.canDudo) {
      const pUnsupported = 1 - supportProbability

      const bidderAfter = bidder.diceCount - 1
      const othersExcludingBidder = view.players
        .filter((candidate) => candidate.id !== playerId && candidate.id !== bidderId && candidate.diceCount > 0)
        .map((candidate) => candidate.diceCount)
      const equityAfterBidderLoses = bidderAfter <= 0
        ? (othersExcludingBidder.length === 0 ? 1 : lookupEquity(table, player.diceCount, othersExcludingBidder, false, playerCount, minSamples))
        : lookupEquity(table, player.diceCount, [...othersExcludingBidder, bidderAfter], false, playerCount, minSamples)

      const selfAfter = player.diceCount - 1
      const equityAfterSelfLoses = selfAfter <= 0 ? 0 : lookupEquity(table, selfAfter, others, true, playerCount, minSamples)

      const evDudo = pUnsupported * equityAfterBidderLoses + (1 - pUnsupported) * equityAfterSelfLoses
      // EV(best bid): current-state equity, UNCHANGED from equityAware.ts — no probability source
      // to swap here (see module docstring point (c)).
      const evBestBid = equityNow
      dudoChoice = {
        evDudo,
        evBestBid,
        worthwhile: evDudo > evBestBid,
        detail: { pUnsupported, equityAfterBidderLoses, equityAfterSelfLoses, evDudo, evBestBidApprox: evBestBid },
      }
    }

    // Belief-scored candidate bid (design point b.3) replaces Conservative's own bid choice as the fallback.
    const beliefBidResult = selectBeliefBid(observation, belief)
    const fallbackChoice: BotChoice = beliefBidResult ? { type: 'bid', bid: beliefBidResult.best.bid } : base.choice

    trace.currentBidAnalysis = baseTrace.currentBidAnalysis && calzoChoice
      ? { ...baseTrace.currentBidAnalysis, effectiveCalzoThreshold: calzoChoice.threshold }
      : baseTrace.currentBidAnalysis
    trace.belief = {
      calzo: calzoChoice?.detail,
      dudo: dudoChoice?.detail,
      bidSelection: beliefBidResult ? { targetBidConfidence: conservativeTargetBidConfidence(view, player), best: beliefBidResult.best } : undefined,
    }
    if (beliefBidResult) trace.consideredCandidates = beliefBidResult.shortlist

    const actionValues: BotActionValueTrace[] = []
    if (dudoChoice) actionValues.push({ action: 'dudo', expectedValue: dudoChoice.evDudo })
    if (calzoChoice) {
      const evCalzo = exactProbability * calzoChoice.detail.afterGain + (1 - exactProbability) * calzoChoice.detail.afterLoss
      actionValues.push({ action: 'calzo', expectedValue: evCalzo })
    }
    actionValues.push({ action: 'bid', expectedValue: equityNow })
    trace.actionValues = actionValues

    // Calzo checked first, then Dudo — same order as equityAware.ts.
    if (calzoChoice?.worthwhile) {
      trace.decisionReason = 'calzo_threshold'
      trace.plainReason = 'It saw a rare chance that the bid was exactly right and judged Calzo worth the risk.'
      return { choice: { type: 'calzo' }, trace }
    }
    if (dudoChoice?.worthwhile) {
      trace.decisionReason = 'dudo_threshold'
      trace.plainReason = 'Its read of the bidding made the claim look weak enough that Dudo was better than raising.'
      return { choice: { type: 'dudo' }, trace }
    }
    if (fallbackChoice.type !== 'bid') trace.decisionReason = 'forced_fallback'
    else trace.decisionReason = 'supported_bid'
    trace.plainReason = fallbackChoice.type === 'bid'
      ? 'It combined its own dice with the table’s bidding pattern and chose the strongest affordable raise.'
      : 'It took the safest remaining legal action.'
    return { choice: fallbackChoice, trace }
  }

  return {
    name,
    chooseAction(observation, random) {
      return decide(observation, random).choice
    },
    chooseActionWithTrace(observation, random) {
      return decide(observation, random)
    },
  }
}
