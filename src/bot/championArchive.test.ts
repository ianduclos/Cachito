import { describe, expect, it } from 'vitest'
import { collectRunChampions, mergeChampionShelf } from './championArchive'
import type { LearningRunResult } from './learning'

const candidate = (id: string, generation: number, fitness: number, ratios: Record<string, number>) => ({
  id, name: id, generation, fitness, genome: { dudoThreshold: .5, calzoThreshold: .7, targetBidConfidence: .6, bluffRate: .05, nearEqualWindow: .02 },
  appearances: 10, wins: 3, performanceRatio: 1.1, dudoAccuracy: .6, calzoAccuracy: null, bidBrier: .2, playerCountRatios: ratios,
})

describe('champion archive', () => {
  it('collects an overall champion and table-size specialists without promotion', () => {
    const overall = candidate('overall', 2, 1.4, { '2': 1.1, '4': 1.2, '6': 1.1 })
    const two = candidate('two', 1, 1.1, { '2': 1.5, '4': .9, '6': .8 })
    const six = candidate('six', 2, 1.2, { '2': .9, '4': 1, '6': 1.7 })
    const run: LearningRunResult = { config: { generations: 2, populationSize: 6, gamesPerGeneration: 24, playerCounts: [2, 4, 6], seed: 7, eliteCount: 1 }, history: [
      { generation: 1, tournamentSeed: 1, gamesCompleted: 24, gamesTotal: 24, candidates: [two], ranking: [two], champion: two },
      { generation: 2, tournamentSeed: 2, gamesCompleted: 24, gamesTotal: 24, candidates: [overall, six], ranking: [overall, six], champion: overall },
    ], finalChampion: overall, totalGames: 48, cancelled: false }
    const shelf = collectRunChampions(run, '2026-07-13T00:00:00.000Z')
    expect(shelf.map(({ role, candidate }) => [role, candidate.id])).toEqual([
      ['overall', 'overall'], ['2-player', 'two'], ['4-player', 'overall'], ['6-player', 'six'],
    ])
    expect(mergeChampionShelf(shelf, shelf)).toHaveLength(4)
  })
})
