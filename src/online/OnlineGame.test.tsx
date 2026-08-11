import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function enterWinner({ viewerId = "player-1", spectator = false, shortfall = false, longMatch = false, legacyAnalysis = false, analysisPlayerCount = 2, liarVariant, coveredSignatureCounterpart, coveredTapeAction }: { viewerId?: string; spectator?: boolean; shortfall?: boolean; longMatch?: boolean; legacyAnalysis?: boolean; analysisPlayerCount?: 2 | 8; liarVariant?: "winner" | "survived" | "tie"; coveredSignatureCounterpart?: "bidder" | "caller"; coveredTapeAction?: "bid" | "call" | "both" } = {}) {
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
    schemaVersion: 5, generatedAt: "2026-07-18T00:00:00.000Z", rounds: 9, totalTurns: 42, winnerId: "player-1",
    headline: "Ana María took the table after 9 rounds.", keyMoment: "Round 7: a correct Dudo changed the direction of the table.",
    startingDice: [{ playerId: "player-1", dice: 5 }, { playerId: "player-2", dice: 5 }],
    tableAverages: { bluff: 22, aggression: 48, challenge: 36 },
    momentum: [{ round: 8, players: [{ playerId: "player-1", dice: 3, share: 75 }, { playerId: "player-2", dice: 1, share: 25 }] }, { round: 9, players: [{ playerId: "player-1", dice: 3, share: 100 }, { playerId: "player-2", dice: 0, share: 0 }] }],
    roundStories: [...(shortfall ? [{
      round: 8, paloFijo: false, startingDice: [{ playerId: "player-1", dice: 3 }, { playerId: "player-2", dice: 1 }],
      bids: [{ playerId: "player-2", quantity: 6, denomination: 5 as const, attributable: true }],
      callerId: "player-1", callerAttributable: true, bidderId: "player-2", kind: "dudo" as const, correct: true, actualCount: 2, margin: -4,
      diceChanges: [{ playerId: "player-2", delta: -1 }],
    }] : []), {
      round: 9, paloFijo: false, startingDice: [{ playerId: "player-1", dice: 3 }, { playerId: "player-2", dice: 1 }],
      bids: [{ playerId: "player-2", quantity: 4, denomination: 5, attributable: true, tableDice: 1 }, { playerId: "player-1", quantity: 5, denomination: 5, attributable: true }],
      callerId: "player-2", callerAttributable: true, bidderId: "player-1", kind: "dudo" as const, correct: false, actualCount: 5, margin: 0,
      diceChanges: [{ playerId: "player-2", delta: -1 }],
    }],
    signaturePlay: { round: 9, kind: "bid-held", actorId: "player-1", counterpartId: "player-2", counterpartAttributable: true, bid: { quantity: 5, denomination: 5 }, actualCount: 5, callKind: "dudo", diceChanges: [{ playerId: "player-2", delta: -1 }], ladderLength: 2, tableDice: 1, surprise: "bold" },
    ...(shortfall ? { biggestLiar: { playerId: "player-2", score: 81, components: { unsupportedFinalBids: 1, tableMaxUnsupportedFinalBids: 1, unheldFaceBids: 4, averageUnheldFaceQuantity: 5.5, tableMaxAverageUnheldFaceQuantity: 5.5 }, widestRevealedShortfall: { round: 8, bid: { quantity: 6, denomination: 5 }, actualCount: 2, shortfall: 4, callerId: "player-1", caught: true } } } : {}),
    players: [
      { id: "player-1", name: "Ana María", controller: "human", winner: true, verdict: "Bid patiently and picked measured moments to challenge. Claims stayed close to what their own dice supported. Every claim that reached a reveal held up.", style: "Receipts Attached", styleRead: "Kept most claims close to the dice they could see.", badges: [{ label: "ALL CLAIMS HELD", read: "Every revealed final claim held." }], scores: { bluff: { value: 31, samples: 18, earlyRead: false }, aggression: { value: 40, samples: 8, earlyRead: false }, challenge: { value: 52, samples: 1, earlyRead: true } }, stats: { bids: 18, verifiedFinalBids: 4, unsupportedFinalBids: 0, unsupportedCaught: 0, unsupportedSurvived: 0, deliberatePersonaBluffs: 0, deliberateBluffsCaught: 0, deliberateBluffsSurvived: 0, forcedEscalations: 0, forcedEscalationsCaught: 0, forcedEscalationsSurvived: 0, dudoAttempts: 3, dudoCorrect: 2, calzoAttempts: 1, calzoCorrect: 1, diceGained: 1, diceLost: 3, tableDicePlays: 1, bidFaceCounts: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 3 }, unheldFaceBids: 0, averageUnheldFaceQuantity: 0 } },
      { id: "player-2", name: "Min-chi Park", controller: "bot", persona: "Bold storyteller", winner: false, verdict: "Pressed the table hard and challenged boldly. Claims regularly ran past what their own dice supported. 1 of 5 revealed claims fell short: 1 caught, 0 survived.", style: "Bid Bulldozer", styleRead: "Kept pushing when the ladder tightened.", badges: [{ label: "TABLE DICE", read: "Put dice in public twice." }, { label: "FORCED CLIMB", read: "Climbed without a fully backed raise twice." }], scores: { bluff: { value: 64, samples: 20, earlyRead: false }, aggression: { value: 72, samples: 11, earlyRead: false }, challenge: { value: 66, samples: 3, earlyRead: false } }, stats: { bids: 20, verifiedFinalBids: 5, unsupportedFinalBids: 1, unsupportedCaught: 1, unsupportedSurvived: 0, deliberatePersonaBluffs: 1, deliberateBluffsCaught: 1, deliberateBluffsSurvived: 0, forcedEscalations: 2, forcedEscalationsCaught: 1, forcedEscalationsSurvived: 1, dudoAttempts: 2, dudoCorrect: 1, calzoAttempts: 1, calzoCorrect: 0, diceGained: 0, diceLost: 5, tableDicePlays: 2, bidFaceCounts: { 1: 2, 2: 1, 3: 2, 4: 3, 5: 8, 6: 4 }, unheldFaceBids: 4, averageUnheldFaceQuantity: 5.5 }, botReasoning: [{ round: 4, action: "Bid 5 Chinas", explanation: "It found a cheap moment to sell a believable story on a face it genuinely held." }] },
    ],
  };
  if (longMatch) {
    analysis.rounds = 30;
    analysis.momentum = Array.from({ length: 30 }, (_, index) => ({ round: index + 1, players: [{ playerId: "player-1", dice: Math.max(0, 5 - Math.floor(index / 8)), share: 100 }, { playerId: "player-2", dice: 0, share: 0 }] }));
    analysis.roundStories = Array.from({ length: 30 }, (_, index) => ({ round: index + 1, paloFijo: false, startingDice: [{ playerId: "player-1", dice: Math.max(1, 5 - Math.floor(index / 8)) }, { playerId: "player-2", dice: 1 }], bids: [{ playerId: "player-1", quantity: 2 + (index % 4), denomination: 5 as const, attributable: true }], callerId: "player-2", callerAttributable: true, bidderId: "player-1", kind: "dudo" as const, correct: index % 2 === 0, actualCount: 3, margin: 0, diceChanges: [] }));
  }
  if (analysis.biggestLiar && liarVariant) {
    const awardedPlayer = analysis.players.find((player) => player.id === (liarVariant === "winner" ? "player-1" : "player-2"))!;
    analysis.biggestLiar.playerId = awardedPlayer.id;
    if (liarVariant === "winner") {
      awardedPlayer.stats.unsupportedFinalBids = 1;
      awardedPlayer.stats.unsupportedCaught = 0;
      awardedPlayer.stats.unsupportedSurvived = 1;
      awardedPlayer.stats.unheldFaceBids = 3;
      awardedPlayer.stats.averageUnheldFaceQuantity = 6;
    } else if (liarVariant === "survived") {
      awardedPlayer.stats.unsupportedFinalBids = 2;
      awardedPlayer.stats.unsupportedCaught = 0;
      awardedPlayer.stats.unsupportedSurvived = 2;
    } else {
      awardedPlayer.stats.unsupportedFinalBids = 2;
      awardedPlayer.stats.unsupportedCaught = 1;
      awardedPlayer.stats.unsupportedSurvived = 1;
    }
    analysis.biggestLiar.components.unsupportedFinalBids = awardedPlayer.stats.unsupportedFinalBids;
    analysis.biggestLiar.components.unheldFaceBids = awardedPlayer.stats.unheldFaceBids;
    analysis.biggestLiar.components.averageUnheldFaceQuantity = awardedPlayer.stats.averageUnheldFaceQuantity;
  }
  if (analysis.signaturePlay && coveredSignatureCounterpart) {
    analysis.signaturePlay.counterpartAttributable = false;
    if (coveredSignatureCounterpart === "bidder") {
      analysis.signaturePlay.kind = "correct-dudo";
      analysis.signaturePlay.actualCount = 2;
    }
  }
  if (coveredTapeAction) {
    const tapeStory = analysis.roundStories.at(-1)!;
    if (coveredTapeAction === "bid" || coveredTapeAction === "both") tapeStory.bids.at(-1)!.attributable = false;
    if (coveredTapeAction === "call" || coveredTapeAction === "both") tapeStory.callerAttributable = false;
  }
  if (analysisPlayerCount === 8) {
    for (let index = 2; index < players.length; index += 1) {
      analysis.players.push({ ...analysis.players[1], id: players[index].id, name: players[index].name, winner: false, scores: { ...analysis.players[1].scores }, stats: { ...analysis.players[1].stats, bidFaceCounts: { ...analysis.players[1].stats.bidFaceCounts } }, botReasoning: undefined });
    }
  }
  if (legacyAnalysis) {
    (analysis as unknown as { schemaVersion: number }).schemaVersion = 4;
    for (const player of analysis.players) delete (player.stats as Partial<typeof player.stats>).bidFaceCounts;
    for (const story of analysis.roundStories) {
      delete (story as Partial<typeof story>).callerAttributable;
      for (const bid of story.bids) delete (bid as Partial<typeof bid>).attributable;
    }
  }
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

  it("explains biggest liar as a table-relative mix, never a confession", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ shortfall: true });

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const panel = screen.getByRole("dialog", { name: "Game analysis" });

    // The award combines revealed unsupported bids with claims on literal
    // absent faces, while retaining the widest public miss as evidence.
    expect(panel).toHaveTextContent("Biggest liar");
    expect(panel).toHaveTextContent("Min-chi Park");
    expect(panel).toHaveTextContent("The dice kept the receipts.");
    expect(panel).toHaveTextContent("1 unsupported final bid");
    expect(panel).toHaveTextContent("4 bids named a face absent from their hand");
    expect(panel).toHaveTextContent("Widest miss: R8, 6 Chinas claimed, 2 were there — 4 short.");
  });

  it("hands out no liar's crown when every revealed claim held up", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    expect(screen.getByRole("dialog", { name: "Game analysis" })).not.toHaveTextContent("Biggest liar");
  });

  it.each([
    ["winner", "Lied. Won. No notes."],
    ["survived", "Got away with it. Lost anyway."],
    ["tie", "The dice kept the receipts."],
  ] as const)("uses the %s Biggest liar roast", (liarVariant, expectedRoast) => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ shortfall: true, liarVariant });

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const award = screen.getByLabelText("Biggest liar explanation");
    expect(award).toHaveTextContent(expectedRoast);
  });

  it("keeps a player on the winner screen after someone else takes the room back to its lobby", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ viewerId: "player-2" });

    // Another player pressed first: the room resets, but this player is still
    // reading the summary and decides for themselves when to leave it.
    act(() => socket().message({
      type: "lobby",
      roomCode: "ABCDE",
      hostPlayerId: "player-1",
      players: [{ id: "player-1", name: "Ana María", connected: true, isBot: false }, { id: "player-2", name: "Min-chi Park", connected: true, isBot: false }],
      spectatorCount: 0,
      rules: { ...DEFAULT_GAME_RULES },
    }));

    expect(screen.getByRole("dialog", { name: "Game winner" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Game winner" })).toHaveTextContent("already back in its lobby");
    expect(screen.queryByRole("button", { name: "Start game" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to lobby" }));

    expect(screen.queryByRole("dialog", { name: "Game winner" })).not.toBeInTheDocument();
    expect(screen.getByText("ABCDE")).toBeInTheDocument();
    // The room was already reset, so nothing needed to be asked of the server.
    expect(socket().sent.map((message) => JSON.parse(message))).not.toContainEqual({ type: "return-to-lobby" });
  });

  it("offers no play-again action to spectators, who never held a seat", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ spectator: true });

    expect(screen.getByRole("dialog", { name: "Game winner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to lobby" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave game" })).toBeInTheDocument();
  });

  it("opens an overview first, with dossiers, style reads and an on-demand round tape", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();

    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const panel = screen.getByRole("dialog", { name: "Game analysis" });
    expect(panel).toHaveTextContent("Match arc");
    expect(panel).toHaveTextContent("Play of the match");
    expect(panel).toHaveTextContent("Ana María made it 5 Chinas. Min-chi Park said Dudo. 5 were there.");
    expect(panel).toHaveTextContent("How everyone’s game read");
    expect(panel).toHaveTextContent("Receipts Attached");
    expect(panel).toHaveTextContent("Kept most claims close to the dice they could see.");
    expect(panel).toHaveTextContent("ALL CLAIMS HELD");
    expect(within(panel).getByRole("button", { name: "Game settings" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("Bold storyteller");
    expect(panel).not.toHaveTextContent("Who dared to call");
    fireEvent.click(screen.getAllByText("Open dossier")[0]);
    expect(panel).toHaveTextContent("Intent not recorded");
    expect(panel).toHaveTextContent("Early read · 1 call");
    expect(panel).toHaveTextContent("18 bids");
    fireEvent.click(screen.getAllByText("Open dossier")[0]);
    fireEvent.click(screen.getAllByText("Open dossier")[1]);
    expect(panel).toHaveTextContent("Unsupported");
    expect(panel).toHaveTextContent("Deliberate");
    expect(panel).toHaveTextContent("Absent face");
    expect(panel).toHaveTextContent("1 caught · 0 survived");
    expect(screen.getAllByLabelText(/Bid faces: Every attributable bid by face/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Aggression: How strongly someone raised/)).toHaveLength(2);
    expect(panel).toHaveTextContent("Bot reasoning");
    expect(panel).toHaveTextContent("believable story");
    const analysisScroll = panel.querySelector<HTMLElement>(".analysis-scroll")!;
    analysisScroll.scrollTop = 300;
    fireEvent.click(screen.getByRole("button", { name: "Round tape" }));
    expect(analysisScroll.scrollTop).toBe(0);
    expect(panel).toHaveTextContent("The stories worth opening");
    expect(screen.getByRole("button", { name: "Eliminations" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("Dudo bounced. Ana María had 5 for 5 Chinas.");
    expect(panel).toHaveTextContent("Exact landing");
    expect(panel).toHaveTextContent("Play of the match");
    fireEvent.click(screen.getByRole("button", { name: "Eliminations" }));
    fireEvent.click(screen.getByRole("button", { name: /Replay round 9/ }));
    expect(screen.getByRole("dialog", { name: "Round 9 · open dice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close round replay" }));
    fireEvent.click(screen.getByRole("button", { name: "Calzo" }));
    expect(panel).toHaveTextContent("No rounds match that filter.");
    fireEvent.click(screen.getByRole("button", { name: "Show all rounds" }));
    expect(panel).toHaveTextContent("Dudo bounced.");
    analysisScroll.scrollTop = 300;
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(analysisScroll.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Back to winner" }));
    expect(screen.getByRole("dialog", { name: "Game winner" })).toBeInTheDocument();
  });

  it("names an attributable caller but not a covered final bidder on the tape", () => {
    const { container } = render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ coveredTapeAction: "bid" });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Round tape" }));

    const card = screen.getByRole("button", { name: "Replay round 9: Min-chi Park called Dudo on the final claim. 5 backed 5 Chinas." });
    expect(card).toHaveTextContent("Final claim: 5 Chinas · 5 were there");
    expect(card).not.toHaveTextContent("Ana María");
    const coveredBar = container.querySelectorAll(".analysis-ladder-bar")[1];
    expect(coveredBar).toHaveClass("analysis-ladder-bar--covered");
    expect(coveredBar).toHaveAttribute("title", "Covered bid 2: 5 × Chinas");
    expect(coveredBar).toHaveAttribute("aria-label", "Covered bid 2: 5 × Chinas");
  });

  it("names an attributable final bidder but keeps a covered call generic on the tape", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ coveredTapeAction: "call" });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Round tape" }));

    const card = screen.getByRole("button", { name: "Replay round 9: A Dudo followed Ana María’s 5 Chinas. 5 were there." });
    expect(card).toHaveTextContent("Ana María’s final 5 Chinas · 5 were there");
    expect(card).not.toHaveTextContent("Min-chi Park called Dudo");
  });

  it("keeps both sides generic when the final bid and resolving call were covered", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ coveredTapeAction: "both" });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Round tape" }));

    const card = screen.getByRole("button", { name: "Replay round 9: A Dudo followed the final 5 Chinas. 5 were there." });
    expect(card).toHaveTextContent("Final claim: 5 Chinas · 5 were there");
    expect(card).not.toHaveTextContent("Ana María");
    expect(card).not.toHaveTextContent("Min-chi Park called Dudo");
  });

  it("does not attribute a covered signature call to the caller", () => {
    const { container } = render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ coveredSignatureCounterpart: "caller" });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    const signature = container.querySelector(".analysis-editorial-rail")!;
    expect(signature).toHaveTextContent("Ana María made it 5 Chinas. A Dudo followed. 5 were there.");
    expect(signature).not.toHaveTextContent("Min-chi Park");
  });

  it("opens the exact same round replay from the signature play rail", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    fireEvent.click(screen.getByRole("button", { name: "Replay play of the match from round 9" }));
    const replay = screen.getByRole("dialog", { name: "Round 9 · open dice" });
    expect(replay).toHaveTextContent("Fresh cups. Same suspicious friends.");
    fireEvent.click(within(replay).getByRole("button", { name: "Close round replay" }));
    expect(screen.queryByRole("dialog", { name: "Round 9 · open dice" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Game analysis" })).toBeInTheDocument();
  });

  it("does not attribute a covered signature bid to the bidder", () => {
    const { container } = render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ coveredSignatureCounterpart: "bidder" });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    const signature = container.querySelector(".analysis-editorial-rail")!;
    expect(signature).toHaveTextContent("Ana María called Dudo on 5 Chinas. 2 were there.");
    expect(signature).not.toHaveTextContent("Min-chi Park");
  });

  it("caps match-arc round labels on a long match", () => {
    const { container } = render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ longMatch: true });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    const labels = [...container.querySelectorAll(".analysis-flow text")].map((node) => node.textContent);
    expect(labels.filter((label) => label?.startsWith("R") || label === "start")).toHaveLength(8);
    expect(labels).not.toContain("R28✗");
    expect(labels).toContain("R30✗");
    expect([...container.querySelectorAll(".analysis-flow text")].find((node) => node.textContent === "R30✗")).toHaveAttribute("text-anchor", "end");
    expect(container.querySelectorAll(".analysis-flow rect[tabindex]")).toHaveLength(0);
    expect(screen.getByText("View round values")).toBeInTheDocument();
  });

  it("opens legacy schema-v4 player dossiers without face-count data", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ legacyAnalysis: true });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    fireEvent.click(screen.getAllByText("Open dossier")[0]);

    expect(screen.getByRole("dialog", { name: "Game analysis" })).toHaveTextContent("Bid faces");
    expect(screen.getByLabelText("Ana María attributable bids by face")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Round tape" }));
    const legacyCard = screen.getByRole("button", { name: "Replay round 9: A Dudo followed the final 5 Chinas. 5 were there." });
    expect(legacyCard).toHaveTextContent("Final claim: 5 Chinas");
    expect(legacyCard.querySelectorAll(".analysis-ladder-bar--covered")).toHaveLength(2);
  });

  it("marks a full eight-player roster for the responsive analysis grid", () => {
    const { container } = render(<OnlineGame onExit={vi.fn()} />);
    enterWinner({ analysisPlayerCount: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));

    expect(container.querySelector(".analysis-player-grid")).toHaveAttribute("data-player-count", "8");
    expect(container.querySelectorAll(".analysis-player-grid > .analysis-player")).toHaveLength(8);
  });

  it("lets nested sound settings consume Escape before closing analysis", () => {
    render(<OnlineGame onExit={vi.fn()} />);
    enterWinner();
    fireEvent.click(screen.getByRole("button", { name: "Game analysis" }));
    const panel = screen.getByRole("dialog", { name: "Game analysis" });
    fireEvent.click(within(panel).getByRole("button", { name: "Game settings" }));
    expect(screen.getByRole("dialog", { name: "Game settings" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Game settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Game analysis" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
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
