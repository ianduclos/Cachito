import type { GameAction, LegalActions, PublicGameView } from "../engine";

export type OnlineClientMessage =
  | { type: "create-room"; name: string }
  | { type: "join-room"; roomCode: string; name?: string; reconnectToken?: string; spectator?: boolean }
  | { type: "start-game" }
  | { type: "add-bot" }
  | { type: "remove-bot"; playerId: string }
  | { type: "kick-player"; playerId: string }
  | { type: "rename-player"; name: string }
  | { type: "return-to-lobby" }
  | { type: "shuffle-dice" }
  | { type: "ready-next-round" }
  | { type: "action"; action: GameAction };

export type OnlineServerMessage =
  | { type: "joined"; roomCode: string; playerId?: string; reconnectToken?: string; hostPlayerId: string }
  | { type: "lobby"; roomCode: string; hostPlayerId: string; players: Array<{ id: string; name: string; connected: boolean; isBot: boolean }>; spectatorCount: number }
  | { type: "state"; view: PublicGameView; legalActions?: LegalActions; history: string[]; announcement?: { text: string; playerId?: string }; shuffle?: { round: number; readyPlayerIds: string[] }; nextRound?: { readyPlayerIds: string[]; deadlineAt: number }; playerStatuses: Array<{ id: string; connected: boolean }>; turnDeadlineAt?: number }
  | { type: "error"; message: string };
