// lab/bots/personaBluff.ts — exp-012 "persona layer": deliberate, story-consistent bluffing +
// intentional table-dice use, wrapped around Gen 2 (Belief Equity, ./beliefEquity.ts, the
// champion). See lab/notes/bluffing.md for the design hypothesis this implements ("scary smart"
// bluffing is conditional: cheap moments, targeted faces, rare, post-hoc legible) and lab/LOG.md
// exp-012 for the non-inferiority gate result this file was built against.
//
// Ian's brief for this file, verbatim: "intentionality, not self-sabotage." This is explicitly
// NOT a win-rate project. Consequence for the design:
//
//   Dudo/Calzo (challenge) decisions are ALWAYS passed through from the wrapped Gen 2 policy
//   completely unchanged (see `decide`: `if (base.choice.type !== 'bid') return base`). This file
//   never touches Gen 2's equity-priced challenge machinery — that machinery carries the win rate
//   the non-inferiority gate depends on, and second-guessing a correctly-priced challenge just to
//   "stay in character" is exactly the self-sabotage Ian ruled out. The persona only reshapes BID
//   decisions: which face to escalate, and whether to put matching dice on the table while doing
//   it.
//
// Bluff mechanics (brief requirement 1):
//   - A "fresh" deliberate bluff fires only when the position is cheap (`isCheapMoment`): the bot
//     has a dice buffer (not one bad Dudo from elimination — MIN_DICE_FOR_BLUFF), the round is
//     early/mid (most of the table's original dice are still in play — EARLY_MID_DICE_FRACTION),
//     and Gen 2's own equity table says losing a die here wouldn't cost much (a small
//     equity(now) - equity(after losing one) gap). All three reuse Gen 2's own equity plumbing
//     (`lookupEquity`, via two helpers duplicated verbatim from beliefEquity.ts's private mirrors
//     of equityAware.ts — same documented-duplication pattern that file uses, one level deeper:
//     lab/ files don't reach into each other's private closures, and beliefEquity.ts is out of
//     scope for edits here).
//   - The bluffed face is never random: it's the denomination with the highest count in the bot's
//     own actual hand ("genuinely holds," per the brief) — a believable line, since the bot really
//     is sitting on a pile of that face, just not necessarily enough to cover the bid quantity.
//   - "Committed": once the bot has bid a face this round (a story, bluffed or true —
//     `findOwnStoryFace`), later bid decisions this round prefer re-raising THAT face over
//     whatever Gen 2 would have picked on its own — unless doing so needs a wildly bigger
//     quantity than Gen 2's own choice (`toleratedExtraQuantity`, the brief's "unless the EV gap
//     is severe" carve-out, read here as "the legal ladder no longer lets the story continue
//     cheaply").
//
// Table dice (brief requirement 2): reused directly from the wrapped policy's own choice when the
// final bid didn't change from what it picked (Conservative, which Gen 2 wraps, has its own
// tableDicePlan — src/bot/policies.ts — and Gen 2's belief-scored fallback bid can coincide with
// it, though it usually drops table dice since it constructs a fresh BotChoice — see
// beliefEquity.ts's `fallbackChoice`). Otherwise, whenever the persona is telling a story this
// turn (a fresh bluff, an overridden continuation, or Gen 2's own choice already sitting on the
// story face — "true or bluffed" per the brief) and the hand still holds a qualifying die after
// the reveal, it puts ONE die (two only for the 'aggressive' persona, and only with >=2
// qualifying dice and a hand deep enough to spare it) on the table — gated by `tableDiceChance` so
// it reads as an occasional flourish, not a tic ("noticeably more deliberate," not spammy, per
// the brief).
//
// Config (brief requirement 3): `bluffRate` (probability of firing a fresh bluff on an eligible
// decision), `tableDiceChance`, and `aggression` (a conservative/balanced/aggressive dial bundling
// defaults for both plus the commitment tolerance and the cheap-moment equity-downside cap — the
// knob future difficulty/personality seats can turn). All are individually overridable;
// `aggression` only supplies defaults.
//
// RNG: every stochastic decision here consumes the SAME seeded `random: RandomSource` the
// BotPolicy interface hands to chooseAction/chooseActionWithTrace — never Math.random.
//
// Privacy: same contract as beliefEquity.ts — inputs are BotObservation fields (own hand when
// visible, public history/dice) plus the two static model files. Never reveals or reasons about
// human/bot controller identity.

