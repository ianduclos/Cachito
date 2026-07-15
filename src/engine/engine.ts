import { rollHand } from './random'
import { countBid, isHigherBid, isValidOpeningBid } from './rules'
import { DEFAULT_GAME_RULES } from './types'
import type {
  Bid,
  DiceChange,
  EnginePlayer,
  GameAction,
  GameRules,
  GameState,
  PlayerSetup,
  PlayingState,
  RandomSource,
  RevealState,
  RoundResolution,
} from './types'

export type GameRuleErrorCode =
  | 'INVALID_PLAYERS'
  | 'DUPLICATE_PLAYER'
  | 'WRONG_PHASE'
  | 'OUT_OF_TURN'
  | 'INVALID_BID'
  | 'NO_BID'

export class GameRuleError extends Error {
  constructor(public readonly code: GameRuleErrorCode, message: string) {
    super(message)
    this.name = 'GameRuleError'
  }
}

export function createGame(playerSetups: PlayerSetup[], random: RandomSource = Math.random, rules: GameRules = DEFAULT_GAME_RULES): PlayingState {
  if (playerSetups.length < 2 || playerSetups.length > 6) {
    throw new GameRuleError('INVALID_PLAYERS', 'Cachito requires 2 to 6 players')
  }
  if (new Set(playerSetups.map((player) => player.id)).size !== playerSetups.length) {
    throw new GameRuleError('DUPLICATE_PLAYER', 'Player IDs must be unique')
  }
  if (playerSetups.some((player) => !player.id.trim() || !player.name.trim())) {
    throw new GameRuleError('INVALID_PLAYERS', 'Players must have a non-empty ID and name')
  }

  const players: EnginePlayer[] = playerSetups.map((player) => ({
    ...player,
    diceCount: 5,
    hand: rollHand(5, random),
    tableDice: [],
    tableDiceUsed: false,
    paloFijoTriggered: false,
  }))

  return {
    phase: 'playing',
    players,
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES, ...rules },
    currentPlayerId: players[0].id,
    currentBid: null,
    lastBidderId: null,
  }
}

export function applyAction(state: GameState, action: GameAction, random: RandomSource = Math.random): GameState {
  if (action.type === 'nextRound') return startNextRound(state, random)
  assertPlayingTurn(state, action.playerId)

  switch (action.type) {
    case 'bid':
      return placeBid(state, action.playerId, action.bid, action.tableDiceIndices, random)
    case 'dudo':
      return resolveDudo(state, action.playerId)
    case 'calzo':
      return resolveCalzo(state, action.playerId)
  }
}

function placeBid(state: PlayingState, playerId: string, bid: Bid, tableDiceIndices: number[] | undefined, random: RandomSource): PlayingState {
  const totalDice = state.players.reduce((sum, player) => sum + player.diceCount, 0)
  const player = getPlayer(state.players, playerId)
  const valid = state.currentBid
    ? bid.quantity <= totalDice && isHigherBid(state.currentBid, bid, state.paloFijo, player.diceCount === 1, state.rules.acesConversion)
    : isValidOpeningBid(bid, totalDice)

  if (!valid) throw new GameRuleError('INVALID_BID', 'Bid does not legally raise the current bid')

  if (tableDiceIndices !== undefined && !Array.isArray(tableDiceIndices)) {
    throw new GameRuleError('INVALID_BID', 'The selected table dice are invalid')
  }
  const selectedIndices = tableDiceIndices ?? []
  let players = state.players
  if (selectedIndices.length > 0) {
    if (!state.rules.tableDiceEnabled || state.paloFijo && state.rules.paloFijoBlindDice || player.tableDiceUsed) {
      throw new GameRuleError('INVALID_BID', 'Putting dice on the table is not available right now')
    }
    if (selectedIndices.length >= player.hand.length || new Set(selectedIndices).size !== selectedIndices.length || selectedIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) {
      throw new GameRuleError('INVALID_BID', 'Choose at least one die to show and keep at least one private')
    }
    const selected = selectedIndices.map((index) => player.hand[index])
    const selectedSet = new Set(selectedIndices)
    const remaining = player.hand.filter((_, index) => !selectedSet.has(index))
    const updatedPlayer: EnginePlayer = { ...player, hand: rollHand(remaining.length, random), tableDice: [...player.tableDice, ...selected], tableDiceUsed: true }
    players = replacePlayer(state.players, playerId, updatedPlayer)
  }

  return {
    ...state,
    players,
    currentBid: { ...bid },
    lastBidderId: playerId,
    currentPlayerId: nextActivePlayerId(players, playerId),
  }
}

function resolveDudo(state: PlayingState, callerId: string): RevealState {
  const { bid, bidderId } = requireBid(state)
  const actualCount = countBid(state, bid)
  const correct = actualCount < bid.quantity
  const loserId = correct ? bidderId : callerId
  const { players, change, triggeredPaloFijo } = loseDice(state.players, loserId, 1, 'dudo', state.rules)
  const nextStarterId = activeOrNext(players, loserId)
  return revealState(state, players, {
    kind: 'dudo', callerId, bidderId, bid, actualCount, correct,
    diceChanges: [change], nextStarterId, paloFijoNextRound: triggeredPaloFijo,
  })
}

