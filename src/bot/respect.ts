// Per-opponent supported-bid reliability ("respect") read, promoted from lab
// exp-014/exp-016. Answers exactly one question from public revealed
// outcomes: does this opponent's final bid keep HOLDING when somebody
// challenges it? This was the read missing from the SZ3UX human regression,
// where the bot paid five dice challenging exactly-true bids from one
// opponent. It reads only the public action ladder — never hidden hands or
// controller identity.
//
// Exact-count evidence uses PublicRoundOutcome.actualCount (supplied by the
// live contract since the full-ladder fix); on older histories the
// exact-count fields stay explicitly unavailable — the read never infers a
// margin it was not given.

import type { BotObservation, PublicActionEntry } from './types'

export type RespectLevel = 'unknown' | 'watch' | 'respect'

export interface OpponentRespectRead {
  playerId: string
  /** This opponent's final bids that a challenge publicly revealed. */
  revealedFinalBids: number
  /** Revealed bids that met the challenged condition (the challenge failed). */
  heldBids: number
  bustedBids: number
  /** Recency-weighted revealed-bid mass; old reveals fade toward zero. */
  effectiveRevealedBids: number
  effectiveHeldWeight: number
  /** Unsmoothed lifetime rate, retained for audit/visualization. */
  rawHoldRate: number
  /** Recency-weighted estimate, shrunk toward an uncommitted prior. */
  holdRate: number
  /** 0–1 evidence-volume confidence; not confidence that a label is true. */
  confidence: number
  /** Whether revealed outcomes carried actualCount for margin analysis. */
  exactCountEvidence: 'available' | 'partial' | 'unavailable'
  /** Held bids that were exactly true (margin 0). Requires actualCount. */
  exactHolds: number
  /** Held bids with margin 0 or 1 — bids that looked thin and still held. */
  thinHolds: number
  /**
   * True when this opponent repeatedly landed exactly-true bids — the SZ3UX
   * signature. Requires actualCount on at least the counted outcomes.
   */
  exactHoldSignature: boolean
  level: RespectLevel
  explanation: string
}

export interface RespectOptions {
  /** Public evidence half-life in rounds. Default 4 (matches livingIntent). */
  evidenceHalfLifeRounds?: number
  /** Revealed-bid mass treated as full evidence volume. Default 3. */
  minimumRevealedBids?: number
}

// Entry needs a raw count, a recency-weighted mass, and a smoothed rate.
// There is deliberately NO separate confidence threshold: heldBids and
// effectiveHeldWeight already require evidence volume, and a second volume
// gate kept the read at `watch` through evidence a human would act on
// (see LOG.md exp-014 respect slice). `confidence` stays as telemetry.
const HOLD_PRIOR_RATE = 0.5
const HOLD_PRIOR_WEIGHT = 2
const RESPECT_MIN_HELD_BIDS = 2
const RESPECT_MIN_HELD_WEIGHT = 1.0
const RESPECT_MIN_HOLD_RATE = 0.65
const WATCH_MIN_HELD_BIDS = 1
const EXACT_SIGNATURE_MIN_HOLDS = 2

function recencyWeight(evidenceRound: number, currentRound: number, halfLifeRounds: number): number {
  return 2 ** (-Math.max(0, currentRound - evidenceRound) / halfLifeRounds)
}

function explanationFor(read: Omit<OpponentRespectRead, 'explanation'>, name: string): string {
  if (read.level === 'respect') {
    const exact = read.exactHoldSignature
      ? ` ${read.exactHolds} of them were exactly true — treat their thin-looking bids as priced, not reckless.`
      : ''
    return `${name}'s challenged bids keep holding (${read.heldBids}/${read.revealedFinalBids} revealed). Challenging them needs better evidence than usual.${exact}`
  }
  if (read.level === 'watch') {
    return `${name}'s revealed bids have held ${read.heldBids}/${read.revealedFinalBids} times; not yet enough recent evidence to raise the challenge bar.`
  }
  return `Too little revealed-bid evidence about ${name} to judge how reliable their bids are.`
}

