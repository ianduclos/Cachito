import { mkdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'

const ENDPOINT = '/api/game-logs'
const MAX_BODY_BYTES = 10 * 1024 * 1024

interface PersistableLog {
  schemaVersion: number
  metadata: {
    seed?: number
    startedAt?: string
    seats: unknown[]
  }
}

function isPersistableLog(value: unknown): value is PersistableLog {
  if (!value || typeof value !== 'object') return false
  const log = value as Partial<PersistableLog>
  return log.schemaVersion === 1
    && !!log.metadata
    && typeof log.metadata === 'object'
    && Array.isArray(log.metadata.seats)
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9TZ-]/g, '-').replace(/-+/g, '-')
}

export function gameLogFilename(log: PersistableLog): string {
  const timestamp = safeSegment((log.metadata.startedAt ?? 'undated').replace(/\.\d{3}Z$/, 'Z'))
  const seed = Number.isFinite(log.metadata.seed) ? String(log.metadata.seed) : 'unknown'
  return `cachito-${timestamp}-seed-${safeSegment(seed)}.json`
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw new Error('Game log exceeds the 10 MB limit')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Local-development persistence. A hosted app should provide the same endpoint server-side. */
export function gameLogPersistencePlugin(): Plugin {
  return {
    name: 'cachito-game-log-persistence',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== ENDPOINT) return next()
        response.setHeader('Content-Type', 'application/json')
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const value = await readJsonBody(request)
          if (!isPersistableLog(value)) throw new Error('Invalid game-log document')
          const logsDirectory = resolve(server.config.root, 'logs')
          const filename = gameLogFilename(value)
          const destination = resolve(logsDirectory, filename)
          const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
          await mkdir(logsDirectory, { recursive: true })
          await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
          await rename(temporary, destination)
          response.statusCode = 200
          response.end(JSON.stringify({ saved: true, filename }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({
            saved: false,
            error: error instanceof Error ? error.message : 'Could not persist game log',
          }))
        }
      })
    },
  }
}
