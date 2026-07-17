// Converts online-room match logs (schema v4, written by dev/onlineRooms.ts) into the
// lab's CompactGameRecord JSONL, so every analysis tool (starting with equity.ts) runs
// identically on simulated and real human/hybrid games.
//
// Usage:
//   npx tsx lab/tools/ingest.ts <file-or-dir> [more...] --out lab/data/rooms.jsonl
//
// See lab/tools/README.md for details. Reuses the real engine's `countBid` for ground-truth
// round resolution; never reimplements bid/count rules.

import fs from 'node:fs'
import path from 'node:path'
import { countBid, type Bid, type Die, type GameRules } from '../../src/engine'
import { parseArgs, type CompactGameRecord, type CompactRoundOutcome, type CompactRoundRow, type CompactSeat, type CompactTurn } from './shared'

// ---- v4 room-log shapes ----------------------------------------------------------------
// Kept local (not imported from dev/onlineRooms.ts) so this tool never pulls in the live
// WebSocket server module — it only needs to describe the JSON the server already wrote.

interface RoomSeatV4 {
  id: string
  name: string
  nickname: string
  controller: 'human' | 'bot'
}

type RoomGameActionV4 =
  | { type: 'bid'; playerId: string; bid: { quantity: number; denomination: number }; tableDiceIndices?: number[] }
  | { type: 'dudo'; playerId: string }
  | { type: 'calzo'; playerId: string }
  | { type: 'nextRound' }
  | { type: 'round-start' }
  | { type: 'shuffle-dice' }
  | { type: 'pause-game' }
  | { type: 'resume-game' }

interface RoomActionV4 {
  at: string
  playerId?: string
  nickname?: string
  action: RoomGameActionV4
  tableDice?: number[]
  rerolledDice?: number[]
}

interface RoundDealV4 {
  round: number
  dealtAt: string
  paloFijo: boolean
  starterId: string
  hands: Array<{ playerId: string; nickname: string; dice: number[] }>
}

interface TurnTimingV4 {
  round: number
  playerId: string
  nickname: string
  controller: 'human' | 'bot'
  startedAt: string
  deadlineAt: string
  finishedAt?: string
  elapsedMs?: number
  remainingMs?: number
  outcome?: 'bid' | 'dudo' | 'calzo' | 'timeout'
}

interface RoomStateV4 {
  phase: string
  players: Array<{ id: string; name: string; diceCount: number }>
  winnerId?: string
}

interface RoomLogV4 {
  schemaVersion: number
  roomCode: string
  startedAt: string
  updatedAt: string
  rules: GameRules
  seats: RoomSeatV4[]
  history: string[]
  actions: RoomActionV4[]
  roundDeals: RoundDealV4[]
  turnTimings: TurnTimingV4[]
  state: RoomStateV4
}

// ---- parsing helpers --------------------------------------------------------------------

function toDie(value: number): Die {
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error(`Invalid die value: ${value}`)
  return value as Die
}

/** Splits the flat actions log into one array of bid/dudo/calzo decisions per round. */
function segmentDecisionsByRound(actions: readonly RoomActionV4[]): RoomActionV4[][] {
  const segments: RoomActionV4[][] = []
  let current: RoomActionV4[] = []
  for (const entry of actions) {
    const type = entry.action.type
    if (type === 'round-start') {
      current = []
    } else if (type === 'nextRound') {
      segments.push(current)
      current = []
    } else if (type === 'bid' || type === 'dudo' || type === 'calzo') {
      current.push(entry)
    }
    // shuffle-dice / pause-game / resume-game carry no round-resolution information.
  }
  if (current.length > 0) segments.push(current) // trailing unresolved round (defensive; skipped later)
  return segments
}

interface ReconstructedHands {
  hands: Map<string, Die[]>
  tableDice: Map<string, Die[]>
  /** playerIds whose table-dice bid this round had no recorded rerolledDice/tableDice — reveal-time hand unknown. */
  missingRerollFor: string[]
}

/**
 * Reconstructs each active player's true dice for the round: the dealt hand from
 * roundDeals, overwritten by the post-reroll hand for anyone who put dice on the table
 * this round (a table-dice bid rerolls the bidder's remaining private dice — round-start
 * hands alone are stale for that player from that point on).
 */
