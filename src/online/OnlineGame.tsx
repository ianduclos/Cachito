import { Component, type CSSProperties, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_PLAYERS, type Bid, type Die, type GameAction, type GameRules, type LegalActions, type PublicGameView, type PublicPlayer } from "../engine";
import { DiceRow } from "../ui/Dice";
import { GameSettings } from "../ui/GameSettings";
import { getSoundLevels, playSound, setSoundLevels, type SoundLevels } from "../ui/sound";
import { seatLayoutFor, spectatorSeatLayoutFor, type SeatPosition } from "../ui/tablePrototypeSeats";
import "../ui/TablePrototype.css";
import "./OnlineTable.css";
import type { OnlineClientMessage, OnlineServerMessage } from "./protocol";

type Lobby = Extract<OnlineServerMessage, { type: "lobby" }>;
type EntryMode = "choose" | "create" | "join" | "watch";
type Shuffle = Extract<OnlineServerMessage, { type: "state" }>['shuffle'];
type NextRound = Extract<OnlineServerMessage, { type: "state" }>['nextRound'];
type Pause = Extract<OnlineServerMessage, { type: "state" }>['paused'];
const denominationNames: Record<Die, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const storageKey = "cachito-online-session";
const dieGlyphs: Record<Die, string> = { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" };
const facePips: Record<Die, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

type SavedSession = { roomCode: string; reconnectToken: string };

function savedSession(): SavedSession | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<SavedSession> | null;
    return saved?.roomCode && saved?.reconnectToken ? { roomCode: saved.roomCode, reconnectToken: saved.reconnectToken } : undefined;
  } catch {
    localStorage.removeItem(storageKey);
    return undefined;
  }
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase();
}

class OnlineErrorBoundary extends Component<{ children: ReactNode; onExit: () => void; onReconnect: () => void; recoveryKey: number }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("Online table failed to render", error); }
  componentDidUpdate(previous: Readonly<{ recoveryKey: number }>) { if (previous.recoveryKey !== this.props.recoveryKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="setup-shell"><section className="setup-card online-entry-card"><p className="eyebrow">Connection recovery</p><h1>Let’s get you back in</h1><p className="intro">Your saved seat is kept on this device. Reconnect will return you to that room if it is still active.</p><button className="button button--primary online-entry-action" onClick={this.props.onReconnect}>Reconnect to saved game</button><button className="button button--ghost online-entry-action" onClick={() => window.location.reload()}>Reload page</button><button className="button button--ghost online-entry-action" onClick={this.props.onExit}>Back to menu</button></section></main>;
  }
}

function send(socket: WebSocket | null, message: OnlineClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function ConnectionNotice({ connected, context }: { connected: boolean; context: "lobby" | "game" }) {
  if (connected) return null;
  return <div className="online-connection-notice" role="status" aria-live="polite"><strong>Reconnecting…</strong><span>{context === "game" ? "The table is read-only until your connection returns." : "Room controls will return when you’re connected."}</span></div>;
}

function useModalFocus(container: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const dialog = container.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
    const backgroundControls = Array.from(dialog.closest(".game-shell")?.querySelectorAll<HTMLElement>(selector) ?? []).filter((element) => !dialog.contains(element));
    const previouslyInert = backgroundControls.filter((element) => element.inert);
    backgroundControls.forEach((element) => { element.inert = true; });
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusable[0] ?? dialog).focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const available = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      if (!available.length) { event.preventDefault(); dialog.focus(); return; }
      const first = available[0];
      const last = available[available.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => {
      dialog.removeEventListener("keydown", trapFocus);
      backgroundControls.forEach((element) => { element.inert = previouslyInert.includes(element); });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, container]);
}

