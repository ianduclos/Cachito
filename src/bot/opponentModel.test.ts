import { describe, expect, it } from 'vitest'
import { adjustSupportForOpponent, buildOpponentProfile } from './opponentModel'
import type { PublicActionEntry } from './types'

const outcome = (bidderId: string, correct: boolean): PublicActionEntry => ({
  round: 1,
  playerId: 'caller',
  action: { type: 'dudo' },
  outcome: { kind: 'dudo', bidderId, bid: { quantity: 2, denomination: 6 }, correct },
})

describe('public opponent model', () => {
  it('uses a neutral prior when no public outcomes exist', () => {
    expect(buildOpponentProfile([], 'b')).toEqual({ evidence: 0, reliability: 0.5 })
  })

  it('learns only from publicly revealed outcomes and stays conservative', () => {
    const profile = buildOpponentProfile([
      outcome('b', false), outcome('b', false), outcome('b', true), outcome('c', true),
    ], 'b')
    expect(profile).toEqual({ evidence: 3, reliability: 3 / 7 })
    expect(adjustSupportForOpponent(0.6, profile)).toBeLessThan(0.6)
    expect(adjustSupportForOpponent(0.6, buildOpponentProfile([], 'b'))).toBe(0.6)
  })
})
