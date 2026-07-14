import type { Bid, Die, RandomSource } from '../engine'
import { evaluateBidDistribution } from './probability'
import { adjustSupportForOpponent, buildOpponentProfile } from './opponentModel'
import type {
  BotActionResult,
  BotActionValueTrace,
  BotCandidateTrace,
  BotChoice,
  BotDecisionTrace,
  BotObservation,
  BotPolicy,
} from './types'

function pickWithRoll<T>(items: readonly T[], random: RandomSource): { item: T; roll: number; index: number } {
  if (items.length === 0) throw new Error('Cannot choose from an empty list')
  const roll = random()
  const index = Math.min(items.length - 1, Math.floor(roll * items.length))
  return { item: items[index], roll, index }
}

function sameBid(left: Bid, right: Bid): boolean {
  return left.quantity === right.quantity && left.denomination === right.denomination
}

export const randomLegalPolicy: BotPolicy = {
  name: 'Random legal',
  chooseAction(observation, random) {
    return chooseRandomLegal(observation, random).choice
  },
  chooseActionWithTrace(observation, random) {
    return chooseRandomLegal(observation, random)
  },
}

function chooseRandomLegal(observation: BotObservation, random: RandomSource): BotActionResult {
    const choices: BotChoice[] = observation.legalActions.bids.map((bid) => ({ type: 'bid', bid }))
    if (observation.legalActions.canDudo) choices.push({ type: 'dudo' })
    if (observation.legalActions.canCalzo) choices.push({ type: 'calzo' })
    const selected = pickWithRoll(choices, random)
    return {
      choice: selected.item,
      trace: {
        model: 'random-legal', version: 1, decisionReason: 'random_legal',
        candidateCount: choices.length, consideredCandidates: [],
        random: {
          actionRoll: selected.roll,
          selectedIndex: selected.index,
          selectionPoolSize: choices.length,
        },
      },
    }
}

export interface ProbabilityPolicyOptions {
  name?: string
  dudoThreshold?: number
  calzoThreshold?: number
  targetBidConfidence?: number
  bluffRate?: number
  nearEqualWindow?: number
}

/**
 * A privacy-safe baseline: exact independent-dice probabilities with simple
 * life-aware challenge thresholds, plus a conservative public-outcome model.
 */
