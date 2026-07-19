import type { Bid, Die, PublicGameView, PublicPlayer, RandomSource } from '../engine'
import { evaluateBidDistribution, evaluateTableDiceDistribution } from './probability'
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
  tableAggression?: number
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
    tableAggression: options.tableAggression ?? 0.2,
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
      const strategy = strategyContext(view, player, settings)
      trace.random.posture = strategy.posture

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
        const effectiveDudoThreshold = clamp(settings.dudoThreshold + lifeCaution + strategy.dudoCaution, 0.2, 0.88)
        const effectiveCalzoThreshold = clamp(settings.calzoThreshold + (player.diceCount <= 2 ? 0.1 : 0) + strategy.calzoCaution, 0.45, 0.96)
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
            effectiveDudoThreshold,
          )
          actionValues.push({ action: 'dudo', expectedValue: dudoValue })
        }
        if (legalActions.canCalzo) {
          calzoValue = expectedCalzoValue(current.exact, player.diceCount, effectiveCalzoThreshold)
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
        const confidenceDistance = Math.abs(distribution.atLeast - strategy.targetBidConfidence)
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
      if (actionRoll < strategy.bluffRate) {
        const plausibleBluffs = scored.filter((candidate) => candidate.confidence >= strategy.bluffFloor && candidate.confidence < strategy.targetBidConfidence).slice(0, 6)
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
      const tablePlan = trace.decisionReason === 'supported_bid'
        ? tableDicePlan(observation, scored, strategy.targetBidConfidence, strategy.tableAggression)
        : undefined
      if (tablePlan && tablePlan.expectedValue > selected.item.expectedValue + strategy.tableGainRequired) {
        trace.selectedCandidate = { rank: scored.findIndex((candidate) => sameBid(candidate.bid, tablePlan.bid)) + 1, score: tablePlan.score }
        trace.decisionReason = 'table_dice_pressure'
        return { choice: { type: 'bid', bid: tablePlan.bid, tableDiceIndices: tablePlan.tableDiceIndices }, trace }
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * Keeps distinct bot styles, while letting the live table position overrule
 * personality: a trailing bot presses, while a short-stacked leader protects
 * its advantage. The hash is stable, so a bot does not change character mid-game.
 */
function strategyContext(
  view: PublicGameView,
  player: PublicPlayer,
  settings: { targetBidConfidence: number; bluffRate: number; tableAggression: number },
) {
  const activeDice = view.players.filter((candidate) => !candidate.eliminated).map((candidate) => candidate.diceCount)
  const fewestDice = Math.min(...activeDice)
  const trailing = player.diceCount >= fewestDice + 2
  const leading = player.diceCount === fewestDice
  const endgame = player.diceCount <= 2
  const posture = [...player.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 3
  const pressurePersona = posture === 1
  const carefulPersona = posture === 2
  const pressure = (trailing ? 0.22 : 0) + (pressurePersona ? 0.14 : 0) - (leading ? 0.12 : 0) - (endgame ? 0.14 : 0) - (carefulPersona ? 0.08 : 0)
  const targetBidConfidence = clamp(settings.targetBidConfidence - pressure * 0.45, 0.48, 0.76)
  return {
    posture,
    targetBidConfidence,
    bluffRate: clamp(settings.bluffRate + pressure * 0.52, 0.015, 0.22),
    bluffFloor: clamp(targetBidConfidence - (0.26 + Math.max(pressure, 0) * 0.18), 0.23, 0.5),
    tableAggression: clamp(settings.tableAggression + pressure * 1.55, 0, 0.8),
    tableGainRequired: pressure > 0.12 ? 0.006 : 0.025,
    dudoCaution: -pressure * 0.38,
    calzoCaution: leading || endgame ? 0.04 : -Math.max(pressure, 0) * 0.12,
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

function tableDicePlan(
  observation: BotObservation,
  candidates: ReadonlyArray<{ bid: Bid; expectedValue: number; distribution: ReturnType<typeof evaluateBidDistribution>; quantityPenalty: number }>,
  targetBidConfidence: number,
  aggression: number,
): { bid: Bid; tableDiceIndices: number[]; expectedValue: number; score: number } | undefined {
  if (!observation.legalActions.canPutDiceOnTable) return undefined
  const player = observation.view.players.find((candidate) => candidate.id === observation.playerId)
  const hand = player?.hand
  if (!player || !hand || player.diceCount <= 2 || hand.length <= 2) return undefined
  const publicTableDice = observation.view.players.flatMap((candidate) => candidate.tableDice)
  if (publicTableDice.length >= (aggression >= 0.45 ? 7 : 5)) return undefined

  return candidates.flatMap((candidate) => {
    // Minimal reveal (1-2 dice) is deliberate: lab exp-015 duels showed the
    // "all qualifying dice" canonical rule loses ~2.7pp vs this behavior —
    // locking more dice shrinks the reroll and leaks information.
    const qualifying = hand.flatMap((die, index) => die === candidate.bid.denomination || (!observation.view.paloFijo && candidate.bid.denomination !== 1 && die === 1) ? [index] : [])
    if (!qualifying.length) return []
    const revealCount = aggression >= 0.45 && qualifying.length >= 2 && hand.length >= 3 ? 2 : 1
    const tableDiceIndices = qualifying.slice(0, revealCount)
    const afterReroll = evaluateTableDiceDistribution(observation.view, observation.playerId, candidate.bid, tableDiceIndices)
    const exposureCost = 0.045 + publicTableDice.length * 0.012 + (tableDiceIndices.length - 1) * 0.018
    const confidenceDistance = Math.abs(afterReroll.atLeast - targetBidConfidence)
    const expectedValue = expectedBidValue(afterReroll.atLeast, candidate.quantityPenalty, 0, confidenceDistance) - exposureCost
    const minimumSupport = aggression >= 0.45 ? Math.max(0.62, targetBidConfidence + 0.02) : Math.max(0.7, targetBidConfidence + 0.06)
    const minimumImprovement = aggression >= 0.45 ? 0.04 : 0.08
    const minimumValueGain = aggression >= 0.45 ? 0.006 : 0.025
    if (afterReroll.atLeast < minimumSupport) return []
    if (afterReroll.atLeast < candidate.distribution.atLeast + minimumImprovement) return []
    if (expectedValue < candidate.expectedValue + minimumValueGain) return []
    return [{ bid: candidate.bid, tableDiceIndices, expectedValue, score: expectedValue }]
  }).sort((left, right) => right.expectedValue - left.expectedValue)[0]
}

export function isChoiceLegal(observation: BotObservation, choice: BotChoice): boolean {
  if (choice.type === 'dudo') return observation.legalActions.canDudo
  if (choice.type === 'calzo') return observation.legalActions.canCalzo
  if (!observation.legalActions.bids.some((bid) => sameBid(bid, choice.bid))) return false
  const indices = choice.tableDiceIndices
  if (!indices?.length) return true
  const handLength = observation.view.players.find((player) => player.id === observation.playerId)?.hand?.length ?? 0
  return observation.legalActions.canPutDiceOnTable && indices.length < handLength && new Set(indices).size === indices.length && indices.every((index) => Number.isInteger(index) && index >= 0 && index < handLength)
}
