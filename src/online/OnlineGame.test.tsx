import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GAME_RULES } from "../engine";
import { OnlineGame } from "./OnlineGame";
import type { OnlineServerMessage } from "./protocol";

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
});