function resolveCalzo(state: PlayingState, callerId: string): RevealState {
  const { bid, bidderId } = requireBid(state)
  const actualCount = countBid(state, bid)
  const correct = actualCount === bid.quantity
  let players: EnginePlayer[]
  let change: DiceChange
  let triggeredPaloFijo = false

  if (correct) {
    const player = getPlayer(state.players, callerId)
    const after = Math.min(5, player.diceCount + 1)
    players = replacePlayer(state.players, callerId, { ...player, diceCount: after })
    change = { playerId: callerId, before: player.diceCount, after, delta: after - player.diceCount, reason: 'calzo-correct' }
  } else {
    const result = loseDice(state.players, callerId, 2, 'calzo-wrong', state.rules)
    players = result.players
    change = result.change
    triggeredPaloFijo = result.triggeredPaloFijo
  }

  const nextStarterId = activeOrNext(players, callerId)
  return revealState(state, players, {
    kind: 'calzo', callerId, bidderId, bid, actualCount, correct,
    diceChanges: [change], nextStarterId, paloFijoNextRound: triggeredPaloFijo,
  })
}

function revealState(
  state: PlayingState,
  players: EnginePlayer[],
  resolution: RoundResolution,
): RevealState {
  return {
    phase: 'reveal',
    players,
    round: state.round,
    paloFijo: state.paloFijo,
    rules: { ...state.rules },
    currentPlayerId: null,
    currentBid: resolution.bid,
    lastBidderId: resolution.bidderId,
    resolution: { ...resolution },
  }
}

function startNextRound(state: GameState, random: RandomSource): GameState {
  if (state.phase !== 'reveal') {
    throw new GameRuleError('WRONG_PHASE', 'A new round can only begin after a reveal')
  }
  const activePlayers = state.players.filter((player) => player.diceCount > 0)
  if (activePlayers.length === 1) {
    return {
      phase: 'gameOver',
      players: state.players.map((player) => ({ ...player, hand: [], tableDice: [], tableDiceUsed: false })),
      round: state.round,
      paloFijo: false,
      rules: { ...state.rules },
      currentPlayerId: null,
      currentBid: null,
      lastBidderId: null,
      winnerId: activePlayers[0].id,
    }
  }

  return {
    phase: 'playing',
    players: state.players.map((player) => ({
      ...player,
      hand: player.diceCount > 0 ? rollHand(player.diceCount, random) : [],
      tableDice: [],
      tableDiceUsed: false,
    })),
    round: state.round + 1,
    paloFijo: state.resolution.paloFijoNextRound,
    rules: { ...state.rules },
    currentPlayerId: state.resolution.nextStarterId,
    currentBid: null,
    lastBidderId: null,
  }
}

function loseDice(players: EnginePlayer[], playerId: string, amount: number, reason: 'dudo' | 'calzo-wrong', rules: GameRules) {
  const player = getPlayer(players, playerId)
  const after = Math.max(0, player.diceCount - amount)
  const activePlayerCount = players.reduce(
    (count, candidate) => count + (candidate.id === playerId
      ? (after > 0 ? 1 : 0)
      : (candidate.diceCount > 0 ? 1 : 0)),
    0,
  )
  const triggerDiceCount = rules.paloFijoTrigger === 'twoDice' ? 2 : 1
  const triggeredPaloFijo = after === triggerDiceCount && activePlayerCount > 2 && !player.paloFijoTriggered
  const updated = {
    ...player,
    diceCount: after,
    paloFijoTriggered: player.paloFijoTriggered || triggeredPaloFijo,
  }
  return {
    players: replacePlayer(players, playerId, updated),
    change: { playerId, before: player.diceCount, after, delta: after - player.diceCount, reason } as DiceChange,
    triggeredPaloFijo,
  }
}

function assertPlayingTurn(state: GameState, playerId: string): asserts state is PlayingState {
  if (state.phase !== 'playing') throw new GameRuleError('WRONG_PHASE', 'Actions can only be played during an active round')
  if (state.currentPlayerId !== playerId) throw new GameRuleError('OUT_OF_TURN', 'It is not this player\'s turn')
}

function requireBid(state: PlayingState): { bid: Bid; bidderId: string } {
  if (!state.currentBid || !state.lastBidderId) throw new GameRuleError('NO_BID', 'Dudo or calzo requires an existing bid')
  return { bid: state.currentBid, bidderId: state.lastBidderId }
}

function getPlayer(players: EnginePlayer[], playerId: string): EnginePlayer {
  const player = players.find((candidate) => candidate.id === playerId)
  if (!player) throw new GameRuleError('INVALID_PLAYERS', `Unknown player: ${playerId}`)
  return player
}

function replacePlayer(players: EnginePlayer[], playerId: string, replacement: EnginePlayer): EnginePlayer[] {
  return players.map((player) => player.id === playerId ? replacement : player)
}

function nextActivePlayerId(players: EnginePlayer[], fromId: string): string {
  const index = players.findIndex((player) => player.id === fromId)
  for (let step = 1; step <= players.length; step += 1) {
    const candidate = players[(index + step) % players.length]
    if (candidate.diceCount > 0) return candidate.id
  }
  throw new GameRuleError('INVALID_PLAYERS', 'No active player remains')
}

function activeOrNext(players: EnginePlayer[], preferredId: string): string {
  const preferred = getPlayer(players, preferredId)
  return preferred.diceCount > 0 ? preferredId : nextActivePlayerId(players, preferredId)
}
