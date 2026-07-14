import type { GameLog } from './gameLog'

export interface BackgroundSaveResult {
  saved: true
  filename: string
}

export type GameLogFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/** Sends a complete snapshot to the local/server persistence endpoint. */
export async function saveGameLogInBackground(
  log: GameLog,
  fetcher: GameLogFetch | undefined = globalThis.fetch,
): Promise<BackgroundSaveResult> {
  if (!fetcher) throw new Error('Background game-log persistence is unavailable')
  const response = await fetcher('/api/game-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(log),
    keepalive: true,
  })
  const result = await response.json() as Partial<BackgroundSaveResult> & { error?: string }
  if (!response.ok || result.saved !== true || typeof result.filename !== 'string') {
    throw new Error(result.error ?? `Background game-log save failed (${response.status})`)
  }
  return { saved: true, filename: result.filename }
}
