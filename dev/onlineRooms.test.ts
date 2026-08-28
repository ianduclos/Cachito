import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type WebSocketServer } from "ws";
import { applyAction, createGame, type GameAction, type GameState } from "../src/engine";
import type { PublicActionEntry } from "../src/bot";
import type { OnlineClientMessage, OnlineServerMessage } from "../src/online/protocol";
import type { RoomPlayer } from "./onlineRoomTypes";
import { applyValidatedGameAction, buildOnlineMatchRecord, writeLocalMatchLog, executeBotTurn, getRoomForTests, installOnlineRooms, isRecoverySnapshotFresh, onlineBotPolicy, onlineLogHeader, recordBotHistoryEntry, resetOnlineRoomsForTests, SUPPORTED_CONCURRENT_GAMES } from "./onlineRooms";
import { release } from "../src/release";

class ProtocolClient {
  readonly socket: WebSocket;
  private messages: OnlineServerMessage[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as OnlineServerMessage));
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new ProtocolClient(socket);
  }

  send(message: OnlineClientMessage) {
    this.socket.send(JSON.stringify(message));
  }

  async take<T extends OnlineServerMessage>(predicate: (message: OnlineServerMessage) => message is T, timeoutMs?: number): Promise<T>;
  async take(predicate: (message: OnlineServerMessage) => boolean, timeoutMs?: number): Promise<OnlineServerMessage>;
  async take(predicate: (message: OnlineServerMessage) => boolean, timeoutMs = 1_500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for a server message. Received: ${JSON.stringify(this.messages)}`);
  }

  waitForClose() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(1006);
    return new Promise<number>((resolve) => this.socket.once("close", resolve));
  }
}

const isJoined = (message: OnlineServerMessage): message is Extract<OnlineServerMessage, { type: "joined" }> => message.type === "joined";
const isError = (message: OnlineServerMessage): message is Extract<OnlineServerMessage, { type: "error" }> => message.type === "error";

describe("online room safety guards", () => {
  it("stamps recovery and match logs with the deployed game version", () => {
    expect(onlineLogHeader(2)).toEqual({ schemaVersion: 2, gameVersion: release });
    expect(onlineLogHeader(5)).toEqual({ schemaVersion: 5, gameVersion: release });
  });

  // A locally-served room persisted NOTHING before 2026-08-28: match logs went only to GCS,
  // gated on MATCH_LOG_BUCKET, so a game played against the local dev server survived just as
  // long as the server process. This is the fallback that fixes it.
  it("writes a completed match to a local file when no GCS bucket is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cachito-match-log-"));
    const game = createGame([
      { id: "p1", name: "dd" },
      { id: "p2", name: "Monkoky" },
    ]);
    const room = {
      code: "Z9V6B",
      startedAt: "2026-08-28T17:40:00.000Z",
      players: [
        { id: "p1", name: "dd", isBot: false },
        { id: "p2", name: "Monkoky", isBot: true },
      ] as RoomPlayer[],
      game,
      history: [],
      botHistory: [],
      botDecisions: [],
      shadowDecisions: [],
      actions: [],
      roundDeals: [],
      roundResolutions: [],
      turnTimings: [],
    };

    await writeLocalMatchLog(room as never, directory);

    const written = await readdir(directory);
    expect(written).toEqual(["2026-08-28T17-40-00-000Z-Z9V6B.json"]);
    const record = JSON.parse(await readFile(join(directory, written[0]), "utf8"));
    expect(record.schemaVersion).toBe(5);
    expect(record.gameVersion).toBe(release);
    expect(record.roomCode).toBe("Z9V6B");
    // No .tmp left behind: the write is temp-file + rename so a reader never sees a partial log.
    expect(written.some((name) => name.endsWith(".tmp"))).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });

  it("writes nothing when no directory is configured, so production keeps using GCS only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cachito-match-log-"));
    await writeLocalMatchLog({ code: "AAAAA", startedAt: "2026-08-28T00:00:00.000Z", game: {} } as never, undefined);
    expect(await readdir(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("age-bounds current snapshots and legacy snapshots during rollout", () => {
    const now = 1_000_000_000;
    expect(isRecoverySnapshotFresh({ schemaVersion: 2, lastActivityAt: now - 19 * 60_000 }, now)).toBe(true);
    expect(isRecoverySnapshotFresh({ schemaVersion: 2, lastActivityAt: now - 20 * 60_000 }, now)).toBe(false);
    expect(isRecoverySnapshotFresh({ schemaVersion: 1 }, now, new Date(now - 19 * 60_000).toISOString())).toBe(true);
    expect(isRecoverySnapshotFresh({ schemaVersion: 1 }, now, new Date(now - 20 * 60_000).toISOString())).toBe(false);
    expect(isRecoverySnapshotFresh({ schemaVersion: 1 }, now)).toBe(false);
    expect(isRecoverySnapshotFresh({ schemaVersion: 2, lastActivityAt: now + 61_000 }, now)).toBe(false);
  });

  it("mirrors the full public ladder into bot history and attaches the reveal outcome", () => {
    // Every die is a 4 with this random source, so a Dudo on "3 threes" is
    // correct with a publicly revealed actualCount of 0.
    let game: GameState = createGame([{ id: "one", name: "One" }, { id: "two", name: "Two" }], () => 0.5);
    const botHistory: PublicActionEntry[] = [];
    const apply = (action: GameAction) => {
      game = applyAction(game, action, () => 0.5);
      recordBotHistoryEntry(botHistory, action, game);
    };
    const first = game.currentPlayerId;
    const second = game.players.find((player) => player.id !== first)!.id;

    apply({ type: "bid", playerId: first, bid: { quantity: 2, denomination: 3 } });
    apply({ type: "bid", playerId: second, bid: { quantity: 3, denomination: 3 } });
    apply({ type: "dudo", playerId: first });

    expect(botHistory.map((entry) => entry.action.type)).toEqual(["bid", "bid", "dudo"]);
    expect(botHistory[0]).toEqual({ round: 1, playerId: first, action: { type: "bid", bid: { quantity: 2, denomination: 3 } } });
    expect(botHistory[1].outcome).toBeUndefined();
    expect(botHistory[2]).toEqual({
      round: 1,
      playerId: first,
      action: { type: "dudo" },
      outcome: { kind: "dudo", bidderId: second, bid: { quantity: 3, denomination: 3 }, correct: true, actualCount: 0 },
    });

    apply({ type: "nextRound" });
    expect(botHistory).toHaveLength(3);
  });

  it("does not finalize timing when the engine rejects an action", () => {
    const game = createGame([{ id: "one", name: "One" }, { id: "two", name: "Two" }], () => 0.5);
    const wrongPlayerId = game.players.find((player) => player.id !== game.currentPlayerId)!.id;
    let timingFinalized = false;

    expect(() => applyValidatedGameAction(game, { type: "bid", playerId: wrongPlayerId, bid: { quantity: 1, denomination: 2 } }, () => { timingFinalized = true; })).toThrow();
    expect(timingFinalized).toBe(false);
  });
});

describe("authoritative online rooms", () => {
  let server: Server;
  let websocketServer: WebSocketServer;
  let url: string;
  let clients: ProtocolClient[];

  beforeAll(async () => {
    server = createServer();
    websocketServer = installOnlineRooms(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    url = `ws://127.0.0.1:${address.port}/online`;
  });

  afterEach(() => {
    for (const client of clients) client.socket.terminate();
    for (const socket of websocketServer.clients) socket.terminate();
    resetOnlineRoomsForTests();
    clients = [];
  });

  afterAll(() => {
    websocketServer.close();
    server.closeAllConnections();
    server.close();
  });

  async function connect() {
    clients ??= [];
    const client = await ProtocolClient.connect(url);
    clients.push(client);
    return client;
  }

  it("allows a failed room lookup to be retried but binds a socket to only one identity", async () => {
    const client = await connect();
    client.send({ type: "join-room", roomCode: "NOPE", name: "Ada" });
    await expect(client.take(isError)).resolves.toMatchObject({ message: "That room does not exist." });

    client.send({ type: "create-room", name: "Ada" });
    const joined = await client.take(isJoined);
    client.send({ type: "create-room", name: "Another Ada" });

    expect(joined.playerId).toBeTruthy();
    await expect(client.take(isError)).resolves.toMatchObject({ message: "This connection is already attached to a room." });
  });

  it("releases a lobby seat and transfers host ownership on explicit leave", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);

    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    const guestJoined = await guest.take(isJoined);
    await guest.take((message) => message.type === "lobby" && message.players.length === 2);

    const hostClosed = host.waitForClose();
    host.send({ type: "leave-room" });
    const lobby = await guest.take((message): message is Extract<OnlineServerMessage, { type: "lobby" }> => message.type === "lobby" && message.players.length === 1);

    expect(lobby.hostPlayerId).toBe(guestJoined.playerId);
    expect(lobby.players.map((player) => player.id)).toEqual([guestJoined.playerId]);
    await expect(hostClosed).resolves.toBe(1000);
  });

  it("publishes active-game host transfers to the remaining players", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);

    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    const guestJoined = await guest.take(isJoined);
    await guest.take((message) => message.type === "lobby" && message.players.length === 2);
    host.send({ type: "start-game" });
    await guest.take((message) => message.type === "state" && message.hostPlayerId === hostJoined.playerId);

    host.send({ type: "leave-room" });
    const transferred = await guest.take((message): message is Extract<OnlineServerMessage, { type: "state" }> => message.type === "state" && message.hostPlayerId === guestJoined.playerId);

    expect(transferred.announcement?.text).toBe("Guest is now the host.");
  });

  it("turns a confirmed forfeit into elimination and a winner when one player remains", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);
    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    await guest.take(isJoined);
    await host.take((message) => message.type === "lobby" && message.players.length === 2);
    host.send({ type: "start-game" });
    await host.take((message) => message.type === "state" && message.view.phase === "playing");

    guest.send({ type: "forfeit-game" });
    const finished = await host.take((message): message is Extract<OnlineServerMessage, { type: "state" }> => message.type === "state" && message.view.phase === "gameOver");

    expect(finished.view.players.find((player) => player.name === "Guest")?.eliminated).toBe(true);
    expect(finished.view.phase === "gameOver" && finished.view.winnerId).toBe(hostJoined.playerId);
    expect(finished.history).toContain("Guest forfeited the game.");
    expect(finished.analysis).toMatchObject({ schemaVersion: 5, winnerId: hostJoined.playerId, headline: expect.stringContaining("Host") });
  });

  it("lets a non-host player return the finished table to the same lobby, seats intact", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);
    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    const guestJoined = await guest.take(isJoined);
    await host.take((message) => message.type === "lobby" && message.players.length === 2);
    host.send({ type: "start-game" });
    await host.take((message) => message.type === "state" && message.view.phase === "playing");
    guest.send({ type: "forfeit-game" });
    await guest.take((message) => message.type === "state" && message.view.phase === "gameOver");

    // The guest is neither the host nor still holding dice, and can still put
    // everyone back in the lobby for another game at the same table.
    guest.send({ type: "return-to-lobby" });
    // The lobby published when the guest first joined was already taken above, so
    // this one can only be the reset that followed the finished game.
    const lobby = await host.take((message): message is Extract<OnlineServerMessage, { type: "lobby" }> => message.type === "lobby" && message.players.length === 2);

    expect(lobby.roomCode).toBe(hostJoined.roomCode);
    expect(lobby.hostPlayerId).toBe(hostJoined.playerId);
    expect(lobby.players.map((player) => player.id)).toEqual([hostJoined.playerId, guestJoined.playerId]);
    await expect(guest.take((message) => message.type === "lobby" && message.players.length === 2)).resolves.toMatchObject({ roomCode: hostJoined.roomCode });

    // Players leave the winner screen one at a time, so the host asking after the
    // guest already reset the room is ordinary — and must not raise an error.
    host.send({ type: "return-to-lobby" });
    await expect(host.take(isError, 200)).rejects.toThrow(/Timed out/);
  });

  it("keeps spectators from returning a finished table to the lobby", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);
    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    await guest.take(isJoined);
    await host.take((message) => message.type === "lobby" && message.players.length === 2);
    host.send({ type: "start-game" });
    await host.take((message) => message.type === "state" && message.view.phase === "playing");
    const watcher = await connect();
    watcher.send({ type: "join-room", roomCode: hostJoined.roomCode, spectator: true });
    await watcher.take(isJoined);
    guest.send({ type: "forfeit-game" });
    await watcher.take((message) => message.type === "state" && message.view.phase === "gameOver");

    watcher.send({ type: "return-to-lobby" });

    await expect(watcher.take(isError)).resolves.toMatchObject({ message: "Only a player at this finished table can return it to the lobby." });
  });

  it("publishes a new turn with only its fresh deadline", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);
    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    const guestJoined = await guest.take(isJoined);
    await host.take((message) => message.type === "lobby" && message.players.length === 2);
    host.send({ type: "start-game" });
    await host.take((message) => message.type === "state" && message.view.phase === "playing");
    host.send({ type: "shuffle-dice" });
    guest.send({ type: "shuffle-dice" });
    const opened = await host.take((message): message is Extract<OnlineServerMessage, { type: "state" }> => message.type === "state" && Boolean(message.turnDeadlineAt) && message.shuffle?.readyPlayerIds.length === 2);
    const initialDeadline = opened.turnDeadlineAt!;
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    const acting = opened.view.currentPlayerId === hostJoined.playerId ? host : guest;
    const observing = opened.view.currentPlayerId === hostJoined.playerId ? guest : host;
    const nextPlayerId = opened.view.currentPlayerId === hostJoined.playerId ? guestJoined.playerId : hostJoined.playerId;
    acting.send({ type: "action", action: { type: "bid", playerId: opened.view.currentPlayerId!, bid: { quantity: 1, denomination: 2 } } });
    const nextTurn = await observing.take((message): message is Extract<OnlineServerMessage, { type: "state" }> => message.type === "state" && message.view.currentPlayerId === nextPlayerId && message.view.currentBid?.quantity === 1);

    expect(nextTurn.turnDeadlineAt).toBeGreaterThan(initialDeadline + 800);
  });

  it("runs four independent games concurrently on the authoritative instance", async () => {
    const roomCodes: string[] = [];
    for (let index = 0; index < SUPPORTED_CONCURRENT_GAMES; index += 1) {
      const host = await connect();
      host.send({ type: "create-room", name: `Host ${index + 1}` });
      const joined = await host.take(isJoined);
      roomCodes.push(joined.roomCode);
      host.send({ type: "add-bot" });
      await host.take((message) => message.type === "lobby" && message.players.length === 2);
      host.send({ type: "start-game" });
      await expect(host.take((message) => message.type === "state" && message.view.phase === "playing")).resolves.toBeTruthy();
    }

    expect(new Set(roomCodes)).toHaveLength(SUPPORTED_CONCURRENT_GAMES);
  });

  it("rejects cross-origin browser upgrades while allowing both public app origins", async () => {
    const rejected = new WebSocket(url, { origin: "https://attacker.example" });
    rejected.on("error", () => undefined);
    const status = await new Promise<number | undefined>((resolve) => rejected.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    }));
    expect(status).toBe(403);

    const production = new WebSocket(url, { origin: "https://cachito.web.app" });
    await new Promise<void>((resolve, reject) => {
      production.once("open", resolve);
      production.once("error", reject);
    });
    production.terminate();

    const appHosting = new WebSocket(url, { origin: "https://cachito--ian-duclos.europe-west4.hosted.app" });
    await new Promise<void>((resolve, reject) => {
      appHosting.once("open", resolve);
      appHosting.once("error", reject);
    });
    appHosting.terminate();

    const customDomain = new WebSocket(url, { origin: "https://cachito.ianduclos.com" });
    await new Promise<void>((resolve, reject) => {
      customDomain.once("open", resolve);
      customDomain.once("error", reject);
    });
    customDomain.terminate();
  });

  it("closes a connection that exceeds the per-socket request budget", async () => {
    const client = await connect();
    client.send({ type: "create-room", name: "Fast" });
    await client.take(isJoined);
    for (let index = 0; index < 41; index += 1) client.socket.send("{}");
    await expect(client.waitForClose()).resolves.toBe(1008);
  });

  it("enforces the websocket payload ceiling", async () => {
    const client = await connect();
    client.socket.send("x".repeat(16 * 1024 + 1));
    await expect(client.waitForClose()).resolves.toBe(1009);
  });

  it("records a shadow decision for each human strategic action", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);
    const guest = await connect();
    guest.send({ type: "join-room", roomCode: hostJoined.roomCode, name: "Guest" });
    const guestJoined = await guest.take(isJoined);
    await host.take((message) => message.type === "lobby" && message.players.length === 2);
    host.send({ type: "start-game" });
    await host.take((message) => message.type === "state" && message.view.phase === "playing");
    host.send({ type: "shuffle-dice" });
    guest.send({ type: "shuffle-dice" });
    const opened = await host.take((message): message is Extract<OnlineServerMessage, { type: "state" }> => message.type === "state" && Boolean(message.turnDeadlineAt) && message.shuffle?.readyPlayerIds.length === 2);
    const actor = opened.view.currentPlayerId === hostJoined.playerId ? host : guest;
    const actorJoined = opened.view.currentPlayerId === hostJoined.playerId ? hostJoined : guestJoined;
    const reactor = actor === host ? guest : host;
    actor.send({ type: "action", action: { type: "bid", playerId: actorJoined.playerId!, bid: { quantity: 1, denomination: 2 } } });
    await reactor.take((message) => message.type === "state" && message.view.currentBid?.quantity === 1);
    reactor.send({ type: "action", action: { type: "dudo", playerId: guestJoined.playerId! } });
    await host.take((message) => message.type === "state" && message.view.phase === "reveal");
    const room = getRoomForTests(hostJoined.roomCode)!;
    expect(room.shadowDecisions).toHaveLength(2);
    expect(room.botDecisions).toHaveLength(0);
    const bidShadow = room.shadowDecisions[0];
    expect(bidShadow.sequence).toBe(0);
    expect(bidShadow.playerId).toBe(actorJoined.playerId);
    expect(bidShadow.observedAction).toEqual({ type: "bid", bid: { quantity: 1, denomination: 2 } });
    expect(bidShadow.policyName).toBe(onlineBotPolicy({ id: actorJoined.playerId, isBot: false } as RoomPlayer).name);
    expect(bidShadow.probabilities.currentBid).toBeUndefined();
    const dudoShadow = room.shadowDecisions[1];
    expect(dudoShadow.sequence).toBe(1);
    expect(dudoShadow.observedAction).toEqual({ type: "dudo" });
    expect(dudoShadow.probabilities.currentBid).toBeDefined();
    const record = buildOnlineMatchRecord(room);
    expect(record.shadowDecisions).toEqual(room.shadowDecisions);
    expect(record.schemaVersion).toBe(5);
  });

  it("records bot actions in botDecisions but not shadowDecisions, and ignores shuffles", async () => {
    const host = await connect();
    host.send({ type: "create-room", name: "Host" });
    const hostJoined = await host.take(isJoined);
    host.send({ type: "add-bot" });
    const lobby = await host.take((message): message is Extract<OnlineServerMessage, { type: "lobby" }> => message.type === "lobby" && message.players.length === 2);
    const botId = lobby.players.find((player) => player.isBot)!.id;
    host.send({ type: "start-game" });
    await host.take((message) => message.type === "state" && message.view.phase === "playing");
    host.send({ type: "shuffle-dice" });
    // The bot shake timer fires 2–3s out; keep the budget generous under parallel-suite load.
    await host.take((message): message is Extract<OnlineServerMessage, { type: "state" }> => message.type === "state" && Boolean(message.turnDeadlineAt) && message.shuffle?.readyPlayerIds.length === 2, 15000);
    let room = getRoomForTests(hostJoined.roomCode)!;
    const bot = room.players.find((player) => player.isBot)!;
    if (room.game?.currentPlayerId === bot.id) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      executeBotTurn(room, bot);
    }
    host.send({ type: "action", action: { type: "bid", playerId: hostJoined.playerId!, bid: { quantity: 1, denomination: 2 } } });
    await host.take((message) => message.type === "state" && message.view.currentBid?.quantity === 1);
    room = getRoomForTests(hostJoined.roomCode)!;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    executeBotTurn(room, bot);
    expect(room.botDecisions.some((decision) => decision.playerId === botId)).toBe(true);
    expect(room.shadowDecisions.some((decision) => decision.playerId === botId)).toBe(false);
    expect(room.shadowDecisions).toHaveLength(1);
  });
});
