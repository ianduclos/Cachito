#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTION_TYPES = ['bid', 'dudo', 'calzo']
const CONTEXTS = ['normal', 'paloFijo']

function emptyActionMix() {
  return { bid: 0, dudo: 0, calzo: 0 }
}

function emptyChallenges() {
  return {
    dudo: { attempts: 0, correct: 0, accuracy: null },
    calzo: { attempts: 0, correct: 0, accuracy: null },
  }
}

function emptyCalibration() {
  return { samples: 0, brierScore: null, meanPrediction: null, observedRate: null }
}

function validateLog(log) {
  const errors = []
  if (!log || typeof log !== 'object' || Array.isArray(log)) return ['root must be an object']
  if (log.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (!log.metadata || typeof log.metadata !== 'object') errors.push('metadata must be an object')
  if (!Array.isArray(log.metadata?.seats)) errors.push('metadata.seats must be an array')
  for (const field of ['publicActions', 'roundResolutions', 'botDecisions']) {
    if (!Array.isArray(log[field])) errors.push(`${field} must be an array`)
  }
  if (log.winnerId !== null && typeof log.winnerId !== 'string') errors.push('winnerId must be a string or null')
  return errors
}

function stableIdentity(log) {
  const seed = log.metadata?.seed
  const startedAt = log.metadata?.startedAt
  if ((typeof seed === 'number' || typeof seed === 'string') && typeof startedAt === 'string') {
    return `seed:${seed}|startedAt:${startedAt}`
  }
  const fallback = JSON.stringify({
    seed: seed ?? null,
    startedAt: startedAt ?? null,
    seats: log.metadata?.seats ?? [],
    publicActions: log.publicActions,
    roundResolutions: log.roundResolutions,
    winnerId: log.winnerId,
  })
  return `content:${createHash('sha256').update(fallback).digest('hex')}`
}

async function discoverJsonFiles(directory) {
  const files = []
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(target)
    }
  }
  await visit(directory)
  return files.sort()
}

function contextName(paloFijo) {
  return paloFijo ? 'paloFijo' : 'normal'
}

function countBidFromReveal(revealedHands, bid, paloFijo) {
  if (!bid || !Number.isInteger(bid.quantity) || !Number.isInteger(bid.denomination)) return null
  let count = 0
  for (const reveal of revealedHands ?? []) {
    if (!Array.isArray(reveal?.dice)) return null
    for (const die of reveal.dice) {
      if (die === bid.denomination || (!paloFijo && bid.denomination !== 1 && die === 1)) count += 1
    }
  }
  return count
}

function finishChallenges(challenges) {
  for (const type of ['dudo', 'calzo']) {
    const item = challenges[type]
    item.accuracy = item.attempts === 0 ? null : item.correct / item.attempts
  }
}

function finishCalibration(accumulator) {
  if (accumulator.samples === 0) return emptyCalibration()
  return {
    samples: accumulator.samples,
    brierScore: accumulator.squaredError / accumulator.samples,
    meanPrediction: accumulator.prediction / accumulator.samples,
    observedRate: accumulator.observed / accumulator.samples,
  }
}

function ensurePolicy(policies, name) {
  if (!policies[name]) {
    policies[name] = {
      decisions: 0,
      actionMix: emptyActionMix(),
      challenges: emptyChallenges(),
      contexts: {
        normal: { decisions: 0, actionMix: emptyActionMix() },
        paloFijo: { decisions: 0, actionMix: emptyActionMix() },
      },
      trace: {
        tracedDecisions: 0,
        averageCandidateCount: null,
        decisionReasons: {},
        candidateCountTotal: 0,
      },
    }
  }
  return policies[name]
}

