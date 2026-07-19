// Canonical table-dice play: when a bot commits dice to the table, it exposes
// every private die supporting the chosen bid — never an arbitrary theatrical
// subset. Promoted from lab exp-014 after audits showed most shipped partial
// reveals failed a conservative support judgment (lab/LOG.md exp-014).

import type { Bid } from '../engine'
import { evaluateBidDistribution, evaluateTableDiceDistribution, type BidDistribution } from './probability'
import type { BotObservation } from './types'

export type TableDiceRecommendation = 'unavailable' | 'avoid' | 'consider'

export type TableDiceReasonCode =
  | 'canonical_variant_unavailable'
  | 'short_stack'
  | 'negligible_support_gain'
  | 'insufficient_resulting_support'
  | 'material_support_gain'

export interface TableDiceOptions {
  /** Minimum modeled P(bid is supported) improvement. Default 0.04. */
  minSupportGain?: number
  /** Minimum resulting P(bid is supported). Default 0.68. */
  minResultingSupport?: number
  /** At or below this stack size, preserve the private hand. Default 2. */
  shortStackDice?: number
}

export interface TableDiceJudgment {
  bid: Bid
  available: boolean
  recommendation: TableDiceRecommendation
  reasonCode: TableDiceReasonCode
  reason: string
  /** Ordinary bid probability from the player's legal private view. */
  plain: BidDistribution
  /** Present only when the canonical table-dice version exists. */
  table?: BidDistribution
  /** Canonical all-qualifying subset; never an arbitrary theatrical subset. */
  tableDiceIndices?: number[]
  measurable?: {
    supportProbabilityGain: number
    exactProbabilityDelta: number
    knownQualifierDelta: number
    unknownDiceDelta: number
    /** Qualifying private dice made public and locked rather than rerolled. */
    revealedQualifiers: number
    /** Non-qualifying private dice rerolled by the engine after the reveal. */
    rerolledPrivateDice: number
    privateExposureFraction: number
    consumesOncePerRoundUse: true
  }
}

/** Conservative defaults, calibrated so far only against lab shadow matrices. */
export const CANONICAL_TABLE_DICE_DEFAULTS = Object.freeze({
  minSupportGain: 0.04,
  minResultingSupport: 0.68,
  shortStackDice: 2,
})

/**
 * The single legal all-qualifying table-dice subset for a bid, or undefined
 * when none exists: table dice unavailable, no supporting private die, or
 * exposing every supporting die would leave no die private.
 */
export function canonicalTableDiceIndices(observation: BotObservation, bid: Bid): number[] | undefined {
  if (!observation.legalActions.canPutDiceOnTable) return undefined
  const hand = observation.view.players.find((player) => player.id === observation.playerId)?.hand
  if (!hand || hand.length < 2) return undefined
  const indices = hand.flatMap((die, index) => {
    const qualifies = observation.view.paloFijo
      ? die === bid.denomination
      : bid.denomination === 1
        ? die === 1
        : die === bid.denomination || die === 1
    return qualifies ? [index] : []
  })
  if (indices.length === 0 || indices.length >= hand.length) return undefined
  return indices
}

