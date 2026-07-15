import type { Bid, Die, PublicGameView } from '../engine'

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function binomialPmf(trials: number, successes: number, probability: number): number {
  if (!Number.isInteger(trials) || trials < 0) throw new RangeError('Trials must be a non-negative integer')
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) return 0
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('Probability must be in [0, 1]')
  }
  if (probability === 0) return successes === 0 ? 1 : 0
  if (probability === 1) return successes === trials ? 1 : 0

  let coefficient = 1
  const smallerSide = Math.min(successes, trials - successes)
  for (let index = 1; index <= smallerSide; index += 1) {
    coefficient *= (trials - smallerSide + index) / index
  }
  return coefficient * probability ** successes * (1 - probability) ** (trials - successes)
}

export function binomialAtLeast(trials: number, minimum: number, probability: number): number {
  if (minimum <= 0) return 1
  if (minimum > trials) return 0
  let total = 0
  for (let successes = minimum; successes <= trials; successes += 1) {
    total += binomialPmf(trials, successes, probability)
  }
  return clampProbability(total)
}

export interface BidDistribution {
  knownQualifiers: number
  unknownDice: number
  probabilityPerUnknown: number
  atLeast: number
  exact: number
}

function qualifies(die: Die, denomination: Die, paloFijo: boolean): boolean {
  if (paloFijo || denomination === 1) return die === denomination
  return die === denomination || die === 1
}

/** Computes a bid distribution using only dice present in the supplied player view. */
export function evaluateBidDistribution(view: PublicGameView, playerId: string, bid: Bid): BidDistribution {
  const player = view.players.find((candidate) => candidate.id === playerId)
  if (!player) throw new Error(`Unknown player: ${playerId}`)

  const visibleDice = [...(player.hand ?? []), ...view.players.flatMap((candidate) => candidate.tableDice)]
  const totalDice = view.players.reduce((sum, candidate) => sum + candidate.diceCount, 0)
  const knownQualifiers = visibleDice.filter((die) => qualifies(die, bid.denomination, view.paloFijo)).length
  const unknownDice = totalDice - visibleDice.length
  const probabilityPerUnknown = view.paloFijo || bid.denomination === 1 ? 1 / 6 : 2 / 6
  const unknownNeeded = bid.quantity - knownQualifiers

  return {
    knownQualifiers,
    unknownDice,
    probabilityPerUnknown,
    atLeast: binomialAtLeast(unknownDice, unknownNeeded, probabilityPerUnknown),
    exact: binomialPmf(unknownDice, unknownNeeded, probabilityPerUnknown),
  }
}

/** Estimates a bid after this player puts selected private dice on the table and rerolls the rest. */
export function evaluateTableDiceDistribution(view: PublicGameView, playerId: string, bid: Bid, selectedIndices: readonly number[]): BidDistribution {
  const player = view.players.find((candidate) => candidate.id === playerId)
  if (!player?.hand) throw new Error(`Player ${playerId} has no visible private hand`)
  const selected = selectedIndices.map((index) => player.hand![index]).filter((die): die is Die => die !== undefined)
  const visibleDice = [...view.players.flatMap((candidate) => candidate.tableDice), ...selected]
  const totalDice = view.players.reduce((sum, candidate) => sum + candidate.diceCount, 0)
  const knownQualifiers = visibleDice.filter((die) => qualifies(die, bid.denomination, view.paloFijo)).length
  const unknownDice = totalDice - visibleDice.length
  const probabilityPerUnknown = view.paloFijo || bid.denomination === 1 ? 1 / 6 : 2 / 6
  const unknownNeeded = bid.quantity - knownQualifiers
  return {
    knownQualifiers,
    unknownDice,
    probabilityPerUnknown,
    atLeast: binomialAtLeast(unknownDice, unknownNeeded, probabilityPerUnknown),
    exact: binomialPmf(unknownDice, unknownNeeded, probabilityPerUnknown),
  }
}
