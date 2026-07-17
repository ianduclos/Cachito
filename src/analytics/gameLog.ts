import type { Bid, Die, RevealState, RoundResolution } from '../engine'
import { evaluateBidDistribution, type BidDistribution } from '../bot/probability'
import type { BotChoice, BotDecisionTrace, BotObservation } from '../bot/types'
import { release } from '../release'

export const GAME_LOG_SCHEMA_VERSION = 1 as const

export interface GameLogSeat {
  id: string
  name: string
  controller: 'human' | 'bot'
  policyName?: string
}

export interface GameLogMetadata {
  seed?: number
  seats: GameLogSeat[]
  /** Optional and caller-supplied so deterministic simulations stay deterministic. */
  startedAt?: string
}

export interface LoggedPublicAction {
  sequence: number
  round: number
  playerId: string
  action: BotChoice
}

export interface RevealedHand {
  playerId: string
  dice: Die[]
}

export interface LoggedRoundResolution {
  round: number
  paloFijo: boolean
  resolution: RoundResolution
  revealedHands: RevealedHand[]
}

export interface ProbabilityDiagnostic extends BidDistribution {
  bid: Bid
}

export interface BotDecisionRecord {
  sequence: number
  policyName: string
  playerId: string
  round: number
  paloFijo: boolean
  ownDiceCount: number
  /** Present only when the bot observation made the hand visible. */
  visibleHand: Die[] | undefined
  publicDiceCounts: Array<{ playerId: string; diceCount: number }>
  currentBid: Bid | null
  historyLength: number
  legalActions: {
    bidCount: number
    canDudo: boolean
    canCalzo: boolean
  }
  chosenAction: BotChoice
  /** Policy-authored, privacy-safe explanation of how the action was selected. */
  trace?: BotDecisionTrace
  probabilities: {
    currentBid?: ProbabilityDiagnostic
    chosenBid?: ProbabilityDiagnostic
  }
}

export interface GameLog {
  schemaVersion: typeof GAME_LOG_SCHEMA_VERSION
  gameVersion: string
  metadata: GameLogMetadata
  publicActions: LoggedPublicAction[]
  roundResolutions: LoggedRoundResolution[]
  botDecisions: BotDecisionRecord[]
  winnerId: string | null
}

export type GameLogMetadataInput = Omit<GameLogMetadata, 'seats'> & {
  seats: readonly GameLogSeat[]
}

export interface GameLogBuilder {
  recordPublicAction(action: Omit<LoggedPublicAction, 'sequence'>): LoggedPublicAction
  recordBotDecision(decision: Omit<BotDecisionRecord, 'sequence'>): BotDecisionRecord
  recordRoundResolution(state: RevealState): LoggedRoundResolution
  finalize(winnerId: string): GameLog
  snapshot(): GameLog
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Creates a privacy-safe diagnostic from the exact observation supplied to a bot. */
export function createBotDecisionRecord(
  observation: BotObservation,
  policyName: string,
  chosenAction: BotChoice,
  trace?: BotDecisionTrace,
): Omit<BotDecisionRecord, 'sequence'> {
  const ownPlayer = observation.view.players.find((player) => player.id === observation.playerId)
  if (!ownPlayer) throw new Error(`Unknown bot player: ${observation.playerId}`)

  const diagnostic = (bid: Bid): ProbabilityDiagnostic => ({
    bid: clone(bid),
    ...evaluateBidDistribution(observation.view, observation.playerId, bid),
  })

  return {
    policyName,
    playerId: observation.playerId,
    round: observation.view.round,
    paloFijo: observation.view.paloFijo,
    ownDiceCount: ownPlayer.diceCount,
    visibleHand: ownPlayer.hand ? [...ownPlayer.hand] : undefined,
    publicDiceCounts: observation.view.players.map((player) => ({
      playerId: player.id,
      diceCount: player.diceCount,
    })),
    currentBid: observation.view.currentBid ? clone(observation.view.currentBid) : null,
    historyLength: observation.history.length,
    legalActions: {
      bidCount: observation.legalActions.bids.length,
      canDudo: observation.legalActions.canDudo,
      canCalzo: observation.legalActions.canCalzo,
    },
    chosenAction: clone(chosenAction),
    ...(trace ? { trace: clone(trace) } : {}),
    probabilities: {
      ...(observation.view.currentBid ? { currentBid: diagnostic(observation.view.currentBid) } : {}),
      ...(chosenAction.type === 'bid' ? { chosenBid: diagnostic(chosenAction.bid) } : {}),
    },
  }
}

export function createGameLogBuilder(metadata: GameLogMetadataInput): GameLogBuilder {
  const log: GameLog = {
    schemaVersion: GAME_LOG_SCHEMA_VERSION,
    gameVersion: release,
    metadata: clone({ ...metadata, seats: metadata.seats.map((seat) => ({ ...seat })) }),
    publicActions: [],
    roundResolutions: [],
    botDecisions: [],
    winnerId: null,
  }
  const resolvedRounds = new Set<number>()

  return {
    recordPublicAction(action) {
      const entry: LoggedPublicAction = clone({ ...action, sequence: log.publicActions.length })
      log.publicActions.push(entry)
      return clone(entry)
    },
    recordBotDecision(decision) {
      const entry: BotDecisionRecord = clone({ ...decision, sequence: log.botDecisions.length })
      log.botDecisions.push(entry)
      return clone(entry)
    },
    recordRoundResolution(state) {
      if (resolvedRounds.has(state.round)) {
        throw new Error(`Round ${state.round} resolution has already been logged`)
      }
      const entry: LoggedRoundResolution = {
        round: state.round,
        paloFijo: state.paloFijo,
        resolution: clone(state.resolution),
        revealedHands: state.players.map((player) => ({
          playerId: player.id,
          dice: [...player.hand],
        })),
      }
      resolvedRounds.add(state.round)
      log.roundResolutions.push(entry)
      return clone(entry)
    },
    finalize(winnerId) {
      log.winnerId = winnerId
      return clone(log)
    },
    snapshot() {
      return clone(log)
    },
  }
}

export function serializeGameLog(log: GameLog, space?: number): string {
  return JSON.stringify(log, null, space)
}