export function aggregateLogs(logs, source = {}) {
  const policies = {}
  const challenges = emptyChallenges()
  const calibrationAcc = {
    all: { samples: 0, squaredError: 0, prediction: 0, observed: 0 },
    normal: { samples: 0, squaredError: 0, prediction: 0, observed: 0 },
    paloFijo: { samples: 0, squaredError: 0, prediction: 0, observed: 0 },
  }
  const result = {
    source,
    matches: logs.length,
    completedMatches: 0,
    seats: 0,
    playerCounts: {},
    actions: 0,
    rounds: 0,
    botDecisions: 0,
    policies,
    challenges,
    botBidCalibration: {},
  }

  for (const log of logs) {
    if (typeof log.winnerId === 'string') result.completedMatches += 1
    const playerCount = log.metadata.seats.length
    result.seats += playerCount
    result.playerCounts[playerCount] = (result.playerCounts[playerCount] ?? 0) + 1
    result.actions += log.publicActions.length
    result.rounds += log.roundResolutions.length
    result.botDecisions += log.botDecisions.length

    const resolutions = new Map(log.roundResolutions.map((entry) => [entry.round, entry]))
    for (const entry of log.publicActions) {
      const type = entry?.action?.type
      if (type !== 'dudo' && type !== 'calzo') continue
      const resolution = resolutions.get(entry.round)?.resolution
      if (!resolution || resolution.kind !== type || resolution.callerId !== entry.playerId) continue
      challenges[type].attempts += 1
      if (resolution.correct === true) challenges[type].correct += 1
    }

    for (const decision of log.botDecisions) {
      const type = decision?.chosenAction?.type
      const policy = ensurePolicy(policies, decision.policyName || 'Unknown policy')
      const context = contextName(decision.paloFijo)
      policy.decisions += 1
      policy.contexts[context].decisions += 1
      if (ACTION_TYPES.includes(type)) {
        policy.actionMix[type] += 1
        policy.contexts[context].actionMix[type] += 1
      }
      if (decision.trace && typeof decision.trace === 'object') {
        policy.trace.tracedDecisions += 1
        if (Number.isFinite(decision.trace.candidateCount)) {
          policy.trace.candidateCountTotal += decision.trace.candidateCount
        }
        const reason = typeof decision.trace.decisionReason === 'string'
          ? decision.trace.decisionReason
          : 'unknown'
        policy.trace.decisionReasons[reason] = (policy.trace.decisionReasons[reason] ?? 0) + 1
      }

      if (type === 'dudo' || type === 'calzo') {
        const resolution = resolutions.get(decision.round)?.resolution
        if (resolution?.kind === type && resolution.callerId === decision.playerId) {
          policy.challenges[type].attempts += 1
          if (resolution.correct === true) policy.challenges[type].correct += 1
        }
      }

      if (type !== 'bid') continue
      const probability = decision.probabilities?.chosenBid?.atLeast
      const bid = decision.probabilities?.chosenBid?.bid ?? decision.chosenAction.bid
      const reveal = resolutions.get(decision.round)
      if (typeof probability !== 'number' || probability < 0 || probability > 1 || !reveal) continue
      const actual = countBidFromReveal(reveal.revealedHands, bid, Boolean(decision.paloFijo))
      if (actual === null) continue
      const observed = actual >= bid.quantity ? 1 : 0
      for (const key of ['all', context]) {
        const accumulator = calibrationAcc[key]
        accumulator.samples += 1
        accumulator.squaredError += (probability - observed) ** 2
        accumulator.prediction += probability
        accumulator.observed += observed
      }
    }
  }

  finishChallenges(challenges)
  for (const policy of Object.values(policies)) {
    finishChallenges(policy.challenges)
    policy.trace.averageCandidateCount = policy.trace.tracedDecisions === 0
      ? null
      : policy.trace.candidateCountTotal / policy.trace.tracedDecisions
    delete policy.trace.candidateCountTotal
  }
  result.botBidCalibration = {
    all: finishCalibration(calibrationAcc.all),
    normal: finishCalibration(calibrationAcc.normal),
    paloFijo: finishCalibration(calibrationAcc.paloFijo),
  }
  return result
}