import { createBeliefEquityPolicy, type BeliefEquityPolicyOptions } from './beliefEquity'
import type { BotActionResult, BotChoice, BotDecisionTrace, BotObservation, BotPolicy } from '../types'
import type { Bid, Die, PublicGameView, PublicPlayer } from '../../engine'
import { loadEquityTable, lookupEquity, type EquityTable } from './equity'

export type PersonaAggression = 'conservative' | 'balanced' | 'aggressive'

export const PERSONA_LABELS: Record<PersonaAggression, string> = {
  conservative: 'Patient reader',
  balanced: 'Measured storyteller',
  aggressive: 'Bold storyteller',
}

interface AggressionPreset {
  bluffRate: number
  tableDiceChance: number
  toleratedExtraQuantity: number
  maxEquityDownside: number
}

/** The aggressive-vs-conservative dial (brief requirement 3). Values are starting points, tuned against the exp-012 gate (see lab/LOG.md) rather than derived analytically. */
const AGGRESSION_PRESETS: Record<PersonaAggression, AggressionPreset> = {
  conservative: { bluffRate: 0.07, tableDiceChance: 0.3, toleratedExtraQuantity: 1, maxEquityDownside: 0.1 },
  balanced: { bluffRate: 0.11, tableDiceChance: 0.45, toleratedExtraQuantity: 2, maxEquityDownside: 0.15 },
  aggressive: { bluffRate: 0.16, tableDiceChance: 0.6, toleratedExtraQuantity: 3, maxEquityDownside: 0.2 },
}

/** Minimum own diceCount to be eligible for a fresh bluff ("not at elimination risk" — losing a die from this floor still leaves a buffer). */
const MIN_DICE_FOR_BLUFF = 3
/** Minimum own diceCount to keep committing to an in-progress story (lower bar than a fresh bluff — a story already in motion is capped by `toleratedExtraQuantity`, not by re-running the full cheap-moment gate). */
const MIN_DICE_FOR_CONTINUATION = 2
/** Fraction of the table's ORIGINAL total dice (playerCount * 5) that must still be in play for "early/mid round." */
const EARLY_MID_DICE_FRACTION = 0.5

export interface PersonaBluffOptions extends BeliefEquityPolicyOptions {
  /** Probability of firing a fresh deliberate bluff on an eligible decision. Defaults from `aggression`. Target band (brief): 0.08-0.12 of ALL bids once eligibility gating is folded in. */
  bluffRate?: number
  /** Probability of putting a matching die on the table while telling a story (fresh bluff, overridden continuation, or a naturally story-aligned bid). Defaults from `aggression`. */
  tableDiceChance?: number
  /** Aggressive-vs-conservative dial; supplies defaults for bluffRate/tableDiceChance/commitment tolerance/downside cap. Default 'balanced'. */
  aggression?: PersonaAggression
}

/** Mirror of beliefEquity.ts's private `activeOtherStacks` (itself a mirror of equityAware.ts's) — duplicated for the same reason: not exported, and lab/ files don't reach into each other's private closures. */
function activeOtherStacks(view: PublicGameView, selfId: string): number[] {
  return view.players.filter((candidate) => candidate.id !== selfId && candidate.diceCount > 0).map((candidate) => candidate.diceCount)
}

/** Mirror of beliefEquity.ts's private `isCurrentRoundStarter`, duplicated for the same reason. */
function isCurrentRoundStarter(observation: BotObservation): boolean {
  const roundEntries = observation.history.filter((entry) => entry.round === observation.view.round)
  if (roundEntries.length === 0) return true
  return roundEntries[0].playerId === observation.playerId
}

function sameBid(left: Bid, right: Bid): boolean {
  return left.quantity === right.quantity && left.denomination === right.denomination
}

/**
 * "Cheap moment" gate for a fresh bluff (brief requirement 1a): a dice buffer, an early/mid
 * round by dice-remaining fraction, and a small equity(now) -> equity(after losing one die) drop,
 * all read off Gen 2's own equity table (`lookupEquity`, exactly as beliefEquity.ts's Dudo/Calzo
 * pricing does).
 */
function isCheapMoment(observation: BotObservation, table: EquityTable, player: PublicPlayer, minSamples: number, maxEquityDownside: number): boolean {
  const { view, playerId } = observation
  if (player.diceCount < MIN_DICE_FOR_BLUFF) return false

  const totalActiveDice = view.players.reduce((sum, candidate) => sum + candidate.diceCount, 0)
  const originalTotalDice = view.players.length * 5
  if (totalActiveDice / originalTotalDice < EARLY_MID_DICE_FRACTION) return false

  const playerCount = view.players.length
  const others = activeOtherStacks(view, playerId)
  const nowStarter = isCurrentRoundStarter(observation)
  const equityNow = lookupEquity(table, player.diceCount, others, nowStarter, playerCount, minSamples)
  const afterLossDice = player.diceCount - 1
  const equityAfterLoss = afterLossDice <= 0 ? 0 : lookupEquity(table, afterLossDice, others, true, playerCount, minSamples)
  return equityNow - equityAfterLoss <= maxEquityDownside
}