function onlineSocketUrl() {
  const configured = import.meta.env.VITE_ONLINE_ENDPOINT?.replace(/\/$/, "");
  if (configured) return `${configured.replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/online`;
  // Firebase Hosting serves a static bundle and cannot proxy WebSockets. Keep
  // the public deployment connected when it is built outside App Hosting.
  if (location.hostname === "cachito.web.app") return "wss://cachito-rooms-ribcxidnzq-ez.a.run.app/online";
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/online`;
}

function inviteRoomFromPath() {
  const match = location.pathname.match(/^\/join\/([A-Z0-9]{5})\/?$/i);
  return match?.[1]?.toUpperCase() ?? "";
}

export function OnlineGame({ onExit }: { onExit: () => void }) {
  const [recoveryKey, setRecoveryKey] = useState(0);
  const reconnect = () => setRecoveryKey((key) => key + 1);
  return <OnlineErrorBoundary onExit={onExit} onReconnect={reconnect} recoveryKey={recoveryKey}><OnlineGameContent key={recoveryKey} onExit={onExit} onReconnect={reconnect} restoreSavedSession={recoveryKey > 0} /></OnlineErrorBoundary>;
}

function OnlineGameContent({ onExit, onReconnect, restoreSavedSession = false }: { onExit: () => void; onReconnect: () => void; restoreSavedSession?: boolean }) {
  const socket = useRef<WebSocket | null>(null);
  const activeRoomCode = useRef("");
  const spectating = useRef(false);
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
  const [paused, setPaused] = useState<Pause>();
  const [playerStatuses, setPlayerStatuses] = useState<Array<{ id: string; connected: boolean; covered: boolean }>>([]);
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | undefined>();
  const [playerId, setPlayerId] = useState<string | undefined>();
  const [hostPlayerId, setHostPlayerId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: number | undefined;
    let shouldRestore = restoreSavedSession;
    const connect = () => {
      if (stopped || socket.current?.readyState === WebSocket.CONNECTING || socket.current?.readyState === WebSocket.OPEN) return;
      const connection = new WebSocket(onlineSocketUrl());
      socket.current = connection;
      connection.onopen = () => {
        if (socket.current !== connection) return;
        const saved = shouldRestore ? savedSession() : undefined;
        const restoring = shouldRestore && Boolean(saved || activeRoomCode.current && spectating.current);
        setConnected(!restoring);
        if (shouldRestore) {
          if (saved) send(connection, { type: "join-room", roomCode: saved.roomCode, name: localStorage.getItem("cachito-display-name") ?? "", reconnectToken: saved.reconnectToken });
          else if (activeRoomCode.current && spectating.current) send(connection, { type: "join-room", roomCode: activeRoomCode.current, spectator: true });
        }
      };
      connection.onerror = () => { if (socket.current === connection) connection.close(); };
      connection.onclose = () => {
        if (socket.current !== connection) return;
        setConnected(false);
        socket.current = null;
        shouldRestore = true;
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1_000);
      };
      connection.onmessage = (event) => {
        if (socket.current !== connection) return;
        const message = JSON.parse(event.data) as OnlineServerMessage;
        if (message.type === "error") {
          setError(message.message);
          if (/room does not exist|idle room expired/i.test(message.message)) { activeRoomCode.current = ""; spectating.current = false; localStorage.removeItem(storageKey); setConnected(connection.readyState === WebSocket.OPEN); setView(null); setLobby(null); setLegal(undefined); setShuffle(undefined); setNextRound(undefined); setPaused(undefined); }
        }
        if (message.type === "joined") {
          activeRoomCode.current = message.roomCode; spectating.current = !message.playerId;
          setConnected(true); setRoomCode(message.roomCode); setPlayerId(message.playerId); setHostPlayerId(message.hostPlayerId); setError(null);
          if (message.playerId && message.reconnectToken) localStorage.setItem(storageKey, JSON.stringify({ roomCode: message.roomCode, reconnectToken: message.reconnectToken }));
        }
        if (message.type === "lobby") { setLobby(message); setHostPlayerId(message.hostPlayerId); setView(null); setLegal(undefined); setAnnouncement(undefined); setShuffle(undefined); setNextRound(undefined); setPaused(undefined); setPlayerStatuses([]); setTurnDeadlineAt(undefined); }
        if (message.type === "state") { setHostPlayerId(message.hostPlayerId); setView(message.view); setLobby(null); setLegal(message.legalActions); setHistory(message.history); setAnnouncement(message.announcement); setShuffle(message.shuffle); setNextRound(message.nextRound); setPaused(message.paused); setPlayerStatuses(message.playerStatuses); setTurnDeadlineAt(message.turnDeadlineAt); }
      };
    };
    connect();
    return () => { stopped = true; if (reconnectTimer) window.clearTimeout(reconnectTimer); socket.current?.close(); };
  }, [restoreSavedSession]);

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
    const saved = !spectator ? savedSession() : undefined;
    activeRoomCode.current = roomCode.toUpperCase();
    spectating.current = spectator;
    if (!spectator) localStorage.setItem("cachito-display-name", name.trim());
    send(socket.current, { type: "join-room", roomCode, name, spectator, ...(saved?.roomCode === roomCode.toUpperCase() ? { reconnectToken: saved.reconnectToken } : {}) });
  };
  const leaveRoom = () => {
    if (!connected) return;
    send(socket.current, { type: "leave-room" });
    activeRoomCode.current = "";
    localStorage.removeItem(storageKey);
    onExit();
  };

  if (!lobby && !view) return <><OnlineEntry mode={entryMode} name={name} roomCode={roomCode} connected={connected} error={error} onExit={onExit} onReconnect={onReconnect} onChoose={setEntryMode} onName={setName} onRoomCode={setRoomCode} onCreate={create} onJoin={() => join(false)} onWatch={() => join(true)} /><div className="menu-settings"><GameSettings /></div></>;
  if (lobby) return <><LobbyScreen lobby={lobby} playerId={playerId} connected={connected} error={error} onStart={() => send(socket.current, { type: "start-game" })} onAddBot={() => send(socket.current, { type: "add-bot" })} onRemoveBot={(botId) => send(socket.current, { type: "remove-bot", playerId: botId })} onKickPlayer={(targetId) => send(socket.current, { type: "kick-player", playerId: targetId })} onRename={(nextName) => { localStorage.setItem("cachito-display-name", nextName); send(socket.current, { type: "rename-player", name: nextName }); }} onProposeRules={(rules) => send(socket.current, { type: "propose-rules", rules })} onApproveRules={() => send(socket.current, { type: "approve-rules" })} onExit={leaveRoom} /><div className="menu-settings"><GameSettings /></div></>;
  return <OnlineTable view={view!} roomCode={roomCode} history={history} legal={legal} playerId={playerId} playerStatuses={playerStatuses} turnDeadlineAt={turnDeadlineAt} connected={connected} error={error} isHost={playerId === hostPlayerId} announcement={announcement} shuffle={shuffle} nextRound={nextRound} paused={paused} onExit={leaveRoom} onPause={() => send(socket.current, { type: "toggle-pause" })} onShuffle={() => send(socket.current, { type: "shuffle-dice" })} onReadyNextRound={() => send(socket.current, { type: "ready-next-round" })} onAction={(action) => send(socket.current, { type: "action", action })} onReturnToLobby={() => send(socket.current, { type: "return-to-lobby" })} />;
}

function OnlineEntry({ mode, name, roomCode, connected, error, onExit, onReconnect, onChoose, onName, onRoomCode, onCreate, onJoin, onWatch }: { mode: EntryMode; name: string; roomCode: string; connected: boolean; error: string | null; onExit: () => void; onReconnect: () => void; onChoose: (mode: EntryMode) => void; onName: (name: string) => void; onRoomCode: (code: string) => void; onCreate: () => void; onJoin: () => void; onWatch: () => void }) {
  if (mode === "choose") return <main className="setup-shell"><section className="setup-card start-card"><button className="button button--ghost back-button" onClick={onExit}>← Back</button><h1>Play online</h1><p className="intro">Private rooms for your group. You can also follow along as a spectator.</p><div className="play-mode-grid"><button className="play-mode-card" onClick={() => onChoose("create")}><span className="play-mode-icon">＋</span><strong>Create a room</strong><small>Start a new table and invite friends.</small></button><button className="play-mode-card" onClick={() => onChoose("join")}><span className="play-mode-icon">→</span><strong>Join a room</strong><small>Take an open seat at a friend's table.</small></button></div><button className="button button--ghost setup-learning-button" onClick={() => onChoose("watch")}>Watch a game</button>{savedSession() && <button className="button button--ghost online-recover-action" onClick={onReconnect}>↻ Reconnect to saved game</button>}{!connected && <p className="rules-note">Connecting to the game server…</p>}</section></main>;
  const spectator = mode === "watch";
  return <main className="setup-shell"><section className="setup-card online-entry-card"><button className="button button--ghost back-button" onClick={() => onChoose("choose")}>← Back</button><h1>{mode === "create" ? "Create a room" : spectator ? "Watch a game" : "Join a room"}</h1><p className="intro">{mode === "create" ? "Your name will appear as the host in the lobby." : spectator ? "Room codes let you follow the public table without joining it." : "Enter your name and the room code shared by the host."}</p>{!spectator && <><label className="field-label" htmlFor="online-name">Your name</label><input id="online-name" value={name} maxLength={24} onChange={(event) => onName(event.target.value)} placeholder="Your name" /></>}{mode !== "create" && <><label className="field-label" htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} maxLength={5} onChange={(event) => onRoomCode(event.target.value.toUpperCase())} placeholder="ABCDE" /></>}<button className="button button--primary online-entry-action" disabled={!connected || (spectator ? !roomCode.trim() : !name.trim() || (mode !== "create" && !roomCode.trim()))} onClick={mode === "create" ? onCreate : spectator ? onWatch : onJoin}>{mode === "create" ? "Create room" : spectator ? "Watch game" : "Join room"}</button>{error && <p className="form-error" role="alert">{error}</p>}</section></main>;
}

function LobbyScreen({ lobby, playerId, connected, error, onStart, onAddBot, onRemoveBot, onKickPlayer, onRename, onProposeRules, onApproveRules, onExit }: { lobby: Lobby; playerId?: string; connected: boolean; error: string | null; onStart: () => void; onAddBot: () => void; onRemoveBot: (botId: string) => void; onKickPlayer: (playerId: string) => void; onRename: (name: string) => void; onProposeRules: (rules: GameRules) => void; onApproveRules: () => void; onExit: () => void }) {
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const ownPlayer = lobby.players.find((player) => player.id === playerId);
  const [rename, setRename] = useState("");
  const copyInvite = async () => {
    try { await navigator.clipboard?.writeText(new URL(`/join/${lobby.roomCode}`, location.origin).toString()); setCopied(true); } catch { setCopied(false); }
  };
  const host = playerId === lobby.hostPlayerId;
  if (rulesOpen) return <LobbyRulesScreen key={JSON.stringify(lobby.pendingRules?.rules ?? lobby.rules)} lobby={lobby} playerId={playerId} connected={connected} onBack={() => setRulesOpen(false)} onPropose={onProposeRules} onApprove={onApproveRules} />;
  return <main className="setup-shell"><section className="setup-card lobby-card"><button className="button button--ghost back-button" disabled={!connected} onClick={onExit}>← Leave room</button><ConnectionNotice connected={connected} context="lobby" /><p className="eyebrow">Private room</p><h1>{lobby.roomCode}</h1><p className="intro">Send one link and friends land straight at this room. {lobby.spectatorCount} watching.</p><button className="button button--ghost copy-code" onClick={() => void copyInvite()}>{copied ? "Invite copied" : "Copy invite link"}</button>{ownPlayer && <form className="lobby-rename" onSubmit={(event) => { event.preventDefault(); if (!connected) return; const nextName = rename.trim(); if (nextName && nextName !== ownPlayer.name) onRename(nextName); setRename(""); }}><label htmlFor="rename-player">Your name</label><input id="rename-player" value={rename || ownPlayer.name} maxLength={24} onChange={(event) => setRename(event.target.value)} /><button className="button button--ghost" type="submit" disabled={!connected}>Rename</button></form>}<div className="lobby-rules-strip"><div><strong>Game rules</strong><span>{lobby.pendingRules ? "Approval needed" : "All set"}</span></div><button className="button button--ghost" onClick={() => setRulesOpen(true)}>{host ? "Edit rules" : "View rules"}</button></div><div className="setup-heading"><div><h2>Players</h2><p>{lobby.players.length}/{MAX_PLAYERS} seated</p></div>{host && <button className="button button--ghost lobby-add-bot" disabled={!connected || lobby.players.length >= MAX_PLAYERS} onClick={onAddBot}>+ Add bot</button>}</div><div className="name-list lobby-players">{lobby.players.map((player) => <div className="lobby-player" key={player.id}><span className="seat-number">{player.isBot ? "◆" : player.connected ? "●" : "○"}</span><span><strong>{player.name}</strong>{player.id === lobby.hostPlayerId && <small>Host</small>}{player.isBot && <small>Bot</small>}</span>{host && player.isBot ? <button className="lobby-remove-bot" disabled={!connected} onClick={() => onRemoveBot(player.id)} aria-label={`Remove ${player.name}`}>Remove</button> : host && player.id !== playerId ? <button className="lobby-remove-bot" disabled={!connected} onClick={() => onKickPlayer(player.id)} aria-label={`Kick ${player.name}`}>Kick</button> : <em>{player.connected ? "Ready" : "Offline"}</em>}</div>)}</div>{host && <button className="button button--primary online-entry-action" disabled={!connected || lobby.players.length < 2 || Boolean(lobby.pendingRules)} onClick={onStart}>{lobby.pendingRules ? "Waiting for rule approval" : "Start game"}</button>}{!host && <p className="rules-note">{lobby.pendingRules ? "Open Game rules to approve the host's proposal." : "Waiting for the host to start the game."}</p>}{error && <p className="form-error" role="alert">{error}</p>}</section></main>;
}

function ruleSummary(rules: GameRules) {
  return [
    `Turn Time · ${rules.turnTimeSeconds === 90 ? "1:30" : `${rules.turnTimeSeconds}s`}`,
    `Aces · ${rules.acesConversion === "half" ? "Half" : "Half + 1"}`,
    `Palo Fijo · ${rules.paloFijoTrigger === "oneDie" ? "1 die" : "2 dice"}`,
    `Blind Dice · ${rules.paloFijoBlindDice ? "Yes" : "No"}`,
    `Dice Amounts · ${rules.diceAmountsVisible ? "Visible" : "Hidden"}`,
    `Table Dice · ${rules.tableDiceEnabled ? "Enabled" : "Disabled"}`,
  ];
}

function LobbyRulesScreen({ lobby, playerId, connected, onBack, onPropose, onApprove }: { lobby: Lobby; playerId?: string; connected: boolean; onBack: () => void; onPropose: (rules: GameRules) => void; onApprove: () => void }) {
  const host = playerId === lobby.hostPlayerId;
  const proposal = lobby.pendingRules;
  const [draft, setDraft] = useState<GameRules>(proposal?.rules ?? lobby.rules);
  const approved = Boolean(playerId && proposal?.approvalPlayerIds.includes(playerId));
  const proposer = lobby.players.find((player) => player.id === proposal?.proposedById)?.name ?? "The host";
  const selected = <div className="lobby-rule-summary">{ruleSummary(lobby.rules).map((rule) => <span key={rule}>{rule}</span>)}</div>;
  return <main className="setup-shell"><section className="setup-card lobby-card rules-page"><button className="button button--ghost back-button" onClick={onBack}>← Back to room</button><ConnectionNotice connected={connected} context="lobby" /><p className="eyebrow">Room rules</p><h1>Game Rules</h1><p className="intro">The host can propose changes; every seated player must approve before they apply. Bots approve automatically.</p><section className="rules-section"><div className="rules-section-heading"><p className="turn-kicker">In play</p><h2>Current Rules</h2></div>{selected}</section>{host && <section className="rules-section rule-editor"><div className="rules-section-heading"><p className="turn-kicker">Host controls</p><h2>Propose Changes</h2></div><div className="rule-fields"><label><span>Time Per Play</span><select value={draft.turnTimeSeconds} onChange={(event) => setDraft({ ...draft, turnTimeSeconds: Number(event.target.value) as GameRules["turnTimeSeconds"] })}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={90}>1 minute 30 seconds</option></select></label><label><span>Aces Conversion</span><select value={draft.acesConversion} onChange={(event) => setDraft({ ...draft, acesConversion: event.target.value as GameRules["acesConversion"] })}><option value="half">Half</option><option value="halfPlusOne">Half + 1</option></select></label><label><span>Palo Fijo Starts At</span><select value={draft.paloFijoTrigger} onChange={(event) => setDraft({ ...draft, paloFijoTrigger: event.target.value as GameRules["paloFijoTrigger"] })}><option value="oneDie">1 die</option><option value="twoDice">2 dice</option></select></label><label><span>Blind Dice in Palo Fijo</span><select value={String(draft.paloFijoBlindDice)} onChange={(event) => setDraft({ ...draft, paloFijoBlindDice: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></label><label><span>Show Dice Amounts</span><select value={String(draft.diceAmountsVisible)} onChange={(event) => setDraft({ ...draft, diceAmountsVisible: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></label><label><span>Allow Table Dice</span><select value={String(draft.tableDiceEnabled)} onChange={(event) => setDraft({ ...draft, tableDiceEnabled: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></label></div><button className="button button--primary rule-propose-button" disabled={!connected} onClick={() => onPropose(draft)}>{proposal ? "Replace Proposal" : "Propose Rule Changes"}</button></section>}{proposal && <section className="rule-proposal"><p className="turn-kicker">Awaiting unanimous approval</p><h2>{proposer}'s Proposal</h2><div className="lobby-rule-summary">{ruleSummary(proposal.rules).map((rule) => <span key={rule}>{rule}</span>)}</div><p>{proposal.approvalPlayerIds.length}/{lobby.players.length} players approved</p><div className="rule-approvals">{lobby.players.map((player) => <span className={proposal.approvalPlayerIds.includes(player.id) ? "approved" : "pending"} key={player.id}>{proposal.approvalPlayerIds.includes(player.id) ? "✓" : "○"} {player.name}</span>)}</div>{playerId && !approved && <button className="button button--primary" disabled={!connected} onClick={onApprove}>Approve These Rules</button>}{approved && <p className="rules-note">You approved this proposal.</p>}</section>}</section></main>;
}

function OnlineDenominationFace({ value }: { value: Die }) {
  return <span className="online-denom-face" role="img" aria-label={denominationNames[value]}>{Array.from({ length: 9 }, (_, index) => <i className={facePips[value].includes(index) ? "online-denom-pip" : "online-denom-pip online-denom-pip--empty"} key={index} />)}<small>{denominationNames[value]}</small></span>;
}

function OnlineDiceInventory({ inPlay, startingTotal }: { inPlay: number; startingTotal: number }) {
  const lost = Math.max(0, startingTotal - inPlay);
  const groups = Array.from({ length: Math.ceil(lost / 5) }, (_, index) => Math.min(5, lost - index * 5));
  return <section className="tp-inventory" aria-label={`${inPlay} dice in play; ${lost} ${lost === 1 ? "die" : "dice"} lost`}><div className="tp-inventory-heading"><span>Dice in play</span><strong>{inPlay}</strong></div><div className="tp-lost-heading"><span>Lost dice</span><small>Grouped in fives</small></div>{groups.length ? <div className="tp-dice-groups" aria-hidden="true">{groups.map((count, groupIndex) => <span className="tp-dice-group" key={`${count}-${groupIndex}`}><DiceRow dice={Array.from({ length: count }, () => 1 as Die)} small /></span>)}</div> : <p className="tp-no-lost-dice">No dice lost yet</p>}</section>;
}

function OnlineSeat({ player, position, currentTurn, latestBid, diceAmountsVisible, connected, covered, announcement }: { player: PublicPlayer; position: SeatPosition; currentTurn: boolean; latestBid?: Bid; diceAmountsVisible: boolean; connected: boolean; covered: boolean; announcement?: string }) {
  const status = player.eliminated ? "Out · spectating" : !connected ? covered ? "Offline · bot cover" : "Offline · reconnecting" : player.tableDice.length ? `${player.tableDice.length} public · rest hidden` : "Dice hidden";
  return <article className={`tp-seat tp-seat--${position}${player.eliminated ? " tp-seat--out" : ""}${currentTurn ? " tp-seat--active" : ""}`} aria-label={`${player.name}${player.eliminated ? ", out and spectating" : ""}${currentTurn ? ", current turn" : ""}`}>{announcement && <div className="online-seat-announcement" role="status">{announcement}</div>}{currentTurn && <span className="tp-turn-flag">Turn</span>}{player.eliminated && <span className="tp-out-flag">Out</span>}<div className="tp-avatar" aria-hidden="true">{initials(player.name)}</div><div className="tp-seat-copy"><div><strong>{player.name}</strong><small>{!connected ? covered ? "Covered" : "Offline" : "Online"}</small></div>{diceAmountsVisible && !player.eliminated ? <span className="tp-seat-dice-squares" aria-label={`${player.diceCount} ${player.diceCount === 1 ? "die" : "dice"}`}>{Array.from({ length: player.diceCount }, (_, index) => <i className={index < player.tableDice.length ? "tp-seat-die--public" : ""} key={index} />)}</span> : <span>{status}</span>}</div>{latestBid && <div className="tp-seat-bid"><span>Latest bid</span><strong><span>{latestBid.quantity} ×</span><b aria-label={denominationNames[latestBid.denomination]}>{dieGlyphs[latestBid.denomination]}</b></strong></div>}{!latestBid && player.tableDice.length > 0 && <small className="tp-seat-note">{player.tableDice.length} dice on the table</small>}</article>;
}

function OnlineSpectatorDock({ roomCode, player, currentPlayerName, currentBid, round, totalDice, formattedTime, onActivity }: { roomCode: string; player?: PublicPlayer; currentPlayerName: string; currentBid: Bid | null; round: number; totalDice: number; formattedTime?: string; onActivity: () => void }) {
  return <section className={`tp-spectator-dock${player?.eliminated ? " tp-spectator-dock--out" : ""}`} aria-label="Spectator view"><div className="tp-spectator-identity"><div className="tp-spectator-icon" aria-hidden="true">◎</div><div><p>{player?.eliminated ? "Out · spectating" : "Live spectator"}</p><strong>{player?.name ?? `Room ${roomCode}`}</strong><span>{player?.eliminated ? "Your seat stays visible. Private hands stay hidden." : "Following the public table. Private hands stay hidden."}</span></div></div><div className="tp-spectator-glance" aria-live="polite"><div><span>Current turn</span><strong>{currentPlayerName}</strong>{formattedTime && <small>{formattedTime} remaining</small>}</div><div><span>Current bid</span><strong>{currentBid ? `${currentBid.quantity} × ${denominationNames[currentBid.denomination]}` : "No bid yet"}</strong></div><div><span>Round</span><strong>{round}</strong></div><div><span>Dice in play</span><strong>{totalDice}</strong></div></div><div className="tp-spectator-actions"><button type="button" onClick={onActivity}>Open activity</button></div></section>;
}

function OnlineHistory({ history, onClose }: { history: string[]; onClose: () => void }) {
  const feed = useRef<HTMLOListElement>(null);
  const chronologicalHistory = useMemo(() => [...history].reverse(), [history]);
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [chronologicalHistory]);
  return <aside className="tp-feed online-table-feed" aria-label="Game feed"><header className="tp-feed-header"><div><p>Table feed</p><span>Live online room</span></div><div className="tp-feed-status"><i aria-hidden="true" /><button type="button" aria-label="Collapse table feed" onClick={onClose}>›</button></div></header><ol className="online-table-feed-list" ref={feed} aria-label="Game feed">{chronologicalHistory.length ? chronologicalHistory.map((entry, index) => <li key={`${entry}-${index}`}><i aria-hidden="true" /><span>{entry}</span></li>) : <li><i aria-hidden="true" /><span>The room is ready.</span></li>}</ol><section className="tp-notification-note"><strong>Integrated notifications</strong><p>Bids, challenges, reconnects, and round results stay with the table.</p></section></aside>;
}

function RoundReveal({ view, playerId, connected, nextRound, onNext }: { view: PublicGameView; playerId?: string; connected: boolean; nextRound?: NextRound; onNext: () => void }) {
  const [showHands, setShowHands] = useState(false);
  const [resultResolved, setResultResolved] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const resolvedRoundRef = useRef<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, showHands);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowHands(true), 3_300);
    return () => window.clearTimeout(timer);
  }, [view.round, view.resolution?.kind]);
  useEffect(() => {
    if (!nextRound) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nextRound]);
  useEffect(() => {
    const resolution = view.resolution;
    if (!resolution) return;
    const round = `${view.round}:${resolution.kind}:${resolution.callerId}`;
    if (resolvedRoundRef.current === round) return;
    resolvedRoundRef.current = round;
    playSound("suspense");
    const timer = window.setTimeout(() => {
      setResultResolved(true);
      playSound(resolution.correct ? "rightGuess" : "wrongGuess");
      if (resolution.diceChanges.some((change) => change.after === 0)) playSound("dead");
    }, 2_100);
    return () => window.clearTimeout(timer);
  }, [view.players, view.resolution, view.round]);
  const resolution = view.resolution!;
  const caller = view.players.find((player) => player.id === resolution.callerId)?.name ?? "The caller";
  const bidder = view.players.find((player) => player.id === resolution.bidderId)?.name ?? "The bidder";
  const change = resolution.diceChanges[0];
  const changedPlayer = view.players.find((player) => player.id === change?.playerId)?.name ?? "A player";
  const callName = resolution.kind === "dudo" ? "Dudo" : "Calzo";
  const amount = Math.abs(change?.delta ?? 0);
  const consequence = change?.delta && change.delta > 0 ? `${changedPlayer} gains ${amount} ${amount === 1 ? "die" : "dice"}.` : `${changedPlayer} loses ${amount} ${amount === 1 ? "die" : "dice"}.`;
  const highlight = (value: number) => value === resolution.bid.denomination || (!view.paloFijo && resolution.bid.denomination !== 1 && value === 1);
  const resultState = resultResolved ? resolution.correct ? "right" : "wrong" : "pending";
  if (!showHands) return <div className={`round-result-overlay round-callout round-callout--${callName.toLowerCase()} round-callout--${resultState}`} role="status"><strong>{resultResolved && resolution.correct ? callName.toUpperCase() : [...callName.toUpperCase()].map((letter, index) => <i key={`${letter}-${index}`}>{letter}</i>)}</strong><span>{caller} calls it.</span></div>;
  const nextReady = Boolean(playerId && nextRound?.readyPlayerIds.includes(playerId));
  const remaining = nextRound ? Math.max(0, Math.ceil((nextRound.deadlineAt - clock) / 1_000)) : 0;
  const missingPlayers = view.players.filter((player) => !player.eliminated && !nextRound?.readyPlayerIds.includes(player.id)).map((player) => player.name);
  const revealedPlayers = view.players.filter((player) => player.hand?.length || player.tableDice.length);
  return <div className="round-result-overlay" role="dialog" aria-modal="true" aria-label="Round result" tabIndex={-1} ref={dialogRef}><section className={`reveal-panel round-result round-result--${resolution.correct ? "correct" : "wrong"}`}><div className="result-banner"><p>{caller} said {callName} to {bidder}’s bid.</p><h3>{resolution.bid.quantity} × {denominationNames[resolution.bid.denomination]} · {resolution.actualCount} there</h3><div className="online-result-verdict"><strong>{resolution.correct ? "Correct call." : "Wrong call."}</strong><span>{consequence}</span></div><small>Highlighted dice counted toward the bid.</small></div><div className="revealed-hands" style={{ "--online-hand-columns": Math.min(4, revealedPlayers.length) } as CSSProperties}>{revealedPlayers.map((player) => <div className="revealed-hand" key={player.id}><strong>{player.name}</strong><DiceRow dice={[...(player.hand ?? []), ...player.tableDice]} small highlight={highlight} /></div>)}</div>{playerId ? <div className="next-round-ready"><button className="button button--primary" disabled={!connected || nextReady} onClick={onNext}>{nextReady ? "Ready for next round" : "Next round"}</button><small>{nextRound ? missingPlayers.length ? `Waiting for ${missingPlayers.join(", ")} · auto-starts in ${remaining}s` : `Everyone is ready · auto-starts in ${remaining}s` : "Preparing the next round…"}</small></div> : <div className="next-round-ready"><small>{nextRound ? missingPlayers.length ? `Waiting for ${missingPlayers.join(", ")} · ${remaining}s` : `Next round in ${remaining}s` : "Preparing the next round…"}</small></div>}</section></div>;
}

function RoundShuffle({ view, playerId, connected, shuffle, shaking, clock, canShake, onShuffle }: { view: PublicGameView; playerId?: string; connected: boolean; shuffle: NonNullable<Shuffle>; shaking: boolean; clock: number; canShake: boolean; onShuffle: () => void }) {
  const activePlayers = view.players.filter((player) => !player.eliminated);
  const ready = new Set(shuffle.readyPlayerIds);
  const myReady = Boolean(playerId && ready.has(playerId));
  const remaining = Math.max(0, Math.ceil((shuffle.deadlineAt - clock) / 1_000));
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  useEffect(() => {
    if (view.round > 1) playSound("nextRound");
  }, [shuffle.round, view.round]);
  return <div className="round-shuffle-overlay" role="dialog" aria-modal="true" aria-label="Shuffle dice" tabIndex={-1} ref={dialogRef}><section className="round-shuffle-card"><p className="turn-kicker">Round {view.round} · First bid waits for every cup</p><h2>{canShake ? "Shake your dice" : "Cups are shaking"}</h2><p className="round-shuffle-copy">{canShake ? "Roll manually, then the table will settle into this round." : "Watching the active players settle into the round."}</p><strong className="shuffle-countdown">{remaining}s</strong><div className="round-shuffle-players">{activePlayers.map((player) => <div className={`round-shuffle-player${ready.has(player.id) ? " round-shuffle-player--ready" : ""}`} key={player.id}><strong>{player.name}</strong><small>{ready.has(player.id) ? "Dice shuffled" : player.id === playerId && canShake ? "Waiting for you" : "Waiting"}</small></div>)}</div>{canShake ? <button className="button button--primary round-shuffle-button" data-sound="shake" disabled={!connected || shaking || myReady} onClick={onShuffle}>{myReady ? "Dice shuffled" : shaking ? "Shuffling…" : "Shake my dice"}</button> : <p className="rules-note">Private hands remain hidden while you watch.</p>}</section></div>;
}

function GameSummary({ view, history, connected, isHost, onReturnToLobby, onExit }: { view: PublicGameView; history: string[]; connected: boolean; isHost: boolean; onReturnToLobby: () => void; onExit: () => void }) {
  const winner = view.players.find((player) => player.id === view.winnerId);
  const standings = [...view.players].sort((left, right) => Number(right.id === view.winnerId) - Number(left.id === view.winnerId) || right.diceCount - left.diceCount || left.name.localeCompare(right.name));
  const lastCall = history.find((entry) => !entry.endsWith("wins the match.")) ?? history[0];
  const confetti = Array.from({ length: 132 }, (_, index) => {
    const angle = (index * 137.508) * Math.PI / 180;
    const distance = 18 + (index % 11) * 7;
    return <i key={index} style={{ "--burst-x": `${Math.cos(angle) * distance}vw`, "--burst-y": `${Math.sin(angle) * distance * .62}vh`, "--drift": `${((index * 19) % 27) - 13}vw`, "--spin": `${540 + (index % 8) * 135}deg`, "--delay": `${(index % 24) * .028}s`, "--duration": `${2.9 + (index % 6) * .17}s`, width: `${5 + (index % 6)}px`, height: `${7 + (index % 8)}px` } as CSSProperties} />;
  });
  return <><div className="tp-confetti" aria-hidden="true">{confetti}</div><section className="tp-game-over online-game-over-card" role="dialog" aria-label="Game winner"><ConnectionNotice connected={connected} context="game" /><span className="tp-winner-crown" aria-hidden="true">♛</span><p>Game complete · {view.round} {view.round === 1 ? "round" : "rounds"}</p><h2>{winner?.name} wins!</h2><strong>The table is theirs.</strong><ol className="summary-standings">{standings.map((player, index) => <li key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><em>{player.id === view.winnerId ? "Winner" : player.diceCount ? `${player.diceCount} dice left` : "Out"}</em></li>)}</ol>{lastCall && <p className="summary-last-call">Last call: {lastCall}</p>}<div className="game-over-actions">{isHost && <button className="button button--primary" disabled={!connected} onClick={onReturnToLobby}>Return to lobby</button>}<button className="button button--ghost" disabled={!connected} onClick={onExit}>Leave game</button></div></section></>;
}

function OnlineTable({ view, roomCode, history, legal, playerId, playerStatuses, turnDeadlineAt, connected, error, isHost, announcement, shuffle, nextRound, paused, onPause, onShuffle, onReadyNextRound, onAction, onReturnToLobby, onExit }: { view: PublicGameView; roomCode: string; history: string[]; legal?: LegalActions; playerId?: string; playerStatuses: Array<{ id: string; connected: boolean; covered: boolean }>; turnDeadlineAt?: number; connected: boolean; error: string | null; isHost: boolean; announcement?: { text: string; playerId?: string }; shuffle?: Shuffle; nextRound?: NextRound; paused?: Pause; onPause: () => void; onShuffle: () => void; onReadyNextRound: () => void; onAction: (action: GameAction) => void; onReturnToLobby: () => void; onExit: () => void }) {
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  const isMyTurn = connected && !paused && view.phase === "playing" && view.currentPlayerId === playerId;
  const first = legal?.bids[0];
  const [quantity, setQuantity] = useState(first?.quantity ?? 1);
  const [denomination, setDenomination] = useState<Die>(first?.denomination ?? 2);
  const [shufflingDice, setShufflingDice] = useState(false);
  const [shuffleFaces, setShuffleFaces] = useState<Die[] | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem("cachito-reduced-motion") === "true");
  const [soundLevels, setSoundLevelsState] = useState<SoundLevels>(getSoundLevels);
  const [tableDiceMode, setTableDiceMode] = useState(false);
  const [tableDiceIndices, setTableDiceIndices] = useState<number[]>([]);
  const [tableRerolling, setTableRerolling] = useState(false);
  const [quantityManuallyAdjusted, setQuantityManuallyAdjusted] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const shuffleTimer = useRef<number | undefined>(undefined);
  const lastTurnRef = useRef<string | undefined>(undefined);
  const selectedTurnRef = useRef<string | undefined>(undefined);
  const lastPlayedDenominationRef = useRef<Die | undefined>(undefined);
  const shakeStopActiveRef = useRef(false);
  const pendingTurnPassRef = useRef(false);
  const turnPassTimerRef = useRef<number | undefined>(undefined);
  const clockSoundDeadlineRef = useRef<number | undefined>(undefined);
  const clockSoundRef = useRef<HTMLAudioElement | undefined>(undefined);
  const clockSoundTurnRef = useRef<string | null>(null);
  const winnerRef = useRef<string | undefined>(undefined);
  const [retainedRoundBid, setRetainedRoundBid] = useState<{ round: number; bid: NonNullable<PublicGameView["currentBid"]>; bidderId: string | null } | undefined>();
  const [roundBids, setRoundBids] = useState<{ round: number; bids: Record<string, NonNullable<PublicGameView["currentBid"]>> }>();
  const maxQuantity = useMemo(() => view.players.reduce((total, player) => total + player.diceCount, 0), [view]);
  const ownPlayer = view.players.find((player) => player.id === playerId);
  const ownHand = ownPlayer?.hand;
  const eliminated = ownPlayer?.eliminated ?? false;
  const statusById = new Map(playerStatuses.map((status) => [status.id, status.connected]));
  const offlineCoverById = new Map(playerStatuses.map((status) => [status.id, status.covered]));
  const secondsLeft = turnDeadlineAt ? Math.max(0, Math.ceil((turnDeadlineAt - clock) / 1_000)) : undefined;
  const paloDefault = view.paloFijo && !legal?.bids.some((bid) => bid.quantity === quantity && bid.denomination === denomination)
    ? legal?.bids.find((bid) => bid.quantity === quantity)?.denomination
    : undefined;
  const selectedDenomination = paloDefault ?? denomination;
  const chosen = legal?.bids.some((bid) => bid.quantity === quantity && bid.denomination === selectedDenomination) ?? false;
  const canPutDiceOnTable = Boolean(legal?.canPutDiceOnTable && ownHand);
  const roundBid = view.currentBid ?? (retainedRoundBid?.round === view.round ? retainedRoundBid.bid : null);
  const roundBidderId = view.lastBidderId ?? (retainedRoundBid?.round === view.round ? retainedRoundBid.bidderId : null);
  const totalDice = view.players.reduce((total, player) => total + player.diceCount, 0);
  const tableDicePlayers = view.players.filter((player) => player.tableDice.length > 0);
  const tableDice = tableDicePlayers.flatMap((player) => player.tableDice);
  const tablePlayers = playerId ? view.players.filter((player) => player.id !== playerId) : view.players;
  const tablePositions = playerId ? seatLayoutFor(view.players.length) : spectatorSeatLayoutFor(view.players.length);
  const formattedTime = secondsLeft === undefined ? undefined : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const activePlayers = view.players.filter((player) => !player.eliminated);
  const roundShuffling = view.phase === "playing" && shuffle?.round === view.round && shuffle.readyPlayerIds.length < activePlayers.length;
  const canShake = Boolean(playerId && !eliminated);
  const isMyActionTurn = isMyTurn && !roundShuffling;
  const controlsDisabled = !isMyActionTurn || !connected;
  const stopClockSound = useCallback(() => {
    const clockSound = clockSoundRef.current;
    if (!clockSound) return;
    clockSound.pause();
    clockSound.currentTime = 0;
    clockSoundRef.current = undefined;
    clockSoundTurnRef.current = null;
  }, []);
  const bid = () => {
    if (!connected) return;
    stopClockSound();
    const tableReroll = tableDiceMode && tableDiceIndices.length > 0;
    if (tableReroll) { playSound("tableDice"); setTableRerolling(true); window.setTimeout(() => setTableRerolling(false), 520); }
    lastPlayedDenominationRef.current = selectedDenomination;
    onAction({ type: "bid", playerId: "", bid: { quantity, denomination: selectedDenomination }, ...(tableDiceMode && tableDiceIndices.length ? { tableDiceIndices } : {}) });
    setTableDiceMode(false);
    setTableDiceIndices([]);
  };
  const call = (type: "dudo" | "calzo") => {
    if (!connected) return;
    stopClockSound();
    onAction({ type, playerId: "" });
  };
  const minimumBidFor = useCallback((die: Die) => legal?.bids.filter((candidate) => candidate.denomination === die).reduce<Bid | undefined>((minimum, candidate) => !minimum || candidate.quantity < minimum.quantity ? candidate : minimum, undefined), [legal]);
  const chooseDenomination = (die: Die) => {
    const minimum = minimumBidFor(die);
    if (!minimum) return;
    playSound("denomination");
    setDenomination(die);
    if (!quantityManuallyAdjusted) setQuantity(minimum.quantity);
  };
  const shakeDice = () => {
    if (!connected) return;
    if (!ownHand) return onShuffle();
    playSound("shake");
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
        shakeStopActiveRef.current = true;
        const shakeStop = playSound("shakeStop");
        const finishShakeStop = () => {
          shakeStopActiveRef.current = false;
          if (!pendingTurnPassRef.current) return;
          pendingTurnPassRef.current = false;
          turnPassTimerRef.current = window.setTimeout(() => playSound("turnPass"), 500);
        };
        shakeStop.addEventListener("ended", finishShakeStop, { once: true });
        shakeStop.addEventListener("error", finishShakeStop, { once: true });
        onShuffle();
        shuffleTimer.current = window.setTimeout(() => setShufflingDice(false), 500);
      }
    };
    tumble();
  };
  useEffect(() => () => { if (shuffleTimer.current) window.clearTimeout(shuffleTimer.current); if (turnPassTimerRef.current) window.clearTimeout(turnPassTimerRef.current); stopClockSound(); }, [stopClockSound]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
    if (view.currentBid) {
      setRetainedRoundBid((current) => {
        const next = { round: view.round, bid: view.currentBid!, bidderId: view.lastBidderId };
        return current?.round === next.round && current.bid.quantity === next.bid.quantity && current.bid.denomination === next.bid.denomination && current.bidderId === next.bidderId ? current : next;
      });
      return;
    }
    setRetainedRoundBid((current) => current?.round !== view.round ? undefined : current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [view.currentBid, view.lastBidderId, view.round]);
  useEffect(() => {
    if (!turnDeadlineAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [turnDeadlineAt]);
  useEffect(() => {
    if (!isMyTurn || !legal?.bids.length || !view.currentPlayerId) return;
    const turn = `${view.round}:${view.currentPlayerId}:${view.currentBid?.quantity ?? 0}:${view.currentBid?.denomination ?? 0}`;
    if (selectedTurnRef.current === turn) return;
    const preferred = lastPlayedDenominationRef.current;
    const minimum = preferred ? minimumBidFor(preferred) : undefined;
    const fallback = legal.bids.reduce((minimumBid, candidate) => candidate.quantity < minimumBid.quantity ? candidate : minimumBid);
    setDenomination((minimum ?? fallback).denomination);
    setQuantity((minimum ?? fallback).quantity);
    setQuantityManuallyAdjusted(false);
    setTableDiceMode(false);
    setTableDiceIndices([]);
    selectedTurnRef.current = turn;
  }, [isMyTurn, legal, minimumBidFor, view.currentBid, view.currentPlayerId, view.round]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRoundBids((current) => {
        if (current?.round !== view.round) return view.currentBid && view.lastBidderId ? { round: view.round, bids: { [view.lastBidderId]: view.currentBid } } : { round: view.round, bids: {} };
        if (!view.currentBid || !view.lastBidderId) return current;
        const prior = current.bids[view.lastBidderId];
        if (prior?.quantity === view.currentBid.quantity && prior.denomination === view.currentBid.denomination) return current;
        return { ...current, bids: { ...current.bids, [view.lastBidderId]: view.currentBid } };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [view.currentBid, view.lastBidderId, view.round]);
  useEffect(() => {
    const roundOpen = view.phase === "playing" && (!shuffle || shuffle.round !== view.round || shuffle.readyPlayerIds.length >= view.players.filter((player) => !player.eliminated).length);
    if (!roundOpen || !view.currentPlayerId) return;
    const turn = `${view.round}:${view.currentPlayerId}`;
    if (lastTurnRef.current !== turn) {
      if (shakeStopActiveRef.current) pendingTurnPassRef.current = true;
      else playSound("turnPass");
      lastTurnRef.current = turn;
    }
  }, [shuffle, view]);
  useEffect(() => {
    if (!turnDeadlineAt || secondsLeft === undefined || secondsLeft > 10 || clockSoundDeadlineRef.current === turnDeadlineAt) return;
    clockSoundDeadlineRef.current = turnDeadlineAt;
    stopClockSound();
    const clockSound = playSound("clock");
    clockSoundRef.current = clockSound;
    clockSoundTurnRef.current = view.currentPlayerId;
    clockSound.addEventListener("ended", () => { if (clockSoundRef.current === clockSound) clockSoundRef.current = undefined; }, { once: true });
  }, [secondsLeft, stopClockSound, turnDeadlineAt, view.currentPlayerId]);
  useEffect(() => {
    if (paused || view.phase !== "playing" || view.currentPlayerId !== clockSoundTurnRef.current) stopClockSound();
  }, [paused, stopClockSound, view.currentPlayerId, view.phase]);
  useEffect(() => {
    localStorage.setItem("cachito-reduced-motion", String(reducedMotion));
  }, [reducedMotion]);
  useEffect(() => {
    if (!settingsOpen) return;
    const popover = settingsPopoverRef.current;
    const button = settingsButtonRef.current;
    if (!popover || !button) return;
    popover.querySelector<HTMLElement>("input, button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      button.focus();
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !popover.contains(event.target) && !button.contains(event.target)) setSettingsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [settingsOpen]);
  useEffect(() => {
    if (view.phase !== "gameOver" || !view.winnerId || winnerRef.current === view.winnerId) return;
    winnerRef.current = view.winnerId;
    playSound("winner");
  }, [view.phase, view.winnerId]);
  const changeSoundLevel = (key: keyof SoundLevels, value: number) => {
    const next = { ...soundLevels, [key]: value };
    setSoundLevelsState(next);
    setSoundLevels(next);
  };
  return <main className={`table-prototype-shell online-live-table${reducedMotion ? " game-shell--reduced-motion" : ""}`}>
    <header className="tp-header online-table-header"><div><p className="tp-eyebrow">Online table · Room {roomCode}</p><h1>Cachito</h1></div><div className="tp-header-actions"><span className={`online-connection-pill${connected ? "" : " online-connection-pill--offline"}`}>{connected ? "Live" : "Reconnecting"}</span><span className="online-round-pill">Round {view.round}{view.paloFijo ? " · Palo fijo" : ""}</span><button className="tp-quiet-button tp-feed-toggle" type="button" aria-expanded={feedOpen} onClick={() => setFeedOpen((open) => !open)}>Activity <span>{history.length}</span></button><div className="online-settings-anchor"><button className="settings-button" ref={settingsButtonRef} aria-expanded={settingsOpen} aria-controls="online-game-settings" aria-label="Game settings" onClick={() => setSettingsOpen((open) => !open)}>⚙</button>{settingsOpen && <div className="settings-popover" id="online-game-settings" ref={settingsPopoverRef} role="dialog" aria-label="Game settings" tabIndex={-1}><strong>Settings</strong><label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label><label className="sound-slider">Sound FX <input type="range" min="0" max="1" step="0.05" value={soundLevels.effects} onChange={(event) => changeSoundLevel("effects", Number(event.target.value))} /><output>{Math.round(soundLevels.effects * 100)}%</output></label><label className="sound-slider">Music <input type="range" min="0" max="1" step="0.05" value={soundLevels.music} onChange={(event) => changeSoundLevel("music", Number(event.target.value))} /><output>{Math.round(soundLevels.music * 100)}%</output></label>{playerId && view.phase !== "gameOver" && <button className="button button--ghost settings-pause" disabled={!connected} onClick={onPause}>{paused ? "Resume game" : "Pause game"}</button>}<button className="button button--ghost settings-exit" disabled={!connected} onClick={onExit}>Exit to menu</button></div>}</div></div></header>
    <ConnectionNotice connected={connected} context="game" />
    <div className={`tp-play-layout${feedOpen ? " tp-play-layout--feed-open" : " tp-play-layout--feed-closed"}`}>
      <section className="tp-stage" aria-label={`${view.players.length}-player online table`}>
        <div className={`tp-table${shufflingDice ? " tp-table--shuffling" : ""}`}>
          <div className="tp-table-grain" aria-hidden="true" />
          <div className="tp-round-meta"><span>Room {roomCode}</span><strong>Round {view.round}</strong><span>{view.paloFijo ? "Palo fijo" : "Normal play"}</span></div>
          {tablePlayers.map((player, index) => <OnlineSeat key={player.id} player={player} position={tablePositions[index]} currentTurn={!roundShuffling && view.phase === "playing" && view.currentPlayerId === player.id} latestBid={roundBids?.round === view.round ? roundBids.bids[player.id] : undefined} diceAmountsVisible={view.rules.diceAmountsVisible} connected={statusById.get(player.id) !== false} covered={offlineCoverById.get(player.id) === true} announcement={announcement?.playerId === player.id ? announcement.text : undefined} />)}
          <div className="tp-table-center">
            <OnlineDiceInventory inPlay={totalDice} startingTotal={view.players.length * 5} />
            {roundBid ? <section className="tp-current-bid" aria-label={`Current bid: ${roundBid.quantity} ${denominationNames[roundBid.denomination]}`}><p>{view.players.find((player) => player.id === roundBidderId)?.name ?? "Current"}’s bid</p><div><strong>{roundBid.quantity}</strong><span>×</span><b>{dieGlyphs[roundBid.denomination]}</b></div><h2>{denominationNames[roundBid.denomination]}</h2>{formattedTime && <div className={`tp-turn-timer${secondsLeft! <= 10 ? " tp-turn-timer--urgent" : ""}`} role="timer" aria-label={`${secondsLeft} seconds remaining`}><span>{formattedTime}</span><small>{isMyActionTurn ? "your turn" : "turn timer"}</small></div>}</section> : <section className="tp-current-bid tp-current-bid--empty"><p>Opening bid</p><h2>{current?.name ?? (view.phase === "gameOver" ? "Game complete" : "Table")}</h2>{formattedTime ? <div className={`tp-turn-timer${secondsLeft! <= 10 ? " tp-turn-timer--urgent" : ""}`} role="timer" aria-label={`${secondsLeft} seconds remaining`}><span>{formattedTime}</span><small>{isMyActionTurn ? "your turn" : "turn timer"}</small></div> : <span className="tp-clock">Cups first</span>}</section>}
            <section className={`tp-exposed-dice${tableDice.length ? "" : " tp-exposed-dice--empty"}`}><div><span>Dice on table</span><small>{tableDicePlayers.length ? tableDicePlayers.map((player) => player.name).join(" · ") : "None yet"}</small></div>{tableDice.length > 0 && <DiceRow dice={tableDice} small />}</section>
          </div>
          {view.paloFijo && <div className="online-palo-banner"><strong>Palo fijo</strong><span>Aces are not wild{view.rules.paloFijoBlindDice && (ownPlayer?.diceCount ?? 0) > 1 ? " · your hand stays hidden" : ""}</span></div>}
          {paused && <div className="game-paused-overlay" role="status"><strong>Game paused</strong><span>{paused.pausedByName} paused the table. Any player can resume it from Settings.</span></div>}
          {view.phase === "reveal" && <RoundReveal key={`${view.round}:${view.resolution?.kind}:${view.resolution?.callerId}`} view={view} playerId={playerId} connected={connected} nextRound={nextRound} onNext={onReadyNextRound} />}
          {roundShuffling && !shufflingDice && <RoundShuffle view={view} playerId={playerId} connected={connected} shuffle={shuffle!} shaking={shufflingDice} clock={clock} canShake={canShake} onShuffle={shakeDice} />}
          {view.phase === "gameOver" && <GameSummary view={view} history={history} connected={connected} isHost={isHost} onReturnToLobby={onReturnToLobby} onExit={onExit} />}
          {error && <p className="tp-engine-error" role="alert">{error}</p>}
        </div>
        {view.phase !== "gameOver" && (ownPlayer && !eliminated ? <section className={`tp-action-dock${isMyActionTurn ? " tp-action-dock--your-turn" : ""}`} aria-label="Your hand and turn controls"><div className="tp-player-hud"><div className="tp-hud-owner"><div className="tp-avatar" aria-hidden="true">{initials(ownPlayer.name)}</div><div><strong>{ownPlayer.name}</strong><small>Your seat</small><span>{!connected ? "Reconnecting" : roundShuffling ? "Waiting for cups" : isMyActionTurn ? "Your turn · make a move" : `Waiting for ${current?.name ?? "the table"}`}</span></div></div><div className="tp-hand"><div><p>{ownPlayer.name}’s hand</p></div>{ownHand ? <DiceRow dice={shufflingDice && shuffleFaces ? shuffleFaces : ownHand} className={`${shufflingDice ? "dice-row--shuffling" : ""}${tableRerolling ? " dice-row--table-reroll" : ""}`.trim()} selectedIndices={tableDiceMode ? tableDiceIndices : undefined} onDieClick={isMyActionTurn ? (value, index) => tableDiceMode ? setTableDiceIndices((selected) => selected.includes(index) ? selected.filter((entry) => entry !== index) : selected.length < ownHand.length - 1 ? [...selected, index] : selected) : chooseDenomination(value as Die) : undefined} getDieButtonLabel={(value, index, selected) => tableDiceMode ? `${selected ? "Remove" : "Choose"} die ${index + 1} for the table` : `Choose ${denominationNames[value as Die]} from die ${index + 1}`} /> : <p className="online-hidden-hand">Hand hidden this Palo Fijo round.</p>}{tableDiceMode && <small className="tp-table-selection-help">Select up to {Math.max(1, (ownHand?.length ?? 1) - 1)} dice; one must stay private.</small>}</div></div><div className="tp-bid-builder"><div className="tp-quantity"><span>Quantity</span><div><button type="button" aria-label="Decrease quantity" disabled={controlsDisabled || quantity <= 1} onClick={() => { playSound("numDown"); setQuantity((value) => Math.max(1, value - 1)); setQuantityManuallyAdjusted(true); }}>−</button><strong>{quantity}</strong><button type="button" aria-label="Increase quantity" disabled={controlsDisabled || quantity >= maxQuantity} onClick={() => { playSound("numUp"); setQuantity((value) => Math.min(maxQuantity, value + 1)); setQuantityManuallyAdjusted(true); }}>+</button></div></div><div className="tp-denominations" aria-label="Choose denomination">{([1, 2, 3, 4, 5, 6] as Die[]).map((die) => <button type="button" key={die} aria-label={`Choose ${denominationNames[die]}`} aria-pressed={selectedDenomination === die} disabled={controlsDisabled || !minimumBidFor(die)} onClick={() => chooseDenomination(die)}><OnlineDenominationFace value={die} /></button>)}</div></div><div className="tp-actions"><button className="tp-call tp-call--dudo" type="button" disabled={controlsDisabled || !legal?.canDudo} onClick={() => call("dudo")}>Dudo</button><button className="tp-call tp-call--calzo" type="button" disabled={controlsDisabled || !legal?.canCalzo} onClick={() => call("calzo")}>Calzo</button><button className="tp-table-dice-action" type="button" aria-pressed={tableDiceMode} disabled={controlsDisabled || (!canPutDiceOnTable && !tableDiceMode)} onClick={() => { setTableDiceMode((active) => !active); setTableDiceIndices([]); playSound("tableDice"); }}>{tableDiceMode ? "Cancel table dice" : view.rules.tableDiceEnabled ? "Put dice on table" : "Table dice off"}</button><button className="tp-raise" type="button" disabled={controlsDisabled || !chosen || (tableDiceMode && !tableDiceIndices.length)} onClick={bid}>{tableDiceMode ? `Bid & put ${tableDiceIndices.length || "…"} on table` : roundBid ? `Raise to ${quantity} ${denominationNames[selectedDenomination]}` : `Bid ${quantity} ${denominationNames[selectedDenomination]}`}</button></div></section> : <OnlineSpectatorDock roomCode={roomCode} player={ownPlayer} currentPlayerName={current?.name ?? (view.phase === "reveal" ? "Round result" : "Table")} currentBid={roundBid} round={view.round} totalDice={totalDice} formattedTime={formattedTime} onActivity={() => setFeedOpen(true)} />)}
      </section>
      {feedOpen && <button className="tp-feed-backdrop" type="button" aria-label="Close table feed" onClick={() => setFeedOpen(false)} />}
      <OnlineHistory history={history} onClose={() => setFeedOpen(false)} />
    </div>
  </main>;
}
