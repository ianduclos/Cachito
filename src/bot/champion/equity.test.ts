import { describe, expect, it } from 'vitest'
import { loadEquityTable } from './equity'

// Locks the promoted 2-8 equity table (lab exp-014 merge: exp-001 league at
// 2-6 seats preserved exactly, plus 10k-game supplements at 7 and 8 seats).
// Before this promotion, 7-8 player lookups silently fell back to 0.5 and
// mispriced every large-table challenge.
describe('promoted equity table', () => {
  const table = loadEquityTable()

  it('covers marginal equity for every supported player count', () => {
    for (let players = 2; players <= 8; players += 1) {
      const marginals = table.marginalByOwnDice[String(players)]
      expect(marginals, `players=${players}`).toBeDefined()
      let previous = 0
      for (let dice = 1; dice <= 5; dice += 1) {
        const p = marginals[String(dice)]?.p
        expect(p, `players=${players} dice=${dice}`).toBeGreaterThan(0)
        expect(p).toBeLessThan(1)
        expect(p, `equity must increase with dice at ${players}p`).toBeGreaterThan(previous)
        previous = p!
      }
    }
  })

  it('keeps the original 2-6 seat values byte-exact (regression against re-merges)', () => {
    expect(table.states['5|5|1|2']).toEqual({ n: 20000, wins: 9113, p: 0.45565 })
    expect(table.marginalByOwnDice['4']['1'].p).toBeCloseTo(0.14209310558970162, 15)
  })

  it('prices seven- and eight-seat dice below the six-seat values, as measured', () => {
    for (let dice = 1; dice <= 5; dice += 1) {
      expect(table.marginalByOwnDice['7'][String(dice)].p)
        .toBeLessThan(table.marginalByOwnDice['6'][String(dice)].p)
      expect(table.marginalByOwnDice['8'][String(dice)].p)
        .toBeLessThan(table.marginalByOwnDice['7'][String(dice)].p)
    }
  })
})
