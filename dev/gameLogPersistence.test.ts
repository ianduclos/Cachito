import { describe, expect, it } from 'vitest'
import { gameLogFilename } from './gameLogPersistence'

describe('local game-log filenames', () => {
  it('matches the manual export filename and removes milliseconds', () => {
    expect(gameLogFilename({
      schemaVersion: 1,
      metadata: {
        seed: 212613255,
        startedAt: '2026-07-13T18:35:51.189Z',
        seats: [],
      },
    })).toBe('cachito-2026-07-13T18-35-51Z-seed-212613255.json')
  })

  it('uses stable fallbacks for deterministic headless logs', () => {
    expect(gameLogFilename({
      schemaVersion: 1,
      metadata: { seats: [] },
    })).toBe('cachito-undated-seed-unknown.json')
  })
})

