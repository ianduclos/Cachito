import {
  applyAction,
  createGame,
  createSeededRandom,
  getLegalActions,
  MAX_PLAYERS,
  projectForPlayer,
  type GameAction,
  type GameState,
  type GameOverState,
  type RandomSource,
} from '../engine'
import { createBotDecisionRecord, createGameLogBuilder, type GameLog } from '../analytics'
import { chooseBotAction, isChoiceLegal } from './policies'
import type { BotChoice, BotObservation, BotPolicy, PublicActionEntry, PublicRoundOutcome } from './types'

export interface BotSeat {
  id: string
  name: string
  policy: BotPolicy
}

export interface MatchOptions {
  seed: number
  maxActions?: number
}

export interface MatchResult {
  winnerId: string
  actions: number
  rounds: number
  history: PublicActionEntry[]
  finalState: GameOverState
  log: GameLog
}

function mixSeed(seed: number, stream: number): number {
  let value = (seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x21f0aaad)
  value ^= value >>> 15
  return value >>> 0
}

export function toGameAction(playerId: string, choice: BotChoice): GameAction {
  if (choice.type === 'bid') return { type: 'bid', playerId, bid: choice.bid, ...(choice.tableDiceIndices?.length ? { tableDiceIndices: [...choice.tableDiceIndices] } : {}) }
  return { type: choice.type, playerId }
}

export function runBotMatch(seats: readonly BotSeat[], options: MatchOptions): MatchResult {
  if (seats.length < 2 || seats.length > MAX_PLAYERS) throw new RangeError(`Bot matches require 2 to ${MAX_PLAYERS} seats`)
  const diceRandom = createSeededRandom(mixSeed(options.seed, 0))
  const policyRandom = new Map<string, RandomSource>(seats.map((seat, index) => [
    seat.id,
    createSeededRandom(mixSeed(options.seed, index + 1)),
  ]))
  const policies = new Map(seats.map((seat) => [seat.id, seat.policy]))
  const history: PublicActionEntry[] = []
  const maxActions = options.maxActions ?? 10_000
  const logBuilder = createGameLogBuilder({
    seed: options.seed,
    seats: seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      controller: 'bot',
      policyName: seat.policy.name,
    })),
  })
  let actions = 0
  let state: GameState = createGame(seats.map(({ id, name }) => ({ id, name })), diceRandom)

  while (state.phase !== 'gameOver') {
    if (actions >= maxActions) throw new Error(`Bot match exceeded ${maxActions} actions`)
    if (state.phase === 'reveal') {
      state = applyAction(state, { type: 'nextRound' }, diceRandom)
      continue
    }

    const playerId = state.currentPlayerId
    const policy = policies.get(playerId)
    const random = policyRandom.get(playerId)
    if (!policy || !random) throw new Error(`No bot policy configured for ${playerId}`)

    const observation: BotObservation = {
      playerId,
      view: projectForPlayer(state, playerId),
      legalActions: getLegalActions(state, playerId),
      history: history.map((entry) => ({ ...entry, action: structuredClone(entry.action) })),
    }
    const { choice, trace } = chooseBotAction(policy, observation, random)
    if (!isChoiceLegal(observation, choice)) {
      throw new Error(`${policy.name} returned an illegal ${choice.type} action for ${playerId}`)
    }

    logBuilder.recordBotDecision(createBotDecisionRecord(observation, policy.name, choice, trace))
    logBuilder.recordPublicAction({ round: state.round, playerId, action: choice })
    state = applyAction(state, toGameAction(playerId, choice), diceRandom)
    const outcome = state.phase === 'reveal' ? publicOutcome(state.resolution) : undefined
    history.push({ round: observation.view.round, playerId, action: structuredClone(choice), outcome })
    if (state.phase === 'reveal') logBuilder.recordRoundResolution(state)
    actions += 1
  }

  return {
    winnerId: state.winnerId,
    actions,
    rounds: state.round,
    history,
    finalState: state,
    log: logBuilder.finalize(state.winnerId),
  }
}

function publicOutcome(resolution: { kind: 'dudo' | 'calzo'; bidderId: string; bid: { quantity: number; denomination: import('../engine').Die }; correct: boolean; actualCount: number }): PublicRoundOutcome {
  return {
    kind: resolution.kind,
    bidderId: resolution.bidderId,
    bid: { ...resolution.bid },
    correct: resolution.correct,
    actualCount: resolution.actualCount,
  }
}

export interface BatchResult {
  matches: number
  wins: Record<string, number>
  averageActions: number
  averageRounds: number
}

export function runBotBatch(seats: readonly BotSeat[], seeds: readonly number[], maxActions?: number): BatchResult {
  const wins = Object.fromEntries(seats.map((seat) => [seat.id, 0]))
  let totalActions = 0
  let totalRounds = 0
  for (const seed of seeds) {
    const result = runBotMatch(seats, { seed, maxActions })
    wins[result.winnerId] += 1
    totalActions += result.actions
    totalRounds += result.rounds
  }
  return {
    matches: seeds.length,
    wins,
    averageActions: seeds.length === 0 ? 0 : totalActions / seeds.length,
    averageRounds: seeds.length === 0 ? 0 : totalRounds / seeds.length,
  }
}

export interface DuelResult {
  matches: number
  candidateWins: number
  opponentWins: number
  candidateWinRate: number
}

/** Runs equal numbers of games with each policy in the opening seat. */
export function runSeatBalancedDuel(
  candidate: BotPolicy,
  opponent: BotPolicy,
  gamesPerSeat: number,
  seed = 1,
): DuelResult {
  if (!Number.isInteger(gamesPerSeat) || gamesPerSeat < 1) {
    throw new RangeError('gamesPerSeat must be a positive integer')
  }
  let candidateWins = 0
  let opponentWins = 0
  for (let orientation = 0; orientation < 2; orientation += 1) {
    for (let game = 0; game < gamesPerSeat; game += 1) {
      const candidateSeat = { id: 'candidate', name: candidate.name, policy: candidate }
      const opponentSeat = { id: 'opponent', name: opponent.name, policy: opponent }
      const seats = orientation === 0
        ? [candidateSeat, opponentSeat]
        : [opponentSeat, candidateSeat]
      const result = runBotMatch(seats, { seed: mixSeed(seed + game, orientation + 20) })
      if (result.winnerId === 'candidate') candidateWins += 1
      else opponentWins += 1
    }
  }
  const matches = gamesPerSeat * 2
  return {
    matches,
    candidateWins,
    opponentWins,
    candidateWinRate: candidateWins / matches,
  }
}