function reconstructHands(roundDeal: RoundDealV4, decisions: readonly RoomActionV4[]): ReconstructedHands {
  const hands = new Map<string, Die[]>(roundDeal.hands.map((hand) => [hand.playerId, hand.dice.map(toDie)]))
  const tableDice = new Map<string, Die[]>()
  const missingRerollFor: string[] = []
  for (const entry of decisions) {
    if (entry.action.type !== 'bid' || !entry.action.tableDiceIndices?.length) continue
    const playerId = entry.playerId ?? entry.action.playerId
    if (entry.rerolledDice && entry.tableDice) {
      hands.set(playerId, entry.rerolledDice.map(toDie))
      tableDice.set(playerId, [...(tableDice.get(playerId) ?? []), ...entry.tableDice.map(toDie)])
    } else {
      // No reroll data recorded for this table-dice bid: the reveal-time hand for this
      // player cannot be reconstructed. Leave the pre-reroll hand in place (best effort,
      // may be wrong) and flag the round as unverifiable.
      missingRerollFor.push(playerId)
    }
  }
  return { hands, tableDice, missingRerollFor }
}

function computeActualCount(hands: Map<string, Die[]>, tableDice: Map<string, Die[]>, paloFijo: boolean, bid: Bid): number {
  const players = [...hands.keys()].map((playerId) => ({ hand: hands.get(playerId) ?? [], tableDice: tableDice.get(playerId) ?? [] }))
  // countBid only reads `.paloFijo` and `.players[].hand/.tableDice`; this is a narrow,
  // intentional fake GameState so we can reuse the engine's authoritative counting logic
  // without reconstructing a full playable game.
  const fakeState = { paloFijo, players } as unknown as Parameters<typeof countBid>[0]
  return countBid(fakeState, bid)
}

/** Matches each round decision to its turnTimings entry: positional first, playerId fallback. */
function matchTimings(decisions: readonly RoomActionV4[], timings: readonly TurnTimingV4[]): Array<TurnTimingV4 | undefined> {
  const used = new Array(timings.length).fill(false)
  return decisions.map((entry, index) => {
    const playerId = entry.playerId ?? (entry.action as { playerId?: string }).playerId
    if (index < timings.length && !used[index] && timings[index].playerId === playerId) {
      used[index] = true
      return timings[index]
    }
    const fallback = timings.findIndex((timing, timingIndex) => !used[timingIndex] && timing.playerId === playerId)
    if (fallback >= 0) {
      used[fallback] = true
      return timings[fallback]
    }
    return undefined
  })
}

/** Conservative: no timing data, an orphaned (never-finished) record, or an explicit
 * "timeout" outcome, or a finish at/after the deadline all count as covered. */
function isCovered(timing: TurnTimingV4 | undefined): boolean {
  if (!timing) return true
  if (timing.outcome === 'timeout') return true
  if (!timing.finishedAt) return true
  return Date.parse(timing.finishedAt) >= Date.parse(timing.deadlineAt)
}

function buildTurns(decisions: readonly RoomActionV4[], matchedTimings: readonly (TurnTimingV4 | undefined)[]): CompactTurn[] {
  return decisions.map((entry, index) => {
    const timing = matchedTimings[index]
    const playerId = (entry.playerId ?? (entry.action as { playerId?: string }).playerId)!
    const action: CompactTurn['action'] = entry.action.type === 'bid'
      ? { type: 'bid', quantity: entry.action.bid.quantity, denomination: entry.action.bid.denomination, ...(entry.action.tableDiceIndices ? { tableDiceIndices: entry.action.tableDiceIndices } : {}) }
      : { type: entry.action.type as 'dudo' | 'calzo' }
    return { playerId, action, ...(timing?.elapsedMs !== undefined ? { elapsedMs: timing.elapsedMs } : {}), covered: isCovered(timing) }
  })
}

/**
 * Independent, dice-agnostic check: which side (bidder or caller) actually lost/gained
 * dice tells us whether the call was correct, without needing to know any hand contents.
 * Always available (uses only round-transition stack deltas); a mismatch against the
 * countBid-derived `correct` is a genuine red flag.
 */
