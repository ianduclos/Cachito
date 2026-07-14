import {
  LearningCancelledError,
  runAdversarialLearning,
  type LearningConfig,
  type LearningControl,
  type LearningGenerationSnapshot,
  type LearningRunResult,
} from './learning'
import {
  isLearningWorkerInboundMessage,
  type LearningWorkerInboundMessage,
  type LearningWorkerOutboundMessage,
} from './learningWorkerProtocol'

export type LearningRunner = (
  config: LearningConfig,
  control?: LearningControl,
) => Promise<LearningRunResult>

export interface LearningWorkerController {
  handleMessage(message: LearningWorkerInboundMessage): void
  activeRunId(): string | null
}

interface ActiveRun {
  runId: string
  config: LearningConfig
  cancelRequested: boolean
  history: LearningGenerationSnapshot[]
  totalGames: number
}

function yieldToWorkerEvents(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}

function gamesIn(snapshot: LearningGenerationSnapshot): number {
  const value = (snapshot as unknown as { gamesCompleted?: unknown }).gamesCompleted
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function cancellationSnapshot(error: unknown): { history: LearningGenerationSnapshot[]; totalGames: number } | null {
  if (!(error instanceof LearningCancelledError)) return null
  return {
    history: [...error.snapshot.history],
    totalGames: error.snapshot.totalGames,
  }
}

/** Pure controller used by both the browser worker and fast injected tests. */
export function createLearningWorkerController(
  postMessage: (message: LearningWorkerOutboundMessage) => void,
  dependencies: {
    runLearning?: LearningRunner
    yieldToEvents?: () => Promise<void>
  } = {},
): LearningWorkerController {
  const runLearning = dependencies.runLearning ?? runAdversarialLearning
  const yieldToEvents = dependencies.yieldToEvents ?? yieldToWorkerEvents
  let active: ActiveRun | null = null

  async function start(runId: string, config: LearningConfig, resume?: LearningRunResult): Promise<void> {
    const run: ActiveRun = { runId, config, cancelRequested: false, history: [], totalGames: 0 }
    active = run
    postMessage({ type: 'started', runId, config })

    try {
      const result = await runLearning(config, {
        resume,
        onGeneration: async (snapshot) => {
          if (active !== run) return
          run.history.push(snapshot)
          run.totalGames += gamesIn(snapshot)
          postMessage({ type: 'generation', runId, snapshot })
          // A macrotask yield lets the worker receive a queued cancel message.
          await yieldToEvents()
        },
        shouldCancel: () => run.cancelRequested,
      })
      if (active === run) postMessage({ type: 'complete', runId, result })
    } catch (error) {
      if (active !== run) return
      const snapshot = cancellationSnapshot(error)
      if (run.cancelRequested || snapshot) {
        postMessage({
          type: 'cancelled',
          runId,
          config,
          history: snapshot?.history ?? [...run.history],
          totalGames: snapshot?.totalGames ?? run.totalGames,
        })
      } else {
        postMessage({
          type: 'error',
          runId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      if (active === run) active = null
    }
  }

  return {
    handleMessage(message) {
      if (message.type === 'cancel') {
        if (active?.runId === message.runId) active.cancelRequested = true
        return
      }
      if (active) {
        postMessage({ type: 'error', runId: message.runId, message: `Learning run ${active.runId} is already active` })
        return
      }
      void start(message.runId, message.config, message.resume)
    },
    activeRunId: () => active?.runId ?? null,
  }
}

interface WorkerLikeScope {
  postMessage(message: LearningWorkerOutboundMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

const inWorker = typeof document === 'undefined'
  && typeof globalThis.postMessage === 'function'
  && typeof globalThis.addEventListener === 'function'

if (inWorker) {
  const scope = globalThis as unknown as WorkerLikeScope
  const controller = createLearningWorkerController((message) => scope.postMessage(message))
  scope.addEventListener('message', (event) => {
    if (isLearningWorkerInboundMessage(event.data)) {
      controller.handleMessage(event.data)
      return
    }
    const runId = typeof (event.data as { runId?: unknown } | null)?.runId === 'string'
      ? (event.data as { runId: string }).runId
      : 'unknown'
    scope.postMessage({ type: 'error', runId, message: 'Invalid learning worker message' })
  })
}
