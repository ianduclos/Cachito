import { runAdversarialTournament } from './adversarial'
import { createProbabilityPolicy } from './policies'
import { MAX_PLAYERS } from '../engine'

/** The complete, JSON-serializable parameter set evolved by the learner. */
export interface PolicyGenome {
  dudoThreshold: number
  calzoThreshold: number
  targetBidConfidence: number
  bluffRate: number
  nearEqualWindow: number
}

export interface LearningConfig {
  generations: number
  populationSize: number
  gamesPerGeneration: number
  playerCounts: number[]
  seed: number
  eliteCount: number
}

export interface LearningPopulationCandidate {
  id: string
  name: string
  genome: PolicyGenome
}

export interface LearningCandidateResult extends LearningPopulationCandidate {
  generation: number
  appearances: number
  wins: number
  performanceRatio: number
  dudoAccuracy: number | null
  calzoAccuracy: number | null
  bidBrier: number | null
  playerCountRatios: Record<string, number | null>
  /** 0.65*overall ratio + 0.25*worst player-count ratio + 0.10*calibration. Ratios are capped at 3. */
  fitness: number
}

export interface LearningGenerationResult {
  generation: number
  tournamentSeed: number
  gamesCompleted: number
  gamesTotal: number
  candidates: LearningCandidateResult[]
  ranking: LearningCandidateResult[]
  champion: LearningCandidateResult
}

export type LearningGenerationSnapshot = LearningGenerationResult

export interface LearningRunSnapshot {
  config: LearningConfig
  history: LearningGenerationSnapshot[]
  champion: LearningCandidateResult | null
  totalGames: number
  cancelled: boolean
}

export interface LearningRunResult {
  config: LearningConfig
  history: LearningGenerationSnapshot[]
  finalChampion: LearningCandidateResult
  totalGames: number
  cancelled: false
}

export interface LearningControl {
  onGeneration?: (
    generation: LearningGenerationSnapshot,
    run?: LearningRunSnapshot,
  ) => void | Promise<void>
  shouldCancel?: () => boolean | Promise<boolean>
  /** Continue from a completed run using its final evolved population. */
  resume?: LearningRunResult
}

export interface LearningGenerationInput {
  config: LearningConfig
  generation: number
  population: readonly LearningPopulationCandidate[]
}

export class LearningCancelledError extends Error {
  readonly snapshot: LearningRunSnapshot

  constructor(snapshot: LearningRunSnapshot) {
    super(`Learning cancelled after ${snapshot.history.length} generations`)
    this.name = 'LearningCancelledError'
    this.snapshot = structuredClone(snapshot)
  }
}

const BOUNDS: Record<keyof PolicyGenome, readonly [number, number]> = {
  dudoThreshold: [0.35, 0.85],
  calzoThreshold: [0.45, 0.98],
  targetBidConfidence: [0.40, 0.85],
  bluffRate: [0, 0.25],
  nearEqualWindow: [0.005, 0.08],
}

const CONSERVATIVE: PolicyGenome = {
  dudoThreshold: 0.64, calzoThreshold: 0.82, targetBidConfidence: 0.72,
  bluffRate: 0.01, nearEqualWindow: 0.025,
}
const SURVIVALIST: PolicyGenome = {
  dudoThreshold: 0.60, calzoThreshold: 0.88, targetBidConfidence: 0.68,
  bluffRate: 0, nearEqualWindow: 0.015,
}

export function validateLearningConfig(config: LearningConfig): void {
  positiveInteger(config.generations, 'generations')
  if (!Number.isInteger(config.populationSize) || config.populationSize < 6) {
    throw new RangeError('populationSize must be an integer of at least 6')
  }
  positiveInteger(config.gamesPerGeneration, 'gamesPerGeneration')
  if (!Array.isArray(config.playerCounts) || config.playerCounts.length === 0) {
    throw new RangeError('playerCounts must be a non-empty array')
  }
  if (config.playerCounts.some((count) => !Number.isInteger(count) || count < 2 || count > MAX_PLAYERS)) {
    throw new RangeError(`playerCounts must contain only integers from 2 to ${MAX_PLAYERS}`)
  }
  if (new Set(config.playerCounts).size !== config.playerCounts.length) {
    throw new RangeError('playerCounts must not contain duplicates')
  }
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer')
  if (!Number.isInteger(config.eliteCount) || config.eliteCount < 1 || config.eliteCount >= config.populationSize) {
    throw new RangeError('eliteCount must be at least 1 and less than populationSize')
  }
}

export function createInitialLearningPopulation(config: LearningConfig): LearningPopulationCandidate[] {
  validateLearningConfig(config)
  const random = seededRandom(mixSeed(config.seed, 0x100))
  const population: LearningPopulationCandidate[] = [
    { id: 'conservative', name: 'Conservative', genome: cloneGenome(CONSERVATIVE) },
    { id: 'survivalist', name: 'Survivalist', genome: cloneGenome(SURVIVALIST) },
  ]
  while (population.length < config.populationSize) {
    const index = population.length
    const base = index % 2 === 0 ? CONSERVATIVE : SURVIVALIST
    population.push({
      id: `seed-${index + 1}`,
      name: `Seed candidate ${index + 1}`,
      genome: mutateGenome(base, random, 1),
    })
  }
  return population
}

