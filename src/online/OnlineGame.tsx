import { useEffect, useMemo, useRef, useState } from "react";
import type { Die, GameAction, LegalActions, PublicGameView } from "../engine";
import { DiceRow } from "../ui/Dice";
import type { OnlineClientMessage, OnlineServerMessage } from "./protocol";

type Lobby = Extract<OnlineServerMessage, { type: "lobby" }>;
type EntryMode = "choose" | "create" | "join" | "watch";
type Shuffle = Extract<OnlineServerMessage, { type: "state" }>['shuffle'];
type NextRound = Extract<OnlineServerMessage, { type: "state" }>['nextRound'];
const denominationNames: Record<Die, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const storageKey = "cachito-online-session";

function send(socket: WebSocket | null, message: OnlineClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function onlineSocketUrl() {
  const configured = import.meta.env.VITE_ONLINE_ENDPOINT?.replace(/\/$/, "");
  if (configured) return `${configured.replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/online`;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/online`;
}

function inviteRoomFromPath() {
  const match = location.pathname.match(/^\/join\/([A-Z0-9]{5})\/?$/i);
  return match?.[1]?.toUpperCase() ?? "";
}

export function OnlineGame({ onExit }: { onExit: () => void }) {
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem("cachito-display-name") ?? "");
  const [roomCode, setRoomCode] = useState(inviteRoomFromPath);
  const [entryMode, setEntryMode] = useState<EntryMode>(() => inviteRoomFromPath() ? "join" : "choose");
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [view, setView] = useState<PublicGameView | null>(null);
  const [legal, setLegal] = useState<LegalActions | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState<{ text: string; playerId?: string }>();
  const [shuffle, setShuffle] = useState<Shuffle>();
  const [nextRound, setNextRound] = useState<NextRound>();
  const [playerStatuses, setPlayerStatuses] = useState<Array<{ id: string; connected: boolean }>>([]);
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | undefined>();
  const [playerId, setPlayerId] = useState<string | undefined>();
  const [hostPlayerId, setHostPlayerId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const connection = new WebSocket(onlineSocketUrl());
    socket.current = connection;
    connection.onopen = () => setConnected(true);
    connection.onclose = () => { setConnected(false); socket.current = null; };
    connection.onmessage = (event) => {
      const message = JSON.parse(event.data) as OnlineServerMessage;
      if (message.type === "error") setError(message.message);
      if (message.type === "joined") {
        setRoomCode(message.roomCode); setPlayerId(message.playerId); setHostPlayerId(message.hostPlayerId); setError(null);
        if (message.playerId && message.reconnectToken) localStorage.setItem(storageKey, JSON.stringify({ roomCode: message.roomCode, reconnectToken: message.reconnectToken }));
      }
      if (message.type === "lobby") { setLobby(message); setHostPlayerId(message.hostPlayerId); setView(null); setLegal(undefined); setAnnouncement(undefined); setShuffle(undefined); setNextRound(undefined); setPlayerStatuses([]); setTurnDeadlineAt(undefined); }
      if (message.type === "state") { setView(message.view); setLobby(null); setLegal(message.legalActions); setHistory(message.history); setAnnouncement(message.announcement); setShuffle(message.shuffle); setNextRound(message.nextRound); setPlayerStatuses(message.playerStatuses); setTurnDeadlineAt(message.turnDeadlineAt); }
    };
    return () => connection.close();
  }, []);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(undefined), 5_000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  const create = () => {
    localStorage.setItem("cachito-display-name", name.trim());
    send(socket.current, { type: "create-room", name });
  };
  const join = (spectator = false) => {
    const saved = !spectator ? JSON.parse(localStorage.getItem(storageKey) ?? "null") as { roomCode?: string; reconnectToken?: string } | null : null;
    if (!spectator) localStorage.setItem("cachito-display-name", name.trim());
    send(socket.current, { type: "join-room", roomCode, name, spectator, ...(saved?.roomCode === roomCode.toUpperCase() ? { reconnectToken: saved.reconnectToken } : {}) });
  };

  if (!lobby && !view) return <OnlineEntry mode={entryMode} name={name} roomCode={roomCode} connected={connected} error={error} onExit={onExit} onChoose={setEntryMode} onName={setName} onRoomCode={setRoomCode} onCreate={create} onJoin={() => join(false)} onWatch={() => join(true)} />;
  if (lobby) return <LobbyScreen lobby={lobby} playerId={playerId} error={error} onStart={() => send(socket.current, { type: "start-game" })} onAddBot={() => send(socket.current, { type: "add-bot" })} onRemoveBot={(botId) => send(socket.current, { type: "remove-bot", playerId: botId })} onKickPlayer={(targetId) => send(socket.current, { type: "kick-player", playerId: targetId })} onRename={(nextName) => { localStorage.setItem("cachito-display-name", nextName); send(socket.current, { type: "rename-player", name: nextName }); }} onExit={onExit} />;
  return <OnlineTable view={view!} history={history} legal={legal} playerId={playerId} playerStatuses={playerStatuses} turnDeadlineAt={turnDeadlineAt} error={error} isHost={playerId === hostPlayerId} announcement={announcement} shuffle={shuffle} nextRound={nextRound} onExit={onExit} onShuffle={() => send(socket.current, { type: "shuffle-dice" })} onReadyNextRound={() => send(socket.current, { type: "ready-next-round" })} onAction={(action) => send(socket.current, { type: "action", action })} onReturnToLobby={() => send(socket.current, { type: "return-to-lobby" })} />;
}

function OnlineEntry({ mode, name, roomCode, connected, error, onExit, onChoose, onName, onRoomCode, onCreate, onJoin, onWatch }: { mode: EntryMode; name: string; roomCode: string; connected: boolean; error: string | null; onExit: () => void; onChoose: (mode: EntryMode) => void; onName: (name: string) => void; onRoomCode: (code: string) => void; onCreate: () => void; onJoin: () => void; onWatch: () => void }) {
  if (mode === "choose") return <main className="setup-shell"><section className="setup-card start-card"><button className="button button--ghost back-button" onClick={onExit}>← Back</button><h1>Play online</h1><p className="intro">Private rooms for your group. You can also follow along as a spectator.</p><div className="play-mode-grid"><button className="play-mode-card" onClick={() => onChoose("create")}><span className="play-mode-icon">＋</span><strong>Create a room</strong><small>Start a new table and invite friends.</small></button><button className="play-mode-card" onClick={() => onChoose("join")}><span className="play-mode-icon">→</span><strong>Join a room</strong><small>Take an open seat at a friend's table.</small></button></div><button className="button button--ghost setup-learning-button" onClick={() => onChoose("watch")}>Watch a game</button>{!connected && <p className="rules-note">Connecting to the game server…</p>}</section></main>;
  const spectator = mode === "watch";
  return <main className="setup-shell"><section className="setup-card online-entry-card"><button className="button button--ghost back-button" onClick={() => onChoose("choose")}>← Back</button><h1>{mode === "create" ? "Create a room" : spectator ? "Watch a game" : "Join a room"}</h1><p className="intro">{mode === "create" ? "Your name will appear as the host in the lobby." : spectator ? "Room codes let you follow the public table without joining it." : "Enter your name and the room code shared by the host."}</p>{!spectator && <><label className="field-label" htmlFor="online-name">Your name</label><input id="online-name" value={name} maxLength={24} onChange={(event) => onName(event.target.value)} placeholder="Your name" /></>}{mode !== "create" && <><label className="field-label" htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} maxLength={5} onChange={(event) => onRoomCode(event.target.value.toUpperCase())} placeholder="ABCDE" /></>}<button className="button button--primary online-entry-action" disabled={!connected || (spectator ? !roomCode.trim() : !name.trim() || (mode !== "create" && !roomCode.trim()))} onClick={mode === "create" ? onCreate : spectator ? onWatch : onJoin}>{mode === "create" ? "Create room" : spectator ? "Watch game" : "Join room"}</button>{error && <p className="form-error" role="alert">{error}</p>}</section></main>;
}

function LobbyScreen({ lobby, playerId, error, onStart, onAddBot, onRemoveBot, onKickPlayer, onRename, onExit }: { lobby: Lobby; playerId?: string; error: string | null; onStart: () => void; onAddBot: () => void; onRemoveBot: (botId: string) => void; onKickPlayer: (playerId: string) => void; onRename: (name: string) => void; onExit: () => void }) {
  const [copied, setCopied] = useState(false);
  const ownPlayer = lobby.players.find((player) => player.id === playerId);
  const [rename, setRename] = useState("");
  const copyInvite = async () => {
    try { await navigator.clipboard?.writeText(new URL(`/join/${lobby.roomCode}`, location.origin).toString()); setCopied(true); } catch { setCopied(false); }
  };
  const host = playerId === lobby.hostPlayerId;
  return <main className="setup-shell"><section className="setup-card lobby-card"><button className="button button--ghost back-button" onClick={onExit}>← Leave room</button><p className="eyebrow">Private room</p><h1>{lobby.roomCode}</h1><p className="intro">Send one link and friends land straight at this room. {lobby.spectatorCount} watching.</p><button className="button button--ghost copy-code" onClick={() => void copyInvite()}>{copied ? "Invite copied" : "Copy invite link"}</button>{ownPlayer && <form className="lobby-rename" onSubmit={(event) => { event.preventDefault(); const nextName = rename.trim(); if (nextName && nextName !== ownPlayer.name) onRename(nextName); setRename(""); }}><label htmlFor="rename-player">Your name</label><input id="rename-player" value={rename || ownPlayer.name} maxLength={24} onChange={(event) => setRename(event.target.value)} /><button className="button button--ghost" type="submit">Rename</button></form>}<div className="setup-heading"><div><h2>Players</h2><p>{lobby.players.length}/6 seated</p></div>{host && <button className="button button--ghost lobby-add-bot" disabled={lobby.players.length >= 6} onClick={onAddBot}>+ Add bot</button>}</div><div className="name-list lobby-players">{lobby.players.map((player) => <div className="lobby-player" key={player.id}><span className="seat-number">{player.isBot ? "◆" : player.connected ? "●" : "○"}</span><span><strong>{player.name}</strong>{player.id === lobby.hostPlayerId && <small>Host</small>}{player.isBot && <small>Bot</small>}</span>{host && player.isBot ? <button className="lobby-remove-bot" onClick={() => onRemoveBot(player.id)} aria-label={`Remove ${player.name}`}>Remove</button> : host && player.id !== playerId ? <button className="lobby-remove-bot" onClick={() => onKickPlayer(player.id)} aria-label={`Kick ${player.name}`}>Kick</button> : <em>{player.connected ? "Ready" : "Offline"}</em>}</div>)}</div>{host && <button className="button button--primary online-entry-action" disabled={lobby.players.length < 2} onClick={onStart}>Start game</button>}{!host && <p className="rules-note">Waiting for the host to start the game.</p>}{error && <p className="form-error">{error}</p>}</section></main>;
}

function FaceMark({ value, label = false }: { value: Die; label?: boolean }) {
  const pips: Record<Die, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return <span className="face-mark" role="img" aria-label={denominationNames[value]}>{Array.from({ length: 9 }, (_, index) => <i className={pips[value].includes(index) ? "face-pip" : "face-pip face-pip--empty"} key={index} />)}{label && <small>{denominationNames[value]}</small>}</span>;
}

function OnlineHistory({ history }: { history: string[] }) {
  return <aside className="sidebar online-sidebar"><section className="side-card online-history"><div className="online-history-heading"><div><p className="turn-kicker">Live table</p><h2>Game feed</h2></div><span>{history.length}</span></div><ol className="log-list" aria-label="Game feed">{history.length ? history.map((entry, index) => <li className="log-item" key={`${entry}-${index}`}>{entry}</li>) : <li className="log-item">The room is ready.</li>}</ol></section><section className="side-card rules-note"><h2>At the table</h2><p>Every bid and challenge appears here for everyone to follow.</p></section></aside>;
}

function RoundReveal({ view, history, playerId, nextRound, onNext }: { view: PublicGameView; history: string[]; playerId?: string; nextRound?: NextRound; onNext: () => void }) {
  const [showHands, setShowHands] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setTimeout(() => setShowHands(true), 1_300);
    return () => window.clearTimeout(timer);
  }, [view.round, view.resolution?.kind]);
  useEffect(() => {
    if (!nextRound) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nextRound]);
  const resolution = view.resolution!;
  const caller = view.players.find((player) => player.id === resolution.callerId)?.name ?? "The caller";
  const bidder = view.players.find((player) => player.id === resolution.bidderId)?.name ?? "The bidder";
  const change = resolution.diceChanges[0];
  const changedPlayer = view.players.find((player) => player.id === change?.playerId)?.name ?? "A player";
  const callName = resolution.kind === "dudo" ? "Dudo" : "Calzo";
  const result = resolution.correct ? `${caller} was right.` : `${caller} was wrong.`;
  const consequence = change?.delta && change.delta > 0 ? `${changedPlayer} gains ${change.delta} die.` : `${changedPlayer} loses ${Math.abs(change?.delta ?? 0)} die.`;
  const highlight = (value: number) => value === resolution.bid.denomination || (!view.paloFijo && resolution.bid.denomination !== 1 && value === 1);
  if (!showHands) return <div className="round-result-overlay round-callout" role="status"><strong>{callName.toUpperCase()}</strong><span>{caller} calls it.</span></div>;
  const nextReady = Boolean(playerId && nextRound?.readyPlayerIds.includes(playerId));
  const remaining = nextRound ? Math.max(0, Math.ceil((nextRound.deadlineAt - clock) / 1_000)) : 0;
  return <div className="round-result-overlay" role="dialog" aria-modal="true" aria-label="Round result"><section className="reveal-panel round-result"><div className="result-banner"><p className="turn-kicker">All hands revealed · {resolution.actualCount} actual</p><h3>{caller} called {callName} on {bidder}'s {resolution.bid.quantity} {denominationNames[resolution.bid.denomination]}.</h3><p><strong>{result}</strong> {consequence}</p></div><div className="revealed-hands">{view.players.filter((player) => player.hand?.length).map((player) => <div className="revealed-hand" key={player.id}><strong>{player.name}</strong><DiceRow dice={player.hand!} small highlight={highlight} /></div>)}</div><ol className="reveal-history">{history.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>{playerId && <div className="next-round-ready"><button className="button button--primary" disabled={nextReady} onClick={onNext}>{nextReady ? "Ready for next round" : "Next round"}</button><small>{nextRound ? `${nextRound.readyPlayerIds.length}/${view.players.filter((player) => !player.eliminated).length} ready · auto-starts in ${remaining}s` : "Preparing the next round…"}</small></div>}</section></div>;
}

function RoundShuffle({ view, playerId, shuffle, shaking, onShuffle }: { view: PublicGameView; playerId?: string; shuffle: NonNullable<Shuffle>; shaking: boolean; onShuffle: () => void }) {
  const activePlayers = view.players.filter((player) => !player.eliminated);
  const ready = new Set(shuffle.readyPlayerIds);
  const myReady = Boolean(playerId && ready.has(playerId));
  return <div className="round-shuffle-overlay" role="dialog" aria-modal="true" aria-label="Shuffle dice"><section className="round-shuffle-card"><p className="turn-kicker">Round {view.round} · First bid waits for everyone</p><h2>Shake your cup</h2><p className="round-shuffle-copy">Your dice below will tumble, then settle into this round’s hand.</p><div className="round-shuffle-players">{activePlayers.map((player) => <div className={`round-shuffle-player${ready.has(player.id) ? " round-shuffle-player--ready" : ""}`} key={player.id}><strong>{player.name}</strong><small>{ready.has(player.id) ? "Dice shuffled" : "Waiting"}</small></div>)}</div>{playerId ? <button className="button button--primary round-shuffle-button" disabled={shaking || myReady} onClick={onShuffle}>{myReady ? "Dice shuffled" : shaking ? "Shuffling…" : "Shake my dice"}</button> : <p className="rules-note">Waiting for the players to shake their dice.</p>}</section></div>;
}

function GameSummary({ view, history, isHost, onReturnToLobby, onExit }: { view: PublicGameView; history: string[]; isHost: boolean; onReturnToLobby: () => void; onExit: () => void }) {
  const winner = view.players.find((player) => player.id === view.winnerId);
  const standings = [...view.players].sort((left, right) => Number(right.id === view.winnerId) - Number(left.id === view.winnerId) || right.diceCount - left.diceCount || left.name.localeCompare(right.name));
  const lastCall = history.find((entry) => !entry.endsWith("wins the match.")) ?? history[0];
  return <main className="game-over"><div className="confetti" aria-hidden="true">{Array.from({ length: 64 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 101}%`, width: `${6 + (index % 6)}px`, height: `${10 + ((index * 3) % 12)}px`, animationDelay: `${-(index % 12) * .22}s`, animationDuration: `${2.7 + (index % 7) * .23}s` }} />)}</div><section className="game-summary-card"><p className="winner-crown" aria-hidden="true">♛</p><p className="eyebrow">Game complete</p><h1>{winner?.name} wins!</h1><p>After {view.round} {view.round === 1 ? "round" : "rounds"}, here is how the table finished.</p><ol className="summary-standings">{standings.map((player, index) => <li key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><em>{player.id === view.winnerId ? "Winner" : player.diceCount ? `${player.diceCount} dice left` : "Out"}</em></li>)}</ol>{lastCall && <p className="summary-last-call">Last call: {lastCall}</p>}<div className="game-over-actions">{isHost && <button className="button button--primary" onClick={onReturnToLobby}>Return to lobby</button>}<button className="button button--ghost" onClick={onExit}>Leave game</button></div></section></main>;
}