export function createProbabilityPolicy(options: ProbabilityPolicyOptions = {}): BotPolicy {
  const policyName = options.name ?? 'Probability heuristic'
  const settings = {
    dudoThreshold: options.dudoThreshold ?? 0.52,
    calzoThreshold: options.calzoThreshold ?? 0.72,
    targetBidConfidence: options.targetBidConfidence ?? 0.62,
    bluffRate: options.bluffRate ?? 0.06,
    nearEqualWindow: options.nearEqualWindow ?? 0.025,
  }

  const decide = (observation: BotObservation, random: RandomSource): BotActionResult => {
      const { view, playerId, legalActions } = observation
      const player = view.players.find((candidate) => candidate.id === playerId)
      if (!player) throw new Error(`Unknown player: ${playerId}`)
      const trace: BotDecisionTrace = {
        model: 'probability-heuristic',
        version: 1,
        settings: { ...settings },
        decisionReason: 'forced_fallback',
        candidateCount: legalActions.bids.length,
        consideredCandidates: [],
        random: {},
      }

      let actionValues: BotActionValueTrace[] = []
      let dudoValue: number | undefined
      let calzoValue: number | undefined
      let hasOpponentEvidence = false

      if (view.currentBid) {
        const current = evaluateBidDistribution(view, playerId, view.currentBid)
        const bidderId = view.lastBidderId
        const opponent = bidderId && bidderId !== playerId
          ? buildOpponentProfile(observation.history, bidderId)
          : undefined
        hasOpponentEvidence = (opponent?.evidence ?? 0) > 0
        const adjustedSupport = opponent
          ? adjustSupportForOpponent(current.atLeast, opponent)
          : current.atLeast
        const dudoConfidence = 1 - adjustedSupport
        const lifeCaution = player.diceCount === 1 ? 0.14 : player.diceCount === 2 ? 0.06 : 0
        const leaderAdjustment = player.diceCount >= Math.max(...view.players.map((candidate) => candidate.diceCount)) ? -0.03 : 0
        const effectiveDudoThreshold = settings.dudoThreshold + lifeCaution + leaderAdjustment
        const effectiveCalzoThreshold = settings.calzoThreshold + (player.diceCount <= 2 ? 0.1 : 0)
        trace.currentBidAnalysis = {
          supportProbability: current.atLeast,
          exactProbability: current.exact,
          dudoConfidence,
          effectiveDudoThreshold,
          effectiveCalzoThreshold,
          ...(opponent ? {
            opponentAdjustedSupportProbability: adjustedSupport,
            opponentEvidence: opponent.evidence,
            opponentReliability: opponent.reliability,
          } : {}),
        }

        if (legalActions.canDudo) {
          dudoValue = expectedDudoValue(
            adjustedSupport,
            player.diceCount,
            bidderId ? view.players.find((candidate) => candidate.id === bidderId)?.diceCount : undefined,
            settings.dudoThreshold,
          )
          actionValues.push({ action: 'dudo', expectedValue: dudoValue })
        }
        if (legalActions.canCalzo) {
          calzoValue = expectedCalzoValue(current.exact, player.diceCount, settings.calzoThreshold)
          actionValues.push({ action: 'calzo', expectedValue: calzoValue })
        }
      }

      if (legalActions.bids.length === 0) {
        trace.decisionReason = 'forced_fallback'
        if (legalActions.canDudo) return { choice: { type: 'dudo' }, trace }
        if (legalActions.canCalzo) return { choice: { type: 'calzo' }, trace }
        throw new Error('Bot has no legal action')
      }

      const scored = legalActions.bids.map((bid) => {
        const distribution = evaluateBidDistribution(view, playerId, bid)
        const confidenceDistance = Math.abs(distribution.atLeast - settings.targetBidConfidence)
        const quantityPenalty = bid.quantity / 10_000
        const visiblePreference = denominationPreference(player.hand, bid.denomination, view.paloFijo)
        const score = -confidenceDistance - quantityPenalty + visiblePreference
        const expectedValue = expectedBidValue(distribution.atLeast, quantityPenalty, visiblePreference, confidenceDistance)
        return { bid, distribution, confidence: distribution.atLeast, score, expectedValue, confidenceDistance, quantityPenalty, visiblePreference }
      }).sort((left, right) => right.expectedValue - left.expectedValue || right.score - left.score)

      const toTrace = (candidate: typeof scored[number]): BotCandidateTrace => ({
        bid: { ...candidate.bid },
        supportProbability: candidate.distribution.atLeast,
        exactProbability: candidate.distribution.exact,
        score: candidate.score,
        scoreComponents: {
          confidenceDistance: candidate.confidenceDistance,
          quantityPenalty: candidate.quantityPenalty,
          visiblePreference: candidate.visiblePreference,
        },
      })
      trace.consideredCandidates = scored.slice(0, 8).map(toTrace)
      const bestBid = scored.reduce((best, candidate) => candidate.expectedValue > best.expectedValue ? candidate : best)
      actionValues = [...actionValues, { action: 'bid', bid: { ...bestBid.bid }, expectedValue: bestBid.expectedValue }]
      trace.actionValues = actionValues

      const bestImmediate = [
        dudoValue === undefined ? undefined : { type: 'dudo' as const, value: dudoValue },
        calzoValue === undefined ? undefined : { type: 'calzo' as const, value: calzoValue },
      ].filter((candidate): candidate is { type: 'dudo' | 'calzo'; value: number } => candidate !== undefined)
        .sort((left, right) => right.value - left.value)[0]
      if (bestImmediate && bestImmediate.value > bestBid.expectedValue) {
        trace.decisionReason = bestImmediate.type === 'dudo'
          ? (hasOpponentEvidence ? 'opponent_model_dudo' : 'dudo_threshold')
          : 'calzo_threshold'
        return { choice: { type: bestImmediate.type }, trace }
      }
      const bestValue = scored[0].expectedValue
      const nearEqual = scored.filter((candidate) => candidate.expectedValue >= bestValue - settings.nearEqualWindow).slice(0, 8)
      const actionRoll = random()
      trace.random.actionRoll = actionRoll
      let pool = nearEqual
      if (actionRoll < settings.bluffRate) {
        const plausibleBluffs = scored.filter((candidate) => candidate.confidence >= 0.25 && candidate.confidence < settings.targetBidConfidence).slice(0, 6)
        if (plausibleBluffs.length > 0) {
          pool = plausibleBluffs
          trace.decisionReason = 'controlled_bluff'
        } else {
          trace.decisionReason = 'supported_bid'
        }
      } else {
        trace.decisionReason = 'supported_bid'
      }
      const selected = pickWithRoll(pool, random)
      trace.random.selectionRoll = selected.roll
      trace.random.selectedIndex = selected.index
      trace.random.selectionPoolSize = pool.length
      trace.selectedCandidate = {
        rank: scored.indexOf(selected.item) + 1,
        score: selected.item.score,
      }
      return { choice: { type: 'bid', bid: selected.item.bid }, trace }
  }

  return {
    name: policyName,
    chooseAction(observation, random) {
      return decide(observation, random).choice
    },
    chooseActionWithTrace(observation, random) {
      return decide(observation, random)
    },
  }
}