function deltaImpliedCorrect(kind: 'dudo' | 'calzo', bidderId: string, callerId: string, stacks: Record<string, number>, deltas: Record<string, number>): boolean | undefined {
  if (kind === 'dudo') {
    if (deltas[bidderId] === -1) return true
    if (deltas[callerId] === -1) return false
    return undefined
  }
  const callerDelta = deltas[callerId] ?? 0
  if (callerDelta === -2) return false
  if (callerDelta === 1) return true
  if (callerDelta === 0 && stacks[callerId] === 5) return true // correct calzo capped at 5 dice
  return undefined
}

interface RoundParseResult {
  row: CompactRoundRow
  tableDiceUsed: boolean
  unverifiable: boolean
  deltaCrossCheck: 'match' | 'mismatch' | 'inconclusive' | 'skipped'
}

function parseRound(roundDeal: RoundDealV4, decisions: readonly RoomActionV4[], timingsForRound: readonly TurnTimingV4[], nextStacks: Record<string, number>): RoundParseResult | undefined {
  if (decisions.length === 0) return undefined
  const last = decisions[decisions.length - 1]
  if (last.action.type !== 'dudo' && last.action.type !== 'calzo') return undefined // incomplete/abandoned round

  const bidDecisions = decisions.filter((entry): entry is RoomActionV4 & { action: Extract<RoomGameActionV4, { type: 'bid' }> } => entry.action.type === 'bid')
  const lastBid = bidDecisions[bidDecisions.length - 1]
  if (!lastBid) return undefined // dudo/calzo with no preceding bid is invalid, skip defensively

  const bidderId = (lastBid.playerId ?? lastBid.action.playerId)!
  const kind = last.action.type
  const callerId = (last.playerId ?? last.action.playerId)!
  const bid: Bid = { quantity: lastBid.action.bid.quantity, denomination: toDie(lastBid.action.bid.denomination) }

  const stacks: Record<string, number> = {}
  for (const hand of roundDeal.hands) stacks[hand.playerId] = hand.dice.length

  const { hands, tableDice, missingRerollFor } = reconstructHands(roundDeal, decisions)
  const tableDiceUsed = tableDice.size > 0
  const unverifiable = missingRerollFor.length > 0

  const actualCount = computeActualCount(hands, tableDice, roundDeal.paloFijo, bid)
  const correct = kind === 'dudo' ? actualCount < bid.quantity : actualCount === bid.quantity

  const deltas: Record<string, number> = {}
  for (const playerId of Object.keys(stacks)) deltas[playerId] = (nextStacks[playerId] ?? 0) - stacks[playerId]

  const matchedTimings = matchTimings(decisions, timingsForRound)
  const turns = buildTurns(decisions, matchedTimings)

  const outcome: CompactRoundOutcome = { kind, callerId, bidderId, bid: { quantity: bid.quantity, denomination: bid.denomination }, correct, actualCount }
  const row: CompactRoundRow = { round: roundDeal.round, starterId: roundDeal.starterId, stacks, paloFijo: roundDeal.paloFijo, bids: bidDecisions.length, outcome, deltas, turns }

  let deltaCrossCheck: RoundParseResult['deltaCrossCheck'] = 'skipped'
  if (!unverifiable) {
    const implied = deltaImpliedCorrect(kind, bidderId, callerId, stacks, deltas)
    deltaCrossCheck = implied === undefined ? 'inconclusive' : implied === correct ? 'match' : 'mismatch'
  }

  return { row, tableDiceUsed, unverifiable, deltaCrossCheck }
}

/**
 * `history` is a rolling window (server keeps only the most recent 30 entries), so it
 * cannot be reliably mapped to absolute round numbers for older rounds (it also contains a
 * benign duplicate "Round N begins." line right at game-over). Instead: pull the resolution
 * lines out in their newest-first order and compare them, purely positionally, against the
 * derived outcomes of the most recent rounds (also newest-first) — no round-number math.
 */
function crossCheckHistory(history: readonly string[], derivedChronological: readonly { round: number; correct: boolean; actualCount: number }[]): { checked: number; mismatchRounds: number[] } {
  const resolutionRe = /^(?:Dudo|Calzo): (correct|incorrect) — (\d+) actual\.$/
  const parsed: Array<{ correct: boolean; actualCount: number }> = []
  for (const line of history) {
    const match = line.match(resolutionRe)
    if (match) parsed.push({ correct: match[1] === 'correct', actualCount: Number(match[2]) })
  }
  const derivedNewestFirst = [...derivedChronological].reverse()
  const checked = Math.min(parsed.length, derivedNewestFirst.length)
  const mismatchRounds: number[] = []
  for (let index = 0; index < checked; index += 1) {
    const derived = derivedNewestFirst[index]
    const found = parsed[index]
    if (found.correct !== derived.correct || found.actualCount !== derived.actualCount) mismatchRounds.push(derived.round)
  }
  return { checked, mismatchRounds }
}

