export type Die = 1 | 2 | 3 | 4 | 5 | 6

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 8

export interface PlayerSetup {
  id: string
  name: string
}

export interface GameRules {
  /** Visible time allowed for each turn. */
  turnTimeSeconds: 15 | 30 | 60 | 90
  /** Minimum normal-to-ace conversion: ceil(quantity / 2), optionally plus one. */
  acesConversion: 'half' | 'halfPlusOne'
  /** Each player can trigger one Palo Fijo round on reaching this many dice. */
  paloFijoTrigger: 'oneDie' | 'twoDice'
  /** When enabled, only one-die players may see their own hand during Palo Fijo. */
  paloFijoBlindDice: boolean
  /** Whether the table displays dice counts on player cards. */
  diceAmountsVisible: boolean
  /** Whether a player may put dice on the public table and reroll the rest once per round. */
  tableDiceEnabled: boolean
}

export const DEFAULT_GAME_RULES: Readonly<GameRules> = {
  turnTimeSeconds: 60,
  acesConversion: 'halfPlusOne',
  paloFijoTrigger: 'oneDie',
  paloFijoBlindDice: true,
  diceAmountsVisible: true,
  tableDiceEnabled: true,
}

export interface Bid {
  quantity: number
  denomination: Die
}

export interface EnginePlayer extends PlayerSetup {
  diceCount: number
  /** Private dice. Once table dice are used, this holds only the rerolled remainder. */
  hand: Die[]
  /** Dice publicly put on the table for this round. */
  tableDice: Die[]
  tableDiceUsed: boolean
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
  rules: GameRules
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
  | { type: 'bid'; playerId: string; bid: Bid; tableDiceIndices?: number[] }
  | { type: 'dudo'; playerId: string }
  | { type: 'calzo'; playerId: string }
  | { type: 'nextRound' }

export type RandomSource = () => number

export interface PublicPlayer extends PlayerSetup {
  diceCount: number
  eliminated: boolean
  tableDice: Die[]
  hand?: Die[]
}

export interface PublicGameView {
  phase: GameState['phase']
  round: number
  paloFijo: boolean
  rules: GameRules
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
  canPutDiceOnTable: boolean
}
