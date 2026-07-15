import { describe, expect, it } from 'vitest'
import {
  applyAction,
  countBid,
  createGame,
  createSeededRandom,
  DEFAULT_GAME_RULES,
  GameRuleError,
  getLegalActions,
  projectForAdminSpectator,
  projectForPlayer,
  projectForSpectator,
} from './index'
import type { Die, PlayingState } from './types'

function playing(
  hands: Record<string, Die[]>,
  overrides: Partial<PlayingState> = {},
): PlayingState {
  const players = Object.entries(hands).map(([id, hand]) => ({
    id,
    name: id.toUpperCase(),
    diceCount: hand.length,
    hand: [...hand],
    tableDice: [],
    tableDiceUsed: false,
    paloFijoTriggered: false,
  }))
  return {
    phase: 'playing',
    players,
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    currentPlayerId: players[0].id,
    currentBid: null,
    lastBidderId: null,
    ...overrides,
  }
}

describe('game creation and turns', () => {
  it('creates deterministic games for 2-6 unique players', () => {
    const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    expect(createGame(players, createSeededRandom(42))).toEqual(createGame(players, createSeededRandom(42)))
    expect(() => createGame([{ id: 'a', name: 'A' }])).toThrow(GameRuleError)
    expect(() => createGame([...players, { id: 'a', name: 'Again' }])).toThrow(GameRuleError)
  })

  it('rotates through active players and rejects out-of-turn or invalid bids', () => {
    const state = playing({ a: [2, 2], b: [3, 3], c: [4, 4] })
    const afterBid = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 2 } })
    expect(afterBid.currentPlayerId).toBe('b')
    expect(() => applyAction(afterBid, { type: 'bid', playerId: 'a', bid: { quantity: 3, denomination: 2 } })).toThrowError(/not this player's turn/i)
    expect(() => applyAction(afterBid, { type: 'bid', playerId: 'b', bid: { quantity: 2, denomination: 2 } })).toThrowError(/legally raise/i)
  })

  it('allows only the current player to call dudo or calzo', () => {
    const state = playing({ a: [2, 2], b: [3, 3], c: [4, 4] })
    const afterBid = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 2 } })

    expect(() => applyAction(afterBid, { type: 'dudo', playerId: 'a' })).toThrowError(/not this player's turn/i)
    expect(() => applyAction(afterBid, { type: 'calzo', playerId: 'c' })).toThrowError(/not this player's turn/i)
  })
})