/** The denomination with the highest count in `hand` ("genuinely holds," brief requirement 1b). Ties broken toward the lower face — deterministic, not a fairness-relevant choice. */
function pickHeldFace(hand: readonly Die[]): Die | undefined {
  const counts = new Map<Die, number>()
  for (const die of hand) counts.set(die, (counts.get(die) ?? 0) + 1)
  let best: Die | undefined
  let bestCount = 0
  for (const face of [1, 2, 3, 4, 5, 6] as const) {
    const count = counts.get(face) ?? 0
    if (count > bestCount) {
      best = face
      bestCount = count
    }
  }
  return best
}

/** The cheapest (minimum-quantity) legal bid on `face`, or undefined if the ladder doesn't currently allow raising that face at all. */
function cheapestLegalBidForFace(bids: readonly Bid[], face: Die): Bid | undefined {
  const matches = bids.filter((bid) => bid.denomination === face)
  if (matches.length === 0) return undefined
  return matches.reduce((min, bid) => (bid.quantity < min.quantity ? bid : min))
}

export interface StoryAnchor {
  face: Die
  /** Quantity of the FIRST own bid this round on `face` — the total-escalation cap below is measured from here, not from the immediately preceding turn, so a story can't ratchet up one small step at a time forever (see decide()'s commit-continuation branch). */
  originalQuantity: number
}

/**
 * This player's current story THIS round: the denomination of their own most recent bid, and the
 * quantity of the FIRST own bid on that same denomination this round (scanning `history`
 * backward for the most recent own bid, current-round entries are always the tail — same
 * assumption beliefEquity.ts's `buildBeliefContext` makes via its forward filter — then forward
 * for the earliest match on that face). Undefined when the player hasn't bid yet this round —
 * "no story in progress."
 */
function findStoryAnchor(observation: BotObservation): StoryAnchor | undefined {
  const { view, playerId, history } = observation
  let face: Die | undefined
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry.round !== view.round) break
    if (entry.playerId === playerId && entry.action.type === 'bid') {
      face = entry.action.bid.denomination
      break
    }
  }
  if (face === undefined) return undefined

  for (const entry of history) {
    if (entry.round !== view.round) continue
    if (entry.playerId === playerId && entry.action.type === 'bid' && entry.action.bid.denomination === face) {
      return { face, originalQuantity: entry.action.bid.quantity }
    }
  }
  return undefined // unreachable given the backward scan above found one, but keeps TS/control-flow honest
}

