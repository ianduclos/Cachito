import { describe, expect, it, vi } from 'vitest'
import type {
  LearningConfig,
  LearningGenerationSnapshot,
  LearningRunResult,
} from './learning'
import {
  createLearningWorkerController,
  type LearningRunner,
} from './learning.worker'
import type { LearningWorkerOutboundMessage } from './learningWorkerProtocol'

const config = { generations: 2 } as LearningConfig
const firstGeneration = { generation: 1, gamesCompleted: 8 } as LearningGenerationSnapshot
const secondGeneration = { generation: 2, gamesCompleted: 8 } as LearningGenerationSnapshot
const result = { history: [firstGeneration, secondGeneration], totalGames: 16 } as LearningRunResult

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('learning worker controller', () => {
  it('posts start, generation progress, and completion in order', async () => {
    const messages: LearningWorkerOutboundMessage[] = []
    const runner: LearningRunner = async (_config, control) => {
      await control?.onGeneration?.(firstGeneration)
      await control?.onGeneration?.(secondGeneration)
      return result
    }
    const controller = createLearningWorkerController(messages.push.bind(messages), {
      runLearning: runner,
      yieldToEvents: async () => undefined,
    })

    controller.handleMessage({ type: 'start', runId: 'run-1', config })
    await settle()

    expect(messages).toEqual([
      { type: 'started', runId: 'run-1', config },
      { type: 'generation', runId: 'run-1', snapshot: firstGeneration },
      { type: 'generation', runId: 'run-1', snapshot: secondGeneration },
      { type: 'complete', runId: 'run-1', result },
    ])
    expect(controller.activeRunId()).toBeNull()
  })

  it('turns invalid learning configuration errors into an error message', async () => {
    const messages: LearningWorkerOutboundMessage[] = []
    const runner: LearningRunner = vi.fn(async () => {
      throw new RangeError('generations must be positive')
    })
    const controller = createLearningWorkerController(messages.push.bind(messages), { runLearning: runner })

    controller.handleMessage({ type: 'start', runId: 'invalid', config: { generations: 0 } as LearningConfig })
    await settle()

    expect(messages.at(-1)).toEqual({ type: 'error', runId: 'invalid', message: 'generations must be positive' })
    expect(controller.activeRunId()).toBeNull()
  })

  it('cooperatively cancels between generations', async () => {
    const messages: LearningWorkerOutboundMessage[] = []
    let releaseYield: (() => void) | undefined
    const runner: LearningRunner = async (_config, control) => {
      await control?.onGeneration?.(firstGeneration)
      if (await control?.shouldCancel?.()) throw new Error('cancelled')
      return result
    }
    const controller = createLearningWorkerController(messages.push.bind(messages), {
      runLearning: runner,
      yieldToEvents: () => new Promise<void>((resolve) => { releaseYield = resolve }),
    })

    controller.handleMessage({ type: 'start', runId: 'run-1', config })
    await settle()
    controller.handleMessage({ type: 'cancel', runId: 'run-1' })
    releaseYield?.()
    await settle()

    expect(messages.at(-1)).toEqual({
      type: 'cancelled',
      runId: 'run-1',
      config,
      history: [firstGeneration],
      totalGames: 8,
    })
    expect(messages.some((message) => message.type === 'complete')).toBe(false)
  })

  it('ignores cancellation for a different run id', async () => {
    const messages: LearningWorkerOutboundMessage[] = []
    let releaseYield: (() => void) | undefined
    const runner: LearningRunner = async (_config, control) => {
      await control?.onGeneration?.(firstGeneration)
      expect(await control?.shouldCancel?.()).toBe(false)
      return result
    }
    const controller = createLearningWorkerController(messages.push.bind(messages), {
      runLearning: runner,
      yieldToEvents: () => new Promise<void>((resolve) => { releaseYield = resolve }),
    })

    controller.handleMessage({ type: 'start', runId: 'run-1', config })
    await settle()
    controller.handleMessage({ type: 'cancel', runId: 'stale-run' })
    releaseYield?.()
    await settle()

    expect(messages.at(-1)?.type).toBe('complete')
    expect(messages.some((message) => message.type === 'cancelled')).toBe(false)
  })

  it('rejects a concurrent start without affecting the active run', async () => {
    const messages: LearningWorkerOutboundMessage[] = []
    let release: (() => void) | undefined
    const runner: LearningRunner = async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return result
    }
    const controller = createLearningWorkerController(messages.push.bind(messages), { runLearning: runner })

    controller.handleMessage({ type: 'start', runId: 'run-1', config })
    controller.handleMessage({ type: 'start', runId: 'run-2', config })

    expect(messages.at(-1)).toEqual({
      type: 'error',
      runId: 'run-2',
      message: 'Learning run run-1 is already active',
    })
    expect(controller.activeRunId()).toBe('run-1')
    release?.()
    await settle()
    expect(messages.at(-1)?.type).toBe('complete')
  })
})
