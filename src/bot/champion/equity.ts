import equityData from './data/equity.json'

export interface EquityStateEntry {
  n: number
  wins: number
  p: number
}

export interface EquityTable {
  states: Record<string, EquityStateEntry>
  marginalByOwnDice: Record<string, Record<string, EquityStateEntry>>
}

const DEFAULT_MIN_SAMPLES = 300
const DEFAULT_CALZO_MARGIN = 0.02

export function loadEquityTable(source: unknown = equityData): EquityTable {
  if (!source || typeof source !== 'object' || !('states' in source) || !('marginalByOwnDice' in source)) {
    throw new Error('The bundled Gen 2 equity table is invalid')
  }
  const parsed = source as EquityTable
  return { states: parsed.states, marginalByOwnDice: parsed.marginalByOwnDice }
}

export function stateKey(ownDice: number, otherStacks: readonly number[], isStarter: boolean, playerCount: number): string {
  const others = [...otherStacks].filter((stack) => stack > 0).sort((a, b) => a - b).join(',')
  return `${ownDice}|${others}|${isStarter ? 1 : 0}|${playerCount}`
}

export function marginalEquity(table: EquityTable, playerCount: number, ownDice: number): number {
  return table.marginalByOwnDice[String(playerCount)]?.[String(ownDice)]?.p ?? 0.5
}

export function lookupEquity(
  table: EquityTable,
  ownDice: number,
  otherStacks: readonly number[],
  isStarter: boolean,
  playerCount: number,
  minSamples = DEFAULT_MIN_SAMPLES,
): number {
  if (ownDice <= 0) return 0
  const wanted = table.states[stateKey(ownDice, otherStacks, isStarter, playerCount)]
  if (wanted && wanted.n >= minSamples) return wanted.p

  const nonStarter = table.states[stateKey(ownDice, otherStacks, false, playerCount)]
  const starter = table.states[stateKey(ownDice, otherStacks, true, playerCount)]
  const nonStarterOk = nonStarter !== undefined && nonStarter.n >= minSamples
  const starterOk = starter !== undefined && starter.n >= minSamples
  if (nonStarterOk && starterOk) return (nonStarter.p + starter.p) / 2
  if (nonStarterOk) return nonStarter.p
  if (starterOk) return starter.p
  return marginalEquity(table, playerCount, ownDice)
}

export interface BreakevenResult {
  deltaLoss: number
  deltaGain: number
  pStar: number
  threshold: number
}

export function breakevenFromEquities(now: number, afterLoss: number, afterGain: number, margin = DEFAULT_CALZO_MARGIN): BreakevenResult {
  const deltaLoss = now - afterLoss
  const deltaGain = afterGain - now
  const denominator = deltaLoss + deltaGain
  const pStar = Math.max(0, Math.min(1, denominator === 0 ? 1 : deltaLoss / denominator))
  return { deltaLoss, deltaGain, pStar, threshold: Math.max(0, Math.min(1, pStar + margin)) }
}

export interface CalzoDetail extends BreakevenResult {
  now: number
  afterLoss: number
  afterGain: number
  exactProbability: number
}

export interface DudoDetail {
  pUnsupported: number
  equityAfterBidderLoses: number
  equityAfterSelfLoses: number
  evDudo: number
  evBestBidApprox: number
}
