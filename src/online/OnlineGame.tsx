import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Die, GameAction, GameRules, LegalActions, PublicGameView } from "../engine";
import { DiceRow } from "../ui/Dice";
import { GameSettings } from "../ui/GameSettings";
import { getSoundLevels, playSound, setSoundLevels, type SoundLevels } from "../ui/sound";
import type { OnlineClientMessage, OnlineServerMessage } from "./protocol";

type Lobby = Extract<OnlineServerMessage, { type: "lobby" }>;
type EntryMode = "choose" | "create" | "join" | "watch";
type Shuffle = Extract<OnlineServerMessage, { type: "state" }>['shuffle'];
type NextRound = Extract<OnlineServerMessage, { type: "state" }>['nextRound'];
type Pause = Extract<OnlineServerMessage, { type: "state" }>['paused'];
const denominationNames: Record<Die, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const storageKey = "cachito-online-session";

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
  return <OnlineErrorBoundary onExit={onExit} onReconnect={() => setRecoveryKey((key) => key + 1)} recoveryKey={recoveryKey}><OnlineGameContent key={recoveryKey} onExit={onExit} restoreSavedSession={recoveryKey > 0} /></OnlineErrorBoundary>;
}

function OnlineGameContent({ onExit, restoreSavedSession = false }: { onExit: () => void; restoreSavedSession?: boolean }) {
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
        setConnected(true);
        if (shouldRestore) {
          const saved = savedSession();
          if (saved) send(connection, { type: "join-room", roomCode: saved.roomCode, name: localStorage.getItem("cachito-display-name") ?? "", reconnectToken: saved.reconnectToken });
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
          if (/room does not exist|idle room expired/i.test(message.message)) { localStorage.removeItem(storageKey); setView(null); setLobby(null); setLegal(undefined); setShuffle(undefined); setNextRound(undefined); setPaused(undefined); }
        }
        if (message.type === "joined") {
          setRoomCode(message.roomCode); setPlayerId(message.playerId); setHostPlayerId(message.hostPlayerId); setError(null);
          if (message.playerId && message.reconnectToken) localStorage.setItem(storageKey, JSON.stringify({ roomCode: message.roomCode, reconnectToken: message.reconnectToken }));
        }
        if (message.type === "lobby") { setLobby(message); setHostPlayerId(message.hostPlayerId); setView(null); setLegal(undefined); setAnnouncement(undefined); setShuffle(undefined); setNextRound(undefined); setPaused(undefined); setPlayerStatuses([]); setTurnDeadlineAt(undefined); }
        if (message.type === "state") { setView(message.view); setLobby(null); setLegal(message.legalActions); setHistory(message.history); setAnnouncement(message.announcement); setShuffle(message.shuffle); setNextRound(message.nextRound); setPaused(message.paused); setPlayerStatuses(message.playerStatuses); setTurnDeadlineAt(message.turnDeadlineAt); }
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
    if (!spectator) localStorage.setItem("cachito-display-name", name.trim());
    send(socket.current, { type: "join-room", roomCode, name, spectator, ...(saved?.roomCode === roomCode.toUpperCase() ? { reconnectToken: saved.reconnectToken } : {}) });
  };

  if (!lobby && !view) return <><OnlineEntry mode={entryMode} name={name} roomCode={roomCode} connected={connected} error={error} onExit={onExit} onChoose={setEntryMode} onName={setName} onRoomCode={setRoomCode} onCreate={create} onJoin={() => join(false)} onWatch={() => join(true)} /><div className="menu-settings"><GameSettings /></div></>;
  if (lobby) return <><LobbyScreen lobby={lobby} playerId={playerId} error={error} onStart={() => send(socket.current, { type: "start-game" })} onAddBot={() => send(socket.current, { type: "add-bot" })} onRemoveBot={(botId) => send(socket.current, { type: "remove-bot", playerId: botId })} onKickPlayer={(targetId) => send(socket.current, { type: "kick-player", playerId: targetId })} onRename={(nextName) => { localStorage.setItem("cachito-display-name", nextName); send(socket.current, { type: "rename-player", name: nextName }); }} onProposeRules={(rules) => send(socket.current, { type: "propose-rules", rules })} onApproveRules={() => send(socket.current, { type: "approve-rules" })} onExit={onExit} /><div className="menu-settings"><GameSettings /></div></>;
  return <OnlineTable view={view!} roomCode={roomCode} history={history} legal={legal} playerId={playerId} playerStatuses={playerStatuses} turnDeadlineAt={turnDeadlineAt} error={error} isHost={playerId === hostPlayerId} announcement={announcement} shuffle={shuffle} nextRound={nextRound} paused={paused} onExit={onExit} onPause={() => send(socket.current, { type: "toggle-pause" })} onShuffle={() => send(socket.current, { type: "shuffle-dice" })} onReadyNextRound={() => send(socket.current, { type: "ready-next-round" })} onAction={(action) => send(socket.current, { type: "action", action })} onReturnToLobby={() => send(socket.current, { type: "return-to-lobby" })} />;
}

