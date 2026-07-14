import type { Bid, Die, GameState, LegalActions } from './types'

export function isDie(value: number): value is Die {
  return Number.isInteger(value) && value >= 1 && value <= 6
}

export function isValidOpeningBid(bid: Bid, totalDice: number): boolean {
  return Number.isInteger(bid.quantity) && bid.quantity >= 1 && bid.quantity <= totalDice && isDie(bid.denomination)
}

/** Checks ordering only; turn/phase checks are performed by the engine. */
export function isHigherBid(previous: Bid, next: Bid, paloFijo: boolean, bidderHasOneDie: boolean): boolean {
  if (!Number.isInteger(next.quantity) || next.quantity < 1 || !isDie(next.denomination)) return false

  if (paloFijo) {
    if (!bidderHasOneDie && next.denomination !== previous.denomination) return false
    return next.quantity > previous.quantity ||
      (next.quantity === previous.quantity && next.denomination > previous.denomination)
  }

  if (previous.denomination === 1) {
    if (next.denomination === 1) return next.quantity > previous.quantity
    return next.quantity >= previous.quantity * 2 + 1
  }

  if (next.denomination === 1) {
    return next.quantity >= Math.ceil(previous.quantity / 2)
  }

  return next.quantity > previous.quantity ||
    (next.quantity === previous.quantity && next.denomination > previous.denomination)
}

export function countBid(state: GameState, bid: Bid): number {
  const dice = state.players.flatMap((player) => player.hand)
  if (state.paloFijo || bid.denomination === 1) {
    return dice.filter((die) => die === bid.denomination).length
  }
  return dice.filter((die) => die === bid.denomination || die === 1).length
}

export function getLegalActions(state: GameState, playerId: string): LegalActions {
  if (state.phase !== 'playing' || state.currentPlayerId !== playerId) {
    return { bids: [], canDudo: false, canCalzo: false }
  }

  const player = state.players.find((candidate) => candidate.id === playerId)
  if (!player || player.diceCount === 0) return { bids: [], canDudo: false, canCalzo: false }

  const totalDice = state.players.reduce((sum, candidate) => sum + candidate.diceCount, 0)
  const bids: Bid[] = []
  for (let quantity = 1; quantity <= totalDice; quantity += 1) {
    for (let denomination = 1; denomination <= 6; denomination += 1) {
      const bid = { quantity, denomination: denomination as Die }
      if (!state.currentBid || isHigherBid(state.currentBid, bid, state.paloFijo, player.diceCount === 1)) {
        bids.push(bid)
      }
    }
  }

  return {
    bids,
    canDudo: state.currentBid !== null,
    canCalzo: state.currentBid !== null,
  }
}