describe('counting and round resolution', () => {
  it('keeps selected dice public, rerolls the private remainder, and counts both', () => {
    const state = playing({ a: [5, 2, 3], b: [4, 6] })
    const afterBid = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 5 }, tableDiceIndices: [0] }, () => 0)
    if (afterBid.phase !== 'playing') throw new Error('expected playing')
    const player = afterBid.players.find((candidate) => candidate.id === 'a')!
    expect(player.tableDice).toEqual([5])
    expect(player.hand).toEqual([1, 1])
    expect(player.tableDiceUsed).toBe(true)
    expect(countBid(afterBid, { quantity: 3, denomination: 5 })).toBe(3)
    expect(projectForPlayer(afterBid, 'a').players.find((candidate) => candidate.id === 'a')?.hand).toEqual([1, 1])
    expect(projectForSpectator(afterBid).players.find((candidate) => candidate.id === 'a')?.tableDice).toEqual([5])
  })

  it('requires a private die and permits table dice only once per round', () => {
    const state = playing({ a: [5, 2], b: [4, 6] })
    expect(() => applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 1, denomination: 5 }, tableDiceIndices: [0, 1] })).toThrowError(/keep at least one private/i)
    const afterBid = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 1, denomination: 5 }, tableDiceIndices: [0] })
    if (afterBid.phase !== 'playing') throw new Error('expected playing')
    const backToA = { ...afterBid, currentPlayerId: 'a' }
    expect(() => applyAction(backToA, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 5 }, tableDiceIndices: [0] })).toThrowError(/not available/i)
  })

  it('counts ones as wild in normal rounds but not for ace bids or palo fijo', () => {
    const state = playing({ a: [1, 5, 5], b: [1, 2] })
    expect(countBid(state, { quantity: 4, denomination: 5 })).toBe(4)
    expect(countBid(state, { quantity: 2, denomination: 1 })).toBe(2)
    expect(countBid({ ...state, paloFijo: true }, { quantity: 2, denomination: 5 })).toBe(2)
  })

  it('makes the bidder lose when dudo is correct and starts them next round', () => {
    let state = playing({ a: [2, 3], b: [4, 5], c: [6, 6] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 3, denomination: 2 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    expect(reveal.phase).toBe('reveal')
    if (reveal.phase !== 'reveal') throw new Error('expected reveal')
    expect(reveal.resolution).toMatchObject({ correct: true, actualCount: 1, nextStarterId: 'a' })
    expect(reveal.players.find((player) => player.id === 'a')?.diceCount).toBe(1)
    const next = applyAction(reveal, { type: 'nextRound' }, () => 0)
    expect(next.phase).toBe('playing')
    if (next.phase === 'playing') {
      expect(next.currentPlayerId).toBe('a')
      expect(next.paloFijo).toBe(true)
      expect(next.players.find((player) => player.id === 'a')?.hand).toEqual([1])
    }
  })

  it('makes the doubter lose when the bid is met', () => {
    let state = playing({ a: [1, 3], b: [3, 4] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 3, denomination: 3 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    expect(reveal.phase === 'reveal' && reveal.resolution.correct).toBe(false)
    expect(reveal.players.find((player) => player.id === 'b')?.diceCount).toBe(1)
  })

  it('awards a die for exact calzo up to the cap of five', () => {
    let state = playing({ a: [2, 2], b: [1, 2] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 4, denomination: 2 } }) as PlayingState
    const reveal = applyAction(state, { type: 'calzo', playerId: 'b' })
    expect(reveal.phase === 'reveal' && reveal.resolution.correct).toBe(true)
    expect(reveal.players.find((player) => player.id === 'b')?.diceCount).toBe(3)

    state = playing({ a: [2], b: [2, 2, 2, 2, 2] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 6, denomination: 2 } }) as PlayingState
    const capped = applyAction(state, { type: 'calzo', playerId: 'b' })
    expect(capped.players.find((player) => player.id === 'b')?.diceCount).toBe(5)
  })

  it('removes up to two dice for a wrong calzo and eliminates at zero', () => {
    let state = playing({ a: [2, 3], b: [4, 5] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 6 } }) as PlayingState
    const reveal = applyAction(state, { type: 'calzo', playerId: 'b' })
    expect(reveal.players.find((player) => player.id === 'b')?.diceCount).toBe(0)
    expect(reveal.phase === 'reveal' && reveal.resolution.nextStarterId).toBe('a')
    const over = applyAction(reveal, { type: 'nextRound' })
    expect(over.phase === 'gameOver' && over.winnerId).toBe('a')
  })

  it('falls forward to the next active player when the round loser is eliminated', () => {
    let state = playing({ a: [2], b: [3, 3], c: [4, 4] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 5, denomination: 6 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    expect(reveal.phase === 'reveal' && reveal.resolution.nextStarterId).toBe('b')

    const next = applyAction(reveal, { type: 'nextRound' }, () => 0)
    expect(next.phase === 'playing' && next.currentPlayerId).toBe('b')
  })
})

describe('palo fijo', () => {
  it('can trigger at two dice when the agreed rule selects it', () => {
    let state = playing({ a: [2, 2, 2], b: [3, 3], c: [4, 4] }, { rules: { ...DEFAULT_GAME_RULES, paloFijoTrigger: 'twoDice' } })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 7, denomination: 2 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    expect(reveal.phase === 'reveal' && reveal.resolution.paloFijoNextRound).toBe(true)
    expect(reveal.players.find((player) => player.id === 'a')?.diceCount).toBe(2)
  })

  it('does not offer table dice during blind palo fijo', () => {
    const state = playing({ a: [2, 3], b: [4, 5], c: [6] }, { paloFijo: true })
    expect(getLegalActions(state, 'a').canPutDiceOnTable).toBe(false)
  })

  it('lasts one round and only triggers the first time a player reaches one die', () => {
    let state = playing({ a: [2, 3], b: [4, 5], c: [6, 6] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 6 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    const paloRound = applyAction(reveal, { type: 'nextRound' }, () => 0)
    expect(paloRound.phase === 'playing' && paloRound.paloFijo).toBe(true)
    if (paloRound.phase !== 'playing') throw new Error('expected playing')

    const p = paloRound.players.find((player) => player.id === 'a')!
    const synthetic = {
      ...paloRound,
      paloFijo: false,
      currentPlayerId: 'a',
      players: paloRound.players.map((player) => player.id === 'a'
        ? { ...p, diceCount: 2, hand: [2, 3] as Die[], paloFijoTriggered: true }
        : { ...player, hand: [4, 5] as Die[] }),
    }
    const bid = applyAction(synthetic, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 6 } })
    const secondLoss = applyAction(bid, { type: 'dudo', playerId: 'b' })
    const ordinaryRound = applyAction(secondLoss, { type: 'nextRound' }, () => 0)
    expect(ordinaryRound.phase === 'playing' && ordinaryRound.paloFijo).toBe(false)
  })

  it('does not trigger with only two active players', () => {
    let state = playing({ a: [2, 3], b: [4, 5] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 6 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })

    expect(reveal.phase === 'reveal' && reveal.resolution.paloFijoNextRound).toBe(false)
    expect(reveal.players.find((player) => player.id === 'a')).toMatchObject({
      diceCount: 1,
      paloFijoTriggered: false,
    })
    const nextRound = applyAction(reveal, { type: 'nextRound' }, () => 0)
    expect(nextRound.phase === 'playing' && nextRound.paloFijo).toBe(false)
  })

  it('lets any one-die player change denomination during palo fijo', () => {
    let state = playing({ a: [2], b: [3], c: [4, 4] }, { paloFijo: true })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 1, denomination: 5 } }) as PlayingState
    const changed = applyAction(state, { type: 'bid', playerId: 'b', bid: { quantity: 2, denomination: 2 } })
    expect(changed.currentBid).toEqual({ quantity: 2, denomination: 2 })
    expect(() => applyAction(changed, { type: 'bid', playerId: 'c', bid: { quantity: 3, denomination: 3 } })).toThrowError(/legally raise/i)
  })

  it('allows different players to trigger their own one-time palo-fijo rounds', () => {
    let state = playing({ a: [2, 3], b: [4, 5], c: [6, 6] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 3, denomination: 2 } }) as PlayingState
    const firstReveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    const firstPaloRound = applyAction(firstReveal, { type: 'nextRound' }, () => 0)
    expect(firstPaloRound.phase === 'playing' && firstPaloRound.paloFijo).toBe(true)
    if (firstPaloRound.phase !== 'playing') throw new Error('expected playing')

    const afterBid = applyAction(firstPaloRound, { type: 'bid', playerId: 'a', bid: { quantity: 1, denomination: 1 } })
    const secondReveal = applyAction(afterBid, { type: 'dudo', playerId: 'b' })
    expect(secondReveal.players.find((player) => player.id === 'b')).toMatchObject({
      diceCount: 1,
      paloFijoTriggered: true,
    })
    expect(secondReveal.phase === 'reveal' && secondReveal.resolution.paloFijoNextRound).toBe(true)

    const secondPaloRound = applyAction(secondReveal, { type: 'nextRound' }, () => 0)
    expect(secondPaloRound.phase === 'playing' && secondPaloRound.paloFijo).toBe(true)
  })
})