function finiteProbabilityOption(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be in [0, 1]`)
  }
  return value
}

function isSameBid(left: Bid, right: Bid): boolean {
  return left.quantity === right.quantity && left.denomination === right.denomination
}

/**
 * Compares a legal plain bid with its one canonical all-qualifying table-dice
 * variant. Probability calculations are delegated to the shipped probability
 * helpers, which model public dice, the private hand, rerolls, ordinary wild
 * aces, ace bids, and Palo Fijo. This judgment never makes table dice
 * automatic; callers decide whether to act on `consider`.
 */
export function assessCanonicalTableDice(
  observation: BotObservation,
  bid: Bid,
  options: TableDiceOptions = {},
): TableDiceJudgment {
  if (!observation.legalActions.bids.some((legal) => isSameBid(legal, bid))) {
    throw new RangeError(`Table-dice judgment requires a legal bid: ${bid.quantity}x${bid.denomination}`)
  }
  const minSupportGain = finiteProbabilityOption('minSupportGain', options.minSupportGain ?? CANONICAL_TABLE_DICE_DEFAULTS.minSupportGain)
  const minResultingSupport = finiteProbabilityOption('minResultingSupport', options.minResultingSupport ?? CANONICAL_TABLE_DICE_DEFAULTS.minResultingSupport)
  const shortStackDice = options.shortStackDice ?? CANONICAL_TABLE_DICE_DEFAULTS.shortStackDice
  if (!Number.isInteger(shortStackDice) || shortStackDice < 0) {
    throw new RangeError('shortStackDice must be a non-negative integer')
  }

  const plain = evaluateBidDistribution(observation.view, observation.playerId, bid)
  const player = observation.view.players.find((candidate) => candidate.id === observation.playerId)
  if (!player) throw new Error(`Unknown player: ${observation.playerId}`)
  const handLength = player.hand?.length ?? 0
  const indices = canonicalTableDiceIndices(observation, bid)

  if (!indices) {
    return {
      bid: { ...bid },
      available: false,
      recommendation: 'unavailable',
      reasonCode: 'canonical_variant_unavailable',
      reason: observation.legalActions.canPutDiceOnTable
        ? 'No legal all-supporting-dice version exists: there may be no supporting private die, or exposing every one would leave no die private.'
        : 'Putting dice on the table is not available under the current engine state and rules.',
      plain,
    }
  }

  const table = evaluateTableDiceDistribution(observation.view, observation.playerId, bid, indices)
  const measurable = {
    supportProbabilityGain: table.atLeast - plain.atLeast,
    exactProbabilityDelta: table.exact - plain.exact,
    knownQualifierDelta: table.knownQualifiers - plain.knownQualifiers,
    unknownDiceDelta: table.unknownDice - plain.unknownDice,
    revealedQualifiers: indices.length,
    rerolledPrivateDice: handLength - indices.length,
    privateExposureFraction: indices.length / handLength,
    consumesOncePerRoundUse: true as const,
  }

  if (player.diceCount <= shortStackDice) {
    return {
      bid: { ...bid }, available: true, recommendation: 'avoid', reasonCode: 'short_stack',
      reason: `The modeled support change is ${formatPoints(measurable.supportProbabilityGain)}, but with ${player.diceCount} dice the conservative judgment preserves the short stack's private hand.`,
      plain, table, tableDiceIndices: [...indices], measurable,
    }
  }
  if (measurable.supportProbabilityGain < minSupportGain) {
    return {
      bid: { ...bid }, available: true, recommendation: 'avoid', reasonCode: 'negligible_support_gain',
      reason: `The table version changes modeled support by only ${formatPoints(measurable.supportProbabilityGain)}, too little to justify revealing ${indices.length} supporting ${indices.length === 1 ? 'die' : 'dice'} and consuming the once-per-round option.`,
      plain, table, tableDiceIndices: [...indices], measurable,
    }
  }
  if (table.atLeast < minResultingSupport) {
    return {
      bid: { ...bid }, available: true, recommendation: 'avoid', reasonCode: 'insufficient_resulting_support',
      reason: `The reroll improves modeled support by ${formatPoints(measurable.supportProbabilityGain)}, but the resulting ${formatPercent(table.atLeast)} support remains below the conservative bar.`,
      plain, table, tableDiceIndices: [...indices], measurable,
    }
  }
  return {
    bid: { ...bid }, available: true, recommendation: 'consider', reasonCode: 'material_support_gain',
    reason: `Revealing ${indices.length} supporting ${indices.length === 1 ? 'die' : 'dice'} and rerolling ${measurable.rerolledPrivateDice} improves modeled support from ${formatPercent(plain.atLeast)} to ${formatPercent(table.atLeast)}; this is worth considering, not an automatic play.`,
    plain, table, tableDiceIndices: [...indices], measurable,
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatPoints(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)} percentage points`
}
