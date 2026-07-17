// Batch headless self-play runner. Imports the real engine/bots; never reimplements rules.
//
// Usage:
//   npx tsx lab/tools/simulate.ts --games 2000 --players 4 \
//     --policies conservative,baseline --seed 1 --out lab/data/run-name.jsonl
//
// See lab/tools/README.md for details.

import fs from 'node:fs'
import path from 'node:path'
import { createAdversarialPolicyLeague, runBotMatch, type BotPolicy, type BotSeat, type MatchResult } from '../../src/bot'
import { MAX_PLAYERS } from '../../src/engine'
import { mixSeed, normalizePolicyName, parseArgs, type CompactGameRecord, type CompactRoundRow } from './shared'

const PROGRESS_INTERVAL = 500

interface CliOptions {
  games: number
  players: number
  policyNames: string[]
  seed: number
  out: string
  maxActions?: number
}

function printUsageAndExit(message?: string): never {
  const league = createAdversarialPolicyLeague()
  if (message) console.error(`Error: ${message}\n`)
  console.error('Usage: npx tsx lab/tools/simulate.ts --games <n> --players <n> --policies <name,name,...> --seed <n> --out <path> [--maxActions <n>]')
  console.error(`Valid policies: ${league.map((policy) => policy.name).join(', ')}`)
  process.exit(1)
}

function parseCliOptions(): CliOptions {
  const { flags } = parseArgs(process.argv.slice(2))
  const games = Number(flags.games)
  const players = Number(flags.players)
  const seed = flags.seed !== undefined ? Number(flags.seed) : 1
  const out = flags.out
  const maxActions = flags.maxActions !== undefined ? Number(flags.maxActions) : undefined

  if (!Number.isInteger(games) || games < 1) printUsageAndExit('--games must be a positive integer')
  if (!Number.isInteger(players) || players < 2 || players > MAX_PLAYERS) printUsageAndExit(`--players must be an integer between 2 and ${MAX_PLAYERS}`)
  if (!flags.policies) printUsageAndExit('--policies is required (comma-separated policy names)')
  if (!out) printUsageAndExit('--out is required (output .jsonl path)')
  if (!Number.isInteger(seed)) printUsageAndExit('--seed must be an integer')
  if (maxActions !== undefined && (!Number.isInteger(maxActions) || maxActions < 1)) printUsageAndExit('--maxActions must be a positive integer')

  const policyNames = flags.policies.split(',').map((name) => name.trim()).filter(Boolean)
  if (policyNames.length === 0) printUsageAndExit('--policies must list at least one policy name')

  return { games, players, policyNames, seed, out, maxActions }
}

function resolvePolicies(names: readonly string[]): BotPolicy[] {
  const league = createAdversarialPolicyLeague()
  const lookup = new Map(league.map((policy) => [normalizePolicyName(policy.name), policy]))
  return names.map((name) => lookup.get(normalizePolicyName(name)) ?? printUsageAndExit(
    `Unknown policy "${name}". Valid policies: ${league.map((policy) => policy.name).join(', ')}`,
  ))
}

/** Round-robins policies to seats, rotating the assignment each game so no policy owns a seat. */
function seatPolicyForGame(policies: readonly BotPolicy[], seatIndex: number, gameIndex: number): BotPolicy {
  const offset = gameIndex % policies.length
  return policies[(seatIndex + offset) % policies.length]
}

function buildRoundRows(result: MatchResult): CompactRoundRow[] {
  const decisionsByRound = new Map<number, typeof result.log.botDecisions>()
  for (const decision of result.log.botDecisions) {
    const list = decisionsByRound.get(decision.round)
    if (list) list.push(decision)
    else decisionsByRound.set(decision.round, [decision])
  }

  return result.log.roundResolutions.map((resolved) => {
    const decisions = decisionsByRound.get(resolved.round) ?? []
    const first = decisions[0]
    const stacks: Record<string, number> = {}
    for (const entry of first?.publicDiceCounts ?? []) stacks[entry.playerId] = entry.diceCount
    const bids = decisions.filter((decision) => decision.chosenAction.type === 'bid').length
    const deltas: Record<string, number> = {}
    for (const change of resolved.resolution.diceChanges) deltas[change.playerId] = change.delta

    return {
      round: resolved.round,
      // Every round has at least one bot decision before it resolves, so `first` exists in practice.
      starterId: first?.playerId ?? resolved.resolution.bidderId,
      stacks,
      paloFijo: resolved.paloFijo,
      bids,
      outcome: {
        kind: resolved.resolution.kind,
        callerId: resolved.resolution.callerId,
        bidderId: resolved.resolution.bidderId,
        bid: { ...resolved.resolution.bid },
        correct: resolved.resolution.correct,
        actualCount: resolved.resolution.actualCount,
      },
      deltas,
    }
  })
}

function buildGameRecord(gameIndex: number, seed: number, seats: readonly BotSeat[], result: MatchResult): CompactGameRecord {
  return {
    game: gameIndex,
    seed,
    players: seats.length,
    seats: seats.map((seat) => ({ id: seat.id, policy: seat.policy.name, controller: 'bot' })),
    winnerId: result.winnerId,
    rounds: result.rounds,
    actions: result.actions,
    roundRows: buildRoundRows(result),
  }
}

function main(): void {
  const options = parseCliOptions()
  const policies = resolvePolicies(options.policyNames)
  const outPath = path.resolve(options.out)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const wins: Record<string, number> = {}
  for (const policy of policies) wins[policy.name] = 0
  const lines: string[] = []
  let errors = 0
  const start = Date.now()

  for (let gameIndex = 0; gameIndex < options.games; gameIndex += 1) {
    const seats: BotSeat[] = Array.from({ length: options.players }, (_, seatIndex) => {
      const policy = seatPolicyForGame(policies, seatIndex, gameIndex)
      return { id: `seat-${seatIndex + 1}`, name: policy.name, policy }
    })
    const seed = mixSeed(options.seed, gameIndex)

    try {
      const result = runBotMatch(seats, { seed, maxActions: options.maxActions })
      lines.push(JSON.stringify(buildGameRecord(gameIndex, seed, seats, result)))
      const winnerPolicy = seats.find((seat) => seat.id === result.winnerId)?.policy.name
      if (winnerPolicy) wins[winnerPolicy] = (wins[winnerPolicy] ?? 0) + 1
    } catch (error) {
      errors += 1
      console.error(`Game ${gameIndex} failed, skipping: ${(error as Error).message}`)
    }

    if ((gameIndex + 1) % PROGRESS_INTERVAL === 0) {
      const elapsed = (Date.now() - start) / 1000
      const rate = (gameIndex + 1) / elapsed
      console.error(`... ${gameIndex + 1}/${options.games} games (${rate.toFixed(1)} games/sec)`)
    }
  }

  fs.writeFileSync(outPath, lines.length > 0 ? `${lines.join('\n')}\n` : '')

  const elapsed = (Date.now() - start) / 1000
  console.log(`\nWrote ${lines.length}/${options.games} games to ${outPath} (${errors} skipped)`)
  console.log(`Elapsed: ${elapsed.toFixed(1)}s (${(lines.length / Math.max(elapsed, 1e-9)).toFixed(1)} games/sec)`)
  console.log('Wins per policy:')
  for (const [name, count] of Object.entries(wins)) {
    const share = lines.length > 0 ? (count / lines.length) * 100 : 0
    console.log(`  ${name}: ${count} (${share.toFixed(1)}%)`)
  }
}

main()
