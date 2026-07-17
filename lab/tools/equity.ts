// Aggregates simulate.ts JSONL output into a dice-equity table: P(win) as a
// function of the public stack vector at every round-start observation.
//
// Usage:
//   npx tsx lab/tools/equity.ts lab/data/run-name.jsonl [more.jsonl] --out lab/data/run-name.equity.json
//
// See lab/tools/README.md for details.
//
// v0 is exact frequency counting, no smoothing/symmetrization (see
// lab/notes/equity-function.md caveat 5) — rare states will be noisy. A
// monotone/exchangeable smoothed estimator is future work.

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, type CompactGameRecord } from './shared'

interface Accumulator {
  n: number
  wins: number
}

function emptyAccumulator(): Accumulator {
  return { n: 0, wins: 0 }
}

function bump(map: Map<string, Accumulator>, key: string, label: number): void {
  const entry = map.get(key) ?? emptyAccumulator()
  entry.n += 1
  entry.wins += label
  map.set(key, entry)
}

function rate(entry: Accumulator): { n: number; wins: number; p: number } {
  return { n: entry.n, wins: entry.wins, p: entry.n > 0 ? entry.wins / entry.n : Number.NaN }
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`)
  console.error('Usage: npx tsx lab/tools/equity.ts <run.jsonl> [more.jsonl ...] [--out path.json]')
  process.exit(1)
}

function deriveDefaultOut(firstInput: string): string {
  const parsed = path.parse(firstInput)
  return path.join(parsed.dir, `${parsed.name}.equity.json`)
}

function readGameRecords(file: string): CompactGameRecord[] {
  const text = fs.readFileSync(path.resolve(file), 'utf8')
  return text.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as CompactGameRecord)
}

function main(): void {
  const { flags, positionals } = parseArgs(process.argv.slice(2))
  if (positionals.length === 0) printUsageAndExit('at least one input .jsonl file is required')
  const outPath = path.resolve(flags.out ?? deriveDefaultOut(positionals[0]))

  // Key: `${ownDice}|${sorted other active stacks}|${isStarter 0/1}|${playerCount}`.
  // playerCount is the original table size for the game (not the currently-active
  // count, which is already implied by the length of the "other stacks" list) —
  // see report for this judgment call.
  const stateAcc = new Map<string, Accumulator>()
  // Key: `${playerCount}|${ownDice}` for the marginal die-value curve.
  const marginalAcc = new Map<string, Accumulator>()
  const starterAcc = { starter: emptyAccumulator(), nonStarter: emptyAccumulator() }

  let totalGames = 0
  let totalObservations = 0

  for (const file of positionals) {
    const records = readGameRecords(file)
    for (const record of records) {
      totalGames += 1
      const playerCount = record.players
      for (const row of record.roundRows) {
        const activeIds = Object.keys(row.stacks).filter((id) => row.stacks[id] > 0)
        for (const playerId of activeIds) {
          const ownDice = row.stacks[playerId]
          const others = activeIds
            .filter((id) => id !== playerId)
            .map((id) => row.stacks[id])
            .sort((a, b) => a - b)
            .join(',')
          const isStarter = playerId === row.starterId ? 1 : 0
          const label = playerId === record.winnerId ? 1 : 0

          bump(stateAcc, `${ownDice}|${others}|${isStarter}|${playerCount}`, label)
          bump(marginalAcc, `${playerCount}|${ownDice}`, label)
          const starterBucket = isStarter ? starterAcc.starter : starterAcc.nonStarter
          starterBucket.n += 1
          starterBucket.wins += label
          totalObservations += 1
        }
      }
    }
  }

  const states: Record<string, { n: number; wins: number; p: number }> = {}
  for (const [key, value] of stateAcc) states[key] = rate(value)

  const marginalByOwnDice: Record<string, Record<string, { n: number; wins: number; p: number }>> = {}
  for (const [key, value] of marginalAcc) {
    const [playerCount, ownDice] = key.split('|')
    marginalByOwnDice[playerCount] ??= {}
    marginalByOwnDice[playerCount][ownDice] = rate(value)
  }

  const marginalDeltas: Record<string, Record<string, number>> = {}
  for (const [playerCount, byDice] of Object.entries(marginalByOwnDice)) {
    const diceValues = Object.keys(byDice).map(Number).sort((a, b) => a - b)
    marginalDeltas[playerCount] = {}
    for (let index = 1; index < diceValues.length; index += 1) {
      const current = diceValues[index]
      const previous = diceValues[index - 1]
      marginalDeltas[playerCount][String(current)] = byDice[String(current)].p - byDice[String(previous)].p
    }
  }

  const starterVsNonStarter = {
    starter: rate(starterAcc.starter),
    nonStarter: rate(starterAcc.nonStarter),
  }

  const output = {
    generatedAt: new Date().toISOString(),
    files: positionals,
    totalGames,
    totalObservations,
    stateCount: stateAcc.size,
    states,
    marginalByOwnDice,
    marginalDeltas,
    starterVsNonStarter,
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  console.log(`Processed ${totalGames} games from ${positionals.length} file(s): ${totalObservations} round-start observations, ${stateAcc.size} distinct state keys.\n`)

  console.log('Marginal die value: P(win) by own dice, per player count (delta vs one fewer die)')
  for (const playerCount of Object.keys(marginalByOwnDice).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  players=${playerCount}:`)
    const byDice = marginalByOwnDice[playerCount]
    for (const dice of Object.keys(byDice).sort((a, b) => Number(a) - Number(b))) {
      const stats = byDice[dice]
      const delta = marginalDeltas[playerCount][dice]
      const deltaText = delta === undefined ? '' : `  delta=${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`
      console.log(`    dice=${dice}: p=${stats.p.toFixed(4)} (n=${stats.n})${deltaText}`)
    }
  }

  console.log(`\nStarter vs non-starter P(win):`)
  console.log(`  starter:     p=${starterVsNonStarter.starter.p.toFixed(4)} (n=${starterVsNonStarter.starter.n})`)
  console.log(`  non-starter: p=${starterVsNonStarter.nonStarter.p.toFixed(4)} (n=${starterVsNonStarter.nonStarter.n})`)

  console.log(`\nWrote ${outPath}`)
}

main()
