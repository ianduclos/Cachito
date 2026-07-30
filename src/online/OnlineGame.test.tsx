import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GAME_RULES } from "../engine";
import type { PublicGameView, PublicPlayer } from "../engine";
import { OnlineGame } from "./OnlineGame";
import type { OnlineServerMessage } from "./protocol";
import type { MatchAnalysis } from "../analysis";

vi.mock("../ui/sound", () => ({
  getSoundLevels: () => ({ effects: 0.85, music: 0.34 }),
  playSound: () => ({ addEventListener: vi.fn(), pause: vi.fn(), currentTime: 0 }),
  setSoundLevels: vi.fn(),
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor() { MockWebSocket.instances.push(this); }
  send(message: string) { this.sent.push(message); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  message(message: OnlineServerMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

function socket() { return MockWebSocket.instances.at(-1)!; }

function enterLobby() {
  act(() => {
    socket().open();
    socket().message({ type: "joined", roomCode: "ABCDE", playerId: "player-1", reconnectToken: "secret", hostPlayerId: "player-1" });
    socket().message({
      type: "lobby",
      roomCode: "ABCDE",
      hostPlayerId: "player-1",
      players: [
        { id: "player-1", name: "Ana", connected: true, isBot: false },
        { id: "bot-1", name: "Bot", connected: true, isBot: true },
      ],
      spectatorCount: 0,
      rules: { ...DEFAULT_GAME_RULES },
    });
  });
}

const names = ["Ana María", "Min-chi Park", "Miss Blanquita", "Luciano Torres", "Pichulín", "Asleigh Costley", "Calculator", "Berioska"];

function gamePlayers(viewerPlayerId?: string, eliminatedViewer = false): PublicPlayer[] {
  return names.map((name, index) => ({
    id: `player-${index + 1}`,
    name,
    diceCount: index === 0 && eliminatedViewer ? 0 : 5,
    eliminated: index === 0 && eliminatedViewer,
    tableDice: index === 2 ? [2] : [],
    ...(viewerPlayerId === `player-${index + 1}` && !eliminatedViewer ? { hand: [1, 2, 3, 4, 5] as const } : {}),
  }));
}

function enterTable({ spectator = false, eliminated = false, shuffling = true, viewerId = "player-1" }: { spectator?: boolean; eliminated?: boolean; shuffling?: boolean; viewerId?: string } = {}) {
  const playerId = spectator ? undefined : viewerId;
  const players = gamePlayers(playerId, eliminated);
  const activeIds = players.filter((player) => !player.eliminated).map((player) => player.id);
  const view: PublicGameView = {
    phase: "playing",
    round: 1,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    players,
    currentPlayerId: "player-2",
    currentBid: { quantity: 3, denomination: 5 },
    lastBidderId: "player-3",
    ...(playerId ? { viewerPlayerId: playerId } : {}),
  };
  act(() => {
    socket().open();
    socket().message({ type: "joined", roomCode: "ABCDE", ...(playerId ? { playerId, reconnectToken: "secret" } : {}), hostPlayerId: "player-1" });
    socket().message({
      type: "state",
      hostPlayerId: "player-1",
      view,
      history: ["Miss Blanquita bid 3 Chinas."],
      ...(shuffling ? { shuffle: { round: 1, readyPlayerIds: playerId && !eliminated ? activeIds.filter((id) => id !== playerId) : activeIds.slice(0, -1), deadlineAt: Date.now() + 20_000 } } : {}),
      playerStatuses: players.map((player) => ({ id: player.id, connected: true, covered: false })),
      turnDeadlineAt: Date.now() + 60_000,
    });
  });
  return view;
}

function enterWinner({ viewerId = "player-1", spectator = false, shortfall = false }: { viewerId?: string; spectator?: boolean; shortfall?: boolean } = {}) {
  const playerId = spectator ? undefined : viewerId;
  const players = gamePlayers("player-1").map((player, index) => ({ ...player, diceCount: index === 0 ? 3 : 0, eliminated: index !== 0 }));
  const view: PublicGameView = {
    phase: "gameOver",
    round: 9,
    paloFijo: false,
    rules: { ...DEFAULT_GAME_RULES },
    players,
    currentPlayerId: null,
    currentBid: null,
    lastBidderId: null,
    winnerId: "player-1",
    ...(playerId ? { viewerPlayerId: playerId } : {}),
  };
  const analysis: MatchAnalysis = {
    schemaVersion: 4, generatedAt: "2026-07-18T00:00:00.000Z", rounds: 9, totalTurns: 42, winnerId: "player-1",
    headline: "Ana María took the table after 9 rounds.", keyMoment: "Round 7: a correct Dudo changed the direction of the table.",
    startingDice: [{ playerId: "player-1", dice: 5 }, { playerId: "player-2", dice: 5 }],
    tableAverages: { bluff: 22, aggression: 48, challenge: 36 },
    momentum: [{ round: 9, players: [{ playerId: "player-1", dice: 3, share: 100 }, { playerId: "player-2", dice: 0, share: 0 }] }],
    roundStories: [...(shortfall ? [{
      round: 8, paloFijo: false,
      bids: [{ playerId: "player-2", quantity: 6, denomination: 5 as const }],
      callerId: "player-1", bidderId: "player-2", kind: "dudo" as const, correct: true, actualCount: 2, margin: -4,
      diceChanges: [{ playerId: "player-2", delta: -1 }],
    }] : []), {
      round: 9, paloFijo: false,
      bids: [{ playerId: "player-2", quantity: 4, denomination: 5, tableDice: 1 }, { playerId: "player-1", quantity: 5, denomination: 5 }],
      callerId: "player-2", bidderId: "player-1", kind: "dudo" as const, correct: false, actualCount: 5, margin: 0,
      diceChanges: [{ playerId: "player-2", delta: -1 }],
    }],
    players: [
      { id: "player-1", name: "Ana María", controller: "human", winner: true, verdict: "Bid patiently and picked measured moments to challenge. Claims stayed close to what their own dice supported. Every claim that reached a reveal held up.", scores: { bluff: { value: 31, samples: 18, earlyRead: false }, aggression: { value: 40, samples: 8, earlyRead: false }, challenge: { value: 52, samples: 4, earlyRead: false } }, stats: { bids: 18, verifiedFinalBids: 4, unsupportedFinalBids: 0, unsupportedCaught: 0, unsupportedSurvived: 0, deliberatePersonaBluffs: 0, deliberateBluffsCaught: 0, deliberateBluffsSurvived: 0, forcedEscalations: 0, forcedEscalationsCaught: 0, forcedEscalationsSurvived: 0, dudoAttempts: 3, dudoCorrect: 2, calzoAttempts: 1, calzoCorrect: 1, diceGained: 1, diceLost: 3, tableDicePlays: 1 } },
      { id: "player-2", name: "Min-chi Park", controller: "bot", persona: "Bold storyteller", winner: false, verdict: "Pressed the table hard and challenged boldly. Claims regularly ran past what their own dice supported. 1 of 5 revealed claims fell short: 1 caught, 0 survived.", scores: { bluff: { value: 64, samples: 20, earlyRead: false }, aggression: { value: 72, samples: 11, earlyRead: false }, challenge: { value: 66, samples: 3, earlyRead: false } }, stats: { bids: 20, verifiedFinalBids: 5, unsupportedFinalBids: 1, unsupportedCaught: 1, unsupportedSurvived: 0, deliberatePersonaBluffs: 1, deliberateBluffsCaught: 1, deliberateBluffsSurvived: 0, forcedEscalations: 2, forcedEscalationsCaught: 1, forcedEscalationsSurvived: 1, dudoAttempts: 2, dudoCorrect: 1, calzoAttempts: 1, calzoCorrect: 0, diceGained: 0, diceLost: 5, tableDicePlays: 2 }, botReasoning: [{ round: 4, action: "Bid 5 Chinas", explanation: "It found a cheap moment to sell a believable story on a face it genuinely held." }] },
    ],
  };
  act(() => {
    socket().open();
    socket().message({ type: "joined", roomCode: "ABCDE", ...(playerId ? { playerId, reconnectToken: "secret" } : {}), hostPlayerId: "player-1" });
    socket().message({
      type: "state",
      hostPlayerId: "player-1",
      view,
      analysis,
      history: ["Ana María wins the match."],
      playerStatuses: players.map((player) => ({ id: player.id, connected: true, covered: false })),
    });
  });
}

describe("OnlineGame connection lifecycle", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    localStorage.clear();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the saved seat and disables room actions while reconnecting", () => {
    const onExit = vi.fn();
    render(<OnlineGame onExit={onExit} />);
    enterLobby();

    act(() => socket().close());

    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave room/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
    expect(localStorage.getItem("cachito-online-session")).toContain("secret");
    expect(onExit).not.toHaveBeenCalled();
  });

  it("sends an explicit leave and clears recovery only for a connected deliberate exit", () => {
    const onExit = vi.fn();
    render(<OnlineGame onExit={onExit} />);
    enterLobby();

    fireEvent.click(screen.getByRole("button", { name: /Leave room/ }));

    expect(socket().sent.map((message) => JSON.parse(message))).toContainEqual({ type: "leave-room" });
    expect(localStorage.getItem("cachito-online-session")).toBeNull();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("renders the live eight-player table with the seated player's private hand", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterTable();

    expect(screen.getByRole("region", { name: "8-player online table" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Shuffle dice" })).toHaveTextContent("Shake your dice");
    expect(screen.getByRole("button", { name: "Shake my dice" })).toBeEnabled();
    expect(screen.getByLabelText("Your hand and turn controls")).toHaveTextContent("Ana María’s hand");
    expect(screen.getAllByRole("article")).toHaveLength(7);
  });

  it("seats the next player in turn order to the viewer's immediate left, wrapping around", () => {
    // The viewer is player-4 (Luciano Torres), mid-array. Turn order is
    // player-1..8, so the player who acts right after the viewer is player-5
    // (Pichulín) and the one right before is player-3 (Miss Blanquita). Like a
    // real table, the next player sits on the immediate left (left-bottom) and
    // order sweeps around the table to the immediate right (right-bottom).
    render(<OnlineGame onExit={vi.fn()} />);
    enterTable({ viewerId: "player-4" });

    expect(screen.getByRole("article", { name: "Pichulín" })).toHaveClass("tp-seat--left-bottom");
    expect(screen.getByRole("article", { name: "Miss Blanquita" })).toHaveClass("tp-seat--right-bottom");
    expect(screen.queryByRole("article", { name: "Luciano Torres" })).not.toBeInTheDocument();
  });

  it("gives a normal spectator all fixed seats without exposing a hand or shake action", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterTable({ spectator: true });

    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(screen.getByLabelText("Spectator view")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Shuffle dice" })).toHaveTextContent("Cups are shaking");
    expect(screen.queryByRole("button", { name: "Shake my dice" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your hand and turn controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana María’s hand")).not.toBeInTheDocument();
  });

  it("moves an eliminated player to a readable spectator dashboard", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterTable({ eliminated: true });

    expect(screen.getByText("Out · spectating")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your hand and turn controls")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shake my dice" })).not.toBeInTheDocument();
  });

  it("keeps eliminated seats readable while preserving connection-state color", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    const view = enterTable({ shuffling: false });
    const players = view.players.map((player) => player.id === "player-3" ? { ...player, diceCount: 0, eliminated: true, hand: undefined, tableDice: [] } : player);
    act(() => socket().message({
      type: "state",
      hostPlayerId: "player-1",
      view: { ...view, players },
      history: [],
      playerStatuses: players.map((player) => ({ id: player.id, connected: true, covered: false })),
      turnDeadlineAt: Date.now() + 60_000,
    }));

    const seat = screen.getByRole("article", { name: /Miss Blanquita, out and spectating/ });
    expect(seat).toHaveClass("tp-seat--out");
    expect(seat.querySelector(".online-seat-status--online")).toHaveTextContent("Online");
  });

  it("lets a player prepare a legal raise before their turn without sending it early", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    const view = enterTable({ shuffling: false });

    expect(screen.queryByText("Normal play")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Sambas" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dudo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Put dice on table" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Choose Sambas" }));
    expect(screen.getByRole("button", { name: "Prepared 3 Sambas" })).toBeDisabled();
    expect(socket().sent.map((message) => JSON.parse(message)).filter((message) => message.type === "action")).toHaveLength(0);

    act(() => socket().message({
      type: "state",
      hostPlayerId: "player-1",
      view: { ...view, currentPlayerId: "player-1" },
      legalActions: { bids: [{ quantity: 3, denomination: 6 }], canDudo: true, canCalzo: true, canPutDiceOnTable: true },
      history: [],
      playerStatuses: view.players.map((player) => ({ id: player.id, connected: true, covered: false })),
      turnDeadlineAt: Date.now() + 60_000,
    }));

    const raise = screen.getByRole("button", { name: "Raise to 3 Sambas" });
    expect(raise).toBeEnabled();
    fireEvent.click(raise);
    expect(socket().sent.map((message) => JSON.parse(message))).toContainEqual({ type: "action", action: { type: "bid", playerId: "", bid: { quantity: 3, denomination: 6 } } });
  });

  it("opens a new round at quantity 1 instead of carrying the last one's climb over", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    const view = enterTable({ shuffling: false });

    // Climb to a high claim during the round the way a player would.
    for (let step = 0; step < 5; step += 1) fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(screen.getByRole("button", { name: /^Prepar(ed|ing) 9 / })).toBeInTheDocument();

    // The next round opens with nothing to beat, so every quantity is legal —
    // the builder must still come back to 1 rather than sitting on 8.
    act(() => socket().message({
      type: "state",
      hostPlayerId: "player-1",
      view: { ...view, round: 2, currentPlayerId: "player-1", currentBid: null, lastBidderId: null },
      // The climbed-to bid is itself legal as an opening claim — which is exactly
      // why keeping it selected was dangerous.
      legalActions: { bids: [{ quantity: 1, denomination: 2 }, { quantity: 9, denomination: 2 }, { quantity: 1, denomination: 5 }], canDudo: false, canCalzo: false, canPutDiceOnTable: true },
      history: [],
      playerStatuses: view.players.map((player) => ({ id: player.id, connected: true, covered: false })),
      turnDeadlineAt: Date.now() + 60_000,
    }));

    expect(screen.getByRole("button", { name: "Bid 1 Dones" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Bid 9 Dones" })).not.toBeInTheDocument();
  });

  it("shows each revealed hand once, without re-adding table dice the projection already includes", () => {
    // The reveal projection folds table dice into `hand` (projections.ts,
    // includeTableDiceInHand). player-2 played 2 of 5 dice to the table, so
    // the overlay must show exactly 5 dice for them — not 7.
    vi.useFakeTimers();
    render(<OnlineGame onExit={vi.fn()} />);
    const players: PublicPlayer[] = [
      { id: "player-1", name: "Ana María", diceCount: 5, eliminated: false, tableDice: [], hand: [1, 2, 3, 4, 5] },
      { id: "player-2", name: "Miss Blanquita", diceCount: 5, eliminated: false, tableDice: [4, 4], hand: [4, 4, 2, 6, 3] },
    ];
    act(() => {
      socket().open();
      socket().message({ type: "joined", roomCode: "ABCDE", playerId: "player-1", reconnectToken: "secret", hostPlayerId: "player-1" });
      socket().message({
        type: "state",
        hostPlayerId: "player-1",
        view: {
          phase: "reveal",
          round: 2,
          paloFijo: false,
          rules: { ...DEFAULT_GAME_RULES },
          players,
          currentPlayerId: null,
          currentBid: { quantity: 4, denomination: 4 },
          lastBidderId: "player-2",
          viewerPlayerId: "player-1",
          resolution: {
            kind: "dudo", callerId: "player-1", bidderId: "player-2",
            bid: { quantity: 4, denomination: 4 }, actualCount: 5, correct: false,
            diceChanges: [{ playerId: "player-1", before: 5, after: 4, delta: -1, reason: "dudo" }], nextStarterId: "player-1", paloFijoNextRound: false,
          },
        },
        history: [],
        playerStatuses: players.map((player) => ({ id: player.id, connected: true, covered: false })),
      });
    });

    // The result card stages: verdict callout first, revealed hands at 3.3s.
    act(() => { vi.advanceTimersByTime(3_400); });

    const overlay = screen.getByRole("dialog", { name: "Round result" });
    const hands = overlay.querySelectorAll(".revealed-hand");
    expect(hands).toHaveLength(2);
    for (const hand of hands) expect(hand.querySelectorAll(".die")).toHaveLength(5);
    vi.useRealTimers();
  })

  it("keeps a seat card showing the pre-resolution dice count while the result callout plays, then updates it", () => {
    // The server view already applies the die loss the instant reveal
    // starts. Seat cards must hold the pre-resolution count (`before`) until
    // the 3.3s callout finishes, then switch to the live count — otherwise
    // the die drop spoils the callout instead of following it.
    vi.useFakeTimers();
    render(<OnlineGame onExit={vi.fn()} />);
    const players: PublicPlayer[] = [
      { id: "player-1", name: "Ana María", diceCount: 5, eliminated: false, tableDice: [], hand: [1, 2, 3, 4, 5] },
      { id: "player-2", name: "Miss Blanquita", diceCount: 4, eliminated: false, tableDice: [4, 4], hand: [4, 4, 2, 6] },
    ];
    act(() => {
      socket().open();
      socket().message({ type: "joined", roomCode: "ABCDE", playerId: "player-1", reconnectToken: "secret", hostPlayerId: "player-1" });
      socket().message({
        type: "state",
        hostPlayerId: "player-1",
        view: {
          phase: "reveal",
          round: 2,
          paloFijo: false,
          rules: { ...DEFAULT_GAME_RULES },
          players,
          currentPlayerId: null,
          currentBid: { quantity: 4, denomination: 4 },
          lastBidderId: "player-2",
          viewerPlayerId: "player-1",
          resolution: {
            kind: "dudo", callerId: "player-1", bidderId: "player-2",
            bid: { quantity: 4, denomination: 4 }, actualCount: 5, correct: false,
            diceChanges: [{ playerId: "player-2", before: 5, after: 4, delta: -1, reason: "dudo" }], nextStarterId: "player-1", paloFijoNextRound: false,
          },
        },
        history: [],
        playerStatuses: players.map((player) => ({ id: player.id, connected: true, covered: false })),
      });
    });

    const seat = () => screen.getByRole("article", { name: "Miss Blanquita" });
    expect(seat().querySelectorAll(".tp-seat-dice-squares i")).toHaveLength(5);

    act(() => { vi.advanceTimersByTime(3_400); });

    expect(seat().querySelectorAll(".tp-seat-dice-squares i")).toHaveLength(4);
    vi.useRealTimers();
  })

  it("turns the winner ceremony into the dominant final screen", () => {
    const { container } = render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();

    const winner = screen.getByRole("dialog", { name: "Game winner" });
    expect(winner).toHaveClass("online-game-over-card");
    expect(winner).toHaveTextContent("Champion of the table");
    expect(winner).toHaveTextContent("Ana María wins!");
    expect(winner).toHaveTextContent("9 rounds");
    expect(container.querySelectorAll(".tp-confetti i")).toHaveLength(132);
    expect(screen.queryByLabelText("Your hand and turn controls")).not.toBeInTheDocument();
  });

  it("lets any seated player — not just the host — take the finished table back to its lobby", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    // Min-chi Park is neither the host (player-1) nor the winner, and is out of
    // dice: the player most likely to be stuck on the winner screen.
    enterWinner({ viewerId: "player-2" });

    fireEvent.click(screen.getByRole("button", { name: "Back to lobby" }));

    expect(socket().sent.map((message) => JSON.parse(message))).toContainEqual({ type: "return-to-lobby" });
  });

  it("crowns the biggest liar from the widest revealed shortfall", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ shortfall: true });

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const panel = screen.getByRole("dialog", { name: "Game analysis" });

    // Min-chi claimed six Chinas in round 8 with two there — four short, the
    // widest gap of the match, so the crown and the tile both name them.
    expect(panel).toHaveTextContent("Biggest liar");
    expect(panel).toHaveTextContent("♛ Min-chi Park");
    expect(panel).toHaveTextContent("Round 8: claimed 6 Chinas, 2 there");
    const crown = screen.getByLabelText("Biggest liar: round 8, claimed 6 with 2 on the table");
    expect(crown.closest(".analysis-player")).toHaveTextContent("Min-chi Park");
  });

  it("hands out no liar's crown when every revealed claim held up", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    expect(screen.getByRole("dialog", { name: "Game analysis" })).not.toHaveTextContent("Biggest liar");
  });

  it("offers no play-again action to spectators, who never held a seat", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ spectator: true });

    expect(screen.getByRole("dialog", { name: "Game winner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to lobby" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave game" })).toBeInTheDocument();
  });

  it("opens a dense, plain-language completed-game analysis from the winner screen", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const panel = screen.getByRole("dialog", { name: "Game analysis" });
    expect(panel).toHaveTextContent("The match, burning down");
    expect(panel).toHaveTextContent("Round by round");
    expect(panel).toHaveTextContent("Who dared to call");
    // Round rail retells the fixture's final round in plain words with margin.
    expect(panel).toHaveTextContent("Min-chi Park → Dudo ✗");
    expect(panel).toHaveTextContent("was exactly true — 5 on the table");
    expect(panel).toHaveTextContent("Knife-edge bids");
    expect(panel).toHaveTextContent("not a chance of winning");
    expect(panel).toHaveTextContent("Bold storyteller");
    expect(panel).toHaveTextContent("Pressed the table hard");
    expect(panel).toHaveTextContent("Unsupported");
    expect(panel).toHaveTextContent("1 caught · 1 survived");
    expect(panel).toHaveTextContent("Intent not recorded");
    expect(screen.getAllByLabelText(/Aggression: How strongly and quickly/)).toHaveLength(2);
    fireEvent.click(screen.getByText("What this bot was thinking"));
    expect(panel).toHaveTextContent("believable story");
    fireEvent.click(screen.getByRole("button", { name: "Back to winner" }));
    expect(screen.getByRole("dialog", { name: "Game winner" })).toBeInTheDocument();
  });

  it("requires confirmation before sending a forfeit", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterTable();

    fireEvent.click(screen.getByRole("button", { name: "Game settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Forfeit game" }));
    expect(socket().sent.map((message) => JSON.parse(message))).not.toContainEqual({ type: "forfeit-game" });
    expect(screen.getByText("You’ll be out and continue as a spectator.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm forfeit" }));
    expect(socket().sent.map((message) => JSON.parse(message))).toContainEqual({ type: "forfeit-game" });
  });
});
