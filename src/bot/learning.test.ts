import { describe, expect, it } from 'vitest'
import {
  LearningCancelledError,
  createInitialLearningPopulation,
  evolveLearningPopulation,
  runAdversarialLearning,
  runLearningGeneration,
  validateLearningConfig,
  type LearningConfig,
  type PolicyGenome,
} from './index'

const config: LearningConfig = {
  generations: 2,
  populationSize: 6,
  gamesPerGeneration: 6,
  playerCounts: [2, 4, 6],
  seed: 20260713,
  eliteCount: 2,
}

const bounds: Record<keyof PolicyGenome, [number, number]> = {
  dudoThreshold: [0.35, 0.85],
  calzoThreshold: [0.45, 0.98],
  targetBidConfidence: [0.40, 0.85],
  bluffRate: [0, 0.25],
  nearEqualWindow: [0.005, 0.08],
}

describe('adversarial evolutionary learning', () => {
  it('is deterministic and uses different tournament seeds by generation', async () => {
    const first = await runAdversarialLearning(config)
    const second = await runAdversarialLearning(config)

    expect(second).toEqual(first)
    expect(first.history).toHaveLength(2)
    expect(first.history[0].tournamentSeed).not.toBe(first.history[1].tournamentSeed)
    expect(first.totalGames).toBe(12)
    expect(first.finalChampion).toEqual(first.history[1].champion)
  })

  it('validates configuration inputs with clear errors', () => {
    expect(() => validateLearningConfig({ ...config, populationSize: 5 })).toThrow(/populationSize/)
    expect(() => validateLearningConfig({ ...config, generations: 0 })).toThrow(/generations/)
    expect(() => validateLearningConfig({ ...config, gamesPerGeneration: 0 })).toThrow(/gamesPerGeneration/)
    expect(() => validateLearningConfig({ ...config, playerCounts: [1, 6] })).toThrow(/playerCounts/)
    expect(() => validateLearningConfig({ ...config, playerCounts: [2, 2] })).toThrow(/duplicates/)
    expect(() => validateLearningConfig({ ...config, eliteCount: 6 })).toThrow(/eliteCount/)
    expect(() => validateLearningConfig({ ...config, seed: Number.NaN })).toThrow(/seed/)
  })

  it('seeds known policies, enforces bounds, and preserves elites while evolving', () => {
    const population = createInitialLearningPopulation(config)
    expect(population.slice(0, 2).map(({ name }) => name)).toEqual(['Conservative', 'Survivalist'])
    assertBounds(population.map(({ genome }) => genome))

    const generation = runLearningGeneration({ config, generation: 1, population })
    const evolved = evolveLearningPopulation(config, generation)
    expect(evolved.slice(0, config.eliteCount)).toEqual(
      generation.ranking.slice(0, config.eliteCount).map(({ id, name, genome }) => ({ id, name, genome })),
    )
    expect(evolved.slice(config.eliteCount).every(({ id }) => id.startsWith('g2-'))).toBe(true)
    const uniqueNames = new Set(evolved.map(({ name }) => name))
    expect(uniqueNames.size).toBe(evolved.length)
    assertBounds(evolved.map(({ genome }) => genome))
  })

  it('aggregates requested 2, 4, and 6 player contexts into chart-safe results', () => {
    const generation = runLearningGeneration({
      config,
      generation: 1,
      population: createInitialLearningPopulation(config),
    })
    expect(generation.gamesCompleted).toBe(6)
    expect(generation.gamesTotal).toBe(6)
    expect(generation.ranking).toHaveLength(6)
    for (const candidate of generation.candidates) {
      expect(Object.keys(candidate.playerCountRatios)).toEqual(['2', '4', '6'])
      expect(candidate.fitness).toEqual(expect.any(Number))
      expect(Number.isFinite(candidate.fitness)).toBe(true)
      expect(JSON.parse(JSON.stringify(candidate))).toEqual(candidate)
    }
  })

  it('publishes awaited progress after each generation', async () => {
    const seen: number[] = []
    const result = await runAdversarialLearning(config, {
      async onGeneration(generation, snapshot) {
        await Promise.resolve()
        seen.push(generation.generation)
        expect(snapshot?.history).toHaveLength(generation.generation)
        expect(snapshot?.totalGames).toBe(generation.generation * config.gamesPerGeneration)
      },
    })
    expect(seen).toEqual([1, 2])
    expect(result.totalGames).toBe(12)
  })

  it('cancels cleanly between generations with a typed partial snapshot', async () => {
    let cancel = false
    const promise = runAdversarialLearning({ ...config, generations: 3 }, {
      onGeneration(generation) {
        if (generation.generation === 1) cancel = true
      },
      shouldCancel: () => cancel,
    })
    await expect(promise).rejects.toBeInstanceOf(LearningCancelledError)
    try {
      await promise
    } catch (error) {
      const cancelled = error as LearningCancelledError
      expect(cancelled.snapshot.cancelled).toBe(true)
      expect(cancelled.snapshot.history).toHaveLength(1)
      expect(cancelled.snapshot.totalGames).toBe(config.gamesPerGeneration)
    }
  })
})

function assertBounds(genomes: PolicyGenome[]): void {
  for (const genome of genomes) {
    expect(Object.keys(genome).sort()).toEqual(Object.keys(bounds).sort())
    for (const key of Object.keys(bounds) as Array<keyof PolicyGenome>) {
      expect(genome[key]).toBeGreaterThanOrEqual(bounds[key][0])
      expect(genome[key]).toBeLessThanOrEqual(bounds[key][1])
    }
  }
}
