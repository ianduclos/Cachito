import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { runAdversarialTournament } from './adversarial'

describe('adversarial policy tournament', () => {
  const games = Number(process.env.CACHITO_ADVERSARIAL_GAMES ?? 30)
  const tournamentTimeout = games > 100 ? 60_000 : 5_000

  it('rotates a policy league through 2-, 4-, and 6-player games', () => {
    const report = runAdversarialTournament({ games, seed: 20260713 })
    expect(report.games).toBe(games)
    expect(Object.values(report.gameDistribution).reduce((sum, count) => sum + count, 0)).toBe(games)
    expect(Object.keys(report.policies)).toHaveLength(6)
    expect(Object.values(report.policies).reduce((sum, policy) => sum + policy.wins, 0)).toBe(games)
    expect(report.averageActions).toBeGreaterThan(0)
    expect(report.averageRounds).toBeGreaterThan(0)
    for (const policy of Object.values(report.policies)) {
      expect(policy.appearances).toBeGreaterThan(0)
      expect(policy.decisions).toBeGreaterThan(0)
      expect(policy.bidCalibration.samples).toBeGreaterThan(0)
    }
    if (process.env.CACHITO_ADVERSARIAL_PRINT === '1') {
      console.log(`ADVERSARIAL_REPORT=${JSON.stringify(report)}`)
    }
  }, tournamentTimeout)
})
