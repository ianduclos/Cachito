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

function enterTable({ spectator = false, eliminated = false, shuffling = true }: { spectator?: boolean; eliminated?: boolean; shuffling?: boolean } = {}) {
  const playerId = spectator ? undefined : "player-1";
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

function enterWinner() {
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
    viewerPlayerId: "player-1",
  };
  const analysis: MatchAnalysis = {
    schemaVersion: 2, generatedAt: "2026-07-18T00:00:00.000Z", rounds: 9, totalTurns: 42, winnerId: "player-1",
    headline: "Ana María took the table after 9 rounds.", keyMoment: "Round 7: a correct Dudo changed the direction of the table.",
    tableAverages: { bluff: 22, aggression: 48, challenge: 36 },
    momentum: [{ round: 9, players: [{ playerId: "player-1", dice: 3, share: 100 }, { playerId: "player-2", dice: 0, share: 0 }] }],
    players: [
      { id: "player-1", name: "Ana María", controller: "human", winner: true, verdict: "Bid patiently and picked measured moments to challenge. Every final claim held up at reveal.", scores: { bluff: { value: 18, samples: 3, earlyRead: true }, aggression: { value: 40, samples: 8, earlyRead: false }, challenge: { value: 52, samples: 4, earlyRead: false } }, stats: { bids: 18, unsupportedFinalBids: 0, unsupportedCaught: 0, unsupportedSurvived: 0, deliberatePersonaBluffs: 0, deliberateBluffsCaught: 0, deliberateBluffsSurvived: 0, forcedEscalations: 0, forcedEscalationsCaught: 0, forcedEscalationsSurvived: 0, dudoAttempts: 3, dudoCorrect: 2, calzoAttempts: 1, calzoCorrect: 1, diceGained: 1, diceLost: 3, tableDicePlays: 1 } },
      { id: "player-2", name: "Min-chi Park", controller: "bot", persona: "Bold storyteller", winner: false, verdict: "Pressed the table hard and challenged boldly. 1 final claim was unsupported: 1 caught, 0 survived.", scores: { bluff: { value: 64, samples: 5, earlyRead: false }, aggression: { value: 72, samples: 11, earlyRead: false }, challenge: { value: 66, samples: 3, earlyRead: false } }, stats: { bids: 20, unsupportedFinalBids: 1, unsupportedCaught: 1, unsupportedSurvived: 0, deliberatePersonaBluffs: 1, deliberateBluffsCaught: 1, deliberateBluffsSurvived: 0, forcedEscalations: 2, forcedEscalationsCaught: 1, forcedEscalationsSurvived: 1, dudoAttempts: 2, dudoCorrect: 1, calzoAttempts: 1, calzoCorrect: 0, diceGained: 0, diceLost: 5, tableDicePlays: 2 }, botReasoning: [{ round: 4, action: "Bid 5 Chinas", explanation: "It found a cheap moment to sell a believable story on a face it genuinely held." }] },
    ],
  };
  act(() => {
    socket().open();
    socket().message({ type: "joined", roomCode: "ABCDE", playerId: "player-1", reconnectToken: "secret", hostPlayerId: "player-1" });
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

  it("opens a dense, plain-language completed-game analysis from the winner screen", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const panel = screen.getByRole("dialog", { name: "Game analysis" });
    expect(panel).toHaveTextContent("How the table shifted");
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
