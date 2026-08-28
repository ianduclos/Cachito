// Table-dice ACTIVE reveal policy — the champion's decision about how many private
// qualifying dice to put on the table when it bids.
//
// WHAT THIS REPLACED. Until 2026-08-28 the champion's reveal was a per-persona coin
// flip in ./personaBluff.ts (`random() < tableDiceChance`) with no value calculation
// behind it. Lab measurement across three independent seed blocks found that coin
// flip measurably HARMFUL on the reroll axis — -0.100 to -0.121 expected qualifying
// dice per reveal, CI entirely below zero — because revealing one die sends every
// OTHER matching die back into the reroll. This module prices the decision instead.
// Full record: lab/notes/table-dice-reveal-decision.md.
//
// THE RULE THIS MIRRORS (src/engine): a bidder may reveal k of their private dice,
// where every revealed die must count toward the bid (`countsTowardBid`), at least
// one die must stay private (k <= hand.length - 1), and the mechanic must be legal
// this round (`legalActions.canPutDiceOnTable` — table dice enabled, not blocked by
// Palo Fijo's blind-dice rule, not already used). Revealed dice go public and LOCKED;
// every other private die is REROLLED.
//
// THE TWO AXES, both in units of expected dice:
//
//   rerollGain(k) = E[qualifying dice after revealing k and rerolling the rest]
//                   - qualifying dice held right now.
//   At k = 0 nothing is revealed and nothing is rerolled, so this is exactly 0 by
//   construction (the engine only enters its table-dice branch for k >= 1). For
//   k >= 1 it is closed-form binomial arithmetic, not simulation: each of the
//   (handLength - k) rerolled dice is a fresh die with probability p of counting,
//   and E[Binomial(n, p)] = n*p. `p` is derived by asking the engine's own
//   `countsTowardBid` about all six faces, never hardcoded, so it cannot drift from
//   the ace-wild / Palo Fijo rule it mirrors.
//
//   proofGain(k) = k, always — only qualifying dice may be revealed, so every
//   revealed die is public, locked, un-doubtable progress toward the claim.
//
// THE LEAKAGE TERM — read this before changing it. Both axes RISE with k, so a
// calculator with only those two always wants to show every qualifier, and lab
// exp-015 already priced that behaviour losing ~2.7pp of win share. The missing
// counterweight is information leakage to opponents, which this codebase does not
// derive from anywhere: modelling it needs a "public reveal -> opponent's read of the
// REVEALER'S hand" model, and the only belief machinery here runs the other
// direction (opponents' own hands from their bids). So LEAKAGE_PER_DIE is an
// explicit, undisguised CHOSEN constant — a cost in expected dice charged per die
// revealed — never a measured or derived quantity. Ratified by Ian on legibility,
// not on strength; see the constant's own note.
//
// Consumes no `random` draws: the calculator is pure arithmetic.

import { countsTowardBid, type Bid, type Die } from '../../engine'
import type { BotObservation } from '../types'

/**
 * Cost in expected dice charged per revealed die, standing in for information leakage.
 *
 * CHOSEN, NOT MEASURED. Win share could not decide this value: in seat-balanced
 * 4-player duels every candidate leakage setting was statistically indistinguishable
 * from the shipped champion, including an arm that never reveals at all. The choice
 * was made on legibility, this project's stated bar, and ratified by Ian 2026-08-28.
 *
 * At 1.5 the resulting behaviour is one legible motif rather than a family of them:
 * the bot shows a die essentially only when it holds EXACTLY ONE die of the face it
 * is claiming, and it never shows two. Measured reveal rate 7.96% of legal decisions
 * at +0.906 expected qualifying dice per reveal [+0.8966, +0.9147], replicated on an
 * untouched seed block (7.96% -> 8.31%, +0.9060 -> +0.9116) so the constant is not
 * fitted to the duel that judged it.
 */
export const LEAKAGE_PER_DIE = 1.5

/** One legal reveal count and its priced decomposition. */
export interface RevealValueRow {
  k: number
  handLength: number
  /** Qualifying dice held right now, before any reveal — the baseline both axes measure from. */
  currentQualifiers: number
  /** Dice rerolled by this action: handLength - k. Zero at k = 0 (no table-dice action at all). */
  rerolledDiceCount: number
  /** P(a fresh die counts toward this bid), from the engine's own countsTowardBid. */
  qualifyingProbabilityPerReroll: number
  /** Exactly 0 at k = 0. */
  rerollGain: number
  /** Always equals k. */
  proofGain: number
}

