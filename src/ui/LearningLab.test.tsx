import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LearningCandidateResult, LearningGenerationSnapshot, LearningRunResult } from '../bot/learning'
import type { LearningWorkerInboundMessage, LearningWorkerOutboundMessage } from '../bot/learningWorkerProtocol'
import { LearningLab } from './LearningLab'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: MessageEvent<LearningWorkerOutboundMessage>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  messages: LearningWorkerInboundMessage[] = []
  terminate = vi.fn()

  constructor() { MockWorker.instances.push(this) }
  postMessage(message: LearningWorkerInboundMessage) { this.messages.push(message) }
  emit(message: LearningWorkerOutboundMessage) { this.onmessage?.({ data: message } as MessageEvent<LearningWorkerOutboundMessage>) }
}

const candidate: LearningCandidateResult = {
  generation: 1,
  id: 'candidate-1',
  name: 'Candidate 1',
  genome: { dudoThreshold: .52, calzoThreshold: .72, targetBidConfidence: .62, bluffRate: .06, nearEqualWindow: .025 },
  appearances: 100,
  wins: 30,
  performanceRatio: 1.2,
  dudoAccuracy: .64,
  calzoAccuracy: .5,
  bidBrier: .18,
  playerCountRatios: { '2': 1.1, '4': 1.2, '6': .9 },
  fitness: 1.08,
}

const DEFAULT_TEST_CONFIG = {
  generations: 12, populationSize: 8, gamesPerGeneration: 240,
  seed: 212613255, playerCounts: [2, 4, 6], eliteCount: 2,
}

function snapshot(generation = 1): LearningGenerationSnapshot {
  const entry = { ...candidate, generation, id: `candidate-${generation}`, name: `Candidate ${generation}` }
  return {
    generation,
    tournamentSeed: generation * 10,
    gamesCompleted: 240,
    gamesTotal: 240,
    candidates: [entry],
    ranking: [entry],
    champion: entry,
  }
}

function worker() { return MockWorker.instances.at(-1)! }

describe('LearningLab', () => {
  beforeEach(() => {
    MockWorker.instances = []
    vi.stubGlobal('Worker', MockWorker)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows bounded defaults and starts one worker run with the selected configuration', () => {
    render(<LearningLab onExit={vi.fn()} />)

    expect(screen.getByLabelText('Generations')).toHaveValue(12)
    expect(screen.getByLabelText('Population')).toHaveValue(8)
    expect(screen.getByLabelText('Games per generation')).toHaveValue(240)
    expect(screen.getByLabelText('2 players')).toBeChecked()
    expect(screen.getByLabelText('4 players')).toBeChecked()
    expect(screen.getByLabelText('6 players')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    expect(worker().messages).toHaveLength(1)
    expect(worker().messages[0]).toEqual({
      type: 'start',
      runId: expect.any(String),
      config: {
        generations: 12, populationSize: 8, gamesPerGeneration: 240,
        seed: 212613255, playerCounts: [2, 4, 6], eliteCount: 2,
      },
    })
    expect(screen.getByLabelText('Generations')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start learning' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export run' })).toBeDisabled()
  })

  it('renders cumulative live progress and a current generation ranking', () => {
    render(<LearningLab onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    const runId = (worker().messages[0] as Extract<LearningWorkerInboundMessage, { type: 'start' }>).runId

    act(() => worker().emit({ type: 'generation', runId, snapshot: snapshot(1) }))
    act(() => worker().emit({ type: 'generation', runId, snapshot: snapshot(2) }))

    expect(screen.getByText('Generation 2 of 12')).toBeInTheDocument()
    expect(screen.getByText('480 / 2,880')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Candidate 2 Champion/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Fitness over time/i })).toBeInTheDocument()
  })

  it('sends cancellation for the active run and shows the stopped state', () => {
    render(<LearningLab onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    const runId = (worker().messages[0] as Extract<LearningWorkerInboundMessage, { type: 'start' }>).runId
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(worker().messages[1]).toEqual({ type: 'cancel', runId })

    act(() => worker().emit({ type: 'cancelled', runId, config: DEFAULT_TEST_CONFIG, history: [snapshot()], totalGames: 240 }))
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start learning' })).toBeEnabled()
  })

  it('offers JSON export after completion', () => {
    let blobParts: BlobPart[] = []
    class CapturingBlob { constructor(parts: BlobPart[] = []) { blobParts = parts } }
    const NativeURL = URL
    class ExportURL extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:learning')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('Blob', CapturingBlob)
    vi.stubGlobal('URL', ExportURL)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<LearningLab onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    const start = worker().messages[0] as Extract<LearningWorkerInboundMessage, { type: 'start' }>
    const result: LearningRunResult = {
      config: start.config, history: [snapshot()], finalChampion: candidate, totalGames: 240, cancelled: false,
    }

    act(() => worker().emit({ type: 'complete', runId: start.runId, result }))
    expect(screen.getByText('Completed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export run' }))
    expect(JSON.parse(String(blobParts[0]))).toEqual(result)
  })

  it('exports a stopped run as a partial snapshot', () => {
    let blobParts: BlobPart[] = []
    class CapturingBlob { constructor(parts: BlobPart[] = []) { blobParts = parts } }
    const NativeURL = URL
    class ExportURL extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:learning')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('Blob', CapturingBlob)
    vi.stubGlobal('URL', ExportURL)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<LearningLab onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    const runId = (worker().messages[0] as Extract<LearningWorkerInboundMessage, { type: 'start' }>).runId
    act(() => worker().emit({ type: 'cancelled', runId, config: DEFAULT_TEST_CONFIG, history: [snapshot()], totalGames: 240 }))

    fireEvent.click(screen.getByRole('button', { name: 'Export run' }))
    expect(JSON.parse(String(blobParts[0]))).toMatchObject({ cancelled: true, totalGames: 240, history: [snapshot()] })
  })

  it('continues a completed run from its final evolved population', () => {
    render(<LearningLab onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    const start = worker().messages[0] as Extract<LearningWorkerInboundMessage, { type: 'start' }>
    const result: LearningRunResult = {
      config: start.config, history: [snapshot(1)], finalChampion: snapshot(1).champion, totalGames: 240, cancelled: false,
    }
    act(() => worker().emit({ type: 'complete', runId: start.runId, result }))

    fireEvent.click(screen.getByRole('button', { name: 'Continue +12 generations' }))
    expect(worker().messages[1]).toEqual({
      type: 'start', runId: expect.any(String),
      config: { ...start.config, generations: 13 },
      resume: result,
    })
    expect(screen.getByText('Generation 1 of 13')).toBeInTheDocument()
  })

  it('shows worker errors, exits, and terminates the worker on cleanup', () => {
    const onExit = vi.fn()
    const rendered = render(<LearningLab onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    const runId = (worker().messages[0] as Extract<LearningWorkerInboundMessage, { type: 'start' }>).runId
    act(() => worker().emit({ type: 'error', runId, message: 'Training failed safely.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Training failed safely.')

    fireEvent.click(screen.getByRole('button', { name: 'Back to game setup' }))
    expect(onExit).toHaveBeenCalledOnce()
    const activeWorker = worker()
    rendered.unmount()
    expect(activeWorker.terminate).toHaveBeenCalledOnce()
  })
})
