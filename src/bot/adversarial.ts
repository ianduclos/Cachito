import type { Bid, Die } from '../engine'
import type { GameLog, LoggedRoundResolution } from '../analytics'
import { createProbabilityPolicy } from './policies'
import { runBotMatch, type BotSeat } from './simulator'
import type { BotPolicy } from './types'

export interface AdversarialTournamentOptions {
  games: number
  seed?: number
  playerCounts?: readonly number[]
  policies?: readonly BotPolicy[]
}

export interface ChallengeStats {
  attempts: number
  correct: number
  accuracy: number | null
}

export interface CalibrationStats {
  samples: number
  brierScore: number | null
  meanPrediction: number | null
  observedRate: number | null
}

export interface PolicyTournamentStats {
  appearances: number
  wins: number
  winRate: number
  fairShareWins: number
  performanceRatio: number
  decisions: number
  actionMix: { bid: number; dudo: number; calzo: number }
  dudo: ChallengeStats
  calzo: ChallengeStats
  bidCalibration: CalibrationStats
  decisionReasons: Record<string, number>
  byPlayerCount: Record<string, {
    appearances: number
    wins: number
    winRate: number
    fairShareWins: number
    performanceRatio: number
  }>
}

export interface AdversarialTournamentReport {
  games: number
  seed: number
  gameDistribution: Record<string, number>
  averageActions: number
  averageRounds: number
  policies: Record<string, PolicyTournamentStats>
}

interface PolicyAccumulator {
  appearances: number
  wins: number
  fairShareWins: number
  decisions: number
  actionMix: { bid: number; dudo: number; calzo: number }
  dudo: Omit<ChallengeStats, 'accuracy'>
  calzo: Omit<ChallengeStats, 'accuracy'>
  calibration: { samples: number; squaredError: number; prediction: number; observed: number }
  decisionReasons: Record<string, number>
  byPlayerCount: Record<string, { appearances: number; wins: number; fairShareWins: number }>
}

export function createAdversarialPolicyLeague(): BotPolicy[] {
  return [
    createProbabilityPolicy({ name: 'Baseline' }),
    createProbabilityPolicy({
      name: 'Conservative', dudoThreshold: 0.64, calzoThreshold: 0.82,
      targetBidConfidence: 0.72, bluffRate: 0.01,
    }),
    createProbabilityPolicy({
      name: 'Challenger', dudoThreshold: 0.40, calzoThreshold: 0.78,
      targetBidConfidence: 0.62, bluffRate: 0.03,
    }),
    createProbabilityPolicy({
      name: 'Bluffer', dudoThreshold: 0.52, calzoThreshold: 0.72,
      targetBidConfidence: 0.50, bluffRate: 0.22,
    }),
    createProbabilityPolicy({
      name: 'Exact seeker', dudoThreshold: 0.52, calzoThreshold: 0.52,
      targetBidConfidence: 0.62, bluffRate: 0.06,
    }),
    createProbabilityPolicy({
      name: 'Survivalist', dudoThreshold: 0.60, calzoThreshold: 0.88,
      targetBidConfidence: 0.68, bluffRate: 0, nearEqualWindow: 0.015,
    }),
  ]
}

export function runAdversarialTournament(options: AdversarialTournamentOptions): AdversarialTournamentReport {
  if (!Number.isInteger(options.games) || options.games < 1) throw new RangeError('games must be positive')
  const seed = options.seed ?? 0xca71_2026
  const playerCounts = [...(options.playerCounts ?? [2, 4, 6])]
  if (playerCounts.length === 0 || playerCounts.some((count) => !Number.isInteger(count) || count < 2 || count > 6)) {
    throw new RangeError('playerCounts must contain values from 2 to 6')
  }
  const policies = [...(options.policies ?? createAdversarialPolicyLeague())]
  if (policies.length < Math.max(...playerCounts)) throw new RangeError('Not enough distinct policies for the largest table')
  if (new Set(policies.map((policy) => policy.name)).size !== policies.length) {
    throw new Error('Tournament policy names must be unique')
  }

  const accumulators = Object.fromEntries(policies.map((policy) => [policy.name, emptyAccumulator()]))
  const gameDistribution = distributeGames(options.games, playerCounts)
  let totalActions = 0
  let totalRounds = 0
  let globalGame = 0

  for (const playerCount of playerCounts) {
    const count = gameDistribution[String(playerCount)]
    for (let localGame = 0; localGame < count; localGame += 1) {
      const selected = selectPolicies(policies, playerCount, localGame)
      const seats: BotSeat[] = selected.map((policy, index) => ({
        id: `seat-${index + 1}`,
        name: policy.name,
        policy,
      }))
      const result = runBotMatch(seats, { seed: mixTournamentSeed(seed, globalGame) })
      totalActions += result.actions
      totalRounds += result.rounds
      recordMatch(accumulators, seats, result.log, result.winnerId, playerCount)
      globalGame += 1
    }
  }

  return {
    games: options.games,
    seed,
    gameDistribution,
    averageActions: totalActions / options.games,
    averageRounds: totalRounds / options.games,
    policies: Object.fromEntries(Object.entries(accumulators).map(([name, accumulator]) => [
      name,
      finalizePolicy(accumulator),
    ])),
  }
}

function emptyAccumulator(): PolicyAccumulator {
  return {
    appearances: 0, wins: 0, fairShareWins: 0, decisions: 0,
    actionMix: { bid: 0, dudo: 0, calzo: 0 },
    dudo: { attempts: 0, correct: 0 },
    calzo: { attempts: 0, correct: 0 },
    calibration: { samples: 0, squaredError: 0, prediction: 0, observed: 0 },
    decisionReasons: {}, byPlayerCount: {},
  }
}