export function createPersonaBluffPolicy(options: PersonaBluffOptions): BotPolicy {
  const wrapped = createBeliefEquityPolicy(options)
  const table: EquityTable = loadEquityTable()
  const minSamples = options.minSamples ?? 300
  const aggression = options.aggression ?? 'balanced'
  const preset = AGGRESSION_PRESETS[aggression]
  const bluffRate = options.bluffRate ?? preset.bluffRate
  const tableDiceChance = options.tableDiceChance ?? preset.tableDiceChance
  const toleratedExtraQuantity = preset.toleratedExtraQuantity
  const maxEquityDownside = preset.maxEquityDownside
  const name = options.name ?? 'Persona Bluff'

  const decide = (observation: BotObservation, random: () => number): BotActionResult => {
    const base = wrapped.chooseActionWithTrace!(observation, random)
    // The measured production gate keeps heads-up play on the stronger Conservative policy.
    if (observation.view.players.length === 2) return base
    // Dudo/Calzo, and any bid decision the wrapped policy couldn't trace, pass through untouched
    // — see module docstring on why challenge decisions are never second-guessed here.
    if (base.choice.type !== 'bid' || !base.trace) return base

    const { view, playerId, legalActions } = observation
    const player = view.players.find((candidate) => candidate.id === playerId)
    if (!player || legalActions.bids.length === 0) return base

    const trace: BotDecisionTrace = { ...base.trace, model: 'persona-bluff', version: 1 }
    trace.settings = { ...base.trace.settings, bluffRate, tableDiceChance, toleratedExtraQuantity, maxEquityDownside }

    const anchor = findStoryAnchor(observation)
    let finalBid: Bid = base.choice.bid
    let toldStory = false

    if (anchor === undefined) {
      // No story yet this round: maybe start one, deliberately, on a face we actually hold.
      if (player.hand && isCheapMoment(observation, table, player, minSamples, maxEquityDownside) && random() < bluffRate) {
        const heldFace = pickHeldFace(player.hand)
        const bluffBid = heldFace !== undefined ? cheapestLegalBidForFace(legalActions.bids, heldFace) : undefined
        if (bluffBid) {
          finalBid = bluffBid
          toldStory = true
          trace.decisionReason = 'controlled_bluff'
          // 'controlled_bluff' is a shared BotDecisionReason (src/bot/policies.ts sets it too, for
          // Conservative's own built-in bluffing) — a decision this file left untouched can already
          // carry it in from `base.trace`. `personaBluffFired` is this file's OWN unambiguous marker
          // (persisted via traceSettings in --decisions output) so downstream measurement never
          // conflates "the wrapped policy already happened to bluff" with "the persona fired."
          trace.settings.personaBluffFired = 1
          trace.plainReason = 'It found a cheap moment to sell a believable story on a face it genuinely held.'
        }
      }
    } else if (anchor.face !== base.choice.bid.denomination) {
      // Already telling a story this round; stay consistent unless it's gotten too expensive to
      // (the brief's "severe EV gap" carve-out) — measured as TOTAL escalation over the story's
      // OWN first bid this round, not turn-by-turn against whatever Gen 2 wants right now. A
      // per-turn-only cap is exactly what let an earlier version of this file ratchet a single
      // held die up into a 9x bid over several turns (see lab/LOG.md exp-012: a real trace went
      // 2x2 -> 3x2 -> 6x2 -> 9x2 while the hand held ONE '2') — bounding against the anchor
      // instead makes the persona let go of a story once it stops being cheap, rather than
      // chasing sunk cost forever. Also requires a small dice buffer (own self-preservation, not
      // "reuse Gen 2's math" — Gen 2's own EV math is exactly what decided to move off this face).
      const continuation = cheapestLegalBidForFace(legalActions.bids, anchor.face)
      if (continuation && player.diceCount >= MIN_DICE_FOR_CONTINUATION && continuation.quantity - anchor.originalQuantity <= toleratedExtraQuantity) {
        finalBid = continuation
        toldStory = true
        trace.decisionReason = 'controlled_bluff'
        trace.settings.personaBluffFired = 1
        trace.plainReason = 'It stayed with the same story because the next raise was still affordable.'
      }
    } else {
      // Gen 2's own choice already continues the story face on its own — nothing to override,
      // but still a story beat worth potentially selling with table dice below.
      toldStory = true
      trace.plainReason = 'Its strongest raise naturally continued the story it had already established.'
    }

    let tableDiceIndices: number[] | undefined
    if (base.choice.tableDiceIndices && sameBid(base.choice.bid, finalBid)) {
      // Reuse the wrapped policy's own table-dice choice when the final bid didn't change from
      // what it picked (brief requirement 2: "reuse the wrapped policy's existing machinery where
      // possible").
      tableDiceIndices = base.choice.tableDiceIndices
    } else if (toldStory && legalActions.canPutDiceOnTable && player.hand && player.hand.length > 1 && random() < tableDiceChance) {
      // Minimal reveal is deliberate, not an oversight: lab exp-015 duels
      // showed the "expose ALL qualifying dice" canonical rule loses ~2.7pp
      // vs this 1-die play — a small reveal keeps most of the hand rerolling
      // and leaks the least information while still selling the story.
      const paloFijo = view.paloFijo
      const qualifying = player.hand.flatMap((die, index) =>
        die === finalBid.denomination || (!paloFijo && finalBid.denomination !== 1 && die === 1) ? [index] : [],
      )
      if (qualifying.length > 0) {
        const revealCount = aggression === 'aggressive' && qualifying.length >= 2 && player.hand.length >= 4 ? 2 : 1
        const capped = Math.min(revealCount, qualifying.length, player.hand.length - 1)
        if (capped > 0) tableDiceIndices = qualifying.slice(0, capped)
      }
    }

    if (tableDiceIndices?.length) {
      trace.plainReason = `${trace.plainReason ?? 'It chose a supported raise.'} It exposed a matching die to make that story more convincing.`
    }

    const choice: BotChoice = { type: 'bid', bid: finalBid, ...(tableDiceIndices ? { tableDiceIndices } : {}) }
    return { choice, trace }
  }

  return {
    name,
    chooseAction(observation, random) {
      return decide(observation, random).choice
    },
    chooseActionWithTrace(observation, random) {
      return decide(observation, random)
    },
  }
}
