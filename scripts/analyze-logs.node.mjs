import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { analyzeLogsDirectory } from './analyze-logs.mjs'

function fixture(overrides = {}) {
  return {
    schemaVersion: 1,
    metadata: {
      seed: 42,
      startedAt: '2026-07-13T18:00:00.000Z',
      seats: [
        { id: 'bot', name: 'Bot', controller: 'bot', policyName: 'Test policy' },
        { id: 'human', name: 'Human', controller: 'human' },
      ],
    },
    publicActions: [
      { sequence: 0, round: 1, playerId: 'bot', action: { type: 'bid', bid: { quantity: 2, denomination: 5 } } },
      { sequence: 1, round: 1, playerId: 'human', action: { type: 'dudo' } },
      { sequence: 2, round: 2, playerId: 'bot', action: { type: 'calzo' } },
    ],
    roundResolutions: [
      {
        round: 1,
        paloFijo: false,
        resolution: { kind: 'dudo', callerId: 'human', bidderId: 'bot', bid: { quantity: 2, denomination: 5 }, actualCount: 2, correct: false },
        revealedHands: [{ playerId: 'bot', dice: [1, 2] }, { playerId: 'human', dice: [5, 3] }],
      },
      {
        round: 2,
        paloFijo: true,
        resolution: { kind: 'calzo', callerId: 'bot', bidderId: 'human', bid: { quantity: 1, denomination: 1 }, actualCount: 1, correct: true },
        revealedHands: [{ playerId: 'bot', dice: [1] }, { playerId: 'human', dice: [5] }],
      },
    ],
    botDecisions: [
      {
        sequence: 0,
        policyName: 'Test policy',
        playerId: 'bot',
        round: 1,
        paloFijo: false,
        chosenAction: { type: 'bid', bid: { quantity: 2, denomination: 5 } },
        probabilities: { chosenBid: { bid: { quantity: 2, denomination: 5 }, atLeast: 0.75, exact: 0.2 } },
        trace: { decisionReason: 'supported_bid', candidateCount: 12 },
      },
      {
        sequence: 1,
        policyName: 'Test policy',
        playerId: 'bot',
        round: 2,
        paloFijo: true,
        chosenAction: { type: 'calzo' },
        probabilities: { currentBid: { bid: { quantity: 1, denomination: 1 }, atLeast: 0.5, exact: 0.5 } },
        trace: { decisionReason: 'calzo_threshold', candidateCount: 4 },
      },
    ],
    winnerId: 'bot',
    ...overrides,
  }
}

test('aggregates policies, challenges, calibration, and context splits', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cachito-logs-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'match.json'), JSON.stringify(fixture()))

  const report = await analyzeLogsDirectory(directory)

  assert.equal(report.matches, 1)
  assert.equal(report.completedMatches, 1)
  assert.deepEqual(report.playerCounts, { 2: 1 })
  assert.equal(report.actions, 3)
  assert.equal(report.rounds, 2)
  assert.equal(report.botDecisions, 2)
  assert.deepEqual(report.challenges.dudo, { attempts: 1, correct: 0, accuracy: 0 })
  assert.deepEqual(report.challenges.calzo, { attempts: 1, correct: 1, accuracy: 1 })
  assert.deepEqual(report.policies['Test policy'].actionMix, { bid: 1, dudo: 0, calzo: 1 })
  assert.equal(report.policies['Test policy'].contexts.normal.decisions, 1)
  assert.equal(report.policies['Test policy'].contexts.paloFijo.decisions, 1)
  assert.equal(report.policies['Test policy'].challenges.calzo.correct, 1)
  assert.equal(report.policies['Test policy'].trace.tracedDecisions, 2)
  assert.equal(report.policies['Test policy'].trace.averageCandidateCount, 8)
  assert.deepEqual(report.policies['Test policy'].trace.decisionReasons, {
    supported_bid: 1,
    calzo_threshold: 1,
  })
  assert.equal(report.botBidCalibration.all.samples, 1)
  assert.equal(report.botBidCalibration.all.brierScore, 0.0625)
  assert.equal(report.botBidCalibration.all.meanPrediction, 0.75)
  assert.equal(report.botBidCalibration.all.observedRate, 1)
  assert.equal(report.botBidCalibration.normal.samples, 1)
  assert.equal(report.botBidCalibration.paloFijo.samples, 0)
})

test('recurses, deduplicates a match identity, and retains invalid files', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cachito-logs-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const nested = path.join(directory, 'nested')
  await mkdir(nested)
  const log = fixture()
  await writeFile(path.join(directory, 'one.json'), JSON.stringify(log))
  await writeFile(path.join(nested, 'copy.json'), JSON.stringify(log))
  await writeFile(path.join(directory, 'bad-json.json'), '{ nope')
  await writeFile(path.join(directory, 'bad-schema.json'), JSON.stringify({ schemaVersion: 1, metadata: { seats: [] } }))

  const report = await analyzeLogsDirectory(directory)

  assert.equal(report.source.discoveredFiles, 4)
  assert.equal(report.source.validFiles, 1)
  assert.equal(report.source.duplicateFiles.length, 1)
  assert.equal(report.source.invalidFiles.length, 2)
  assert.equal(report.matches, 1)
  assert.match(report.source.invalidFiles.map((item) => item.errors.join(' ')).join(' '), /publicActions must be an array/)
})

test('uses a content identity fallback when seed or start time is unavailable', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cachito-logs-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const log = fixture({ metadata: { seats: fixture().metadata.seats } })
  await writeFile(path.join(directory, 'one.json'), JSON.stringify(log))
  await writeFile(path.join(directory, 'copy.json'), JSON.stringify(log))

  const report = await analyzeLogsDirectory(directory)

  assert.equal(report.matches, 1)
  assert.equal(report.source.duplicateFiles.length, 1)
})
