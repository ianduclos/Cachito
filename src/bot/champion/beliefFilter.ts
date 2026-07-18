// L2 belief filter (exp-003): exact Bayesian posterior over ONE opponent's hidden hand,
// plus a table-count posterior built by convolving posteriors across all active opponents.
// Library only — no CLI. See lab/tools/fitLikelihood.ts (fits the likelihood model this
// module consumes) and lab/tools/evalBelief.ts (the predictor-evaluation CLI that uses it).
//
// This is a PREDICTOR, not a bot: the deliverable is "does hand inference from bids beat the
// independent-binomial assumption at predicting whether the current bid is true?" — see
// lab/notes/bot-sophistication.md ("L2") and the exp-003 task brief for framing.
//
// Counting rules are never invented here — they mirror, and are cross-checked in
// beliefFilter.check.ts against, the real engine:
//   - src/engine/rules.ts `countBid` (aces wild for non-ace bids, non-Palo-Fijo only)
//   - src/bot/probability.ts `evaluateBidDistribution` (same qualification rule, plus the
//     independent-binomial baseline this filter is being compared against)

import type { Bid, Die } from '../../engine'
import { binomialAtLeast } from '../probability'

/** Starting dice count per player (src/engine/engine.ts `createGame`: `diceCount: 5`). */
export const MAX_DICE = 5
export const FACES = 6

/** counts[f] = number of dice showing face (f+1), f in 0..5. Always length 6. */
export type FaceCounts = readonly [number, number, number, number, number, number]

export interface HandState {
  counts: FaceCounts
  /** Multinomial coefficient k!/(c1!·…·c6!) — the number of ordered iid-die sequences mapping to this multiset. */
  weight: number
}

const factorialCache: number[] = [1]
function factorial(n: number): number {
  for (let i = factorialCache.length; i <= n; i += 1) factorialCache[i] = factorialCache[i - 1] * i
  return factorialCache[n]
}

function multinomial(k: number, counts: readonly number[]): number {
  let denom = 1
  for (const c of counts) denom *= factorial(c)
  return factorial(k) / denom
}

const handCache = new Map<number, HandState[]>()

/** Enumerates every multiset of k dice over 6 faces (C(k+5,5) states; ≤252 for k≤5). Memoized per k. */
export function enumerateHands(k: number): readonly HandState[] {
  if (!Number.isInteger(k) || k < 0 || k > MAX_DICE) throw new RangeError(`k must be an integer in [0, ${MAX_DICE}], got ${k}`)
  const cached = handCache.get(k)
  if (cached) return cached

  const states: HandState[] = []
  const counts = [0, 0, 0, 0, 0, 0]
  const recurse = (face: number, remaining: number): void => {
    if (face === FACES - 1) {
      counts[face] = remaining
      const snapshot = [...counts] as unknown as FaceCounts
      states.push({ counts: snapshot, weight: multinomial(k, counts) })
      return
    }
    for (let c = 0; c <= remaining; c += 1) {
      counts[face] = c
      recurse(face + 1, remaining - c)
    }
    counts[face] = 0
  }
  recurse(0, k)
  handCache.set(k, states)
  return states
}

/** Uniform-per-die prior over hands: P(hand) = weight / 6^k. Sums to 1 over enumerateHands(k) (multinomial theorem). */
export function initialPosterior(k: number): Float64Array {
  const hands = enumerateHands(k)
  const total = 6 ** k
  return Float64Array.from(hands, (h) => h.weight / total)
}

export function countsFromDice(dice: readonly Die[]): FaceCounts {
  const counts = [0, 0, 0, 0, 0, 0]
  for (const die of dice) counts[die - 1] += 1
  return counts as unknown as FaceCounts
}

/** Literal count of face `denomination` in a hand — never wild, regardless of Palo Fijo. */
export function printedCount(counts: FaceCounts, denomination: Die): number {
  return counts[denomination - 1]
}

/**
 * Count of dice in `counts` that qualify toward `denomination` on the table.
 * Mirrors src/engine/rules.ts `countBid` / src/bot/probability.ts `qualifies` exactly:
 * aces (1s) count as wild for non-ace bids in normal (non-Palo-Fijo) rounds only.
 */
