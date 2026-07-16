import { useEffect, useRef, useState } from 'react'

import type { LearningConfig, LearningGenerationSnapshot, LearningRunResult, LearningRunSnapshot } from '../bot/learning'
import { collectRunChampions, mergeChampionShelf, type ArchivedChampion } from '../bot/championArchive'
import type { LearningWorkerInboundMessage, LearningWorkerOutboundMessage } from '../bot/learningWorkerProtocol'

type RunStatus = 'idle' | 'running' | 'stopping' | 'stopped' | 'completed' | 'error'

const DEFAULT_CONFIG: LearningConfig = {
  generations: 12,
  populationSize: 8,
  gamesPerGeneration: 240,
  seed: 212613255,
  playerCounts: [2, 4, 6],
  eliteCount: 2,
}

const GENOME_LABELS = {
  dudoThreshold: 'Dudo threshold',
  calzoThreshold: 'Calzo threshold',
  targetBidConfidence: 'Bid confidence',
  bluffRate: 'Bluff rate',
  nearEqualWindow: 'Choice flexibility',
} as const

const CONTINUATION_GENERATIONS = 12
const CHAMPION_SHELF_KEY = 'cachito-learning-champion-shelf-v1'

let runSequence = 0

export function LearningLab({ onExit }: { onExit: () => void }) {
  const [config, setConfig] = useState<LearningConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [history, setHistory] = useState<LearningGenerationSnapshot[]>([])
  const [result, setResult] = useState<LearningRunResult | null>(null)
  const [exportableRun, setExportableRun] = useState<LearningRunResult | LearningRunSnapshot | null>(null)
  const [championShelf, setChampionShelf] = useState<ArchivedChampion[]>(loadChampionShelf)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const workerRef = useRef<Worker | null>(null)
  const runIdRef = useRef<string | null>(null)

  useEffect(() => {
    const worker = new Worker(new URL('../bot/learning.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<LearningWorkerOutboundMessage>) => {
      const message = event.data
      if (message.runId !== runIdRef.current) return
      if (message.type === 'started') {
        setStatus('running')
      } else if (message.type === 'generation') {
        setHistory((current) => [...current.filter((item) => item.generation !== message.snapshot.generation), message.snapshot]
          .sort((left, right) => left.generation - right.generation))
      } else if (message.type === 'complete') {
        setHistory(message.result.history)
        setResult(message.result)
        setExportableRun(message.result)
        setChampionShelf((current) => {
          const next = mergeChampionShelf(current, collectRunChampions(message.result))
          saveChampionShelf(next)
          return next
        })
        setStatus('completed')
        runIdRef.current = null
      } else if (message.type === 'cancelled') {
        setHistory(message.history)
        setExportableRun({
          config: structuredClone(message.config),
          history: message.history,
          champion: message.history.at(-1)?.champion ?? null,
          totalGames: message.totalGames,
          cancelled: true,
        })
        setStatus('stopped')
        runIdRef.current = null
      } else {
        setError(message.message)
        setStatus('error')
        runIdRef.current = null
      }
    }
    worker.onerror = () => {
      if (!runIdRef.current) return
      setError('The learning worker stopped unexpectedly.')
      setStatus('error')
      runIdRef.current = null
    }
    return () => {
      runIdRef.current = null
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if ((status !== 'running' && status !== 'stopping') || startedAt === null) return
    const update = () => setElapsedMs(Date.now() - startedAt)
    update()
    const timer = window.setInterval(update, 500)
    return () => window.clearInterval(timer)
  }, [startedAt, status])

  const snapshot = history.at(-1)
  const gamesCompleted = history.reduce((sum, item) => sum + item.gamesCompleted, 0)
  const totalGames = config.generations * config.gamesPerGeneration
  const progress = totalGames === 0 ? 0 : Math.min(1, gamesCompleted / totalGames)
  const gamesPerSecond = elapsedMs > 0 ? gamesCompleted / (elapsedMs / 1000) : 0
  const canStart = config.playerCounts.length > 0 && status !== 'running' && status !== 'stopping'
  const continuationGenerations = result ? Math.min(CONTINUATION_GENERATIONS, 100 - result.history.length) : 0

  const start = (resume?: LearningRunResult, nextConfig = config) => {
    if (!canStart || !workerRef.current || runIdRef.current) return
    const runId = `learning-${Date.now()}-${++runSequence}`
    runIdRef.current = runId
    setHistory(resume?.history ?? [])
    setResult(null)
    setExportableRun(null)
    setError(null)
    setStartedAt(Date.now())
    setElapsedMs(0)
    setStatus('running')
    post(workerRef.current, { type: 'start', runId, config: nextConfig, ...(resume ? { resume } : {}) })
  }

  const continueRun = () => {
    if (!result) return
    const generations = result.history.length + continuationGenerations
    const nextConfig = { ...result.config, generations }
    setConfig(nextConfig)
    start(result, nextConfig)
  }

  const stop = () => {
    if (status !== 'running' || !runIdRef.current || !workerRef.current) return
    setStatus('stopping')
    post(workerRef.current, { type: 'cancel', runId: runIdRef.current })
  }

  const exportResult = () => {
    if (!exportableRun) return
    const blob = new Blob([JSON.stringify(exportableRun, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `cachito-learning-seed-${exportableRun.config.seed}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const locked = status === 'running' || status === 'stopping'
  const champion = result?.finalChampion ?? snapshot?.champion

  return (
    <main className="learning-shell">
      <header className="learning-header">
        <div>
          <p className="eyebrow">Training workspace</p>
          <h1>Bot learning</h1>
        </div>
        <button className="button button--ghost" type="button" onClick={onExit}>Back to game setup</button>
      </header>

      <div className="learning-layout">
        <section className="learning-card learning-config" aria-labelledby="learning-config-title">
          <div className="learning-card-heading">
            <div><h2 id="learning-config-title">Training setup</h2><p>Choose how long and broadly the bots should practice.</p></div>
            <StatusBadge status={status} />
          </div>
          <div className="learning-fields">
            <NumberField label="Generations" value={config.generations} min={1} max={100} disabled={locked}
              onChange={(generations) => setConfig((current) => ({ ...current, generations }))} />
            <NumberField label="Population" value={config.populationSize} min={6} max={24} disabled={locked}
              onChange={(populationSize) => setConfig((current) => ({ ...current, populationSize }))} />
            <NumberField label="Games per generation" value={config.gamesPerGeneration} min={24} max={10000} disabled={locked}
              onChange={(gamesPerGeneration) => setConfig((current) => ({ ...current, gamesPerGeneration }))} />
            <NumberField label="Seed" value={config.seed} min={0} max={4_294_967_295} disabled={locked}
              onChange={(seed) => setConfig((current) => ({ ...current, seed }))} />
          </div>
          <fieldset className="learning-player-counts" disabled={locked}>
            <legend>Table sizes</legend>
            {[2, 4, 6, 8].map((count) => (
              <label key={count}>
                <input type="checkbox" checked={config.playerCounts.includes(count)} onChange={(event) => {
                  setConfig((current) => ({
                    ...current,
                    playerCounts: event.target.checked
                      ? [...current.playerCounts, count].sort((left, right) => left - right)
                      : current.playerCounts.filter((value) => value !== count),
                  }))
                }} />
                {count} players
              </label>
            ))}
          </fieldset>
          {config.playerCounts.length === 0 && <p className="learning-error" role="alert">Select at least one table size.</p>}
          {error && <p className="learning-error" role="alert">{error}</p>}
          <div className="learning-run-actions">
            <button className="button button--primary" type="button" disabled={!canStart} onClick={() => start()}>Start learning</button>
            {result && <button className="button button--secondary" type="button" disabled={!canStart || continuationGenerations === 0} onClick={continueRun}>Continue +{continuationGenerations} generations</button>}
            <button className="button button--ghost" type="button" disabled={status !== 'running'} onClick={stop}>{status === 'stopping' ? 'Stopping…' : 'Stop'}</button>
            <button className="button button--ghost learning-export" type="button" disabled={!exportableRun} onClick={exportResult}>Export run</button>
          </div>
        </section>

        <section className="learning-card learning-progress-card" aria-labelledby="learning-progress-title" aria-live="polite">
          <div className="learning-card-heading">
            <div><h2 id="learning-progress-title">Progress</h2><p>Generation {snapshot?.generation ?? 0} of {config.generations}</p></div>
            <strong>{Math.round(progress * 100)}%</strong>
          </div>
          <progress max={totalGames} value={gamesCompleted}>{Math.round(progress * 100)}%</progress>
          <dl className="learning-stats">
            <div><dt>Games</dt><dd>{gamesCompleted.toLocaleString()} / {totalGames.toLocaleString()}</dd></div>
            <div><dt>Elapsed</dt><dd>{formatDuration(elapsedMs)}</dd></div>
            <div><dt>Speed</dt><dd>{gamesPerSecond.toFixed(1)} games/sec</dd></div>
          </dl>
        </section>

        <FitnessChart history={history} />
        <RankingTable snapshot={snapshot} />
        <ChampionPanel champion={champion} />
        <RunConclusions history={history} result={result} />
        <ChampionShelf champions={championShelf} />
      </div>
    </main>
  )
}

function ChampionShelf({ champions }: { champions: ArchivedChampion[] }) {
  return <section className="learning-card learning-shelf" aria-labelledby="champion-shelf-title">
    <div className="learning-card-heading"><div><h2 id="champion-shelf-title">Champion shelf</h2><p>Training standouts collected automatically. They are not active bots.</p></div><strong>{champions.length}</strong></div>
    {champions.length === 0
      ? <p className="learning-empty">Complete a run to collect its strongest overall and table-size specialists.</p>
      : <div className="champion-shelf-grid">{champions.slice(0, 12).map((entry) => {
          const label = entry.role === 'overall' ? 'Overall champion' : `${entry.role} specialist`
          const ratio = entry.role === 'overall' ? entry.candidate.performanceRatio : entry.candidate.playerCountRatios[entry.role.slice(0, 1)]
          return <article key={entry.key} className="shelf-entry"><span>{label}</span><strong>{entry.candidate.name}</strong><small>Generation {entry.candidate.generation} · seed {entry.seed}</small><div><b>{formatScore(entry.candidate.fitness)}</b><em>{ratio == null ? '—' : `${ratio.toFixed(2)}×`}</em></div></article>
        })}</div>}
  </section>
}

function loadChampionShelf(): ArchivedChampion[] {
  try {
    const value = globalThis.localStorage?.getItem(CHAMPION_SHELF_KEY)
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as ArchivedChampion[] : []
  } catch { return [] }
}

function saveChampionShelf(champions: readonly ArchivedChampion[]) {
  try { globalThis.localStorage?.setItem(CHAMPION_SHELF_KEY, JSON.stringify(champions)) } catch { /* Shelf persistence is optional. */ }
}

function RunConclusions({ history, result }: { history: LearningGenerationSnapshot[]; result: LearningRunResult | null }) {
  const final = result?.finalChampion ?? history.at(-1)?.champion
  const first = history[0]?.champion
  const best = history.length ? history.map((entry) => entry.champion).reduce((best, candidate) => candidate.fitness > best.fitness ? candidate : best) : undefined
  if (!final || !first || !best) {
    return <section className="learning-card learning-conclusions" aria-labelledby="conclusions-title"><h2 id="conclusions-title">Run conclusions</h2><p className="learning-empty">Complete a generation to see evidence-based conclusions.</p></section>
  }
  const weakest = Object.entries(final.playerCountRatios).sort(([, left], [, right]) => (left ?? -Infinity) - (right ?? -Infinity))[0]
  const fitnessDelta = final.fitness - first.fitness
  const robust = (weakest?.[1] ?? 0) >= 1
  return <section className="learning-card learning-conclusions" aria-labelledby="conclusions-title">
    <div className="learning-card-heading"><div><h2 id="conclusions-title">Run conclusions</h2><p>Interpret the training signal before promoting a bot.</p></div><span className={`conclusion-badge conclusion-badge--${robust ? 'promising' : 'caution'}`}>{robust ? 'Promising' : 'Needs validation'}</span></div>
    <div className="conclusion-grid">
      <div><span>Final fitness</span><strong>{formatScore(final.fitness)}</strong><small>{fitnessDelta >= 0 ? '+' : ''}{formatScore(fitnessDelta)} vs generation 1</small></div>
      <div><span>Best observed</span><strong>Gen {best.generation}</strong><small>{formatScore(best.fitness)} fitness</small></div>
      <div><span>Weakest table</span><strong>{weakest ? `${weakest[0]} players` : '—'}</strong><small>{weakest?.[1] == null ? 'No result' : `${weakest[1].toFixed(2)}× fair share`}</small></div>
    </div>
    <p className="conclusion-summary">{robust
      ? 'The final champion cleared fair share at every selected table size in its latest training tournament.'
    : 'At least one selected table size is below fair share, so this candidate is not robust yet.'} {best.generation !== final.generation ? `The strongest observed candidate was from generation ${best.generation}, not the final generation.` : 'The final generation also contains the strongest observed candidate.'}</p>
    <p className="conclusion-warning">Training results are not a release decision. Run a separate held-out tournament before integrating any champion into the playable bot.</p>
  </section>
}

function post(worker: Worker, message: LearningWorkerInboundMessage) {
  worker.postMessage(message)
}

function NumberField({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void
}) {
  return <label><span>{label}</span><input type="number" value={value} min={min} max={max} disabled={disabled}
    onChange={(event) => onChange(clamp(Number(event.target.value), min, max))} /></label>
}

function StatusBadge({ status }: { status: RunStatus }) {
  const label: Record<RunStatus, string> = {
    idle: 'Ready', running: 'Running', stopping: 'Stopping', stopped: 'Stopped', completed: 'Completed', error: 'Error',
  }
  return <span className={`learning-status learning-status--${status}`}>{label[status]}</span>
}

function FitnessChart({ history }: { history: LearningGenerationSnapshot[] }) {
  const width = 720
  const height = 250
  const padding = 34
  const values = history.flatMap((item) => [item.champion.fitness, averageFitness(item)])
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const range = max - min || 1
  const point = (value: number, index: number) => ({
    x: padding + (history.length <= 1 ? (width - padding * 2) / 2 : index * (width - padding * 2) / (history.length - 1)),
    y: height - padding - (value - min) / range * (height - padding * 2),
  })
  const champion = history.map((item, index) => point(item.champion.fitness, index))
  const average = history.map((item, index) => point(averageFitness(item), index))
  const description = history.length === 0
    ? 'No generations completed yet.'
    : history.map((item) => `Generation ${item.generation}: champion ${formatScore(item.champion.fitness)}, average ${formatScore(averageFitness(item))}`).join('. ')

  return (
    <section className="learning-card learning-chart-card" aria-labelledby="fitness-title">
      <div className="learning-card-heading"><div><h2 id="fitness-title">Fitness over time</h2><p>Champion compared with the population average.</p></div></div>
      <div className="learning-chart-legend"><span className="champion-line">Champion</span><span className="average-line">Population average</span></div>
      <svg className="learning-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="fitness-title fitness-description" tabIndex={0}>
        <desc id="fitness-description">{description}</desc>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-axis" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="chart-axis" />
        {champion.length > 1 && <polyline points={toPoints(champion)} className="chart-line chart-line--champion" />}
        {average.length > 1 && <polyline points={toPoints(average)} className="chart-line chart-line--average" />}
        {champion.map((item, index) => <circle key={`c-${index}`} cx={item.x} cy={item.y} r="4" className="chart-dot chart-dot--champion" />)}
        {average.map((item, index) => <circle key={`a-${index}`} cx={item.x} cy={item.y} r="3" className="chart-dot chart-dot--average" />)}
        {history.length === 0 && <text x={width / 2} y={height / 2} textAnchor="middle" className="chart-empty">Fitness appears after the first generation</text>}
      </svg>
    </section>
  )
}

function RankingTable({ snapshot }: { snapshot?: LearningGenerationSnapshot }) {
  const candidates = snapshot?.ranking ?? []
  return (
    <section className="learning-card learning-ranking" aria-labelledby="ranking-title">
      <div className="learning-card-heading"><div><h2 id="ranking-title">Current ranking</h2><p>{snapshot ? `Generation ${snapshot.generation}` : 'Waiting for the first generation'}</p></div></div>
      <div className="learning-table-scroll">
        <table>
          <thead><tr><th>Rank</th><th>Candidate</th><th>Fitness</th><th>Performance</th><th>Dudo accuracy</th><th>Brier</th></tr></thead>
          <tbody>
            {candidates.length === 0
              ? <tr><td colSpan={6} className="learning-empty-cell">No ranking yet.</td></tr>
              : candidates.map((candidate, index) => {
                  const isChampion = candidate.id === snapshot?.champion.id
                  return <tr key={candidate.id} className={isChampion ? 'learning-champion-row' : undefined}>
                    <td>{index + 1}</td><th scope="row">{candidate.name} {isChampion && <span className="champion-marker">Champion</span>}</th>
                    <td>{formatScore(candidate.fitness)}</td><td>{candidate.performanceRatio.toFixed(2)}×</td>
                    <td>{formatPercent(candidate.dudoAccuracy)}</td><td>{formatNullable(candidate.bidBrier)}</td>
                  </tr>
                })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ChampionPanel({ champion }: { champion?: LearningGenerationSnapshot['champion'] }) {
  const playerCounts = [2, 4, 6, 8]
  return (
    <section className="learning-card learning-champion" aria-labelledby="champion-title">
      <div className="learning-card-heading"><div><h2 id="champion-title">Current champion</h2><p>{champion?.name ?? 'Not selected yet'}</p></div></div>
      {champion ? <>
        <dl className="genome-grid">
          {(Object.keys(GENOME_LABELS) as Array<keyof typeof GENOME_LABELS>).map((key) => (
            <div key={key}><dt>{GENOME_LABELS[key]}</dt><dd>{champion.genome[key].toFixed(3)}</dd></div>
          ))}
        </dl>
        <h3 className="performance-title">Performance by table size</h3>
        <div className="performance-bars">
          {playerCounts.map((count) => {
            const ratio = champion.playerCountRatios[String(count)]
            return <div key={count}><span>{count} players</span><div><i style={{ width: `${Math.min(100, (ratio ?? 0) * 50)}%` }} /></div><strong>{ratio == null ? '—' : `${ratio.toFixed(2)}×`}</strong></div>
          })}
        </div>
      </> : <p className="learning-empty">Champion parameters appear after the first generation.</p>}
    </section>
  )
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function formatScore(value: number) { return value.toFixed(3) }
function formatPercent(value: number | null) { return value === null ? '—' : `${(value * 100).toFixed(1)}%` }
function formatNullable(value: number | null) { return value === null ? '—' : value.toFixed(3) }
function toPoints(points: Array<{ x: number; y: number }>) { return points.map((item) => `${item.x},${item.y}`).join(' ') }
function averageFitness(snapshot: LearningGenerationSnapshot) {
  if (snapshot.candidates.length === 0) return 0
  return snapshot.candidates.reduce((sum, candidate) => sum + candidate.fitness, 0) / snapshot.candidates.length
}
