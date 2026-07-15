import type { GameAction, GameRules, LegalActions, PublicGameView } from "../engine";

export type OnlineClientMessage =
  | { type: "create-room"; name: string }
  | { type: "join-room"; roomCode: string; name?: string; reconnectToken?: string; spectator?: boolean }
  | { type: "start-game" }
  | { type: "add-bot" }
  | { type: "remove-bot"; playerId: string }
  | { type: "kick-player"; playerId: string }
  | { type: "rename-player"; name: string }
  | { type: "propose-rules"; rules: GameRules }
  | { type: "approve-rules" }
  | { type: "return-to-lobby" }
  | { type: "shuffle-dice" }
  | { type: "ready-next-round" }
  | { type: "action"; action: GameAction };

export type OnlineServerMessage =
  | { type: "joined"; roomCode: string; playerId?: string; reconnectToken?: string; hostPlayerId: string }
  | { type: "lobby"; roomCode: string; hostPlayerId: string; players: Array<{ id: string; name: string; connected: boolean; isBot: boolean }>; spectatorCount: number; rules: GameRules; pendingRules?: { rules: GameRules; proposedById: string; approvalPlayerIds: string[] } }
  | { type: "state"; view: PublicGameView; legalActions?: LegalActions; history: string[]; announcement?: { text: string; playerId?: string }; shuffle?: { round: number; readyPlayerIds: string[] }; nextRound?: { readyPlayerIds: string[]; deadlineAt: number }; playerStatuses: Array<{ id: string; connected: boolean }>; turnDeadlineAt?: number }
  | { type: "error"; message: string };