export function qualifyingCount(counts: FaceCounts, denomination: Die, paloFijo: boolean): number {
  if (paloFijo || denomination === 1) return counts[denomination - 1]
  return counts[denomination - 1] + counts[0]
}

/** Buckets a printed/held count into {0, 1, "2 or more"} — the coarse buckets the likelihood model is fit on. */
export type CountBucket = 0 | 1 | 2
export function bucketCount(m: number): CountBucket {
  return (m >= 2 ? 2 : m) as CountBucket
}

/** Support-probability bucket edges for the raise-vs-challenge likelihood (5 buckets: [0,.2) … [.8,1]). */
export const SUPPORT_BUCKET_EDGES = [0.2, 0.4, 0.6, 0.8] as const
export const SUPPORT_BUCKET_COUNT = SUPPORT_BUCKET_EDGES.length + 1
export function supportBucket(p: number): number {
  let bucket = 0
  for (const edge of SUPPORT_BUCKET_EDGES) {
    if (p >= edge) bucket += 1
    else break
  }
  return bucket
}

export interface DenomChoiceTable {
  /** P(bidder chooses this face | printed-count bucket of that face in their hand), Laplace-smoothed. */
  m: [number, number, number]
}

export interface RaiseVsChallengeBucket {
  bid: number
  dudo: number
  calzo: number
}

export interface LikelihoodModel {
  version: 1
  trainedFrom: { file: string; decisionLines: number; bidActions: number; supportSamples: number } | { file: '(uniform)' }
  denomChoice: {
    nonAce: DenomChoiceTable
    ace: DenomChoiceTable
  }
  raiseVsChallenge: {
    buckets: RaiseVsChallengeBucket[]
  }
}

/**
 * A likelihood model whose every entry is a constant (no dependence on the hand or bucket).
 * Multiplying a posterior by constant weights and renormalizing is a no-op — this is the
 * fixture for identity check (a): the belief filter, denied any evidence, must reduce exactly
 * to the independent-binomial baseline. See beliefFilter.check.ts.
 */
export function uniformLikelihoodModel(): LikelihoodModel {
  return {
    version: 1,
    trainedFrom: { file: '(uniform)' },
    denomChoice: {
      nonAce: { m: [1 / 3, 1 / 3, 1 / 3] },
      ace: { m: [1 / 3, 1 / 3, 1 / 3] },
    },
    raiseVsChallenge: {
      buckets: Array.from({ length: SUPPORT_BUCKET_COUNT }, () => ({ bid: 1 / 3, dudo: 1 / 3, calzo: 1 / 3 })),
    },
  }
}

function normalizeInPlace(dist: Float64Array): Float64Array {
  let total = 0
  for (let i = 0; i < dist.length; i += 1) total += dist[i]
  if (total <= 0) throw new Error('Posterior collapsed to zero mass — likelihood model assigned zero probability to every hand')
  for (let i = 0; i < dist.length; i += 1) dist[i] /= total
  return dist
}

/**
 * P(current bid is true | this hypothesis hand `counts`) using only this hypothesis hand's own
 * contribution plus an independent-binomial baseline for `unknownDice` other dice. This is the
 * same shape of quantity `evaluateBidDistribution` records as `probabilities.currentBid.atLeast`
 * (src/analytics/gameLog.ts), evaluated from one opponent's hypothesized hand instead of the
 * real decider's hand — reuses the exported `binomialAtLeast` rather than reimplementing it.
 */
export function supportProbability(counts: FaceCounts, bid: Bid, paloFijo: boolean, unknownDice: number): number {
  const own = qualifyingCount(counts, bid.denomination, paloFijo)
  const needed = bid.quantity - own
  const probabilityPerUnknown = paloFijo || bid.denomination === 1 ? 1 / 6 : 2 / 6
  return binomialAtLeast(Math.max(unknownDice, 0), needed, probabilityPerUnknown)
}