function OnlineTable({ view, history, legal, playerId, playerStatuses, turnDeadlineAt, error, isHost, announcement, shuffle, nextRound, onShuffle, onReadyNextRound, onAction, onReturnToLobby, onExit }: { view: PublicGameView; history: string[]; legal?: LegalActions; playerId?: string; playerStatuses: Array<{ id: string; connected: boolean }>; turnDeadlineAt?: number; error: string | null; isHost: boolean; announcement?: { text: string; playerId?: string }; shuffle?: Shuffle; nextRound?: NextRound; onShuffle: () => void; onReadyNextRound: () => void; onAction: (action: GameAction) => void; onReturnToLobby: () => void; onExit: () => void }) {
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  const isMyTurn = view.phase === "playing" && view.currentPlayerId === playerId;
  const first = legal?.bids[0];
  const [quantity, setQuantity] = useState(first?.quantity ?? 1);
  const [denomination, setDenomination] = useState<Die>(first?.denomination ?? 2);
  const [shufflingDice, setShufflingDice] = useState(false);
  const [shuffleFaces, setShuffleFaces] = useState<Die[] | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem("cachito-reduced-motion") === "true");
  const [clock, setClock] = useState(() => Date.now());
  const shuffleTimer = useRef<number | undefined>(undefined);
  const maxQuantity = useMemo(() => view.players.reduce((total, player) => total + player.diceCount, 0), [view]);
  const ownHand = view.players.find((player) => player.id === playerId)?.hand;
  const eliminated = view.players.find((player) => player.id === playerId)?.eliminated ?? false;
  const statusById = new Map(playerStatuses.map((status) => [status.id, status.connected]));
  const secondsLeft = turnDeadlineAt ? Math.max(0, Math.ceil((turnDeadlineAt - clock) / 1_000)) : undefined;
  const paloDefault = view.paloFijo && !legal?.bids.some((bid) => bid.quantity === quantity && bid.denomination === denomination)
    ? legal?.bids.find((bid) => bid.quantity === quantity)?.denomination
    : undefined;
  const selectedDenomination = paloDefault ?? denomination;
  const chosen = legal?.bids.some((bid) => bid.quantity === quantity && bid.denomination === selectedDenomination) ?? false;
  const bid = () => onAction({ type: "bid", playerId: "", bid: { quantity, denomination: selectedDenomination } });
  const shakeDice = () => {
    if (!ownHand) return onShuffle();
    setShufflingDice(true);
    let step = 0;
    const tumble = () => {
      setShuffleFaces(ownHand.map(() => (Math.floor(Math.random() * 6) + 1) as Die));
      step += 1;
      if (step < 14) {
        const delay = step < 8 ? 65 : 100 + (step - 8) * 38;
        shuffleTimer.current = window.setTimeout(tumble, delay);
      } else {
        setShuffleFaces([...ownHand]);
        onShuffle();
        shuffleTimer.current = window.setTimeout(() => setShufflingDice(false), 500);
      }
    };
    tumble();
  };
  useEffect(() => () => { if (shuffleTimer.current) window.clearTimeout(shuffleTimer.current); }, []);
  useEffect(() => {
    if (!turnDeadlineAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [turnDeadlineAt]);
  useEffect(() => {
    localStorage.setItem("cachito-reduced-motion", String(reducedMotion));
  }, [reducedMotion]);
  if (view.phase === "gameOver") return <GameSummary view={view} history={history} isHost={isHost} onReturnToLobby={onReturnToLobby} onExit={onExit} />;
  const needsShuffle = view.phase === "playing" && shuffle?.round === view.round && shuffle.readyPlayerIds.length < view.players.filter((player) => !player.eliminated).length;
  return <div className={`game-shell${reducedMotion ? " game-shell--reduced-motion" : ""}`}>
    <header className="game-header"><div className="wordmark">Cachito online</div><div className="game-header-actions"><div className="round-label">Room · Round {view.round}{view.paloFijo ? " · Palo fijo" : ""}</div><button className="settings-button" aria-expanded={settingsOpen} aria-label="Game settings" onClick={() => setSettingsOpen((open) => !open)}>⚙</button>{settingsOpen && <div className="settings-popover"><strong>Settings</strong><label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label><small>Sound controls are coming next.</small></div>}</div></header>
    <div className="table-layout"><main className="table-main">
      <section className="players-strip">{view.players.map((player) => <article className={`player-chip${player.id === current?.id ? " player-chip--active" : ""}${statusById.get(player.id) === false ? " player-chip--offline" : ""}`} key={player.id}>{announcement?.playerId === player.id && <div className="player-speech" role="status">{announcement.text}</div>}<div className="player-name">{player.name}</div><div className="dice-count">{player.eliminated ? "Out · spectating" : statusById.get(player.id) === false ? "Offline · bot cover in 2 min" : `${player.diceCount} dice`}</div></article>)}</section>
      <section className={`felt-table${isMyTurn ? " felt-table--your-turn" : ""}`}>
        {view.phase === "reveal" && <RoundReveal view={view} history={history} playerId={playerId} nextRound={nextRound} onNext={onReadyNextRound} />}
        {needsShuffle && <RoundShuffle view={view} playerId={playerId} shuffle={shuffle!} shaking={shufflingDice} onShuffle={shakeDice} />}
        {isMyTurn && <div className="your-turn-banner" role="status">Your move · 2 min</div>}
        {announcement && !announcement.playerId && <p className="table-announcement" role="status">{announcement.text}</p>}
        {secondsLeft !== undefined && <div className={`turn-timer${secondsLeft <= 10 ? " turn-timer--urgent" : ""}`} aria-label={`${secondsLeft} seconds remaining`}><span>{String(Math.floor(secondsLeft / 60)).padStart(1, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</span><small>{isMyTurn ? "your turn" : "turn timer"}</small></div>}
        <p className="turn-kicker">{eliminated ? "Spectating — you are out" : isMyTurn ? "Make a bid or call it" : playerId ? "Waiting for turn" : "Spectating until the next lobby"}</p>
        <h2 className="turn-name">{view.phase === "reveal" ? "Round result" : current?.name}</h2>
        {view.paloFijo && <div className="palo-fijo-alert"><strong>Palo fijo</strong><span>Aces are not wild this round.{(view.players.find((player) => player.id === playerId)?.diceCount ?? 0) > 1 ? " Your dice stay hidden until you have one." : ""}</span></div>}
        {view.currentBid ? <div className="current-bid bid-card"><span className="bid-quantity">{view.currentBid.quantity}</span><FaceMark value={view.currentBid.denomination} /><div className="bid-copy"><strong>{denominationNames[view.currentBid.denomination]}</strong><span>current bid</span></div></div> : <div className="current-bid bid-empty">No bid yet.</div>}
        {isMyTurn ? <section className="controls-card"><div className="bid-inputs"><div><span className="field-label">Quantity</span><div className="stepper"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><span>{quantity}</span><button onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}>+</button></div></div><div><span className="field-label">Denomination</span><div className="denominations">{([1,2,3,4,5,6] as Die[]).map((die) => <button className="denom-button" key={die} aria-pressed={selectedDenomination === die} onClick={() => setDenomination(die)} disabled={!legal?.bids.some((candidate) => candidate.quantity === quantity && candidate.denomination === die)}><FaceMark value={die} label /></button>)}</div></div></div><div className="action-row"><button className="challenge-button challenge-button--dudo" disabled={!legal?.canDudo} onClick={() => onAction({ type: "dudo", playerId: "" })}>Dudo</button><button className="challenge-button challenge-button--calzo" disabled={!legal?.canCalzo} onClick={() => onAction({ type: "calzo", playerId: "" })}>Calzo</button><button className="button button--primary" disabled={!chosen} onClick={bid}>Raise bid</button></div></section> : <section className="controls-card"><p className="rules-note">{eliminated ? "You are now a spectator for the rest of this game." : playerId ? "Your moves will appear here when it is your turn." : "You are spectating this game and will be seated when it returns to the lobby."}</p></section>}
        <section className={`hand-panel${needsShuffle || shufflingDice ? " hand-panel--shuffling" : ""}`}><p className="hand-label">Your dice{isMyTurn ? " · click a die to choose its face" : ""}</p>{ownHand ? <DiceRow dice={shufflingDice && shuffleFaces ? shuffleFaces : ownHand} className={shufflingDice ? "dice-row--shuffling" : ""} onDieClick={isMyTurn ? (value) => setDenomination(value as Die) : undefined} /> : <p className="rules-note">Hands are hidden.</p>}</section>
        {error && <p className="form-error">{error}</p>}
      </section>
    </main><OnlineHistory history={history} /></div>
  </div>;
}
