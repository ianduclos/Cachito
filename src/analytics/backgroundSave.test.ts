import { describe, expect, it, vi } from 'vitest'
import { saveGameLogInBackground, type GameLogFetch } from './backgroundSave'
import type { GameLog } from './gameLog'

const log: GameLog = {
  schemaVersion: 1,
  metadata: { seed: 42, startedAt: '2026-07-13T18:35:51.189Z', seats: [] },
  publicActions: [],
  roundResolutions: [],
  botDecisions: [],
  winnerId: null,
}

describe('background game-log persistence client', () => {
  it('posts a complete JSON snapshot', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      saved: true,
      filename: 'cachito-test.json',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as GameLogFetch

    await expect(saveGameLogInBackground(log, fetcher)).resolves.toEqual({
      saved: true,
      filename: 'cachito-test.json',
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith('/api/game-logs', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(log),
      keepalive: true,
    }))
  })

  it('reports server failures without mutating the snapshot', async () => {
    const original = structuredClone(log)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      saved: false,
      error: 'Disk unavailable',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })) as GameLogFetch

    await expect(saveGameLogInBackground(log, fetcher)).rejects.toThrow('Disk unavailable')
    expect(log).toEqual(original)
  })
})

