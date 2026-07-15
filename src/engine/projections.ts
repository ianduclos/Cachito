import type { EnginePlayer, GameState, PublicGameView, PublicPlayer } from './types'

function publicPlayer(player: EnginePlayer, revealHand: boolean, includeTableDiceInHand = false): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    diceCount: player.diceCount,
    eliminated: player.diceCount === 0,
    tableDice: [...player.tableDice],
    ...(revealHand ? { hand: includeTableDiceInHand ? [...player.tableDice, ...player.hand] : [...player.hand] } : {}),
  }
}

function baseView(state: GameState, players: PublicPlayer[]): PublicGameView {
  return {
    phase: state.phase,
    round: state.round,
    paloFijo: state.paloFijo,
    rules: { ...state.rules },
    players,
    currentPlayerId: state.currentPlayerId,
    currentBid: state.currentBid ? { ...state.currentBid } : null,
    lastBidderId: state.lastBidderId,
    ...(state.phase === 'reveal' ? { resolution: structuredClone(state.resolution) } : {}),
    ...(state.phase === 'gameOver' ? { winnerId: state.winnerId } : {}),
  }
}

export function projectForPlayer(state: GameState, playerId: string): PublicGameView {
  const viewer = state.players.find((player) => player.id === playerId)
  if (!viewer) {
    throw new Error(`Unknown player: ${playerId}`)
  }
  const revealAll = state.phase === 'reveal'
  const revealViewerHand = state.phase === 'playing' && playerId === viewer.id
    && (!state.paloFijo || !state.rules.paloFijoBlindDice || viewer.diceCount === 1)
  return {
    ...baseView(state, state.players.map((player) => publicPlayer(
      player,
      revealAll || (revealViewerHand && player.id === playerId),
      revealAll,
    ))),
    viewerPlayerId: playerId,
  }
}

/** Spectators never see live hands, but do see all hands while a result is revealed. */
export function projectForSpectator(state: GameState): PublicGameView {
  const revealAll = state.phase === 'reveal'
  return baseView(state, state.players.map((player) => publicPlayer(player, revealAll, revealAll)))
}

/** Testing/admin view that exposes all hands, including while a round is live. */
export function projectForAdminSpectator(state: GameState): PublicGameView {
  return baseView(state, state.players.map((player) => publicPlayer(player, true, true)))
}