interface FileSummary {
  file: string
  players: number
  humans: number
  rounds: number
  covered: number
  tableDiceRounds: number
  unverifiableRounds: number
  deltaMatches: number
  deltaMismatches: number
  deltaInconclusive: number
  historyChecked: number
  historyMismatches: number
}

function ingestFile(filePath: string, gameIndex: number): { record: CompactGameRecord; summary: FileSummary } | undefined {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    console.error(`Skipping ${filePath}: cannot read file (${(error as Error).message})`)
    return undefined
  }

  let data: RoomLogV4
  try {
    data = JSON.parse(text) as RoomLogV4
  } catch (error) {
    console.error(`Skipping ${filePath}: invalid JSON (${(error as Error).message})`)
    return undefined
  }

  if (data.schemaVersion !== 4) {
    console.error(`Skipping ${filePath}: schemaVersion ${data.schemaVersion} (only v4 is supported)`)
    return undefined
  }
  if (!data.state || data.state.phase !== 'gameOver' || !data.state.winnerId) {
    console.error(`Skipping ${filePath}: game is not finished (no winnerId in final state)`)
    return undefined
  }

  const segments = segmentDecisionsByRound(data.actions)
  const roundCount = Math.min(segments.length, data.roundDeals.length)
  if (segments.length !== data.roundDeals.length) {
    console.error(`Warning: ${filePath}: ${segments.length} action-derived round segments vs ${data.roundDeals.length} roundDeals entries; processing ${roundCount}`)
  }

  const rows: CompactRoundRow[] = []
  const derivedForHistoryCheck: Array<{ round: number; correct: boolean; actualCount: number }> = []
  let covered = 0
  let tableDiceRounds = 0
  let unverifiableRounds = 0
  let deltaMatches = 0
  let deltaMismatches = 0
  let deltaInconclusive = 0

  for (let index = 0; index < roundCount; index += 1) {
    const roundDeal = data.roundDeals[index]
    const decisions = segments[index]
    const timingsForRound = data.turnTimings.filter((timing) => timing.round === roundDeal.round)
    const nextStacks = index + 1 < data.roundDeals.length
      ? Object.fromEntries(data.roundDeals[index + 1].hands.map((hand) => [hand.playerId, hand.dice.length]))
      : Object.fromEntries(data.state.players.map((player) => [player.id, player.diceCount]))

    const parsed = parseRound(roundDeal, decisions, timingsForRound, nextStacks)
    if (!parsed) {
      console.error(`Warning: ${filePath}: round ${roundDeal.round} has no dudo/calzo resolution in the actions log, skipping`)
      continue
    }

    rows.push(parsed.row)
    derivedForHistoryCheck.push({ round: parsed.row.round, correct: parsed.row.outcome.correct, actualCount: parsed.row.outcome.actualCount })
    covered += parsed.row.turns?.filter((turn) => turn.covered).length ?? 0
    if (parsed.tableDiceUsed) tableDiceRounds += 1
    if (parsed.unverifiable) unverifiableRounds += 1
    if (parsed.deltaCrossCheck === 'match') deltaMatches += 1
    else if (parsed.deltaCrossCheck === 'mismatch') deltaMismatches += 1
    else if (parsed.deltaCrossCheck === 'inconclusive') deltaInconclusive += 1
  }

  const historyCheck = crossCheckHistory(data.history, derivedForHistoryCheck)

  const seats: CompactSeat[] = data.seats.map((seat) => ({ id: seat.id, policy: seat.nickname || seat.name, controller: seat.controller }))
  const humans = seats.filter((seat) => seat.controller === 'human').length
  const totalDecisions = data.actions.filter((entry) => entry.action.type === 'bid' || entry.action.type === 'dudo' || entry.action.type === 'calzo').length

  const record: CompactGameRecord = {
    game: gameIndex,
    seed: 0, // no RNG seed concept for real games; roomCode is the real identifier
    players: seats.length,
    seats,
    winnerId: data.state.winnerId!,
    rounds: rows.length,
    actions: totalDecisions,
    roundRows: rows,
    source: 'room',
    roomCode: data.roomCode,
    startedAt: data.startedAt,
    rules: data.rules,
  }

  const summary: FileSummary = {
    file: filePath,
    players: seats.length,
    humans,
    rounds: rows.length,
    covered,
    tableDiceRounds,
    unverifiableRounds,
    deltaMatches,
    deltaMismatches,
    deltaInconclusive,
    historyChecked: historyCheck.checked,
    historyMismatches: historyCheck.mismatchRounds.length,
  }

  return { record, summary }
}

