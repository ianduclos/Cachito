import type { Die, RandomSource } from './types'

/** Small deterministic PRNG useful for tests, replays, and seeded local games. */
export function createSeededRandom(seed: number): RandomSource {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rollDie(random: RandomSource): Die {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random source must return a number in [0, 1)')
  }
  return (Math.floor(value * 6) + 1) as Die
}

export function rollHand(count: number, random: RandomSource): Die[] {
  return Array.from({ length: count }, () => rollDie(random))
}
