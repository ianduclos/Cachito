export type Die = 1 | 2 | 3 | 4 | 5 | 6

export interface PlayerSetup {
  id: string
  name: string
}

export interface Bid {
  quantity: number
  denomination: Die
}

export interface EnginePlayer extends PlayerSetup {
  diceCount: number
  hand: Die[]
  /** True once this player has caused their one-time palo-fijo round. */
  paloFijoTriggered: boolean
}

export type DiceChangeReason = 'dudo' | 'calzo-correct' | 'calzo-wrong'

export interface DiceChange {
  playerId: string
  before: number
  after: number
  delta: number
  reason: DiceChangeReason
}

export interface RoundResolution {
  kind: 'dudo' | 'calzo'
  callerId: string
  bidderId: string
  bid: Bid
  actualCount: number
  correct: boolean
  diceChanges: DiceChange[]
  nextStarterId: string
  paloFijoNextRound: boolean
}

interface StateBase {
  players: EnginePlayer[]
  round: number
  paloFijo: boolean
}

export interface PlayingState extends StateBase {
  phase: 'playing'
  currentPlayerId: string
  currentBid: Bid | null
  lastBidderId: string | null
}

export interface RevealState extends StateBase {
  phase: 'reveal'
  currentPlayerId: null
  currentBid: Bid
  lastBidderId: string
  resolution: RoundResolution
}

export interface GameOverState extends StateBase {
  phase: 'gameOver'
  currentPlayerId: null
  currentBid: null
  lastBidderId: null
  winnerId: string
}

export type GameState = PlayingState | RevealState | GameOverState

export type GameAction =
  | { type: 'bid'; playerId: string; bid: Bid }
  | { type: 'dudo'; playerId: string }
  | { type: 'calzo'; playerId: string }
  | { type: 'nextRound' }

export type RandomSource = () => number

export interface PublicPlayer extends PlayerSetup {
  diceCount: number
  eliminated: boolean
  hand?: Die[]
}

export interface PublicGameView {
  phase: GameState['phase']
  round: number
  paloFijo: boolean
  players: PublicPlayer[]
  currentPlayerId: string | null
  currentBid: Bid | null
  lastBidderId: string | null
  resolution?: RoundResolution
  winnerId?: string
  viewerPlayerId?: string
}

export interface LegalActions {
  bids: Bid[]
  canDudo: boolean
  canCalzo: boolean
}