/** P(a single freshly-rerolled die counts toward `bid`), asked of the engine's own rule over all six faces rather than hardcoded. */
export function qualifyingProbability(bid: Bid, paloFijo: boolean): number {
  const faces: readonly Die[] = [1, 2, 3, 4, 5, 6]
  return faces.filter((face) => countsTowardBid(face, bid, paloFijo)).length / 6
}

/** Indices into `hand` of every die that counts toward `bid`, in hand order. Every qualifier is interchangeable under the reveal rule, so hand order is a fixed arbitrary tie-break, not a judgement. */
export function qualifyingIndices(hand: readonly Die[], bid: Bid, paloFijo: boolean): number[] {
  return hand.flatMap((die, index) => (countsTowardBid(die, bid, paloFijo) ? [index] : []))
}

/**
 * Every legal k for this hand and bid, ascending, always including 0 (never touching
 * table dice is legal even when the mechanic itself is unavailable). The ceiling is
 * min(currentQualifiers, handLength - 1) — tighter than "hand.length - 1" whenever
 * the hand does not hold that many qualifiers.
 */
export function legalRevealKs(hand: readonly Die[], bid: Bid, paloFijo: boolean, canPutDiceOnTable: boolean): number[] {
  if (hand.length < 2 || !canPutDiceOnTable) return [0]
  const qualifiers = qualifyingIndices(hand, bid, paloFijo).length
  const kMax = Math.min(qualifiers, hand.length - 1)
  if (kMax < 1) return [0]
  return Array.from({ length: kMax + 1 }, (_, k) => k)
}

/** The priced decomposition for one legal k. */
export function evaluateReveal(hand: readonly Die[], bid: Bid, paloFijo: boolean, k: number): RevealValueRow {
  const currentQualifiers = qualifyingIndices(hand, bid, paloFijo).length
  const rerolledDiceCount = k === 0 ? 0 : hand.length - k
  const p = qualifyingProbability(bid, paloFijo)
  const expectedQualifyingAfter = k === 0 ? currentQualifiers : k + rerolledDiceCount * p
  return {
    k,
    handLength: hand.length,
    currentQualifiers,
    rerolledDiceCount,
    qualifyingProbabilityPerReroll: p,
    rerollGain: k === 0 ? 0 : expectedQualifyingAfter - currentQualifiers,
    proofGain: k,
  }
}

/** Every legal k's row, ascending. */
export function evaluateRevealCurve(hand: readonly Die[], bid: Bid, paloFijo: boolean, canPutDiceOnTable: boolean): RevealValueRow[] {
  return legalRevealKs(hand, bid, paloFijo, canPutDiceOnTable).map((k) => evaluateReveal(hand, bid, paloFijo, k))
}

/** score(k) = rerollGain(k) + proofGain(k) - leakagePerDie * k. Both gains are already in expected dice, so 1:1 is the least-invented way to add them. */
export function revealScore(row: RevealValueRow, leakagePerDie: number): number {
  return row.rerollGain + row.proofGain - leakagePerDie * row.k
}

/** The row `revealScore` ranks highest; ties keep the smallest k (the least committal legal choice). */
export function pickRevealK(curve: readonly RevealValueRow[], leakagePerDie: number): RevealValueRow {
  if (curve.length === 0) throw new RangeError('Cannot pick a best row from an empty curve')
  return curve.reduce((best, row) => (revealScore(row, leakagePerDie) > revealScore(best, leakagePerDie) + 1e-12 ? row : best))
}

/**
 * The whole decision: which private dice (if any) to put on the table alongside `bid`.
 * Returns undefined for "reveal nothing" so the caller can omit `tableDiceIndices`
 * entirely rather than sending an empty array.
 */
export function chooseRevealIndices(
  observation: BotObservation,
  bid: Bid,
  leakagePerDie: number = LEAKAGE_PER_DIE,
): number[] | undefined {
  if (!Number.isFinite(leakagePerDie) || leakagePerDie < 0) {
    throw new RangeError(`leakagePerDie must be a non-negative finite number, got ${leakagePerDie}`)
  }
  const hand = observation.view.players.find((candidate) => candidate.id === observation.playerId)?.hand
  if (!hand) return undefined // no visible private hand (blind Palo Fijo) — nothing to price
  const paloFijo = observation.view.paloFijo
  const curve = evaluateRevealCurve(hand, bid, paloFijo, observation.legalActions.canPutDiceOnTable)
  const best = pickRevealK(curve, leakagePerDie)
  if (best.k === 0) return undefined
  return qualifyingIndices(hand, bid, paloFijo).slice(0, best.k)
}
