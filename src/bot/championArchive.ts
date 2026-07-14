import type { LearningCandidateResult, LearningRunResult } from './learning'

export type ChampionRole = 'overall' | '2-player' | '4-player' | '6-player'

export interface ArchivedChampion {
  key: string
  role: ChampionRole
  candidate: LearningCandidateResult
  seed: number
  collectedAt: string
}

/** Collects training standouts only; it never changes the active game policy. */
export function collectRunChampions(run: LearningRunResult, collectedAt = new Date().toISOString()): ArchivedChampion[] {
  const candidates = run.history.flatMap((snapshot) => snapshot.ranking)
  if (candidates.length === 0) return []
  const overall = candidates.reduce((best, candidate) => candidate.fitness > best.fitness ? candidate : best)
  const entries: Array<[ChampionRole, LearningCandidateResult]> = [
    ['overall', overall],
    ...([2, 4, 6] as const).map((count): [ChampionRole, LearningCandidateResult] => [
      `${count}-player` as ChampionRole,
      candidates.reduce((best, candidate) => (candidate.playerCountRatios[String(count)] ?? -Infinity) > (best.playerCountRatios[String(count)] ?? -Infinity) ? candidate : best),
    ]),
  ]
  return entries.map(([role, candidate]) => ({
    key: `${run.config.seed}:${role}:${candidate.generation}:${candidate.id}`,
    role,
    candidate: structuredClone(candidate),
    seed: run.config.seed,
    collectedAt,
  }))
}

export function mergeChampionShelf(existing: readonly ArchivedChampion[], additions: readonly ArchivedChampion[]): ArchivedChampion[] {
  const byKey = new Map(existing.map((entry) => [entry.key, entry]))
  additions.forEach((entry) => byKey.set(entry.key, entry))
  return [...byKey.values()].sort((left, right) => right.collectedAt.localeCompare(left.collectedAt) || right.candidate.fitness - left.candidate.fitness)
}