function readOpponent(
  history: readonly PublicActionEntry[],
  playerId: string,
  currentRound: number,
  halfLifeRounds: number,
  minimumRevealedBids: number,
  name: string,
): OpponentRespectRead {
  let revealedFinalBids = 0
  let heldBids = 0
  let bustedBids = 0
  let effectiveRevealedBids = 0
  let effectiveHeldWeight = 0
  let exactHolds = 0
  let thinHolds = 0
  let outcomesWithActualCount = 0
  for (const entry of history) {
    const outcome = entry.outcome
    if (!outcome || outcome.bidderId !== playerId) continue
    // Support semantics: actualCount decides directly when present. Without
    // it, a failed Dudo means the bid held; a correct Calzo means it held
    // exactly; a FAILED Calzo only says the count was not exact — direction
    // unknown — so that reveal is skipped rather than guessed.
    let held: boolean
    if (outcome.actualCount !== undefined) held = outcome.actualCount >= outcome.bid.quantity
    else if (outcome.kind === 'dudo') held = !outcome.correct
    else if (outcome.correct) held = true
    else continue
    revealedFinalBids += 1
    const weight = recencyWeight(entry.round, currentRound, halfLifeRounds)
    effectiveRevealedBids += weight
    if (held) {
      heldBids += 1
      effectiveHeldWeight += weight
    } else {
      bustedBids += 1
    }
    if (outcome.actualCount !== undefined) {
      outcomesWithActualCount += 1
      const margin = outcome.actualCount - outcome.bid.quantity
      if (margin === 0) {
        exactHolds += 1
        thinHolds += 1
      } else if (margin === 1) {
        thinHolds += 1
      }
    }
  }
  const holdRate = (effectiveHeldWeight + HOLD_PRIOR_RATE * HOLD_PRIOR_WEIGHT) /
    (effectiveRevealedBids + HOLD_PRIOR_WEIGHT)
  const confidence = Math.min(1, effectiveRevealedBids / minimumRevealedBids)
  const exactCountEvidence = revealedFinalBids === 0 || outcomesWithActualCount === revealedFinalBids
    ? outcomesWithActualCount > 0 ? 'available' as const : 'unavailable' as const
    : outcomesWithActualCount > 0 ? 'partial' as const : 'unavailable' as const
  const level: RespectLevel =
    heldBids >= RESPECT_MIN_HELD_BIDS &&
    effectiveHeldWeight >= RESPECT_MIN_HELD_WEIGHT &&
    holdRate >= RESPECT_MIN_HOLD_RATE
      ? 'respect'
      : heldBids >= WATCH_MIN_HELD_BIDS ? 'watch' : 'unknown'
  const withoutExplanation = {
    playerId,
    revealedFinalBids,
    heldBids,
    bustedBids,
    effectiveRevealedBids,
    effectiveHeldWeight,
    rawHoldRate: revealedFinalBids > 0 ? heldBids / revealedFinalBids : 0,
    holdRate,
    confidence,
    exactCountEvidence,
    exactHolds,
    thinHolds,
    exactHoldSignature: exactCountEvidence !== 'unavailable' && exactHolds >= EXACT_SIGNATURE_MIN_HOLDS,
    level,
  }
  return { ...withoutExplanation, explanation: explanationFor(withoutExplanation, name) }
}

export interface RespectSignals {
  /** Reads for every active opponent, ordered by seat. */
  opponents: OpponentRespectRead[]
  /** The read for the next active opponent, when one exists. */
  nextOpponent?: OpponentRespectRead
}

function validatedOptions(options: RespectOptions): { halfLife: number; minimumRevealed: number } {
  const halfLife = options.evidenceHalfLifeRounds ?? 4
  const minimumRevealed = options.minimumRevealedBids ?? 3
  if (!Number.isFinite(halfLife) || halfLife <= 0) throw new RangeError('evidenceHalfLifeRounds must be positive')
  if (!Number.isFinite(minimumRevealed) || minimumRevealed <= 0) throw new RangeError('minimumRevealedBids must be positive')
  return { halfLife, minimumRevealed }
}

/** Pure derivation from one observation; safe to call on any decision. */
export function deriveOpponentRespect(
  observation: BotObservation,
  options: RespectOptions = {},
): RespectSignals {
  const { halfLife, minimumRevealed } = validatedOptions(options)
  const players = observation.view.players
  const selfIndex = players.findIndex((player) => player.id === observation.playerId)
  if (selfIndex < 0) throw new Error(`Unknown respect-read player ${observation.playerId}`)
  const active = players.filter((player) =>
    player.id !== observation.playerId && !player.eliminated && player.diceCount > 0)
  const reads = active.map((player) => readOpponent(
    observation.history,
    player.id,
    observation.view.round,
    halfLife,
    minimumRevealed,
    player.name,
  ))
  let nextOpponent: OpponentRespectRead | undefined
  for (let offset = 1; offset < players.length; offset += 1) {
    const candidate = players[(selfIndex + offset) % players.length]
    if (!candidate.eliminated && candidate.diceCount > 0) {
      nextOpponent = reads.find((read) => read.playerId === candidate.id)
      break
    }
  }
  return { opponents: reads, nextOpponent }
}