/**
 * Updates one opponent's hand posterior after observing them place a bid.
 *
 * Two independent evidence factors are combined (documented judgment call: treated as
 * independent rather than jointly normalized — the fitted tables are coarse bucketed
 * frequencies, "a fitted honest v0, not elegance" per the task brief):
 *   - denomination choice: did they bid a face they hold many/few printed copies of? Applied
 *     only outside Palo Fijo — Palo Fijo's same-denomination-lock legality rule (see
 *     src/engine/rules.ts `isHigherBid`) would bias a table fit on normal rounds, and Model A
 *     is documented as normal-rounds-only per the task brief.
 *   - raise vs challenge: did they raise rather than call dudo/calzo, given how well this
 *     hypothesis hand would have supported the bid they were facing? No-op when this is the
 *     round's opening bid (no prior bid to have supported).
 *
 * `unknownDiceExcludingThisOpponent` = total dice at the table minus this opponent's own k
 * (everyone else's dice, including the eventual decider's, are treated as unknown here — the
 * same independent-binomial treatment the recorded `probabilities.currentBid.atLeast` uses).
 */
export function applyBidObservation(
  posterior: Float64Array,
  k: number,
  paloFijo: boolean,
  observedDenomination: Die,
  priorBid: Bid | null,
  unknownDiceExcludingThisOpponent: number,
  model: LikelihoodModel,
): Float64Array {
  const hands = enumerateHands(k)
  if (hands.length !== posterior.length) throw new Error(`Posterior length ${posterior.length} does not match enumerateHands(${k}) length ${hands.length}`)
  const isAce = observedDenomination === 1
  const table = isAce ? model.denomChoice.ace : model.denomChoice.nonAce
  const out = new Float64Array(posterior.length)

  for (let i = 0; i < hands.length; i += 1) {
    let weight = posterior[i]
    if (!paloFijo) {
      const bucket = bucketCount(printedCount(hands[i].counts, observedDenomination))
      weight *= table.m[bucket]
    }
    if (priorBid) {
      const support = supportProbability(hands[i].counts, priorBid, paloFijo, unknownDiceExcludingThisOpponent)
      const bucket = supportBucket(support)
      weight *= model.raiseVsChallenge.buckets[bucket].bid
    }
    out[i] = weight
  }
  return normalizeInPlace(out)
}

export interface OpponentBelief {
  playerId: string
  k: number
  posterior: Float64Array
}

function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length - 1)
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i]
    if (ai === 0) continue
    for (let j = 0; j < b.length; j += 1) out[i + j] += ai * b[j]
  }
  return out
}

/** Per-opponent pmf over their contributed qualifying-dice count (0..k) for `bid`'s denomination. */
function qualifyingCountDistribution(opponent: OpponentBelief, bid: Bid, paloFijo: boolean): Float64Array {
  const hands = enumerateHands(opponent.k)
  const dist = new Float64Array(opponent.k + 1)
  for (let i = 0; i < hands.length; i += 1) {
    const q = qualifyingCount(hands[i].counts, bid.denomination, paloFijo)
    dist[q] += opponent.posterior[i]
  }
  return dist
}

/**
 * P(bid true) from the decider's perspective: the decider's own hand is fully known (its
 * qualifying-dice contribution is a fixed number), convolved with every other active
 * opponent's posterior count-distribution for the bid's denomination.
 *
 * Identity check (a) (beliefFilter.check.ts): with every opponent posterior left at
 * `initialPosterior` (equivalently: updated only with `uniformLikelihoodModel()`), this must
 * equal `evaluateBidDistribution`'s `atLeast` for the same view — convolving independent
 * Binomial(k_i, p) count-distributions is exactly Binomial(sum k_i, p).
 */
export function beliefBidProbability(
  ownCounts: FaceCounts,
  bid: Bid,
  paloFijo: boolean,
  opponents: readonly OpponentBelief[],
): number {
  const ownQualifying = qualifyingCount(ownCounts, bid.denomination, paloFijo)
  const needed = bid.quantity - ownQualifying
  if (needed <= 0) return 1

  let totalDist: Float64Array = new Float64Array([1])
  for (const opponent of opponents) {
    if (opponent.k === 0) continue
    totalDist = convolve(totalDist, qualifyingCountDistribution(opponent, bid, paloFijo))
  }

  if (needed > totalDist.length - 1) return 0
  let probability = 0
  for (let i = needed; i < totalDist.length; i += 1) probability += totalDist[i]
  return Math.max(0, Math.min(1, probability))
}
