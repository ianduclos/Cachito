// Shared helpers for lab/tools CLIs. No external dependencies; run via `npx tsx`.

import type { GameRules } from '../../src/engine'

/**
 * Deterministic seed mixer, copied verbatim from `src/bot/simulator.ts`
 * (that function is not exported, and lab/ must not edit src/ to export it).
 * Used to derive a distinct, reproducible seed per game from a single --seed.
 */
export function mixSeed(seed: number, stream: number): number {
  let value = (seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x21f0aaad)
  value ^= value >>> 15
  return value >>> 0
}

export interface ParsedArgs {
  flags: Record<string, string>
  positionals: string[]
}

/** Minimal `--flag value` / positional argument parser (no external deps). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string> = {}
  const positionals: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        index += 1
      } else {
        flags[key] = 'true'
      }
    } else {
      positionals.push(token)
    }
  }
  return { flags, positionals }
}

/** Case/spacing-insensitive policy name matching, e.g. "exact-seeker" === "Exact seeker". */
export function normalizePolicyName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '')
}

export interface CompactSeat {
  id: string
  policy: string
  controller: 'bot' | 'human'
}

export interface CompactRoundOutcome {
  kind: 'dudo' | 'calzo'
  callerId: string
  bidderId: string
  bid: { quantity: number; denomination: number }
  correct: boolean
  actualCount: number
}

/** A single bid/dudo/calzo decision within a round, in the order it happened. */
export interface CompactTurn {
  playerId: string
  action:
    | { type: 'bid'; quantity: number; denomination: number; tableDiceIndices?: number[] }
    | { type: 'dudo' | 'calzo' }
  elapsedMs?: number
  /** True when a timeout bot made this move on behalf of a human seat. Exclude from human-style analysis. */
  covered?: boolean
}

export interface CompactRoundRow {
  round: number
  starterId: string
  stacks: Record<string, number>
  paloFijo: boolean
  bids: number
  outcome: CompactRoundOutcome
  deltas: Record<string, number>
  /** Per-turn sequence for the round. Present on ingest.ts output; the compact sim format omits it. */
  turns?: CompactTurn[]
}

/** One line of simulate.ts or ingest.ts JSONL output. */
export interface CompactGameRecord {
  game: number
  seed: number
  players: number
  seats: CompactSeat[]
  winnerId: string
  rounds: number
  actions: number
  roundRows: CompactRoundRow[]
  /** Provenance: 'sim' (simulate.ts, default assumed when absent) or 'room' (ingest.ts, real match log). */
  source?: 'sim' | 'room'
  roomCode?: string
  startedAt?: string
  rules?: GameRules
}