function collectInputFiles(inputs: readonly string[]): string[] {
  const files: string[] = []
  for (const input of inputs) {
    const resolved = path.resolve(input)
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved).sort()) {
        if (entry.toLowerCase().endsWith('.json')) files.push(path.join(resolved, entry))
      }
    } else {
      files.push(resolved)
    }
  }
  return files
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`)
  console.error('Usage: npx tsx lab/tools/ingest.ts <file-or-dir> [more...] --out lab/data/rooms.jsonl')
  process.exit(1)
}

function main(): void {
  const { flags, positionals } = parseArgs(process.argv.slice(2))
  if (positionals.length === 0) printUsageAndExit('at least one input file or directory is required')
  if (!flags.out) printUsageAndExit('--out is required (output .jsonl path)')
  const outPath = path.resolve(flags.out)

  const files = collectInputFiles(positionals)
  const lines: string[] = []
  let gameIndex = 0
  let filesOk = 0
  let filesSkipped = 0
  const totals = { rounds: 0, covered: 0, tableDiceRounds: 0, unverifiableRounds: 0, deltaMatches: 0, deltaMismatches: 0, deltaInconclusive: 0, historyChecked: 0, historyMismatches: 0, humans: 0, players: 0 }

  for (const file of files) {
    const result = ingestFile(file, gameIndex)
    if (!result) {
      filesSkipped += 1
      continue
    }
    lines.push(JSON.stringify(result.record))
    gameIndex += 1
    filesOk += 1
    const s = result.summary
    console.log(`${path.basename(file)}: players=${s.players} humans=${s.humans} rounds=${s.rounds} covered=${s.covered} tableDiceRounds=${s.tableDiceRounds} unverifiable=${s.unverifiableRounds} deltaCheck(match=${s.deltaMatches} mismatch=${s.deltaMismatches} inconclusive=${s.deltaInconclusive}) historyCheck(checked=${s.historyChecked} mismatches=${s.historyMismatches})`)
    totals.rounds += s.rounds
    totals.covered += s.covered
    totals.tableDiceRounds += s.tableDiceRounds
    totals.unverifiableRounds += s.unverifiableRounds
    totals.deltaMatches += s.deltaMatches
    totals.deltaMismatches += s.deltaMismatches
    totals.deltaInconclusive += s.deltaInconclusive
    totals.historyChecked += s.historyChecked
    totals.historyMismatches += s.historyMismatches
    totals.humans += s.humans
    totals.players += s.players
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, lines.length > 0 ? `${lines.join('\n')}\n` : '')

  console.log(`\nIngested ${filesOk} file(s) (${filesSkipped} skipped) -> ${lines.length} game(s) written to ${outPath}`)
  console.log(`Rounds: ${totals.rounds} | covered moves: ${totals.covered} | table-dice rounds: ${totals.tableDiceRounds} | unverifiable (missing reroll data): ${totals.unverifiableRounds}`)
  console.log(`Delta cross-check (bidder/caller stack deltas vs derived correctness): ${totals.deltaMatches} match, ${totals.deltaMismatches} mismatch, ${totals.deltaInconclusive} inconclusive`)
  console.log(`History cross-check (recent rounds only, rolling 30-entry window): ${totals.historyChecked} resolutions checked, ${totals.historyMismatches} mismatches`)
  if (totals.deltaMismatches > 0 || totals.historyMismatches > 0) {
    console.error('\nWARNING: ground-truth mismatches detected above — investigate before trusting this output.')
  }
}

main()
