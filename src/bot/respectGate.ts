// Respect gate, promoted from lab exp-016 after passing its paired duels
// (4p non-inferiority identical to baseline; ~86% of avoided challenges
// would have failed). When the respect read says the current bidder's
// challenged bids keep holding, a MARGINAL Dudo needs extra evidence; if the
// margin is too thin, the bot makes its most supportable raise instead of
// paying to test a proven bidder.
//
// Scope guards, learned from lab exp-015:
// - Overrides ONLY marginal Dudos, only against a `respect`-level bidder, and
//   only when the wrapped policy's own trace exposes how marginal the call
//   was. No trace margin -> no override, ever.
// - Calzo and all bid decisions pass through untouched.
// - Consumes no randomness: the decision is deterministic given the public
//   record, so paired-seed comparisons attribute every changed game to it.
// - Every override is trace-annotated (respectGate note + plain reason)
//   so replays can show exactly why the challenge was withheld.

import { evaluateBidDistribution } from './probability'
import type { BotActionResult, BotObservation, BotPolicy } from './types'
import type { Bid } from '../engine'
import { deriveOpponentRespect, type RespectOptions, type OpponentRespectRead } from './respect'

export interface RespectGateOptions {
  /** Extra probability margin demanded from threshold-shaped Dudo traces. Default 0.08. */
  probabilityMargin?: number
  /** Same, when the bidder shows the exact-hold signature. Default 0.12. */
  signatureProbabilityMargin?: number
  /** Extra equity margin demanded from belief-EV-shaped Dudo traces. Default 0.02. */
  equityMargin?: number
  /** Same, when the bidder shows the exact-hold signature. Default 0.04. */
  signatureEquityMargin?: number
  respect?: RespectOptions
}

interface ThresholdShapedTrace {
  currentBidAnalysis?: { dudoConfidence: number; effectiveDudoThreshold: number }
}

interface BeliefShapedTrace {
  belief?: { dudo?: { evDudo: number; evBestBidApprox: number } }
}

/** The wrapped policy's own slack on this Dudo, in its own units, or undefined. */
function dudoSlack(trace: BotActionResult['trace']): { slack: number; unit: 'probability' | 'equity' } | undefined {
  const belief = (trace as BeliefShapedTrace | undefined)?.belief?.dudo
  if (belief) return { slack: belief.evDudo - belief.evBestBidApprox, unit: 'equity' }
  const analysis = (trace as ThresholdShapedTrace | undefined)?.currentBidAnalysis
  if (analysis) return { slack: analysis.dudoConfidence - analysis.effectiveDudoThreshold, unit: 'probability' }
  return undefined
}

/** Most supportable legal raise; cheapest wins ties. Undefined when no bid is legal. */
function safestRaise(observation: BotObservation): Bid | undefined {
  let best: { bid: Bid; atLeast: number } | undefined
  for (const bid of observation.legalActions.bids) {
    const atLeast = evaluateBidDistribution(observation.view, observation.playerId, bid).atLeast
    if (!best || atLeast > best.atLeast + 1e-12) best = { bid, atLeast }
  }
  return best?.bid
}

export interface RespectGateDecisionNote {
  bidderId: string
  read: Pick<OpponentRespectRead, 'level' | 'heldBids' | 'revealedFinalBids' | 'exactHolds' | 'exactHoldSignature'>
  slack: number
  slackUnit: 'probability' | 'equity'
  requiredSlack: number
  overrode: boolean
}

export function createRespectGatedPolicy(base: BotPolicy, options: RespectGateOptions = {}): BotPolicy {
  const probabilityMargin = options.probabilityMargin ?? 0.08
  const signatureProbabilityMargin = options.signatureProbabilityMargin ?? 0.12
  const equityMargin = options.equityMargin ?? 0.02
  const signatureEquityMargin = options.signatureEquityMargin ?? 0.04

  const decide = (observation: BotObservation, random: Parameters<BotPolicy['chooseAction']>[1]): BotActionResult => {
    const result: BotActionResult = base.chooseActionWithTrace?.(observation, random) ?? {
      choice: base.chooseAction(observation, random),
    }
    if (result.choice.type !== 'dudo') return result
    const bidderId = observation.view.lastBidderId
    if (!bidderId) return result
    const read = deriveOpponentRespect(observation, options.respect).opponents
      .find((opponent) => opponent.playerId === bidderId)
    if (!read || read.level !== 'respect') return result
    const slack = dudoSlack(result.trace)
    if (!slack) return result
    const requiredSlack = slack.unit === 'probability'
      ? read.exactHoldSignature ? signatureProbabilityMargin : probabilityMargin
      : read.exactHoldSignature ? signatureEquityMargin : equityMargin
    const note: RespectGateDecisionNote = {
      bidderId,
      read: {
        level: read.level,
        heldBids: read.heldBids,
        revealedFinalBids: read.revealedFinalBids,
        exactHolds: read.exactHolds,
        exactHoldSignature: read.exactHoldSignature,
      },
      slack: slack.slack,
      slackUnit: slack.unit,
      requiredSlack,
      overrode: false,
    }
    const trace = result.trace
    if (slack.slack >= requiredSlack) {
      if (trace) (trace as { respectGate?: RespectGateDecisionNote }).respectGate = note
      return result
    }
    const raise = safestRaise(observation)
    if (!raise) return result
    note.overrode = true
    if (trace) {
      const annotated = trace as { respectGate?: RespectGateDecisionNote; plainReason?: string; settings?: Record<string, number> }
      annotated.respectGate = note
      annotated.plainReason = `${read.explanation} It raised instead of paying to test them again.`
      annotated.settings = { ...(annotated.settings ?? {}), respectGateOverride: 1 }
    }
    return { choice: { type: 'bid', bid: { ...raise } }, ...(trace ? { trace } : {}) }
  }

  return {
    name: `${base.name} + respect gate`,
    chooseAction(observation, random) {
      return decide(observation, random).choice
    },
    chooseActionWithTrace: decide,
  }
}