/** Expected dice change from challenging a bid: opponent loses one when false, caller loses one when true. */
function expectedDudoValue(supportProbability: number, callerDice: number, bidderDice: number | undefined, riskPreference: number): number {
  const callerLoss = callerDice === 1 ? 1.5 : callerDice === 2 ? 1.2 : 1
  const bidderLoss = bidderDice === 1 ? 1.35 : 1
  return (1 - supportProbability) * bidderLoss - supportProbability * callerLoss - riskCost(riskPreference)
}

/** Exact Calzo gains one die, while a wrong call loses two; a full hand cannot gain another die. */
function expectedCalzoValue(exactProbability: number, callerDice: number, riskPreference: number): number {
  const gain = callerDice < 5 ? 1 : 0
  const loss = callerDice <= 2 ? 2.5 : 2
  return exactProbability * gain - (1 - exactProbability) * loss - riskCost(riskPreference)
}

/**
 * One-turn proxy for a raise. A bid does not resolve immediately, so its value
 * reflects its chance to be true, tempered by how far it pushes the table.
 */
function expectedBidValue(supportProbability: number, quantityPenalty: number, visiblePreference: number, confidenceDistance: number): number {
  return supportProbability * 0.28 - (1 - supportProbability) * 0.16 - quantityPenalty + visiblePreference - confidenceDistance * 0.04
}

/** Converts the learned threshold into a small risk premium instead of a hard cut-off. */
function riskCost(preference: number): number {
  return (preference - 0.5) * 0.25
}

/** Executes newer trace-aware policies while retaining legacy policy compatibility. */
export function chooseBotAction(
  policy: BotPolicy,
  observation: BotObservation,
  random: RandomSource,
): BotActionResult {
  return policy.chooseActionWithTrace?.(observation, random) ?? {
    choice: policy.chooseAction(observation, random),
  }
}

function denominationPreference(hand: Die[] | undefined, denomination: Die, paloFijo: boolean): number {
  if (!hand) return 0
  const matches = hand.filter((die) => die === denomination || (!paloFijo && denomination !== 1 && die === 1)).length
  return matches * 0.008
}

export function isChoiceLegal(observation: BotObservation, choice: BotChoice): boolean {
  if (choice.type === 'dudo') return observation.legalActions.canDudo
  if (choice.type === 'calzo') return observation.legalActions.canCalzo
  return observation.legalActions.bids.some((bid) => sameBid(bid, choice.bid))
}