function distributeGames(games: number, playerCounts: readonly number[]): Record<string, number> {
  const base = Math.floor(games / playerCounts.length)
  const remainder = games % playerCounts.length
  return Object.fromEntries(playerCounts.map((count, index) => [String(count), base + (index < remainder ? 1 : 0)]))
}

function selectPolicies(policies: readonly BotPolicy[], count: number, game: number): BotPolicy[] {
  if (count === policies.length) {
    return Array.from({ length: count }, (_, index) => policies[(index + game) % policies.length])
  }
  const combinations = choose(policies, count)
  const combination = combinations[game % combinations.length]
  const rotation = Math.floor(game / combinations.length) % count
  return Array.from({ length: count }, (_, index) => combination[(index + rotation) % count])
}

function choose<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === size) {
      result.push([...chosen])
      return
    }
    for (let index = start; index <= values.length - (size - chosen.length); index += 1) {
      chosen.push(values[index])
      visit(index + 1, chosen)
      chosen.pop()
    }
  }
  visit(0, [])
  return result
}

function mixTournamentSeed(seed: number, game: number): number {
  let value = (seed ^ Math.imul(game + 1, 0x9e37_79b1)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x21f0_aaad)
  value ^= value >>> 15
  return value >>> 0
}

function recordMatch(
  accumulators: Record<string, PolicyAccumulator>,
  seats: readonly BotSeat[],
  log: GameLog,
  winnerId: string,
  playerCount: number,
): void {
  const policyByPlayer = new Map(seats.map((seat) => [seat.id, seat.policy.name]))
  const winnerPolicy = policyByPlayer.get(winnerId)
  for (const seat of seats) {
    const accumulator = accumulators[seat.policy.name]
    const split = accumulator.byPlayerCount[String(playerCount)] ??= { appearances: 0, wins: 0, fairShareWins: 0 }
    accumulator.appearances += 1
    accumulator.fairShareWins += 1 / playerCount
    split.appearances += 1
    split.fairShareWins += 1 / playerCount
    if (seat.policy.name === winnerPolicy) {
      accumulator.wins += 1
      split.wins += 1
    }
  }

  const resolutions = new Map(log.roundResolutions.map((resolution) => [resolution.round, resolution]))
  for (const decision of log.botDecisions) {
    const accumulator = accumulators[decision.policyName]
    if (!accumulator) continue
    accumulator.decisions += 1
    const type = decision.chosenAction.type
    accumulator.actionMix[type] += 1
    const reason = decision.trace?.decisionReason ?? 'untraced'
    accumulator.decisionReasons[reason] = (accumulator.decisionReasons[reason] ?? 0) + 1

    if (type === 'dudo' || type === 'calzo') {
      const resolution = resolutions.get(decision.round)?.resolution
      if (resolution?.kind === type && resolution.callerId === decision.playerId) {
        accumulator[type].attempts += 1
        if (resolution.correct) accumulator[type].correct += 1
      }
    }
    if (type === 'bid') recordBidCalibration(accumulator, decision.chosenAction.bid, decision, resolutions.get(decision.round))
  }
}

function recordBidCalibration(
  accumulator: PolicyAccumulator,
  bid: Bid,
  decision: GameLog['botDecisions'][number],
  resolution: LoggedRoundResolution | undefined,
): void {
  const prediction = decision.probabilities.chosenBid?.atLeast
  if (typeof prediction !== 'number' || !resolution) return
  const actual = countBid(resolution.revealedHands.flatMap((hand) => hand.dice), bid, decision.paloFijo)
  const observed = actual >= bid.quantity ? 1 : 0
  accumulator.calibration.samples += 1
  accumulator.calibration.squaredError += (prediction - observed) ** 2
  accumulator.calibration.prediction += prediction
  accumulator.calibration.observed += observed
}

function countBid(dice: readonly Die[], bid: Bid, paloFijo: boolean): number {
  return dice.filter((die) => die === bid.denomination || (!paloFijo && bid.denomination !== 1 && die === 1)).length
}

function finalizeChallenge(value: Omit<ChallengeStats, 'accuracy'>): ChallengeStats {
  return { ...value, accuracy: value.attempts === 0 ? null : value.correct / value.attempts }
}

function finalizeCalibration(value: PolicyAccumulator['calibration']): CalibrationStats {
  if (value.samples === 0) return { samples: 0, brierScore: null, meanPrediction: null, observedRate: null }
  return {
    samples: value.samples,
    brierScore: value.squaredError / value.samples,
    meanPrediction: value.prediction / value.samples,
    observedRate: value.observed / value.samples,
  }
}

function finalizePolicy(value: PolicyAccumulator): PolicyTournamentStats {
  return {
    appearances: value.appearances,
    wins: value.wins,
    winRate: value.wins / value.appearances,
    fairShareWins: value.fairShareWins,
    performanceRatio: value.wins / value.fairShareWins,
    decisions: value.decisions,
    actionMix: { ...value.actionMix },
    dudo: finalizeChallenge(value.dudo),
    calzo: finalizeChallenge(value.calzo),
    bidCalibration: finalizeCalibration(value.calibration),
    decisionReasons: { ...value.decisionReasons },
    byPlayerCount: Object.fromEntries(Object.entries(value.byPlayerCount).map(([count, split]) => [count, {
      ...split,
      winRate: split.wins / split.appearances,
      performanceRatio: split.wins / split.fairShareWins,
    }])),
  }
}

