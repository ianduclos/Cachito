import type { Bid, Die, GameRules, GameState, LegalActions } from './types'

export function isDie(value: number): value is Die {
  return Number.isInteger(value) && value >= 1 && value <= 6
}

export function isValidOpeningBid(bid: Bid, totalDice: number): boolean {
  return Number.isInteger(bid.quantity) && bid.quantity >= 1 && bid.quantity <= totalDice && isDie(bid.denomination)
}

/**
 * Palo Fijo bid ordering at equal quantity. Aces are not wild in Palo Fijo, but
 * they still top the ladder: a one-die player may swap the denomination to Aces
 * without raising the quantity, and from there the quantity is the only way up.
 * Ranking them above Sambas is what keeps that swap from cycling back and forth.
 */
function paloFijoRank(denomination: Die): number {
  return denomination === 1 ? 7 : denomination
}

/** Checks ordering only; turn/phase checks are performed by the engine. */
export function isHigherBid(previous: Bid, next: Bid, paloFijo: boolean, bidderHasOneDie: boolean, acesConversion: GameRules['acesConversion'] = 'half'): boolean {
  if (!Number.isInteger(next.quantity) || next.quantity < 1 || !isDie(next.denomination)) return false

  if (paloFijo) {
    if (!bidderHasOneDie && next.denomination !== previous.denomination) return false
    return next.quantity > previous.quantity ||
      (next.quantity === previous.quantity && paloFijoRank(next.denomination) > paloFijoRank(previous.denomination))
  }

  if (previous.denomination === 1) {
    if (next.denomination === 1) return next.quantity > previous.quantity
    return next.quantity >= previous.quantity * 2 + 1
  }

  if (next.denomination === 1) {
    // Half rounds the halving up; half-plus-one rounds it down first, then adds one.
    // They coincide for odd previous quantities and differ by one for even ones.
    const minimumAces = acesConversion === 'halfPlusOne'
      ? Math.floor(previous.quantity / 2) + 1
      : Math.ceil(previous.quantity / 2)
    return next.quantity >= minimumAces
  }

  return next.quantity > previous.quantity ||
    (next.quantity === previous.quantity && next.denomination > previous.denomination)
}

/**
 * Whether one die counts toward a bid: its own denomination always, plus wild
 * aces outside Palo Fijo and outside ace bids. Single definition — bid counting
 * and the table-dice rule both ask this, so they can never drift apart.
 */
export function countsTowardBid(die: Die, bid: Bid, paloFijo: boolean): boolean {
  if (die === bid.denomination) return true
  return !paloFijo && bid.denomination !== 1 && die === 1
}

export function countBid(state: GameState, bid: Bid): number {
  const dice = state.players.flatMap((player) => [...player.hand, ...player.tableDice])
  return dice.filter((die) => countsTowardBid(die, bid, state.paloFijo)).length
}

export function getLegalActions(state: GameState, playerId: string): LegalActions {
  if (state.phase !== 'playing' || state.currentPlayerId !== playerId) {
    return { bids: [], canDudo: false, canCalzo: false, canPutDiceOnTable: false }
  }

  const player = state.players.find((candidate) => candidate.id === playerId)
  if (!player || player.diceCount === 0) return { bids: [], canDudo: false, canCalzo: false, canPutDiceOnTable: false }

  const totalDice = state.players.reduce((sum, candidate) => sum + candidate.diceCount, 0)
  const bids: Bid[] = []
  for (let quantity = 1; quantity <= totalDice; quantity += 1) {
    for (let denomination = 1; denomination <= 6; denomination += 1) {
      const bid = { quantity, denomination: denomination as Die }
      if (!state.currentBid || isHigherBid(state.currentBid, bid, state.paloFijo, player.diceCount === 1, state.rules.acesConversion)) {
        bids.push(bid)
      }
    }
  }

  return {
    bids,
    canDudo: state.currentBid !== null,
    canCalzo: state.currentBid !== null,
    canPutDiceOnTable: state.rules.tableDiceEnabled && !(state.paloFijo && state.rules.paloFijoBlindDice) && !player.tableDiceUsed && player.hand.length >= 2,
  }
}
