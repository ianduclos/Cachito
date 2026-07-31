import type { PublicActionEntry } from './types'

export interface OpponentProfile {
  /** Number of previously resolved bids. Kept as a confidence signal, not an identity. */
  evidence: number
  /** Smoothed probability that this player's bids have been true when challenged. */
  reliability: number
}

const PRIOR_TRUE_BIDS = 2
const PRIOR_FALSE_BIDS = 2

/**
 * Estimates bid reliability using only outcomes revealed to the whole table.
 * A balanced Beta prior deliberately keeps sparse histories close to neutral.
 */
export function buildOpponentProfile(history: readonly PublicActionEntry[], playerId: string): OpponentProfile {
  let trueBids = 0
  let falseBids = 0
  for (const entry of history) {
    const outcome = entry.outcome
    if (outcome?.bidderId !== playerId) continue
    // `correct` describes the caller, not the bid. Prefer the publicly
    // announced count whenever present. In legacy histories, a failed Dudo
    // means the bid held and a correct Calzo means it held exactly; a failed
    // Calzo is directionally ambiguous and must not be guessed.
    const held = outcome.actualCount !== undefined
      ? outcome.actualCount >= outcome.bid.quantity
      : outcome.kind === 'dudo'
        ? !outcome.correct
        : outcome.correct
          ? true
          : undefined
    if (held === true) trueBids += 1
    else if (held === false) falseBids += 1
  }
  const evidence = trueBids + falseBids
  return {
    evidence,
    reliability: (trueBids + PRIOR_TRUE_BIDS) / (evidence + PRIOR_TRUE_BIDS + PRIOR_FALSE_BIDS),
  }
}

/**
 * Nudges the independent-dice estimate toward a public, observed tendency.
 * The evidence cap prevents a short game from overwhelming the exact dice math.
 */
export function adjustSupportForOpponent(baseSupport: number, profile: OpponentProfile): number {
  const confidence = Math.min(profile.evidence / 12, 1)
  const adjustment = (profile.reliability - 0.5) * 0.24 * confidence
  return Math.max(0, Math.min(1, baseSupport + adjustment))
}