export function runLearningGeneration(input: LearningGenerationInput): LearningGenerationResult {
  validateLearningConfig(input.config)
  if (!Number.isInteger(input.generation) || input.generation < 1) {
    throw new RangeError('generation must be a positive integer')
  }
  if (input.generation > input.config.generations) {
    throw new RangeError('generation must not exceed configured generations')
  }
  validatePopulation(input.population, input.config.populationSize)
  const tournamentSeed = mixSeed(input.config.seed, input.generation)
  const report = runAdversarialTournament({
    games: input.config.gamesPerGeneration,
    seed: tournamentSeed,
    playerCounts: input.config.playerCounts,
    policies: input.population.map((candidate) => createProbabilityPolicy({
      name: candidate.name,
      ...candidate.genome,
    })),
  })
  const candidates = input.population.map((candidate): LearningCandidateResult => {
    const stats = report.policies[candidate.name]
    const performanceRatio = Number.isFinite(stats.performanceRatio) ? stats.performanceRatio : 0
    const playerCountRatios = Object.fromEntries(input.config.playerCounts.map((count) => [
      String(count), stats.byPlayerCount[String(count)]?.performanceRatio ?? null,
    ]))
    return {
      generation: input.generation,
      id: candidate.id,
      name: candidate.name,
      genome: cloneGenome(candidate.genome),
      appearances: stats.appearances,
      wins: stats.wins,
      performanceRatio,
      dudoAccuracy: stats.dudo.accuracy,
      calzoAccuracy: stats.calzo.accuracy,
      bidBrier: stats.bidCalibration.brierScore,
      playerCountRatios,
      fitness: calculateFitness(performanceRatio, playerCountRatios, stats.bidCalibration.brierScore),
    }
  })
  const ranking = [...candidates].sort(compareCandidates)
  return {
    generation: input.generation,
    tournamentSeed,
    gamesCompleted: report.games,
    gamesTotal: input.config.gamesPerGeneration,
    candidates,
    ranking,
    champion: ranking[0],
  }
}

export function evolveLearningPopulation(
  config: LearningConfig,
  completed: LearningGenerationSnapshot,
): LearningPopulationCandidate[] {
  validateLearningConfig(config)
  if (completed.ranking.length !== config.populationSize) {
    throw new RangeError('generation ranking must match populationSize')
  }
  const nextGeneration = completed.generation + 1
  const random = seededRandom(mixSeed(config.seed, 0x200 + completed.generation))
  const elites = completed.ranking.slice(0, config.eliteCount).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    genome: cloneGenome(candidate.genome),
  }))
  const next = [...elites]
  const parentPool = completed.ranking.slice(0, Math.max(2, Math.ceil(config.populationSize / 2)))
  while (next.length < config.populationSize) {
    const childIndex = next.length + 1
    const first = parentPool[Math.floor(random() * parentPool.length)]
    const second = parentPool[Math.floor(random() * parentPool.length)]
    const crossed = crossoverGenomes(first.genome, second.genome, random)
    next.push({
      id: `g${nextGeneration}-c${childIndex}`,
      name: `Generation ${nextGeneration} candidate ${childIndex}`,
      genome: mutateGenome(crossed, random, 0.72),
    })
  }
  return next
}

export async function runAdversarialLearning(
  config: LearningConfig,
  control: LearningControl = {},
): Promise<LearningRunResult> {
  validateLearningConfig(config)
  const safeConfig = structuredClone(config)
  const resumed = control.resume ? validateResume(control.resume, safeConfig) : null
  let population = resumed ? evolveLearningPopulation(safeConfig, resumed.history.at(-1)!) : createInitialLearningPopulation(safeConfig)
  const history: LearningGenerationSnapshot[] = resumed ? structuredClone(resumed.history) : []
  let totalGames = resumed?.totalGames ?? 0

  for (let generation = history.length + 1; generation <= safeConfig.generations; generation += 1) {
    if (await control.shouldCancel?.()) throw cancellation(safeConfig, history, totalGames)
    const result = runLearningGeneration({ config: safeConfig, generation, population })
    history.push(result)
    totalGames += result.gamesCompleted
    const snapshot = createSnapshot(safeConfig, history, totalGames, false)
    await control.onGeneration?.(structuredClone(result), snapshot)
    if (generation < safeConfig.generations) {
      // Awaiting a macrotask allows worker message handlers to update shouldCancel.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (await control.shouldCancel?.()) throw cancellation(safeConfig, history, totalGames)
      population = evolveLearningPopulation(safeConfig, result)
    }
  }

  return {
    config: structuredClone(safeConfig),
    history: structuredClone(history),
    finalChampion: structuredClone(history.at(-1)!.champion),
    totalGames,
    cancelled: false,
  }
}

