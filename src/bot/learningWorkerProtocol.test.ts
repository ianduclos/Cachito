import { describe, expect, it } from 'vitest'
import { isLearningWorkerInboundMessage } from './learningWorkerProtocol'

describe('learning worker protocol', () => {
  it('accepts serializable start and cancel messages', () => {
    expect(isLearningWorkerInboundMessage({ type: 'start', runId: 'run-1', config: { generations: 3 } })).toBe(true)
    expect(isLearningWorkerInboundMessage({ type: 'cancel', runId: 'run-1' })).toBe(true)
  })

  it('rejects malformed or undiscriminated messages', () => {
    expect(isLearningWorkerInboundMessage(null)).toBe(false)
    expect(isLearningWorkerInboundMessage({ type: 'start', runId: '', config: {} })).toBe(false)
    expect(isLearningWorkerInboundMessage({ type: 'start', runId: 'run-1' })).toBe(false)
    expect(isLearningWorkerInboundMessage({ type: 'pause', runId: 'run-1' })).toBe(false)
  })
})
