import process from 'node:process'
import { describe, expect, it } from 'vitest'

import { runAdversarialTournament } from './adversarial'
import { runAdversarialLearning } from './learning'
import { createProbabilityPolicy } from './policies'

const enabled = process.env.CACHITO_LEARNING_EXPERIMENT === '1'

describe.skipIf(!enabled)('adversarial learning experiment', () => {
  it('trains and evaluates a champion on a held-out tournament seed', async () => {
    const learning = await runAdversarialLearning({
      generations: 10,
      populationSize: 8,
      gamesPerGeneration: 300,
      playerCounts: [2, 4, 6],
      seed: 20260714,
      eliteCount: 2,
    })
    const champion = learning.finalChampion
    const validation = runAdversarialTournament({
      games: 2000,
      seed: 20260715,
      playerCounts: [2, 4, 6],
      policies: [
        createProbabilityPolicy({ name: 'Learned champion', ...champion.genome }),
        createProbabilityPolicy({ name: 'Baseline' }),
        createProbabilityPolicy({
          name: 'Conservative', dudoThreshold: 0.64, calzoThreshold: 0.82,
          targetBidConfidence: 0.72, bluffRate: 0.01,
        }),
        createProbabilityPolicy({
          name: 'Survivalist', dudoThreshold: 0.60, calzoThreshold: 0.88,
          targetBidConfidence: 0.68, bluffRate: 0, nearEqualWindow: 0.015,
        }),
        createProbabilityPolicy({
          name: 'Challenger', dudoThreshold: 0.40, calzoThreshold: 0.78,
          targetBidConfidence: 0.62, bluffRate: 0.03,
        }),
        createProbabilityPolicy({
          name: 'Bluffer', dudoThreshold: 0.52, calzoThreshold: 0.72,
          targetBidConfidence: 0.50, bluffRate: 0.22,
        }),
      ],
    })

    expect(learning.totalGames).toBe(3000)
    expect(validation.games).toBe(2000)
    expect(validation.policies['Learned champion'].appearances).toBeGreaterThan(0)

    console.log(`LEARNING_EXPERIMENT=${JSON.stringify({
      config: learning.config,
      generations: learning.history.map((generation) => ({
        generation: generation.generation,
        champion: generation.champion.name,
        fitness: generation.champion.fitness,
        performanceRatio: generation.champion.performanceRatio,
        genome: generation.champion.genome,
      })),
      finalChampion: champion,
      validation,
    })}`)
  }, 120_000)
})
