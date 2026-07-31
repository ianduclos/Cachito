import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_RULES,
  applyAction,
  type Bid,
  type Die,
  type PlayingState,
} from '../engine'
import { adjustSupportForOpponent, buildOpponentProfile } from './opponentModel'
import type { PublicActionEntry } from './types'

const outcome = (
  bidderId: string,
  kind: 'dudo' | 'calzo',
  correct: boolean,
  actualCount?: number,
): PublicActionEntry => ({
  round: 1,
  playerId: 'caller',
  action: { type: kind },
  outcome: {
    kind,
    bidderId,
    bid: { quantity: 2, denomination: 6 },
    correct,
    ...(actualCount === undefined ? {} : { actualCount }),
  },
})

function resolvedOutcome(
  kind: 'dudo' | 'calzo',
  bid: Bid,
  bidderHand: Die[],
  callerHand: Die[],
): PublicActionEntry {
  const state: PlayingState = {
    phase: 'playing',
    players: [
      {
        id: 'bidder', name: 'Bidder', diceCount: bidderHand.length, hand: bidderHand,
        tableDice: [], tableDiceUsed: false, paloFijoTriggered: false,
      },
      {
        id: 'caller', name: 'Caller', diceCount: callerHand.length, hand: callerHand,
        tableDice: [], tableDiceUsed: false, paloFijoTriggered: false,
      },
    ],
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    currentPlayerId: 'caller',
    currentBid: bid,
    lastBidderId: 'bidder',
  }
  const next = applyAction(state, { type: kind, playerId: 'caller' }, () => 0.5)
  if (next.phase !== 'reveal') throw new Error('Expected a revealed call outcome')
  return {
    round: 1,
    playerId: 'caller',
    action: { type: kind },
    outcome: {
      kind,
      bidderId: next.resolution.bidderId,
      bid: next.resolution.bid,
      correct: next.resolution.correct,
      actualCount: next.resolution.actualCount,
    },
  }
}

describe('public opponent model', () => {
  it('uses a neutral prior when no public outcomes exist', () => {
    expect(buildOpponentProfile([], 'b')).toEqual({ evidence: 0, reliability: 0.5 })
  })

  it('interprets engine call correctness as bid truth with actual-count ground truth', () => {
    const reliable = buildOpponentProfile([
      resolvedOutcome('dudo', { quantity: 1, denomination: 6 }, [6], [2]),
      resolvedOutcome('calzo', { quantity: 1, denomination: 6 }, [6], [2]),
      resolvedOutcome('calzo', { quantity: 1, denomination: 6 }, [6], [6]),
      outcome('other', 'dudo', true, 0),
    ], 'bidder')
    expect(reliable).toEqual({ evidence: 3, reliability: 5 / 7 })
    expect(adjustSupportForOpponent(0.6, reliable)).toBeGreaterThan(0.6)

    const unreliable = buildOpponentProfile([
      resolvedOutcome('dudo', { quantity: 2, denomination: 6 }, [2], [3]),
      resolvedOutcome('calzo', { quantity: 2, denomination: 6 }, [2], [3]),
    ], 'bidder')
    expect(unreliable).toEqual({ evidence: 2, reliability: 2 / 6 })
    expect(adjustSupportForOpponent(0.6, unreliable)).toBeLessThan(0.6)
  })

  it('uses legacy Dudo and correct-Calzo semantics but skips an ambiguous failed Calzo', () => {
    const profile = buildOpponentProfile([
      outcome('b', 'dudo', false),
      outcome('b', 'dudo', true),
      outcome('b', 'calzo', true),
      outcome('b', 'calzo', false),
    ], 'b')
    expect(profile).toEqual({ evidence: 3, reliability: 4 / 7 })
    expect(adjustSupportForOpponent(0.6, buildOpponentProfile([], 'b'))).toBe(0.6)
  })
})
