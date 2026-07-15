import type {
  Bid,
  LegalActions,
  PublicGameView,
  RandomSource,
} from '../engine'

export type BotChoice =
  | { type: 'bid'; bid: Bid; tableDiceIndices?: number[] }
  | { type: 'dudo' }
  | { type: 'calzo' }

/** Information revealed to every player after a challenged bid. */
export interface PublicRoundOutcome {
  kind: 'dudo' | 'calzo'
  bidderId: string
  bid: Bid
  /** Whether the bid met the challenged condition. */
  correct: boolean
}

export interface PublicActionEntry {
  round: number
  playerId: string
  action: BotChoice
  /** Present only after the round has been publicly revealed. */
  outcome?: PublicRoundOutcome
}

/** The complete and deliberately restricted input available to a bot. */
export interface BotObservation {
  playerId: string
  view: PublicGameView
  legalActions: LegalActions
  history: readonly PublicActionEntry[]
}

export type BotDecisionReason =
  | 'calzo_threshold'
  | 'dudo_threshold'
  | 'opponent_model_dudo'
  | 'supported_bid'
  | 'controlled_bluff'
  | 'table_dice_pressure'
  | 'forced_fallback'
  | 'random_legal'

export interface BotCandidateTrace {
  bid: Bid
  supportProbability: number
  exactProbability: number
  score: number
  scoreComponents: {
    confidenceDistance: number
    quantityPenalty: number
    visiblePreference: number
  }
}

/** Immediate expected values considered alongside the best legal raise. */
export interface BotActionValueTrace {
  action: 'dudo' | 'calzo' | 'bid'
  expectedValue: number
  /** Included for bid actions only. */
  bid?: Bid
}

export interface BotDecisionTrace {
  model: string
  version: number
  settings?: Record<string, number>
  decisionReason: BotDecisionReason
  currentBidAnalysis?: {
    supportProbability: number
    exactProbability: number
    dudoConfidence: number
    effectiveDudoThreshold: number
    effectiveCalzoThreshold: number
    opponentAdjustedSupportProbability?: number
    opponentEvidence?: number
    opponentReliability?: number
  }
  candidateCount: number
  selectedCandidate?: {
    rank: number
    score: number
  }
  actionValues?: BotActionValueTrace[]
  /** Bounded, score-sorted shortlist. It never contains hidden state. */
  consideredCandidates: BotCandidateTrace[]
  /** Rolls consumed for this choice, but never the generator's internal state. */
  random: {
    posture?: number
    actionRoll?: number
    selectionRoll?: number
    selectedIndex?: number
    selectionPoolSize?: number
  }
}

export interface BotActionResult {
  choice: BotChoice
  trace?: BotDecisionTrace
}

export interface BotPolicy {
  readonly name: string
  chooseAction(observation: BotObservation, random: RandomSource): BotChoice
  chooseActionWithTrace?(observation: BotObservation, random: RandomSource): BotActionResult
}