describe('private and spectator views', () => {
  it('shows only the viewer hand during play and no live hand to spectators', () => {
    const state = playing({ a: [1, 2], b: [3, 4] })
    const playerView = projectForPlayer(state, 'a')
    expect(playerView.players.find((player) => player.id === 'a')?.hand).toEqual([1, 2])
    expect(playerView.players.find((player) => player.id === 'b')).not.toHaveProperty('hand')
    expect(projectForSpectator(state).players.every((player) => !('hand' in player))).toBe(true)
  })

  it('only shows one-die players their own hand during palo fijo', () => {
    const state = playing({ a: [1], b: [2, 3], c: [4] }, { paloFijo: true })

    expect(projectForPlayer(state, 'a').players.find((player) => player.id === 'a')?.hand).toEqual([1])
    expect(projectForPlayer(state, 'b').players.find((player) => player.id === 'b')).not.toHaveProperty('hand')
    expect(projectForPlayer(state, 'c').players.find((player) => player.id === 'c')?.hand).toEqual([4])
  })

  it('shows every player their own hand during palo fijo when blind dice are disabled', () => {
    const state = playing({ a: [1, 2], b: [3, 4] }, { paloFijo: true, rules: { ...DEFAULT_GAME_RULES, paloFijoBlindDice: false } })
    expect(projectForPlayer(state, 'a').players.find((player) => player.id === 'a')?.hand).toEqual([1, 2])
  })

  it('keeps normal spectators private while admin spectators see every live hand', () => {
    const state = playing({ a: [1, 2], b: [3], c: [4, 5] }, { paloFijo: true })

    expect(projectForSpectator(state).players.every((player) => !('hand' in player))).toBe(true)
    expect(projectForAdminSpectator(state).players.map((player) => player.hand)).toEqual([[1, 2], [3], [4, 5]])
  })

  it('reveals all hands after dudo or calzo', () => {
    let state = playing({ a: [2, 3], b: [4, 5] })
    state = applyAction(state, { type: 'bid', playerId: 'a', bid: { quantity: 2, denomination: 2 } }) as PlayingState
    const reveal = applyAction(state, { type: 'dudo', playerId: 'b' })
    expect(projectForSpectator(reveal).players.map((player) => player.hand)).toEqual([[2, 3], [4, 5]])
    expect(projectForPlayer(reveal, 'a').players.map((player) => player.hand)).toEqual([[2, 3], [4, 5]])
  })
})