export async function analyzeLogsDirectory(directory) {
  const absoluteDirectory = path.resolve(directory)
  let files
  try {
    files = await discoverJsonFiles(absoluteDirectory)
  } catch (error) {
    return aggregateLogs([], {
      directory: absoluteDirectory,
      discoveredFiles: 0,
      validFiles: 0,
      duplicateFiles: [],
      invalidFiles: [{ file: absoluteDirectory, errors: [error instanceof Error ? error.message : String(error)] }],
    })
  }

  const logs = []
  const identities = new Map()
  const invalidFiles = []
  const duplicateFiles = []
  for (const file of files) {
    let log
    try {
      log = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      invalidFiles.push({ file, errors: [error instanceof Error ? error.message : String(error)] })
      continue
    }
    const errors = validateLog(log)
    if (errors.length > 0) {
      invalidFiles.push({ file, errors })
      continue
    }
    const identity = stableIdentity(log)
    const firstFile = identities.get(identity)
    if (firstFile) {
      duplicateFiles.push({ file, duplicateOf: firstFile, identity })
      continue
    }
    identities.set(identity, file)
    logs.push(log)
  }

  return aggregateLogs(logs, {
    directory: absoluteDirectory,
    discoveredFiles: files.length,
    validFiles: logs.length,
    duplicateFiles,
    invalidFiles,
  })
}

function number(value) {
  return value === null ? 'n/a' : Number(value).toFixed(3)
}

export function formatHumanReport(report) {
  const lines = [
    `Cachito logs: ${report.source.directory}`,
    `Files: ${report.source.discoveredFiles} discovered, ${report.source.validFiles} unique valid, ${report.source.duplicateFiles.length} duplicate, ${report.source.invalidFiles.length} invalid`,
    `Matches: ${report.matches} (${report.completedMatches} completed)`,
    `Seats: ${report.seats}; player counts: ${Object.entries(report.playerCounts).map(([count, matches]) => `${count}p=${matches}`).join(', ') || 'none'}`,
    `Activity: ${report.actions} actions, ${report.rounds} resolved rounds, ${report.botDecisions} bot decisions`,
    `Dudo: ${report.challenges.dudo.correct}/${report.challenges.dudo.attempts} correct (${number(report.challenges.dudo.accuracy)})`,
    `Calzo: ${report.challenges.calzo.correct}/${report.challenges.calzo.attempts} correct (${number(report.challenges.calzo.accuracy)})`,
    'Bot bid calibration:',
  ]
  for (const context of ['all', ...CONTEXTS]) {
    const value = report.botBidCalibration[context]
    lines.push(`  ${context}: n=${value.samples}, Brier=${number(value.brierScore)}, mean p=${number(value.meanPrediction)}, observed=${number(value.observedRate)}`)
  }
  lines.push('Policies:')
  for (const [name, policy] of Object.entries(report.policies)) {
    lines.push(`  ${name}: ${policy.decisions} decisions; bid=${policy.actionMix.bid}, dudo=${policy.actionMix.dudo}, calzo=${policy.actionMix.calzo}`)
    lines.push(`    challenges: Dudo ${policy.challenges.dudo.correct}/${policy.challenges.dudo.attempts}; Calzo ${policy.challenges.calzo.correct}/${policy.challenges.calzo.attempts}`)
    lines.push(`    traces: ${policy.trace.tracedDecisions}/${policy.decisions}; average candidates=${number(policy.trace.averageCandidateCount)}; reasons=${Object.entries(policy.trace.decisionReasons).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'}`)
    for (const context of CONTEXTS) {
      const split = policy.contexts[context]
      lines.push(`    ${context}: ${split.decisions} decisions; bid=${split.actionMix.bid}, dudo=${split.actionMix.dudo}, calzo=${split.actionMix.calzo}`)
    }
  }
  for (const item of report.source.invalidFiles) lines.push(`Invalid: ${item.file}: ${item.errors.join('; ')}`)
  for (const item of report.source.duplicateFiles) lines.push(`Duplicate: ${item.file} (same match as ${item.duplicateOf})`)
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const positional = args.filter((arg) => arg !== '--json')
  if (positional.length > 1) {
    console.error('Usage: npm run logs:analyze -- [directory] [--json]')
    process.exitCode = 2
    return
  }
  const directory = positional[0] ?? path.resolve(process.cwd(), 'logs')
  const report = await analyzeLogsDirectory(directory)
  console.log(json ? JSON.stringify(report, null, 2) : formatHumanReport(report))
  if (report.source.invalidFiles.length > 0) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) await main()