function OnlineEntry({ mode, name, roomCode, connected, error, onExit, onChoose, onName, onRoomCode, onCreate, onJoin, onWatch }: { mode: EntryMode; name: string; roomCode: string; connected: boolean; error: string | null; onExit: () => void; onChoose: (mode: EntryMode) => void; onName: (name: string) => void; onRoomCode: (code: string) => void; onCreate: () => void; onJoin: () => void; onWatch: () => void }) {
  if (mode === "choose") return <main className="setup-shell"><section className="setup-card start-card"><button className="button button--ghost back-button" onClick={onExit}>← Back</button><h1>Play online</h1><p className="intro">Private rooms for your group. You can also follow along as a spectator.</p><div className="play-mode-grid"><button className="play-mode-card" onClick={() => onChoose("create")}><span className="play-mode-icon">＋</span><strong>Create a room</strong><small>Start a new table and invite friends.</small></button><button className="play-mode-card" onClick={() => onChoose("join")}><span className="play-mode-icon">→</span><strong>Join a room</strong><small>Take an open seat at a friend's table.</small></button></div><button className="button button--ghost setup-learning-button" onClick={() => onChoose("watch")}>Watch a game</button>{!connected && <p className="rules-note">Connecting to the game server…</p>}</section></main>;
  const spectator = mode === "watch";
  return <main className="setup-shell"><section className="setup-card online-entry-card"><button className="button button--ghost back-button" onClick={() => onChoose("choose")}>← Back</button><h1>{mode === "create" ? "Create a room" : spectator ? "Watch a game" : "Join a room"}</h1><p className="intro">{mode === "create" ? "Your name will appear as the host in the lobby." : spectator ? "Room codes let you follow the public table without joining it." : "Enter your name and the room code shared by the host."}</p>{!spectator && <><label className="field-label" htmlFor="online-name">Your name</label><input id="online-name" value={name} maxLength={24} onChange={(event) => onName(event.target.value)} placeholder="Your name" /></>}{mode !== "create" && <><label className="field-label" htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} maxLength={5} onChange={(event) => onRoomCode(event.target.value.toUpperCase())} placeholder="ABCDE" /></>}<button className="button button--primary online-entry-action" disabled={!connected || (spectator ? !roomCode.trim() : !name.trim() || (mode !== "create" && !roomCode.trim()))} onClick={mode === "create" ? onCreate : spectator ? onWatch : onJoin}>{mode === "create" ? "Create room" : spectator ? "Watch game" : "Join room"}</button>{error && <p className="form-error" role="alert">{error}</p>}</section></main>;
}