function validateResume(resume: LearningRunResult, config: LearningConfig): LearningRunResult {
  if (resume.cancelled || resume.history.length === 0) throw new RangeError('resume must be a completed learning run')
  validateLearningConfig(resume.config)
  const fields: Array<keyof Omit<LearningConfig, 'generations'>> = [
    'populationSize', 'gamesPerGeneration', 'seed', 'playerCounts', 'eliteCount',
  ]
  for (const field of fields) {
    if (JSON.stringify(resume.config[field]) !== JSON.stringify(config[field])) {
      throw new RangeError(`resume config must keep ${field} unchanged`)
    }
  }
  if (config.generations <= resume.history.length) {
    throw new RangeError('continued run must include at least one additional generation')
  }
  return structuredClone(resume)
}

function calculateFitness(
  performanceRatio: number,
  playerCountRatios: Record<string, number | null>,
  bidBrier: number | null,
): number {
  const ratios = Object.values(playerCountRatios).map((ratio) => ratio ?? 0)
  const overall = clamp(performanceRatio, 0, 3)
  const robustness = clamp(Math.min(...ratios), 0, 3)
  const calibration = bidBrier === null ? 0.5 : 1 - clamp(bidBrier, 0, 1)
  return 0.65 * overall + 0.25 * robustness + 0.10 * calibration
}

function compareCandidates(left: LearningCandidateResult, right: LearningCandidateResult): number {
  return right.fitness - left.fitness || right.performanceRatio - left.performanceRatio || left.name.localeCompare(right.name)
}

function validatePopulation(population: readonly LearningPopulationCandidate[], expectedSize: number): void {
  if (population.length !== expectedSize) throw new RangeError(`population must contain exactly ${expectedSize} candidates`)
  if (new Set(population.map(({ id }) => id)).size !== population.length) throw new Error('candidate ids must be unique')
  if (new Set(population.map(({ name }) => name)).size !== population.length) throw new Error('candidate policy names must be unique')
  for (const candidate of population) {
    if (!candidate.id || !candidate.name) throw new Error('candidate id and name must be non-empty')
    validateGenome(candidate.genome)
  }
}

function validateGenome(genome: PolicyGenome): void {
  const genomeKeys = Object.keys(genome).sort()
  const expectedKeys = Object.keys(BOUNDS).sort()
  if (genomeKeys.length !== expectedKeys.length || genomeKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new RangeError(`genome must contain exactly: ${expectedKeys.join(', ')}`)
  }
  for (const key of expectedKeys as Array<keyof PolicyGenome>) {
    const [minimum, maximum] = BOUNDS[key]
    if (!Number.isFinite(genome[key]) || genome[key] < minimum || genome[key] > maximum) {
      throw new RangeError(`${key} must be between ${minimum} and ${maximum}`)
    }
  }
}

function mutateGenome(source: PolicyGenome, random: () => number, scale: number): PolicyGenome {
  const result = cloneGenome(source)
  for (const key of Object.keys(BOUNDS) as Array<keyof PolicyGenome>) {
    const [minimum, maximum] = BOUNDS[key]
    const delta = (random() * 2 - 1) * (maximum - minimum) * 0.16 * scale
    result[key] = clamp(source[key] + delta, minimum, maximum)
  }
  return result
}

function crossoverGenomes(left: PolicyGenome, right: PolicyGenome, random: () => number): PolicyGenome {
  const result = cloneGenome(left)
  for (const key of Object.keys(BOUNDS) as Array<keyof PolicyGenome>) {
    const weight = 0.25 + random() * 0.5
    result[key] = left[key] * weight + right[key] * (1 - weight)
  }
  return result
}

function cloneGenome(genome: PolicyGenome): PolicyGenome {
  return {
    dudoThreshold: genome.dudoThreshold,
    calzoThreshold: genome.calzoThreshold,
    targetBidConfidence: genome.targetBidConfidence,
    bluffRate: genome.bluffRate,
    nearEqualWindow: genome.nearEqualWindow,
  }
}

function createSnapshot(
  config: LearningConfig,
  history: LearningGenerationSnapshot[],
  totalGames: number,
  cancelled: boolean,
): LearningRunSnapshot {
  return structuredClone({
    config,
    history,
    champion: history.at(-1)?.champion ?? null,
    totalGames,
    cancelled,
  })
}

function cancellation(config: LearningConfig, history: LearningGenerationSnapshot[], totalGames: number): LearningCancelledError {
  return new LearningCancelledError(createSnapshot(config, history, totalGames, true))
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function mixSeed(seed: number, stream: number): number {
  let value = (seed ^ Math.imul(stream + 1, 0x9e37_79b1)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x21f0_aaad)
  value ^= value >>> 15
  return value >>> 0
}
