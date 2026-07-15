import type { IncomingMessage } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { Storage } from "@google-cloud/storage";
import { applyAction, createGame, DEFAULT_GAME_RULES, getLegalActions, projectForPlayer, projectForSpectator, type Die, type GameAction, type GameRules, type GameState, type PlayerSetup } from "../src/engine";
import { chooseBotAction, createProbabilityPolicy, isChoiceLegal, type BotObservation, type PublicActionEntry } from "../src/bot";
import type { OnlineClientMessage, OnlineServerMessage } from "../src/online/protocol";

type RoomPlayer = { id: string; name: string; isBot: boolean; token?: string; socket?: WebSocket };
type RoomEvent = { type: "round-start" } | { type: "shuffle-dice" } | { type: "pause-game" } | { type: "resume-game" };
type Spectator = { socket: WebSocket; queuedPlayer?: RoomPlayer };
type ConnectionContext = { connectionId: string; ipHash: string | null; ipVersion: "ipv4" | "ipv6" | "unknown"; forwardedForCount: number; userAgentHash: string | null; origin?: string; language?: string; protocol?: string; hashConfigured: boolean };
type ConnectionEvent = ConnectionContext & { at: string; event: "room-created" | "player-joined" | "player-reconnected" | "player-queued" | "spectator-joined" | "disconnected"; role: "player" | "spectator"; playerId?: string };
type LoggedAction = { at: string; playerId?: string; nickname?: string; action: GameAction | RoomEvent; tableDice?: Die[]; rerolledDice?: Die[] };
type RoundDeal = { round: number; dealtAt: string; paloFijo: boolean; starterId: string | null; hands: Array<{ playerId: string; nickname: string; dice: number[] }> };
type TurnTiming = { round: number; playerId: string; nickname: string; controller: "human" | "bot"; startedAt: string; deadlineAt: string; finishedAt?: string; elapsedMs?: number; remainingMs?: number; outcome?: "bid" | "dudo" | "calzo" | "timeout" };
type RoomRuleProposal = { rules: GameRules; proposedById: string; approvalPlayerIds: Set<string> };
type PauseState = { pausedById: string; pausedAt: number; turnRemainingMs?: number; shuffleRemainingMs?: number; nextRoundRemainingMs?: number };
type Room = { code: string; hostPlayerId: string; players: RoomPlayer[]; spectators: Map<WebSocket, Spectator>; connectionEvents: ConnectionEvent[]; rules: GameRules; pendingRules?: RoomRuleProposal; roundDeals: RoundDeal[]; turnTimings: TurnTiming[]; activeTurn?: TurnTiming; game?: GameState; history: string[]; botHistory: PublicActionEntry[]; announcement?: { text: string; playerId?: string }; shuffleReadyPlayerIds?: Set<string>; nextRoundReadyPlayerIds?: Set<string>; nextRoundDeadlineAt?: number; shuffleDeadlineAt?: number; paused?: PauseState; actions: LoggedAction[]; startedAt?: string; lastActivityAt: number; nextGameStarterId?: string; turnDeadlineAt?: number; turnTimer?: ReturnType<typeof setTimeout>; shuffleTimer?: ReturnType<typeof setTimeout>; nextRoundTimer?: ReturnType<typeof setTimeout>; botShuffleTimers?: Array<ReturnType<typeof setTimeout>>; botNextRoundTimers?: Array<ReturnType<typeof setTimeout>> };
const rooms = new Map<string, Room>();
const connectionContexts = new WeakMap<WebSocket, ConnectionContext>();
const botNames = [
  "Khaleesi",
  "Calculator",
  "Berioska",
  "Miss Blanquita",
  "Pichulín",
  "Monkoky",
  "Matt Millan",
  "Gonchi",
  "El Gordo",
  "Asleigh Costley",
  "Min-chi Park",
  "Henry Sarria",
  "Fogey Baxter",
  "Poeta Dalmacia",
  "Balú Johnson",
  "McDonald Lewis",
  "Luciano Torres",
  "La Del Burro",
  "Tachi Cabrera",
];
const logBucket = process.env.MATCH_LOG_BUCKET;
const storage = logBucket ? new Storage() : undefined;
const GAME_IDLE_MS = 20 * 60_000;
const LOBBY_IDLE_MS = 60 * 60_000;
const ROUND_ADVANCE_MS = 60_000;
const SHUFFLE_LIMIT_MS = 60_000;
const BOT_TURN_DELAY_MIN_MS = 3_000;
const BOT_TURN_DELAY_SPREAD_MS = 5_000;
const BOT_SHAKE_DELAY_MIN_MS = 2_000;
const BOT_SHAKE_DELAY_SPREAD_MS = 1_000;
const BOT_NEXT_ROUND_DELAY_MIN_MS = 4_000;
const BOT_NEXT_ROUND_DELAY_SPREAD_MS = 2_000;
const ipHashSalt = process.env.IP_HASH_SALT;

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  do for (let i = 0; i < 5; i += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  while (rooms.has(value));
  return value;
}
function token() { return crypto.randomUUID(); }
function touch(room: Room) { room.lastActivityAt = Date.now(); }
function isGameRules(value: unknown): value is GameRules {
  if (!value || typeof value !== "object") return false;
  const rules = value as Partial<GameRules>;
  return (rules.turnTimeSeconds === 15 || rules.turnTimeSeconds === 30 || rules.turnTimeSeconds === 60 || rules.turnTimeSeconds === 90)
    && (rules.acesConversion === "half" || rules.acesConversion === "halfPlusOne")
    && (rules.paloFijoTrigger === "oneDie" || rules.paloFijoTrigger === "twoDice")
    && typeof rules.paloFijoBlindDice === "boolean"
    && typeof rules.diceAmountsVisible === "boolean"
    && typeof rules.tableDiceEnabled === "boolean";
}
function settleRuleProposal(room: Room) {
  const proposal = room.pendingRules;
  if (!proposal) return;
  for (const bot of room.players.filter((player) => player.isBot)) proposal.approvalPlayerIds.add(bot.id);
  if (!room.players.every((player) => proposal.approvalPlayerIds.has(player.id))) return;
  room.rules = { ...proposal.rules };
  room.pendingRules = undefined;
}
function headerValue(value: string | string[] | undefined) { return Array.isArray(value) ? value.join(",") : value; }
function createConnectionContext(request: IncomingMessage): ConnectionContext {
  const forwardedFor = (headerValue(request.headers["x-forwarded-for"]) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const ip = (forwardedFor[0] ?? request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const userAgent = headerValue(request.headers["user-agent"]);
  const hash = (value: string) => ipHashSalt ? createHmac("sha256", ipHashSalt).update(value).digest("base64url") : null;
  const version = isIP(ip);
  return {
    connectionId: randomUUID(), ipHash: ip ? hash(`ip:v1:${ip}`) : null,
    ipVersion: version === 4 ? "ipv4" : version === 6 ? "ipv6" : "unknown", forwardedForCount: forwardedFor.length,
    userAgentHash: userAgent ? hash(`user-agent:v1:${userAgent}`) : null,
    ...(headerValue(request.headers.origin) ? { origin: headerValue(request.headers.origin) } : {}),
    ...(headerValue(request.headers["accept-language"]) ? { language: headerValue(request.headers["accept-language"])!.split(",")[0] } : {}),
    ...(headerValue(request.headers["x-forwarded-proto"]) ? { protocol: headerValue(request.headers["x-forwarded-proto"]) } : {}), hashConfigured: Boolean(ipHashSalt),
  };
}
function recordConnection(room: Room, socket: WebSocket, event: ConnectionEvent["event"], role: ConnectionEvent["role"], playerId?: string) {
  const context = connectionContexts.get(socket) ?? { connectionId: "unknown", ipHash: null, ipVersion: "unknown" as const, forwardedForCount: 0, userAgentHash: null, hashConfigured: false };
  room.connectionEvents.push({ at: new Date().toISOString(), event, role, ...context, ...(playerId ? { playerId } : {}) });
}
function recordRoundDeal(room: Room) {
  const game = room.game;
  if (!game || game.phase !== "playing") return;
  room.roundDeals.push({ round: game.round, dealtAt: new Date().toISOString(), paloFijo: game.paloFijo, starterId: game.currentPlayerId, hands: game.players.map((player) => ({ playerId: player.id, nickname: player.name, dice: [...player.hand] })) });
}
function startTurnTiming(room: Room, actor: RoomPlayer): TurnTiming | undefined {
  const game = room.game;
  if (!game) return undefined;
  if (room.activeTurn?.round === game.round && room.activeTurn.playerId === actor.id && !room.activeTurn.finishedAt) return room.activeTurn;
  const now = Date.now();
  const timing: TurnTiming = { round: game.round, playerId: actor.id, nickname: actor.name, controller: actor.isBot ? "bot" : "human", startedAt: new Date(now).toISOString(), deadlineAt: new Date(now + turnLimitMs(room)).toISOString() };
  room.turnTimings.push(timing);
  room.activeTurn = timing;
  return timing;
}
function finishTurnTiming(room: Room, outcome: NonNullable<TurnTiming["outcome"]>) {
  const timing = room.activeTurn;
  if (!timing || timing.finishedAt) return;
  const finishedAt = Date.now();
  timing.finishedAt = new Date(finishedAt).toISOString();
  timing.elapsedMs = Math.max(0, finishedAt - Date.parse(timing.startedAt));
  timing.remainingMs = Math.max(0, Date.parse(timing.deadlineAt) - finishedAt);
  timing.outcome = outcome;
  room.activeTurn = undefined;
}
function nextBotName(room: Room) {
  const unused = botNames.filter((name) => !room.players.some((player) => player.name === name));
  return unused[Math.floor(Math.random() * unused.length)] ?? `Bot ${room.players.filter((player) => player.isBot).length + 1}`;
}
function onlineBotPolicy(player: RoomPlayer) {
  const style = [...player.name].reduce((total, character) => total + character.charCodeAt(0), 0) % 3;
  if (style === 1) return createProbabilityPolicy({ name: "Pressure strategist", bluffRate: 0.12, targetBidConfidence: 0.57, tableAggression: 0.52 });
  if (style === 2) return createProbabilityPolicy({ name: "Careful strategist", bluffRate: 0.035, targetBidConfidence: 0.67, tableAggression: 0.08 });
  return createProbabilityPolicy({ name: "Adaptive strategist", bluffRate: 0.07, targetBidConfidence: 0.62, tableAggression: 0.24 });
}
function send(socket: WebSocket, message: OnlineServerMessage) { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); }
function lobby(room: Room): Extract<OnlineServerMessage, { type: "lobby" }> {
  return { type: "lobby", roomCode: room.code, hostPlayerId: room.hostPlayerId, spectatorCount: room.spectators.size,
    players: room.players.map(({ id, name, isBot, socket }) => ({ id, name, isBot, connected: isBot || Boolean(socket) })), rules: { ...room.rules },
    ...(room.pendingRules ? { pendingRules: { rules: { ...room.pendingRules.rules }, proposedById: room.pendingRules.proposedById, approvalPlayerIds: [...room.pendingRules.approvalPlayerIds] } } : {}) };
}
function playerStatuses(room: Room) { return room.players.map((player) => ({ id: player.id, connected: player.isBot || Boolean(player.socket) })); }
function shufflePayload(room: Room) {
  return room.game?.phase === "playing" && room.shuffleReadyPlayerIds
    ? { shuffle: { round: room.game.round, readyPlayerIds: [...room.shuffleReadyPlayerIds] } }
    : {};
}
function nextRoundPayload(room: Room) {
  return room.game?.phase === "reveal" && room.nextRoundReadyPlayerIds && room.nextRoundDeadlineAt
    ? { nextRound: { readyPlayerIds: [...room.nextRoundReadyPlayerIds], deadlineAt: room.nextRoundDeadlineAt } }
    : {};
}
function pausePayload(room: Room) {
  const pausedBy = room.paused && room.players.find((player) => player.id === room.paused!.pausedById);
  return pausedBy ? { paused: { pausedByName: pausedBy.name } } : {};
}
function activeRoomPlayers(room: Room) {
  return room.players.filter((roomPlayer) => room.game?.players.some((player) => player.id === roomPlayer.id && player.diceCount > 0));
}
function promoteQueuedSpectators(room: Room) {
  for (const [socket, spectator] of room.spectators) {
    if (!spectator.queuedPlayer || room.players.length >= 6) continue;
    room.players.push(spectator.queuedPlayer);
    room.spectators.delete(socket);
    send(socket, { type: "joined", roomCode: room.code, playerId: spectator.queuedPlayer.id, reconnectToken: spectator.queuedPlayer.token, hostPlayerId: room.hostPlayerId });
  }
}
function everyoneShuffled(room: Room) {
  return Boolean(room.game && room.game.phase === "playing" && room.shuffleReadyPlayerIds && activeRoomPlayers(room).every((player) => room.shuffleReadyPlayerIds!.has(player.id)));
}
function everyoneReadyForNextRound(room: Room) {
  return Boolean(room.game?.phase === "reveal" && room.nextRoundReadyPlayerIds && activeRoomPlayers(room).every((player) => room.nextRoundReadyPlayerIds!.has(player.id)));
}
function publish(room: Room) {
  for (const player of room.players) {
    if (!player.socket) continue;
    if (!room.game) send(player.socket, lobby(room));
    else {
      const view = projectForPlayer(room.game, player.id);
      send(player.socket, { type: "state", view, history: [...room.history], playerStatuses: playerStatuses(room), ...(room.turnDeadlineAt ? { turnDeadlineAt: room.turnDeadlineAt } : {}), ...(room.announcement ? { announcement: room.announcement } : {}), ...pausePayload(room), ...shufflePayload(room), ...nextRoundPayload(room), ...(room.game.phase === "playing" && everyoneShuffled(room) && room.game.currentPlayerId === player.id ? { legalActions: getLegalActions(room.game, player.id) } : {}) });
    }
  }
  for (const { socket } of room.spectators.values()) {
    if (room.game) send(socket, { type: "state", view: projectForSpectator(room.game), history: [...room.history], playerStatuses: playerStatuses(room), ...(room.turnDeadlineAt ? { turnDeadlineAt: room.turnDeadlineAt } : {}), ...(room.announcement ? { announcement: room.announcement } : {}), ...pausePayload(room), ...shufflePayload(room), ...nextRoundPayload(room) });
    else send(socket, lobby(room));
  }
}
function turnLimitMs(room: Room) { return (room.game?.rules.turnTimeSeconds ?? 60) * 1_000; }
function scheduleTurn(room: Room, remainingMs = turnLimitMs(room)) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnDeadlineAt = undefined;
  if (room.paused || !room.game || room.game.phase !== "playing" || !everyoneShuffled(room)) return;
  const actor = room.players.find((candidate) => candidate.id === room.game?.currentPlayerId);
  if (!actor) return;
  // Bots get the same visible clock as humans. Their actual choice is made earlier,
  // after a natural thinking pause, rather than shortening the public timer.
  const delay = actor.isBot
    ? Math.min(remainingMs, BOT_TURN_DELAY_MIN_MS + Math.floor(Math.random() * BOT_TURN_DELAY_SPREAD_MS))
    : remainingMs;
  const turnTiming = startTurnTiming(room, actor);
  if (!turnTiming) return;
  room.turnDeadlineAt = Date.now() + remainingMs;
  turnTiming.deadlineAt = new Date(room.turnDeadlineAt).toISOString();
  publish(room);
  room.turnTimer = setTimeout(() => {
    room.turnTimer = undefined;
    room.turnDeadlineAt = undefined;
    const game = room.game;
    if (!game || game.phase !== "playing" || game.currentPlayerId !== actor.id) return;
    try {
      const observation: BotObservation = { playerId: actor.id, view: projectForPlayer(game, actor.id), legalActions: getLegalActions(game, actor.id), history: room.botHistory };
      const { choice } = chooseBotAction(onlineBotPolicy(actor), observation, Math.random);
      if (!isChoiceLegal(observation, choice)) throw new Error("Bot selected an illegal action.");
      // A timeout bot is a safety net, not a strategic table-dice move.
      const action = choice.type === "bid" ? { type: "bid" as const, playerId: actor.id, bid: choice.bid, ...(actor.isBot && choice.tableDiceIndices?.length ? { tableDiceIndices: choice.tableDiceIndices } : {}) } : { type: choice.type, playerId: actor.id };
      finishTurnTiming(room, actor.isBot ? action.type : "timeout");
      room.game = applyAction(game, action);
      recordAction(room, actor.name, action);
      if (room.game.phase === "reveal") startNextRoundVote(room);
      if (!actor.isBot) {
        room.history.unshift(`${actor.name} ran out of time — a bot made the move.`);
        room.announcement = { text: `${actor.name} ran out of time — bot move.`, playerId: actor.id };
      }
      void persistRoomSnapshot(room);
      publish(room);
      scheduleTurn(room);
    } catch {
      for (const player of room.players) if (player.socket) send(player.socket, { type: "error", message: "A room bot could not take its turn." });
    }
  }, delay);
}
function startRoundShuffle(room: Room, remainingMs = SHUFFLE_LIMIT_MS, keepReady = false) {
  if (!room.game || room.game.phase !== "playing") return;
  if (room.paused) return;
  if (!keepReady) {
    room.shuffleReadyPlayerIds = new Set();
    room.announcement = { text: `Round ${room.game.round}: shake your dice.` };
  }
  if (room.shuffleTimer) clearTimeout(room.shuffleTimer);
  for (const timer of room.botShuffleTimers ?? []) clearTimeout(timer);
  room.botShuffleTimers = [];
  room.shuffleDeadlineAt = Date.now() + remainingMs;
  room.shuffleTimer = setTimeout(() => {
    room.shuffleTimer = undefined;
    room.shuffleDeadlineAt = undefined;
    if (!room.game || room.game.phase !== "playing" || !room.shuffleReadyPlayerIds) return;
    for (const player of activeRoomPlayers(room)) room.shuffleReadyPlayerIds.add(player.id);
    room.announcement = { text: "The table shakes the remaining cups automatically." };
    void persistRoomSnapshot(room);
    publish(room);
    scheduleTurn(room);
  }, remainingMs);
  for (const bot of activeRoomPlayers(room).filter((player) => player.isBot)) {
    const timer = setTimeout(() => {
      if (!room.game || room.game.phase !== "playing" || !room.shuffleReadyPlayerIds || room.shuffleReadyPlayerIds.has(bot.id)) return;
      room.shuffleReadyPlayerIds.add(bot.id);
      room.actions.push({ at: new Date().toISOString(), playerId: bot.id, nickname: bot.name, action: { type: "shuffle-dice" } });
      room.announcement = { text: `${bot.name} shakes their cup.`, playerId: bot.id };
      void persistRoomSnapshot(room);
      publish(room);
      scheduleTurn(room);
    }, BOT_SHAKE_DELAY_MIN_MS + Math.floor(Math.random() * BOT_SHAKE_DELAY_SPREAD_MS));
    room.botShuffleTimers.push(timer);
  }
}
function beginNextRound(room: Room) {
  if (!room.game || room.game.phase !== "reveal") return;
  if (room.paused) return;
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
  room.nextRoundTimer = undefined;
  for (const timer of room.botNextRoundTimers ?? []) clearTimeout(timer);
  room.botNextRoundTimers = [];
  room.nextRoundReadyPlayerIds = undefined;
  room.nextRoundDeadlineAt = undefined;
  room.game = applyAction(room.game, { type: "nextRound" });
  recordAction(room, "", { type: "nextRound" });
  if (room.game.phase === "playing") { recordRoundDeal(room); startRoundShuffle(room); }
  touch(room);
  void persistRoomSnapshot(room);
  publish(room);
  scheduleTurn(room);
}
function startNextRoundVote(room: Room, remainingMs = ROUND_ADVANCE_MS, keepReady = false) {
  if (!room.game || room.game.phase !== "reveal") return;
  if (room.paused) return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = undefined;
  room.turnDeadlineAt = undefined;
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
  for (const timer of room.botNextRoundTimers ?? []) clearTimeout(timer);
  room.botNextRoundTimers = [];
  if (!keepReady) {
    room.nextRoundReadyPlayerIds = new Set();
    room.announcement = { text: "Choose Next round when you are ready." };
  }
  room.nextRoundDeadlineAt = Date.now() + remainingMs;
  room.nextRoundTimer = setTimeout(() => beginNextRound(room), remainingMs);
  for (const bot of activeRoomPlayers(room).filter((player) => player.isBot)) {
    const timer = setTimeout(() => {
      if (!room.game || room.game.phase !== "reveal" || !room.nextRoundReadyPlayerIds || room.nextRoundReadyPlayerIds.has(bot.id)) return;
      room.nextRoundReadyPlayerIds.add(bot.id);
      room.announcement = { text: `${bot.name} is ready for the next round.`, playerId: bot.id };
      if (everyoneReadyForNextRound(room)) beginNextRound(room);
      else publish(room);
    }, BOT_NEXT_ROUND_DELAY_MIN_MS + Math.floor(Math.random() * BOT_NEXT_ROUND_DELAY_SPREAD_MS));
    room.botNextRoundTimers.push(timer);
  }
}
function resumeRecoveredRoom(room: Room) {
  if (!room.game || room.paused) return;
  if (room.game.phase === "playing") {
    if (room.shuffleReadyPlayerIds && !everyoneShuffled(room)) startRoundShuffle(room, SHUFFLE_LIMIT_MS, true);
    else if (room.shuffleReadyPlayerIds) scheduleTurn(room);
    else startRoundShuffle(room);
  } else if (room.game.phase === "reveal") {
    startNextRoundVote(room, ROUND_ADVANCE_MS, Boolean(room.nextRoundReadyPlayerIds));
  }
}
async function loadPersistedRoom(roomCode: string): Promise<Room | undefined> {
  if (!storage || !logBucket) return undefined;
  try {
    const [contents] = await storage.bucket(logBucket).file(`active-rooms/${roomCode}.json`).download();
    const saved = JSON.parse(contents.toString()) as Partial<Room> & { shuffleReadyPlayerIds?: string[]; nextRoundReadyPlayerIds?: string[] };
    if (!saved.game || !Array.isArray(saved.players) || saved.code !== roomCode) return undefined;
    const restored: Room = {
      code: saved.code,
      hostPlayerId: saved.hostPlayerId ?? "",
      players: saved.players.map((player) => ({ id: player.id, name: player.name, isBot: player.isBot, ...(player.token ? { token: player.token } : {}) })),
      spectators: new Map(),
      connectionEvents: saved.connectionEvents ?? [],
      rules: saved.rules ?? DEFAULT_GAME_RULES,
      roundDeals: saved.roundDeals ?? [],
      turnTimings: saved.turnTimings ?? [],
      ...(saved.activeTurn ? { activeTurn: saved.activeTurn } : {}),
      game: saved.game,
      history: saved.history ?? [],
      botHistory: saved.botHistory ?? [],
      ...(saved.announcement ? { announcement: saved.announcement } : {}),
      ...(saved.shuffleReadyPlayerIds ? { shuffleReadyPlayerIds: new Set(saved.shuffleReadyPlayerIds) } : {}),
      ...(saved.nextRoundReadyPlayerIds ? { nextRoundReadyPlayerIds: new Set(saved.nextRoundReadyPlayerIds) } : {}),
      ...(saved.paused ? { paused: saved.paused } : {}),
      actions: saved.actions ?? [],
      ...(saved.startedAt ? { startedAt: saved.startedAt } : {}),
      lastActivityAt: Date.now(),
      ...(saved.nextGameStarterId ? { nextGameStarterId: saved.nextGameStarterId } : {}),
    };
    rooms.set(restored.code, restored);
    return restored;
  } catch {
    return undefined;
  }
}
function pauseGame(room: Room, player: RoomPlayer) {
  if (!room.game || room.paused) return;
  const now = Date.now();
  room.paused = {
    pausedById: player.id,
    pausedAt: now,
    ...(room.turnDeadlineAt ? { turnRemainingMs: Math.max(0, room.turnDeadlineAt - now) } : {}),
    ...(room.shuffleDeadlineAt ? { shuffleRemainingMs: Math.max(0, room.shuffleDeadlineAt - now) } : {}),
    ...(room.nextRoundDeadlineAt ? { nextRoundRemainingMs: Math.max(0, room.nextRoundDeadlineAt - now) } : {}),
  };
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.shuffleTimer) clearTimeout(room.shuffleTimer);
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
  for (const timer of room.botShuffleTimers ?? []) clearTimeout(timer);
  for (const timer of room.botNextRoundTimers ?? []) clearTimeout(timer);
  room.turnTimer = undefined;
  room.shuffleTimer = undefined;
  room.nextRoundTimer = undefined;
  room.botShuffleTimers = [];
  room.botNextRoundTimers = [];
  room.turnDeadlineAt = undefined;
  room.shuffleDeadlineAt = undefined;
  room.nextRoundDeadlineAt = undefined;
  room.actions.push({ at: new Date(now).toISOString(), playerId: player.id, nickname: player.name, action: { type: "pause-game" } });
  room.history.unshift(`${player.name} paused the game.`);
  room.announcement = { text: `${player.name} paused the game. Any player can resume it from Settings.`, playerId: player.id };
}
function resumeGame(room: Room, player: RoomPlayer) {
  const pause = room.paused;
  if (!room.game || !pause) return;
  const now = Date.now();
  const pausedForMs = now - pause.pausedAt;
  if (room.activeTurn && !room.activeTurn.finishedAt) {
    room.activeTurn.startedAt = new Date(Date.parse(room.activeTurn.startedAt) + pausedForMs).toISOString();
    if (pause.turnRemainingMs !== undefined) room.activeTurn.deadlineAt = new Date(now + pause.turnRemainingMs).toISOString();
  }
  room.paused = undefined;
  room.actions.push({ at: new Date(now).toISOString(), playerId: player.id, nickname: player.name, action: { type: "resume-game" } });
  room.history.unshift(`${player.name} resumed the game.`);
  room.announcement = { text: `${player.name} resumed the game.`, playerId: player.id };
  if (room.game.phase === "playing") {
    if (room.shuffleReadyPlayerIds && !everyoneShuffled(room)) startRoundShuffle(room, pause.shuffleRemainingMs ?? SHUFFLE_LIMIT_MS, true);
    else scheduleTurn(room, pause.turnRemainingMs ?? turnLimitMs(room));
  } else if (room.game.phase === "reveal" && room.nextRoundReadyPlayerIds) {
    startNextRoundVote(room, pause.nextRoundRemainingMs ?? ROUND_ADVANCE_MS, true);
  }
}
function safeMessage(data: Buffer | ArrayBuffer | Buffer[]) { try { return JSON.parse(data.toString()) as OnlineClientMessage; } catch { return null; } }

function expireIdleRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const limit = room.game ? GAME_IDLE_MS : LOBBY_IDLE_MS;
    if (now - room.lastActivityAt < limit) continue;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.shuffleTimer) clearTimeout(room.shuffleTimer);
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    for (const timer of room.botShuffleTimers ?? []) clearTimeout(timer);
    for (const timer of room.botNextRoundTimers ?? []) clearTimeout(timer);
    for (const player of room.players) if (player.socket) { send(player.socket, { type: "error", message: "This idle room expired." }); player.socket.close(); }
    for (const { socket } of room.spectators.values()) { send(socket, { type: "error", message: "This idle room expired." }); socket.close(); }
    rooms.delete(room.code);
  }
}
setInterval(expireIdleRooms, 60_000).unref();

/** Authoritative websocket endpoint. Each browser receives only its permitted game projection. */
export function installOnlineRooms(httpServer: import("node:http").Server) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/online") return;
    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
  });
  wss.on("connection", (socket, request: IncomingMessage) => {
    connectionContexts.set(socket, createConnectionContext(request));
    let room: Room | undefined;
    let player: RoomPlayer | undefined;
    let spectator = false;
    socket.on("message", async (raw) => {
      const message = safeMessage(raw);
      if (!message) return send(socket, { type: "error", message: "Invalid message." });
      try {
        if (message.type === "create-room") {
          const name = message.name.trim().slice(0, 24);
          if (!name) throw new Error("Enter your name first.");
          const id = `player-${crypto.randomUUID()}`;
          player = { id, name, isBot: false, token: token(), socket };
          room = { code: code(), hostPlayerId: id, players: [player], spectators: new Map(), connectionEvents: [], rules: { ...DEFAULT_GAME_RULES }, roundDeals: [], turnTimings: [], history: [], botHistory: [], actions: [], lastActivityAt: Date.now() };
          recordConnection(room, socket, "room-created", "player", id);
          rooms.set(room.code, room);
          send(socket, { type: "joined", roomCode: room.code, playerId: id, reconnectToken: player.token, hostPlayerId: id }); publish(room);
        } else if (message.type === "join-room") {
          const requestedCode = message.roomCode.trim().toUpperCase();
          room = rooms.get(requestedCode);
          const recoveredRoom = !room;
          if (!room) room = await loadPersistedRoom(requestedCode);
          if (!room) throw new Error("That room does not exist.");
          if (message.spectator) { spectator = true; room.spectators.set(socket, { socket }); recordConnection(room, socket, "spectator-joined", "spectator"); send(socket, { type: "joined", roomCode: room.code, hostPlayerId: room.hostPlayerId }); }
          else {
            const prior = room.players.find((entry) => !entry.isBot && entry.token === message.reconnectToken);
            if (prior) { if (prior.socket) prior.socket.close(); prior.socket = socket; player = prior; recordConnection(room, socket, "player-reconnected", "player", player.id); }
            else {
              if (room.game) {
                const name = message.name?.trim().slice(0, 24) ?? "";
                if (!name || room.players.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()) || [...room.spectators.values()].some((entry) => entry.queuedPlayer?.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Choose a unique name.");
                player = { id: `player-${crypto.randomUUID()}`, name, isBot: false, token: token(), socket };
                spectator = true;
                room.spectators.set(socket, { socket, queuedPlayer: player });
                recordConnection(room, socket, "player-queued", "spectator", player.id);
                send(socket, { type: "joined", roomCode: room.code, hostPlayerId: room.hostPlayerId });
                touch(room);
                void persistRoomSnapshot(room);
                publish(room);
                return;
              }
              if (room.players.length >= 6) throw new Error("This room cannot accept another player.");
              const name = message.name?.trim().slice(0, 24) ?? "";
              if (!name || room.players.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Choose a unique name.");
              player = { id: `player-${crypto.randomUUID()}`, name, isBot: false, token: token(), socket }; room.players.push(player);
              recordConnection(room, socket, "player-joined", "player", player.id);
            }
            send(socket, { type: "joined", roomCode: room.code, playerId: player.id, reconnectToken: player.token, hostPlayerId: room.hostPlayerId });
          }
          touch(room);
          void persistRoomSnapshot(room);
          publish(room);
          if (recoveredRoom) resumeRecoveredRoom(room);
        } else if (!room) throw new Error("Join a room first.");
        else if (message.type === "add-bot") {
          if (!player || player.id !== room.hostPlayerId || room.game) throw new Error("Only the host can change bots before the game starts.");
          if (room.players.length >= 6) throw new Error("This room already has six players.");
          room.players.push({ id: `bot-${crypto.randomUUID()}`, name: nextBotName(room), isBot: true }); settleRuleProposal(room); touch(room); publish(room);
        } else if (message.type === "remove-bot") {
          if (!player || player.id !== room.hostPlayerId || room.game) throw new Error("Only the host can change bots before the game starts.");
          const index = room.players.findIndex((entry) => entry.id === message.playerId && entry.isBot);
          if (index < 0) throw new Error("That bot is no longer in this room.");
          room.players.splice(index, 1); settleRuleProposal(room); touch(room); publish(room);
        } else if (message.type === "kick-player") {
          if (!player || player.id !== room.hostPlayerId || room.game) throw new Error("Only the host can remove players before the game starts.");
          const index = room.players.findIndex((entry) => entry.id === message.playerId && !entry.isBot && entry.id !== room!.hostPlayerId);
          if (index < 0) throw new Error("That player cannot be removed.");
          const [removed] = room.players.splice(index, 1);
          if (removed.socket) { send(removed.socket, { type: "error", message: "The host removed you from this room." }); removed.socket.close(); }
          settleRuleProposal(room); touch(room); publish(room);
        } else if (message.type === "rename-player") {
          if (!player || room.game || !room.players.some((candidate) => candidate.id === player!.id)) throw new Error("You can only rename yourself in the lobby.");
          const name = message.name.trim().slice(0, 24);
          if (!name || room.players.some((candidate) => candidate.id !== player!.id && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Choose a unique name.");
          player.name = name;
          touch(room); publish(room);
        } else if (message.type === "propose-rules") {
          if (!player || player.id !== room.hostPlayerId || room.game) throw new Error("Only the host can propose lobby rules before the game starts.");
          if (!isGameRules(message.rules)) throw new Error("Those game rules are invalid.");
          room.pendingRules = { rules: { ...message.rules }, proposedById: player.id, approvalPlayerIds: new Set([player.id]) };
          settleRuleProposal(room); touch(room); publish(room);
        } else if (message.type === "approve-rules") {
          if (!player || room.game || !room.pendingRules) throw new Error("There is no lobby rule change to approve.");
          room.pendingRules.approvalPlayerIds.add(player.id);
          settleRuleProposal(room); touch(room); publish(room);
        } else if (message.type === "start-game") {
          if (!player || player.id !== room.hostPlayerId) throw new Error("Only the host can start the game.");
          if (room.game || room.players.length < 2) throw new Error("At least two players are needed.");
          if (room.pendingRules) throw new Error("Every player must approve the pending rules before the game starts.");
          const starter = room.players.find((candidate) => candidate.id === room!.nextGameStarterId) ?? room.players[Math.floor(Math.random() * room.players.length)];
          const otherPlayers = room.players.filter((candidate) => candidate.id !== starter.id).sort(() => Math.random() - .5);
          room.game = createGame([starter, ...otherPlayers].map(({ id, name }): PlayerSetup => ({ id, name })), Math.random, room.rules); room.startedAt = new Date().toISOString(); room.history = [`Round 1 begins — ${starter.name} starts.`]; room.botHistory = []; room.actions = [{ at: room.startedAt, action: { type: "round-start" } }]; room.roundDeals = []; room.turnTimings = []; room.activeTurn = undefined; recordRoundDeal(room); touch(room); startRoundShuffle(room); void persistRoomSnapshot(room); publish(room);
        } else if (message.type === "return-to-lobby") {
          if (!player || player.id !== room.hostPlayerId || room.game?.phase !== "gameOver") throw new Error("Only the host can return this completed game to the lobby.");
          promoteQueuedSpectators(room); room.game = undefined; room.history = []; room.botHistory = []; room.announcement = undefined; room.paused = undefined; room.shuffleReadyPlayerIds = undefined; room.nextRoundReadyPlayerIds = undefined; room.nextRoundDeadlineAt = undefined; room.shuffleDeadlineAt = undefined; if (room.shuffleTimer) clearTimeout(room.shuffleTimer); room.shuffleTimer = undefined; for (const timer of room.botShuffleTimers ?? []) clearTimeout(timer); room.botShuffleTimers = []; if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer); room.nextRoundTimer = undefined; for (const timer of room.botNextRoundTimers ?? []) clearTimeout(timer); room.botNextRoundTimers = []; if (room.turnTimer) clearTimeout(room.turnTimer); room.turnTimer = undefined; room.turnDeadlineAt = undefined; room.actions = []; room.roundDeals = []; room.turnTimings = []; room.activeTurn = undefined; room.startedAt = undefined; touch(room); void persistRoomSnapshot(room); publish(room);
        } else if (message.type === "toggle-pause") {
          if (!player || !room.game || room.game.phase === "gameOver" || !room.players.some((candidate) => candidate.id === player!.id)) throw new Error("Only a player at this table can pause or resume the game.");
          if (room.paused) resumeGame(room, player);
          else pauseGame(room, player);
          touch(room); void persistRoomSnapshot(room); publish(room);
        } else if (room.paused) {
          throw new Error("The game is paused. Open Settings to resume it.");
        } else if (message.type === "shuffle-dice") {
          if (!player || !room.players.some((candidate) => candidate.id === player!.id) || !room.game || room.game.phase !== "playing" || !room.shuffleReadyPlayerIds || !activeRoomPlayers(room).some((candidate) => candidate.id === player!.id)) throw new Error("There are no dice to shuffle right now.");
          room.shuffleReadyPlayerIds.add(player.id);
          room.actions.push({ at: new Date().toISOString(), playerId: player.id, nickname: player.name, action: { type: "shuffle-dice" } });
          room.announcement = { text: `${player.name} shakes their cup.`, playerId: player.id };
          touch(room); void persistRoomSnapshot(room); publish(room); scheduleTurn(room);
        } else if (message.type === "ready-next-round") {
          if (!player || !room.game || room.game.phase !== "reveal" || !room.nextRoundReadyPlayerIds || !activeRoomPlayers(room).some((candidate) => candidate.id === player!.id)) throw new Error("The next round is not ready yet.");
          room.nextRoundReadyPlayerIds.add(player.id);
          room.announcement = { text: `${player.name} is ready for the next round.`, playerId: player.id };
          touch(room);
          if (everyoneReadyForNextRound(room)) beginNextRound(room);
          else publish(room);
        } else if (message.type === "action") {
          if (!player || !room.players.some((candidate) => candidate.id === player!.id) || !room.game) throw new Error("You cannot take that action.");
          if (message.action.type === "nextRound") throw new Error("Wait for the table to choose the next round.");
          if (room.game.phase === "playing" && !everyoneShuffled(room)) throw new Error("Everyone needs to shake their dice before the round begins.");
          const action: GameAction = { ...message.action, playerId: player.id };
          if (action.type === "bid" || action.type === "dudo" || action.type === "calzo") finishTurnTiming(room, action.type);
          room.game = applyAction(room.game, action); recordAction(room, player.name, action); if (room.game.phase === "reveal") startNextRoundVote(room); touch(room); void persistRoomSnapshot(room); publish(room); scheduleTurn(room);
        }
      } catch (error) { send(socket, { type: "error", message: error instanceof Error ? error.message : "Unable to update the room." }); }
    });
    socket.on("close", () => { if (!room) return; if (player && room.players.some((candidate) => candidate.id === player!.id)) player.socket = undefined; if (spectator) room.spectators.delete(socket); recordConnection(room, socket, "disconnected", spectator ? "spectator" : "player", player?.id); void persistRoomSnapshot(room); publish(room); });
  });
}

function recordAction(room: Room, name: string, action: GameAction) {
  if (!room.game) return;
  const player = action.type === "nextRound" ? undefined : room.game.players.find((candidate) => candidate.id === action.playerId);
  const tableMove = action.type === "bid" && action.tableDiceIndices?.length && player ? { tableDice: [...player.tableDice], rerolledDice: [...player.hand] } : {};
  room.actions.push({ at: new Date().toISOString(), ...(action.type === "nextRound" ? {} : { playerId: action.playerId, nickname: name }), action, ...tableMove });
  if (action.type === "bid") room.history.unshift(action.tableDiceIndices?.length ? `${name} puts ${action.tableDiceIndices.length} dice on the table and bids ${action.bid.quantity} ${denominationName(action.bid.denomination)}.` : `${name} bids ${action.bid.quantity} ${denominationName(action.bid.denomination)}.`);
  else if (action.type === "dudo") room.history.unshift(`${name} calls Dudo.`);
  else if (action.type === "calzo") room.history.unshift(`${name} calls Calzo.`);
  else room.history.unshift(`Round ${room.game.round} begins.`);
  if (room.game.phase === "reveal") {
    const { resolution } = room.game;
    const loss = resolution.diceChanges.find((change) => change.delta < 0);
    if (loss) room.nextGameStarterId = loss.playerId;
    room.history.unshift(`${resolution.kind === "dudo" ? "Dudo" : "Calzo"}: ${resolution.correct ? "correct" : "incorrect"} — ${resolution.actualCount} actual.`);
  }
  room.announcement = { text: room.history[0], ...(action.type === "nextRound" ? {} : { playerId: action.playerId }) };
  if (room.game.phase === "gameOver") {
    const gameOver = room.game;
    const winner = gameOver.players.find((player) => player.id === gameOver.winnerId);
    room.history.unshift(`${winner?.name ?? "The last player"} wins the match.`);
    room.announcement = { text: `${winner?.name ?? "The last player"} wins the match.`, playerId: gameOver.winnerId };
  }
  room.history = room.history.slice(0, 30);
  if (room.game.phase === "reveal") {
    const { resolution } = room.game;
    room.botHistory.push({
      round: room.game.round,
      playerId: resolution.bidderId,
      action: { type: "bid", bid: { ...resolution.bid } },
      outcome: { kind: resolution.kind, bidderId: resolution.bidderId, bid: { ...resolution.bid }, correct: resolution.correct },
    });
    room.botHistory = room.botHistory.slice(-80);
  }
}

function denominationName(value: number) { return ["", "Aces", "Dones", "Trenes", "Cuadras", "Chinas", "Sambas"][value] ?? "dice"; }

/** Private, server-only snapshots for later bot evaluation. No browser receives this data. */
async function persistRoomSnapshot(room: Room) {
  if (!storage || !logBucket) return;
  const activeFile = storage.bucket(logBucket).file(`active-rooms/${room.code}.json`);
  if (room.game) {
    const activeSnapshot = {
      schemaVersion: 1,
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      players: room.players.map(({ id, name, isBot, token }) => ({ id, name, isBot, ...(token ? { token } : {}) })),
      connectionEvents: room.connectionEvents,
      rules: room.rules,
      roundDeals: room.roundDeals,
      turnTimings: room.turnTimings,
      activeTurn: room.activeTurn,
      game: room.game,
      history: room.history,
      botHistory: room.botHistory,
      announcement: room.announcement,
      shuffleReadyPlayerIds: room.shuffleReadyPlayerIds ? [...room.shuffleReadyPlayerIds] : undefined,
      nextRoundReadyPlayerIds: room.nextRoundReadyPlayerIds ? [...room.nextRoundReadyPlayerIds] : undefined,
      paused: room.paused,
      actions: room.actions,
      startedAt: room.startedAt,
      nextGameStarterId: room.nextGameStarterId,
    };
    try {
      await activeFile.save(JSON.stringify(activeSnapshot), { contentType: "application/json", resumable: false, metadata: { cacheControl: "no-store" } });
    } catch (error) {
      console.error("Unable to save active room recovery snapshot", error);
    }
  } else {
    void activeFile.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
  if (!room.game || !room.startedAt) return;
  const filename = `online-matches/${room.startedAt.replace(/[:.]/g, "-")}-${room.code}.json`;
  const snapshot = {
    schemaVersion: 4,
    roomCode: room.code,
    startedAt: room.startedAt,
    updatedAt: new Date().toISOString(),
    rules: room.game.rules,
    seats: room.players.map(({ id, name, isBot }) => ({ id, name, nickname: name, controller: isBot ? "bot" : "human" })),
    history: room.history,
    actions: room.actions,
    roundDeals: room.roundDeals,
    turnTimings: room.turnTimings,
    connectionEvents: room.connectionEvents,
    connectionAudit: {
      ipHashAlgorithm: "HMAC-SHA-256",
      rawIpStored: false,
      rawUserAgentStored: false,
      hashSaltConfigured: Boolean(ipHashSalt),
    },
    state: room.game,
  };
  try {
    await storage.bucket(logBucket).file(filename).save(JSON.stringify(snapshot), { contentType: "application/json", resumable: false, metadata: { cacheControl: "no-store" } });
  } catch (error) {
    console.error("Unable to save private online match snapshot", error);
  }
}
