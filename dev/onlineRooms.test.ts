import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type WebSocketServer } from "ws";
import { createGame } from "../src/engine";
import type { OnlineClientMessage, OnlineServerMessage } from "../src/online/protocol";
import { applyValidatedGameAction, installOnlineRooms, isRecoverySnapshotFresh, onlineLogHeader, resetOnlineRoomsForTests, SUPPORTED_CONCURRENT_GAMES } from "./onlineRooms";
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

  it("age-bounds current snapshots and legacy snapshots during rollout", () => {
    const now = 1_000_000_000;
    expect(isRecoverySnapshotFresh({ schemaVersion: 2, lastActivityAt: now - 19 * 60_000 }, now)).toBe(true);
    expect(isRecoverySnapshotFresh({ schemaVersion: 2, lastActivityAt: now - 20 * 60_000 }, now)).toBe(false);
    expect(isRecoverySnapshotFresh({ schemaVersion: 1 }, now, new Date(now - 19 * 60_000).toISOString())).toBe(true);
    expect(isRecoverySnapshotFresh({ schemaVersion: 1 }, now, new Date(now - 20 * 60_000).toISOString())).toBe(false);
    expect(isRecoverySnapshotFresh({ schemaVersion: 1 }, now)).toBe(false);
    expect(isRecoverySnapshotFresh({ schemaVersion: 2, lastActivityAt: now + 61_000 }, now)).toBe(false);
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
    expect(finished.analysis).toMatchObject({ schemaVersion: 2, winnerId: hostJoined.playerId, headline: expect.stringContaining("Host") });
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
});
