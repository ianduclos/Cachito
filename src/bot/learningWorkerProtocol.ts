import type {
  LearningConfig,
  LearningGenerationSnapshot,
  LearningRunResult,
} from './learning'

export type LearningWorkerInboundMessage =
  | { type: 'start'; runId: string; config: LearningConfig; resume?: LearningRunResult }
  | { type: 'cancel'; runId: string }

export type LearningWorkerOutboundMessage =
  | { type: 'started'; runId: string; config: LearningConfig }
  | { type: 'generation'; runId: string; snapshot: LearningGenerationSnapshot }
  | { type: 'complete'; runId: string; result: LearningRunResult }
  | {
      type: 'cancelled'
      runId: string
      config: LearningConfig
      history: LearningGenerationSnapshot[]
      totalGames: number
    }
  | { type: 'error'; runId: string; message: string }

export function isLearningWorkerInboundMessage(value: unknown): value is LearningWorkerInboundMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (typeof message.runId !== 'string' || message.runId.length === 0) return false
  if (message.type === 'cancel') return true
  return message.type === 'start'
    && Boolean(message.config)
    && typeof message.config === 'object'
    && !Array.isArray(message.config)
    && (message.resume === undefined || (typeof message.resume === 'object' && message.resume !== null))
}