function LobbyScreen({ lobby, playerId, error, onStart, onAddBot, onRemoveBot, onKickPlayer, onRename, onProposeRules, onApproveRules, onExit }: { lobby: Lobby; playerId?: string; error: string | null; onStart: () => void; onAddBot: () => void; onRemoveBot: (botId: string) => void; onKickPlayer: (playerId: string) => void; onRename: (name: string) => void; onProposeRules: (rules: GameRules) => void; onApproveRules: () => void; onExit: () => void }) {
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const ownPlayer = lobby.players.find((player) => player.id === playerId);
  const [rename, setRename] = useState("");
  const copyInvite = async () => {
    try { await navigator.clipboard?.writeText(new URL(`/join/${lobby.roomCode}`, location.origin).toString()); setCopied(true); } catch { setCopied(false); }
  };
  const host = playerId === lobby.hostPlayerId;
  if (rulesOpen) return <LobbyRulesScreen key={JSON.stringify(lobby.pendingRules?.rules ?? lobby.rules)} lobby={lobby} playerId={playerId} onBack={() => setRulesOpen(false)} onPropose={onProposeRules} onApprove={onApproveRules} />;
  return <main className="setup-shell"><section className="setup-card lobby-card"><button className="button button--ghost back-button" onClick={onExit}>← Leave room</button><p className="eyebrow">Private room</p><h1>{lobby.roomCode}</h1><p className="intro">Send one link and friends land straight at this room. {lobby.spectatorCount} watching.</p><button className="button button--ghost copy-code" onClick={() => void copyInvite()}>{copied ? "Invite copied" : "Copy invite link"}</button>{ownPlayer && <form className="lobby-rename" onSubmit={(event) => { event.preventDefault(); const nextName = rename.trim(); if (nextName && nextName !== ownPlayer.name) onRename(nextName); setRename(""); }}><label htmlFor="rename-player">Your name</label><input id="rename-player" value={rename || ownPlayer.name} maxLength={24} onChange={(event) => setRename(event.target.value)} /><button className="button button--ghost" type="submit">Rename</button></form>}<div className="lobby-rules-strip"><div><strong>Game rules</strong><span>{lobby.pendingRules ? "Approval needed" : "All set"}</span></div><button className="button button--ghost" onClick={() => setRulesOpen(true)}>{host ? "Edit rules" : "View rules"}</button></div><div className="setup-heading"><div><h2>Players</h2><p>{lobby.players.length}/6 seated</p></div>{host && <button className="button button--ghost lobby-add-bot" disabled={lobby.players.length >= 6} onClick={onAddBot}>+ Add bot</button>}</div><div className="name-list lobby-players">{lobby.players.map((player) => <div className="lobby-player" key={player.id}><span className="seat-number">{player.isBot ? "◆" : player.connected ? "●" : "○"}</span><span><strong>{player.name}</strong>{player.id === lobby.hostPlayerId && <small>Host</small>}{player.isBot && <small>Bot</small>}</span>{host && player.isBot ? <button className="lobby-remove-bot" onClick={() => onRemoveBot(player.id)} aria-label={`Remove ${player.name}`}>Remove</button> : host && player.id !== playerId ? <button className="lobby-remove-bot" onClick={() => onKickPlayer(player.id)} aria-label={`Kick ${player.name}`}>Kick</button> : <em>{player.connected ? "Ready" : "Offline"}</em>}</div>)}</div>{host && <button className="button button--primary online-entry-action" disabled={lobby.players.length < 2 || Boolean(lobby.pendingRules)} onClick={onStart}>{lobby.pendingRules ? "Waiting for rule approval" : "Start game"}</button>}{!host && <p className="rules-note">{lobby.pendingRules ? "Open Game rules to approve the host's proposal." : "Waiting for the host to start the game."}</p>}{error && <p className="form-error">{error}</p>}</section></main>;
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

function LobbyRulesScreen({ lobby, playerId, onBack, onPropose, onApprove }: { lobby: Lobby; playerId?: string; onBack: () => void; onPropose: (rules: GameRules) => void; onApprove: () => void }) {
  const host = playerId === lobby.hostPlayerId;
  const proposal = lobby.pendingRules;
  const [draft, setDraft] = useState<GameRules>(proposal?.rules ?? lobby.rules);
  const approved = Boolean(playerId && proposal?.approvalPlayerIds.includes(playerId));
  const proposer = lobby.players.find((player) => player.id === proposal?.proposedById)?.name ?? "The host";
  const selected = <div className="lobby-rule-summary">{ruleSummary(lobby.rules).map((rule) => <span key={rule}>{rule}</span>)}</div>;
  return <main className="setup-shell"><section className="setup-card lobby-card rules-page"><button className="button button--ghost back-button" onClick={onBack}>← Back to room</button><p className="eyebrow">Room rules</p><h1>Game Rules</h1><p className="intro">The host can propose changes; every seated player must approve before they apply. Bots approve automatically.</p><section className="rules-section"><div className="rules-section-heading"><p className="turn-kicker">In play</p><h2>Current Rules</h2></div>{selected}</section>{host && <section className="rules-section rule-editor"><div className="rules-section-heading"><p className="turn-kicker">Host controls</p><h2>Propose Changes</h2></div><div className="rule-fields"><label><span>Time Per Play</span><select value={draft.turnTimeSeconds} onChange={(event) => setDraft({ ...draft, turnTimeSeconds: Number(event.target.value) as GameRules["turnTimeSeconds"] })}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={90}>1 minute 30 seconds</option></select></label><label><span>Aces Conversion</span><select value={draft.acesConversion} onChange={(event) => setDraft({ ...draft, acesConversion: event.target.value as GameRules["acesConversion"] })}><option value="half">Half</option><option value="halfPlusOne">Half + 1</option></select></label><label><span>Palo Fijo Starts At</span><select value={draft.paloFijoTrigger} onChange={(event) => setDraft({ ...draft, paloFijoTrigger: event.target.value as GameRules["paloFijoTrigger"] })}><option value="oneDie">1 die</option><option value="twoDice">2 dice</option></select></label><label><span>Blind Dice in Palo Fijo</span><select value={String(draft.paloFijoBlindDice)} onChange={(event) => setDraft({ ...draft, paloFijoBlindDice: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></label><label><span>Show Dice Amounts</span><select value={String(draft.diceAmountsVisible)} onChange={(event) => setDraft({ ...draft, diceAmountsVisible: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></label><label><span>Allow Table Dice</span><select value={String(draft.tableDiceEnabled)} onChange={(event) => setDraft({ ...draft, tableDiceEnabled: event.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></label></div><button className="button button--primary rule-propose-button" onClick={() => onPropose(draft)}>{proposal ? "Replace Proposal" : "Propose Rule Changes"}</button></section>}{proposal && <section className="rule-proposal"><p className="turn-kicker">Awaiting unanimous approval</p><h2>{proposer}'s Proposal</h2><div className="lobby-rule-summary">{ruleSummary(proposal.rules).map((rule) => <span key={rule}>{rule}</span>)}</div><p>{proposal.approvalPlayerIds.length}/{lobby.players.length} players approved</p><div className="rule-approvals">{lobby.players.map((player) => <span className={proposal.approvalPlayerIds.includes(player.id) ? "approved" : "pending"} key={player.id}>{proposal.approvalPlayerIds.includes(player.id) ? "✓" : "○"} {player.name}</span>)}</div>{playerId && !approved && <button className="button button--primary" onClick={onApprove}>Approve These Rules</button>}{approved && <p className="rules-note">You approved this proposal.</p>}</section>}</section></main>;
}

function FaceMark({ value, label = false }: { value: Die; label?: boolean }) {
  const pips: Record<Die, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return <span className="face-mark" role="img" aria-label={denominationNames[value]}>{Array.from({ length: 9 }, (_, index) => <i className={pips[value].includes(index) ? "face-pip" : "face-pip face-pip--empty"} key={index} />)}{label && <small>{denominationNames[value]}</small>}</span>;
}

function OnlineHistory({ history }: { history: string[] }) {
  const feed = useRef<HTMLOListElement>(null);
  const chronologicalHistory = useMemo(() => [...history].reverse(), [history]);
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [chronologicalHistory]);
  return <aside className="sidebar online-sidebar"><section className="side-card online-history"><div className="online-history-heading"><div><p className="turn-kicker">Live table</p><h2>Game feed</h2></div><span>{history.length}</span></div><ol className="log-list" ref={feed} aria-label="Game feed">{chronologicalHistory.length ? chronologicalHistory.map((entry, index) => <li className="log-item" key={`${entry}-${index}`}>{entry}</li>) : <li className="log-item">The room is ready.</li>}</ol></section><section className="side-card rules-note"><h2>At the table</h2><p>Every bid and challenge appears here for everyone to follow.</p></section></aside>;
}

function RoundReveal({ view, playerId, nextRound, onNext }: { view: PublicGameView; playerId?: string; nextRound?: NextRound; onNext: () => void }) {
  const [showHands, setShowHands] = useState(false);
  const [resultResolved, setResultResolved] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const resolvedRoundRef = useRef<string | undefined>(undefined);
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
  const consequence = change?.delta && change.delta > 0 ? `${changedPlayer} gains ${change.delta} die.` : `${changedPlayer} loses ${Math.abs(change?.delta ?? 0)} die.`;
  const highlight = (value: number) => value === resolution.bid.denomination || (!view.paloFijo && resolution.bid.denomination !== 1 && value === 1);
  const resultState = resultResolved ? resolution.correct ? "right" : "wrong" : "pending";
  if (!showHands) return <div className={`round-result-overlay round-callout round-callout--${callName.toLowerCase()} round-callout--${resultState}`} role="status"><strong>{resultResolved && resolution.correct ? callName.toUpperCase() : [...callName.toUpperCase()].map((letter, index) => <i key={`${letter}-${index}`}>{letter}</i>)}</strong><span>{caller} calls it.</span></div>;
  const nextReady = Boolean(playerId && nextRound?.readyPlayerIds.includes(playerId));
  const remaining = nextRound ? Math.max(0, Math.ceil((nextRound.deadlineAt - clock) / 1_000)) : 0;
  const missingPlayers = view.players.filter((player) => !player.eliminated && !nextRound?.readyPlayerIds.includes(player.id)).map((player) => player.name);
  return <div className="round-result-overlay" role="dialog" aria-modal="true" aria-label="Round result"><section className="reveal-panel round-result"><div className="result-banner"><p className="turn-kicker">{callName} · {caller} → {bidder}</p><h3>{resolution.bid.quantity} × {denominationNames[resolution.bid.denomination]} · {resolution.actualCount} there</h3><p>{resolution.correct ? "Correct call." : "Wrong call."} {consequence}</p></div><div className="revealed-hands">{view.players.filter((player) => player.hand?.length).map((player) => <div className="revealed-hand" key={player.id}><strong>{player.name}</strong><DiceRow dice={player.hand!} small highlight={highlight} /></div>)}</div>{playerId && <div className="next-round-ready"><button className="button button--primary" disabled={nextReady} onClick={onNext}>{nextReady ? "Ready for next round" : "Next round"}</button><small>{nextRound ? missingPlayers.length ? `Waiting for ${missingPlayers.join(", ")} · auto-starts in ${remaining}s` : `Everyone is ready · auto-starts in ${remaining}s` : "Preparing the next round…"}</small></div>}</section></div>;
}

function RoundShuffle({ view, playerId, shuffle, shaking, clock, onShuffle }: { view: PublicGameView; playerId?: string; shuffle: NonNullable<Shuffle>; shaking: boolean; clock: number; onShuffle: () => void }) {
  const activePlayers = view.players.filter((player) => !player.eliminated);
  const ready = new Set(shuffle.readyPlayerIds);
  const myReady = Boolean(playerId && ready.has(playerId));
  const remaining = Math.max(0, Math.ceil((shuffle.deadlineAt - clock) / 1_000));
  useEffect(() => {
    if (view.round > 1) playSound("nextRound");
  }, [shuffle.round, view.round]);
  return <div className="round-shuffle-overlay" role="dialog" aria-modal="true" aria-label="Shuffle dice"><section className="round-shuffle-card"><p className="turn-kicker">Round {view.round} · First bid waits for everyone</p><h2>Shake your cup</h2><p className="round-shuffle-copy">Your dice below will tumble, then settle into this round’s hand.</p><strong className="shuffle-countdown">{remaining}s</strong><div className="round-shuffle-players">{activePlayers.map((player) => <div className={`round-shuffle-player${ready.has(player.id) ? " round-shuffle-player--ready" : ""}`} key={player.id}><strong>{player.name}</strong><small>{ready.has(player.id) ? "Dice shuffled" : "Waiting"}</small></div>)}</div>{playerId ? <button className="button button--primary round-shuffle-button" data-sound="shake" disabled={shaking || myReady} onClick={onShuffle}>{myReady ? "Dice shuffled" : shaking ? "Shuffling…" : "Shake my dice"}</button> : <p className="rules-note">Waiting for the players to shake their dice.</p>}</section></div>;
}

function GameSummary({ view, history, isHost, onReturnToLobby, onExit }: { view: PublicGameView; history: string[]; isHost: boolean; onReturnToLobby: () => void; onExit: () => void }) {
  const winner = view.players.find((player) => player.id === view.winnerId);
  const standings = [...view.players].sort((left, right) => Number(right.id === view.winnerId) - Number(left.id === view.winnerId) || right.diceCount - left.diceCount || left.name.localeCompare(right.name));
  const lastCall = history.find((entry) => !entry.endsWith("wins the match.")) ?? history[0];
  return <main className="game-over"><div className="confetti" aria-hidden="true">{Array.from({ length: 64 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 101}%`, width: `${6 + (index % 6)}px`, height: `${10 + ((index * 3) % 12)}px`, animationDelay: `${-(index % 12) * .22}s`, animationDuration: `${2.7 + (index % 7) * .23}s` }} />)}</div><section className="game-summary-card"><p className="winner-crown" aria-hidden="true">♛</p><p className="eyebrow">Game complete</p><h1>{winner?.name} wins!</h1><p>After {view.round} {view.round === 1 ? "round" : "rounds"}, here is how the table finished.</p><ol className="summary-standings">{standings.map((player, index) => <li key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><em>{player.id === view.winnerId ? "Winner" : player.diceCount ? `${player.diceCount} dice left` : "Out"}</em></li>)}</ol>{lastCall && <p className="summary-last-call">Last call: {lastCall}</p>}<div className="game-over-actions">{isHost && <button className="button button--primary" onClick={onReturnToLobby}>Return to lobby</button>}<button className="button button--ghost" onClick={onExit}>Leave game</button></div></section></main>;
}

function OnlineTable({ view, roomCode, history, legal, playerId, playerStatuses, turnDeadlineAt, error, isHost, announcement, shuffle, nextRound, paused, onPause, onShuffle, onReadyNextRound, onAction, onReturnToLobby, onExit }: { view: PublicGameView; roomCode: string; history: string[]; legal?: LegalActions; playerId?: string; playerStatuses: Array<{ id: string; connected: boolean; covered: boolean }>; turnDeadlineAt?: number; error: string | null; isHost: boolean; announcement?: { text: string; playerId?: string }; shuffle?: Shuffle; nextRound?: NextRound; paused?: Pause; onPause: () => void; onShuffle: () => void; onReadyNextRound: () => void; onAction: (action: GameAction) => void; onReturnToLobby: () => void; onExit: () => void }) {
  const current = view.players.find((player) => player.id === view.currentPlayerId);
  const isMyTurn = !paused && view.phase === "playing" && view.currentPlayerId === playerId;
  const first = legal?.bids[0];
  const [quantity, setQuantity] = useState(first?.quantity ?? 1);
  const [denomination, setDenomination] = useState<Die>(first?.denomination ?? 2);
  const [shufflingDice, setShufflingDice] = useState(false);
  const [shuffleFaces, setShuffleFaces] = useState<Die[] | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const ownHand = view.players.find((player) => player.id === playerId)?.hand;
  const eliminated = view.players.find((player) => player.id === playerId)?.eliminated ?? false;
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
  const stopClockSound = useCallback(() => {
    const clockSound = clockSoundRef.current;
    if (!clockSound) return;
    clockSound.pause();
    clockSound.currentTime = 0;
    clockSoundRef.current = undefined;
    clockSoundTurnRef.current = null;
  }, []);
  const bid = () => {
    stopClockSound();
    const tableReroll = tableDiceMode && tableDiceIndices.length > 0;
    if (tableReroll) { playSound("tableDice"); setTableRerolling(true); window.setTimeout(() => setTableRerolling(false), 520); }
    lastPlayedDenominationRef.current = selectedDenomination;
    onAction({ type: "bid", playerId: "", bid: { quantity, denomination: selectedDenomination }, ...(tableDiceMode && tableDiceIndices.length ? { tableDiceIndices } : {}) });
    setTableDiceMode(false);
    setTableDiceIndices([]);
  };
  const call = (type: "dudo" | "calzo") => {
    stopClockSound();
    onAction({ type, playerId: "" });
  };
  const minimumBidFor = useCallback((die: Die) => legal?.bids.filter((candidate) => candidate.denomination === die).reduce((minimum, candidate) => candidate.quantity < minimum.quantity ? candidate : minimum), [legal]);
  const chooseDenomination = (die: Die) => {
    const acesMinimum = die === 1 && view.currentBid ? Math.ceil(view.currentBid.quantity * .5) + (view.rules.acesConversion === "halfPlusOne" ? 1 : 0) : 0;
    const candidates = legal?.bids.filter((candidate) => candidate.denomination === die && candidate.quantity >= acesMinimum) ?? [];
    const minimum = candidates.length ? candidates.reduce((lowest, candidate) => candidate.quantity < lowest.quantity ? candidate : lowest) : undefined;
    if (!minimum) return;
    playSound("denomination");
    setDenomination(die);
    if (!quantityManuallyAdjusted) setQuantity(minimum.quantity);
  };
  const shakeDice = () => {
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
    if (!isMyTurn || !legal || !view.currentPlayerId) return;
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
    if (view.phase !== "gameOver" || !view.winnerId || winnerRef.current === view.winnerId) return;
    winnerRef.current = view.winnerId;
    playSound("winner");
  }, [view.phase, view.winnerId]);
  const changeSoundLevel = (key: keyof SoundLevels, value: number) => {
    const next = { ...soundLevels, [key]: value };
    setSoundLevelsState(next);
    setSoundLevels(next);
  };
  if (view.phase === "gameOver") return <GameSummary view={view} history={history} isHost={isHost} onReturnToLobby={onReturnToLobby} onExit={onExit} />;
  const needsShuffle = !eliminated && view.phase === "playing" && shuffle?.round === view.round && shuffle.readyPlayerIds.length < view.players.filter((player) => !player.eliminated).length;
  return <div className={`game-shell${reducedMotion ? " game-shell--reduced-motion" : ""}`}>
    <header className="game-header"><div className="wordmark">Cachito online</div><div className="game-header-actions"><div className="round-label">Room {roomCode} · Round {view.round}{view.paloFijo ? " · Palo fijo" : ""}</div><button className="settings-button" aria-expanded={settingsOpen} aria-label="Game settings" onClick={() => setSettingsOpen((open) => !open)}>⚙</button>{settingsOpen && <div className="settings-popover"><strong>Settings</strong><label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label><label className="sound-slider">Sound FX <input type="range" min="0" max="1" step="0.05" value={soundLevels.effects} onChange={(event) => changeSoundLevel("effects", Number(event.target.value))} /><output>{Math.round(soundLevels.effects * 100)}%</output></label><label className="sound-slider">Music <input type="range" min="0" max="1" step="0.05" value={soundLevels.music} onChange={(event) => changeSoundLevel("music", Number(event.target.value))} /><output>{Math.round(soundLevels.music * 100)}%</output></label>{playerId && <button className="button button--ghost settings-pause" onClick={onPause}>{paused ? "Resume game" : "Pause game"}</button>}<button className="button button--ghost settings-exit" onClick={onExit}>Exit to menu</button></div>}</div></header>
    <div className="table-layout"><main className="table-main">
      <section className="players-strip">{view.players.map((player) => { const playerBid = roundBids?.round === view.round ? roundBids.bids[player.id] : undefined; return <article className={`player-chip${player.id === current?.id ? " player-chip--active" : ""}${statusById.get(player.id) === false ? " player-chip--offline" : ""}`} key={player.id}>{announcement?.playerId === player.id && <div className="player-speech" role="status">{announcement.text}</div>}<div className="player-name">{player.name}</div><div className="dice-count">{player.eliminated ? "Out · spectating" : statusById.get(player.id) === false ? offlineCoverById.get(player.id) ? "Offline · bot cover active" : "Offline · bot cover in 2 min" : view.rules.diceAmountsVisible ? <span className="dice-squares" aria-label={`${player.diceCount} ${player.diceCount === 1 ? "die" : "dice"}`}>{Array.from({ length: player.diceCount }, (_, index) => <i className={index < player.tableDice.length ? "dice-square--table" : ""} key={index} aria-hidden="true" />)}</span> : <span>Dice hidden</span>}</div>{playerBid && <div className="player-last-bid"><span>{playerBid.quantity} ×</span><span className="player-last-bid-die"><FaceMark value={playerBid.denomination} /></span></div>}</article>; })}</section>
      {view.players.some((player) => player.tableDice.length) && <section className="table-dice-board" aria-label="Table dice"><p className="turn-kicker">Table dice</p><div>{view.players.filter((player) => player.tableDice.length).map((player) => <article key={player.id}><strong>{player.name}</strong><DiceRow dice={player.tableDice} small /></article>)}</div></section>}
      <section className={`felt-table${isMyTurn ? " felt-table--your-turn" : ""}`}>
        {paused && <div className="game-paused-overlay" role="status"><strong>Game paused</strong><span>{paused.pausedByName} paused the table. Any player can resume it from Settings.</span></div>}
        {view.phase === "reveal" && <RoundReveal key={`${view.round}:${view.resolution?.kind}:${view.resolution?.callerId}`} view={view} playerId={playerId} nextRound={nextRound} onNext={onReadyNextRound} />}
        {needsShuffle && !shufflingDice && <RoundShuffle view={view} playerId={playerId} shuffle={shuffle!} shaking={shufflingDice} clock={clock} onShuffle={shakeDice} />}
        {secondsLeft !== undefined && <div className={`turn-timer${secondsLeft <= 10 ? " turn-timer--urgent" : ""}`} aria-label={`${secondsLeft} seconds remaining`}><span>{String(Math.floor(secondsLeft / 60)).padStart(1, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</span><small>{isMyTurn ? "your turn" : "turn timer"}</small></div>}
        <p className="turn-kicker">{eliminated ? "Spectating — you are out" : isMyTurn ? "Make a bid or call it" : playerId ? "Waiting for turn" : "Spectating until the next lobby"}</p>
        <h2 className="turn-name">{view.phase === "reveal" ? "Round result" : current?.name}</h2>
        {view.paloFijo && <div className="palo-fijo-alert"><strong>Palo fijo</strong><span>Aces are not wild this round.{view.rules.paloFijoBlindDice && (view.players.find((player) => player.id === playerId)?.diceCount ?? 0) > 1 ? " Your dice stay hidden until you have one." : ""}</span></div>}
        {roundBid ? <div className="current-bid bid-card"><span className="bid-quantity">{roundBid.quantity}</span><FaceMark value={roundBid.denomination} /><div className="bid-copy"><strong>{denominationNames[roundBid.denomination]}</strong><span>{view.players.find((player) => player.id === roundBidderId)?.name ?? "Unknown player"} made the current bid</span></div></div> : <div className="current-bid bid-empty">No bid yet.</div>}
        {isMyTurn ? <section className="controls-card">{canPutDiceOnTable && <div className="table-dice-control">{tableDiceMode ? <><strong>Select dice for the table</strong><span>Choose at least one and keep one private. They will be public for this round; the rest reroll after your bid.</span><button className="button button--ghost" onClick={() => { setTableDiceMode(false); setTableDiceIndices([]); }}>Cancel table dice</button></> : <button className="button button--ghost" onClick={() => setTableDiceMode(true)}>Put dice on table</button>}</div>}<div className="bid-inputs"><div><span className="field-label">Quantity</span><div className="stepper"><button data-sound="number" onClick={() => { playSound("numDown"); setQuantity((value) => Math.max(1, value - 1)); setQuantityManuallyAdjusted(true); }}>−</button><span>{quantity}</span><button data-sound="number" onClick={() => { playSound("numUp"); setQuantity((value) => Math.min(maxQuantity, value + 1)); setQuantityManuallyAdjusted(true); }}>+</button></div></div><div><span className="field-label">Denomination</span><div className="denominations">{([1,2,3,4,5,6] as Die[]).map((die) => <button className="denom-button" data-sound="denomination" key={die} aria-pressed={selectedDenomination === die} onClick={() => chooseDenomination(die)} disabled={!minimumBidFor(die)}><FaceMark value={die} label /></button>)}</div></div></div><div className="action-row"><button className="challenge-button challenge-button--dudo" data-sound="challenge" disabled={!legal?.canDudo} onClick={() => call("dudo")}>Dudo</button><button className="challenge-button challenge-button--calzo" data-sound="challenge" disabled={!legal?.canCalzo} onClick={() => call("calzo")}>Calzo</button><button className="button button--primary" disabled={!chosen || tableDiceMode && !tableDiceIndices.length} onClick={bid}>{tableDiceMode ? `${view.currentBid ? "Raise" : "Make"} bid & put ${tableDiceIndices.length || "…"} on table` : view.currentBid ? "Raise bid" : "Make bid"}</button></div></section> : <section className="controls-card"><p className="rules-note">{eliminated ? "You are now a spectator for the rest of this game." : playerId ? "Your moves will appear here when it is your turn." : "You are spectating this game and will be seated when it returns to the lobby."}</p></section>}
        <section className={`hand-panel${needsShuffle || shufflingDice ? " hand-panel--shuffling" : ""}`}><p className="hand-label">Your dice{tableDiceMode ? " · select dice to put on table" : isMyTurn ? " · click a die to choose its face" : ""}</p>{ownHand ? <DiceRow dice={shufflingDice && shuffleFaces ? shuffleFaces : ownHand} className={`${shufflingDice ? "dice-row--shuffling" : ""}${tableRerolling ? " dice-row--table-reroll" : ""}`} selectedIndices={tableDiceMode ? tableDiceIndices : undefined} onDieClick={isMyTurn ? (value, index) => tableDiceMode ? setTableDiceIndices((current) => current.includes(index) ? current.filter((entry) => entry !== index) : current.length < ownHand.length - 1 ? [...current, index] : current) : setDenomination(value as Die) : undefined} /> : <p className="rules-note">Hands are hidden.</p>}</section>
        {error && <p className="form-error">{error}</p>}
      </section>
    </main><OnlineHistory history={history} /></div>
  </div>;
}
