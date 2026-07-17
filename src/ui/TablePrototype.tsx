import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  applyAction,
  createGame,
  createSeededRandom,
  DEFAULT_GAME_RULES,
  getLegalActions,
  MAX_PLAYERS,
  MIN_PLAYERS,
  projectForPlayer,
  type Bid,
  type Die as DieValue,
  type EnginePlayer,
  type GameState,
  type PlayerSetup,
  type RandomSource,
  type RevealState,
} from "../engine";
import {
  BOT_NAMES,
  chooseBotAction,
  createProbabilityPolicy,
  isChoiceLegal,
  type BotObservation,
  type PublicActionEntry,
  type PublicRoundOutcome,
} from "../bot";
import { DiceRow } from "./Dice";
import { playSound, type SoundName } from "./sound";
import { seatLayoutFor, type SeatPosition } from "./tablePrototypeSeats";
import "./TablePrototype.css";

type FeedEvent = { id: number; initials: string; text: string; time: string; tone?: "bid" | "you" | "quiet" };
type CallPresentation = { key: string; kind: "dudo" | "calzo"; name: string; correct: boolean; resolved: boolean; showHands: boolean };
type RoundRoll = { key: string; round: number; readyIds: string[]; userRolling: boolean };

const USER_ID = "prototype-1";
const INITIAL_SEED = 0xcac1170;
export const PROTOTYPE_BOT_TURN_DELAY_MIN_MS = 3_000;
export const PROTOTYPE_BOT_TURN_DELAY_SPREAD_MS = 5_000;
const BOT_SHAKE_DELAY_MIN_MS = 2_000;
const BOT_SHAKE_DELAY_SPREAD_MS = 1_000;
const CALL_RESOLVE_MS = 2_100;
const CALL_REVEAL_MS = 3_300;
const dieGlyphs: Record<DieValue, string> = { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" };
const denominationNames: Record<DieValue, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const facePips: Record<DieValue, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const noLegalActions = { bids: [], canDudo: false, canCalzo: false, canPutDiceOnTable: false };

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase();
}

function safePlaySound(name: SoundName) {
  if (typeof Audio !== "undefined" && !navigator.userAgent.includes("jsdom")) return playSound(name);
}

function DenominationFace({ value }: { value: DieValue }) {
  return <span className="tp-face-mark" role="img" aria-label={denominationNames[value]}>{Array.from({ length: 9 }, (_, index) => <i className={facePips[value].includes(index) ? "tp-face-pip" : "tp-face-pip tp-face-pip--empty"} key={index} />)}<small>{denominationNames[value]}</small></span>;
}

function createRoster(userName: string, playerCount: number, seed: number): PlayerSetup[] {
  const random = createSeededRandom(seed ^ 0x51a7cafe);
  const available = [...BOT_NAMES];
  const bots = Array.from({ length: playerCount - 1 }, (_, index) => {
    const selected = Math.min(available.length - 1, Math.floor(random() * available.length));
    const name = available.splice(selected, 1)[0] ?? `Bot ${index + 1}`;
    return { id: `prototype-${index + 2}`, name };
  });
  return [{ id: USER_ID, name: userName }, ...bots];
}

function createOfflineGame(roster: PlayerSetup[], random: RandomSource) {
  return createGame(roster, random, {
    ...DEFAULT_GAME_RULES,
    diceAmountsVisible: false,
    tableDiceEnabled: true,
  });
}

function createBotRandoms(seed: number, roster: PlayerSetup[]) {
  return new Map(roster.slice(1).map((player, index) => [player.id, createSeededRandom(seed + 1_009 + index * 97)]));
}

function botPolicyFor(player: EnginePlayer) {
  const style = [...player.name].reduce((total, character) => total + character.charCodeAt(0), 0) % 3;
  if (style === 1) return createProbabilityPolicy({ name: "Pressure strategist", bluffRate: 0.12, targetBidConfidence: 0.57, tableAggression: 0.52 });
  if (style === 2) return createProbabilityPolicy({ name: "Careful strategist", bluffRate: 0.035, targetBidConfidence: 0.67, tableAggression: 0.08 });
  return createProbabilityPolicy({ name: "Adaptive strategist", bluffRate: 0.07, targetBidConfidence: 0.62, tableAggression: 0.24 });
}

function DiceInventory({ inPlay, startingTotal }: { inPlay: number; startingTotal: number }) {
  const lost = Math.max(0, startingTotal - inPlay);
  const groups = Array.from({ length: Math.ceil(lost / 5) }, (_, index) => Math.min(5, lost - index * 5));
  const label = lost === 0 ? `${inPlay} dice in play; no dice lost` : `${inPlay} dice in play; ${lost} ${lost === 1 ? "die" : "dice"} lost`;
  return (
    <section className="tp-inventory" aria-label={label}>
      <div className="tp-inventory-heading"><span>Dice in play</span><strong>{inPlay}</strong></div>
      <div className="tp-lost-heading"><span>Lost dice</span><small>Grouped in fives</small></div>
      {groups.length ? <div className="tp-dice-groups" aria-hidden="true">
        {groups.map((count, groupIndex) => <span className="tp-dice-group" key={`${count}-${groupIndex}`}><DiceRow dice={Array.from({ length: count }, () => 1)} small /></span>)}
      </div> : <p className="tp-no-lost-dice">No dice lost yet</p>}
    </section>
  );
}

export function PrototypePlayerSeat({ player, position, revealDistribution, currentTurn, latestBid, rolling, rollReady }: { player: EnginePlayer; position: SeatPosition; revealDistribution: boolean; currentTurn: boolean; latestBid?: Bid; rolling: boolean; rollReady: boolean }) {
  const status = player.diceCount === 0
    ? "Out · spectating"
    : revealDistribution
      ? `${player.diceCount} ${player.diceCount === 1 ? "die" : "dice"}`
      : rolling
        ? rollReady ? "Cup ready" : "Waiting to shake"
        : player.tableDice.length
          ? `${player.tableDice.length} public · rest hidden`
          : "Dice hidden";
  return (
    <article className={`tp-seat tp-seat--${position}${player.diceCount === 0 ? " tp-seat--out" : ""}${currentTurn ? " tp-seat--active" : ""}`} aria-label={`${player.name}${player.diceCount === 0 ? ", out and spectating" : ""}${currentTurn ? ", current turn" : ""}`}>
      {currentTurn && <span className="tp-turn-flag">Thinking</span>}
      {player.diceCount === 0 && <span className="tp-out-flag">Out</span>}
      <div className="tp-avatar" aria-hidden="true">{initials(player.name)}</div>
      <div className="tp-seat-copy">
        <div><strong>{player.name}</strong><small>Bot</small></div>
        {revealDistribution && player.diceCount > 0 ? <span className="tp-seat-dice-squares" aria-label={`${player.diceCount} dice`} >{Array.from({ length: player.diceCount }, (_, index) => <i className={index < player.tableDice.length ? "tp-seat-die--public" : ""} key={index} />)}</span> : <span>{status}</span>}
      </div>
      {latestBid && <div className="tp-seat-bid"><span>Latest bid</span><strong><span>{latestBid.quantity} ×</span><b aria-label={denominationNames[latestBid.denomination]}>{dieGlyphs[latestBid.denomination]}</b></strong></div>}
      {!latestBid && player.tableDice.length > 0 && <small className="tp-seat-note">{player.tableDice.length} dice on the table</small>}
    </article>
  );
}

function TableFeed({ events, currentPlayerName, isYourTurn, onPreviewAlert, onClose }: { events: FeedEvent[]; currentPlayerName: string; isYourTurn: boolean; onPreviewAlert: () => void; onClose: () => void }) {
  return (
    <aside className="tp-feed" aria-label="Table feed and notifications">
      <header className="tp-feed-header">
        <div><p>Table feed</p><span>Live offline engine</span></div>
        <div className="tp-feed-status"><i aria-hidden="true" /><button type="button" aria-label="Collapse table feed" onClick={onClose}>›</button></div>
      </header>
      <section className={`tp-up-next${isYourTurn ? " tp-up-next--you" : ""}`}><span>Current turn</span><strong>{isYourTurn ? "Your turn" : currentPlayerName}</strong><small>Your hand stays anchored below while the turn moves around the fixed seats.</small></section>
      <ol className="tp-feed-list">
        {events.map((event) => <li className={`tp-feed-event${event.tone ? ` tp-feed-event--${event.tone}` : ""}`} key={event.id}><i>{event.initials}</i><div><strong>{event.text}</strong><span>{event.time}</span></div></li>)}
      </ol>
      <section className="tp-notification-note"><strong>Integrated notifications</strong><p>Calls pause the table, resolve with their full animation and sound, then reveal the highlighted dice.</p><button type="button" onClick={onPreviewAlert}>Preview a Dudo alert</button></section>
    </aside>
  );
}

export function PrototypeCallout({ kind, name, correct, resolved }: { kind: "dudo" | "calzo"; name: string; correct: boolean; resolved: boolean }) {
  const word = kind.toUpperCase();
  const result = resolved ? correct ? "right" : "wrong" : "pending";
  return (
    <div className={`tp-callout tp-callout--${kind} tp-callout--${result}`} role="status" aria-label={`${word} call${resolved ? correct ? ", correct" : ", wrong" : ", checking"}`}>
      <strong>{resolved && correct ? word : [...word].map((letter, index) => <i key={`${letter}-${index}`}>{letter}</i>)}</strong>
      <span>{resolved ? correct ? "Correct call" : "Wrong call" : `${name} calls it.`}</span>
    </div>
  );
}

function RoundRollOverlay({ state, players, userName, spectating, onShake }: { state: RoundRoll; players: EnginePlayer[]; userName: string; spectating: boolean; onShake: () => void }) {
  const ready = new Set(state.readyIds);
  const active = players.filter((player) => player.diceCount > 0);
  const userActive = active.some((player) => player.id === USER_ID);
  return (
    <section className="tp-roll-overlay" role="dialog" aria-label="Shake dice">
      <p>Round {state.round} · first bid waits for every cup</p>
      <h2>Shake your dice</h2>
      <span>{spectating ? "Every active cup settles automatically while you watch." : "Roll manually, then the table will settle into this round."}</span>
      <div className="tp-roll-players">{active.map((player) => <div className={ready.has(player.id) ? "tp-roll-player--ready" : ""} key={player.id}><strong>{player.name}</strong><small>{ready.has(player.id) ? "Dice shuffled" : player.id === USER_ID ? spectating ? "Bot preparing" : "Waiting for you" : "Bot preparing"}</small></div>)}</div>
      {userActive && !spectating ? <button type="button" disabled={state.userRolling || ready.has(USER_ID)} onClick={onShake}>{ready.has(USER_ID) ? `${userName} is ready` : state.userRolling ? "Shuffling…" : "Shake my dice"}</button> : <small className="tp-roll-watch-note">Watching the remaining cups.</small>}
    </section>
  );
}

function SpectatorDock({ user, currentPlayerName, currentBid, round, totalDice, formattedTime, eliminated, onReturn, onActivity }: { user: EnginePlayer; currentPlayerName: string; currentBid: Bid | null; round: number; totalDice: number; formattedTime?: string; eliminated: boolean; onReturn: () => void; onActivity: () => void }) {
  return (
    <section className={`tp-spectator-dock${eliminated ? " tp-spectator-dock--out" : ""}`} aria-label="Spectator view">
      <div className="tp-spectator-identity">
        <div className="tp-spectator-icon" aria-hidden="true">◎</div>
        <div><p>{eliminated ? "Out · spectating" : "Watching the table"}</p><strong>{user.name}</strong><span>{eliminated ? "Your seat stays visible. Private hands stay hidden." : `A bot is covering ${user.name}’s seat.`}</span></div>
      </div>
      <div className="tp-spectator-glance" aria-live="polite">
        <div><span>Current turn</span><strong>{currentPlayerName}</strong>{formattedTime && <small>{formattedTime} remaining</small>}</div>
        <div><span>Current bid</span><strong>{currentBid ? `${currentBid.quantity} × ${denominationNames[currentBid.denomination]}` : "No bid yet"}</strong></div>
        <div><span>Round</span><strong>{round}</strong></div>
        <div><span>Dice in play</span><strong>{totalDice}</strong></div>
      </div>
      <div className="tp-spectator-actions">
        <button type="button" onClick={onActivity}>Open activity</button>
        {!eliminated && <button className="tp-spectator-return" type="button" onClick={onReturn}>Return to seat</button>}
      </div>
    </section>
  );
}

function RoundResult({ state, onNext }: { state: RevealState; onNext: () => void }) {
  const resolution = state.resolution;
  const caller = state.players.find((player) => player.id === resolution.callerId)?.name ?? "Caller";
  const bidder = state.players.find((player) => player.id === resolution.bidderId)?.name ?? "the bidder";
  const changed = state.players.find((player) => player.id === resolution.diceChanges[0]?.playerId)?.name ?? "Player";
  const change = resolution.diceChanges[0];
  const qualifying = (value: number) => value === resolution.bid.denomination || (!state.paloFijo && resolution.bid.denomination !== 1 && value === 1);
  const amount = Math.abs(change?.delta ?? 0);
  const revealedPlayers = state.players.filter((player) => player.hand.length || player.tableDice.length);
  const consequence = change?.delta && change.delta > 0
    ? `${changed} gains ${amount} ${amount === 1 ? "die" : "dice"}.`
    : `${changed} loses ${amount} ${amount === 1 ? "die" : "dice"}.`;
  return (
    <section className={`tp-round-result tp-round-result--${resolution.correct ? "correct" : "wrong"}`} role="dialog" aria-label="Round result">
      <div className="tp-result-heading"><p>{caller} said {resolution.kind === "dudo" ? "Dudo" : "Calzo"} to {bidder}’s bid.</p><h2>{resolution.bid.quantity} × {denominationNames[resolution.bid.denomination]} · {resolution.actualCount} there</h2><div className="tp-result-verdict"><strong>{resolution.correct ? "Correct call." : "Wrong call."}</strong><span>{consequence}</span></div><small>Highlighted dice counted toward the bid.</small></div>
      <div className="tp-revealed-hands" style={{ "--hand-columns": Math.min(4, revealedPlayers.length) } as CSSProperties}>
        {revealedPlayers.map((player) => <div key={player.id}><strong>{player.name}</strong><DiceRow dice={[...player.hand, ...player.tableDice]} small highlight={qualifying} /></div>)}
      </div>
      <button type="button" onClick={onNext}>Next round</button>
    </section>
  );
}

export function PrototypeGameOver({ winnerName, round, onRestart }: { winnerName: string; round: number; onRestart: () => void }) {
  const confetti = Array.from({ length: 132 }, (_, index) => {
    const angle = index * 137.508 * Math.PI / 180;
    const distance = 18 + index % 11 * 7;
    return <i key={index} style={{ "--burst-x": `${Math.cos(angle) * distance}vw`, "--burst-y": `${Math.sin(angle) * distance * .62}vh`, "--drift": `${index * 19 % 27 - 13}vw`, "--spin": `${540 + index % 8 * 135}deg`, "--delay": `${index % 24 * .028}s`, "--duration": `${2.9 + index % 6 * .17}s`, width: `${5 + index % 6}px`, height: `${7 + index % 8}px` } as CSSProperties} />;
  });
  return <><div className="tp-confetti" aria-hidden="true">{confetti}</div><section className="tp-game-over" role="dialog" aria-label="Game winner"><span className="tp-winner-crown" aria-hidden="true">♛</span><p>Game complete · {round} {round === 1 ? "round" : "rounds"}</p><h2>{winnerName} wins!</h2><strong>The table is theirs.</strong><button type="button" onClick={onRestart}>Play again</button></section></>;
}

export function TablePrototype({ onExit }: { onExit: () => void }) {
  const [initial] = useState(() => {
    const userName = localStorage.getItem("cachito-display-name")?.trim() || "Player 1";
    const roster = createRoster(userName, MAX_PLAYERS, INITIAL_SEED);
    const random = createSeededRandom(INITIAL_SEED);
    return { game: createOfflineGame(roster, random), random, roster, userName };
  });
  const seedRef = useRef(INITIAL_SEED);
  const rollSequenceRef = useRef(1);
  const gameRandomRef = useRef<RandomSource>(initial.random);
  const botRandomsRef = useRef(createBotRandoms(INITIAL_SEED, initial.roster));
  const timeoutRandomRef = useRef(createSeededRandom(INITIAL_SEED ^ 0x710e));
  const historyRef = useRef<PublicActionEntry[]>([]);
  const gameRef = useRef<GameState | null>(null);
  const pendingBotTurnRef = useRef<string | null>(null);
  const lastTurnRef = useRef<string | null>(null);
  const selectedTurnRef = useRef<string | null>(null);
  const lastPlayedDenominationRef = useRef<DieValue | undefined>(undefined);
  const callTimersRef = useRef<number[]>([]);
  const shakeTimerRef = useRef<number | undefined>(undefined);
  const turnPassTimerRef = useRef<number | undefined>(undefined);
  const shakeStopActiveRef = useRef(false);
  const pendingTurnPassRef = useRef(false);
  const roundReadyIdsRef = useRef<string[]>([]);
  const clockSoundDeadlineRef = useRef<number | undefined>(undefined);
  const clockSoundRef = useRef<HTMLAudioElement | undefined>(undefined);
  const clockSoundTurnRef = useRef<string | null>(null);
  const eventIdRef = useRef(2);
  const [playerCount, setPlayerCount] = useState(MAX_PLAYERS);
  const [game, setGameState] = useState<GameState>(initial.game);
  const [roundRoll, setRoundRoll] = useState<RoundRoll>({ key: `${INITIAL_SEED}:1:1`, round: 1, readyIds: [], userRolling: false });
  const [shuffleFaces, setShuffleFaces] = useState<DieValue[] | undefined>();
  const [roundBids, setRoundBids] = useState<Record<string, Bid>>({});
  const [revealDistribution, setRevealDistribution] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [denomination, setDenomination] = useState<DieValue>(2);
  const [quantityManuallyAdjusted, setQuantityManuallyAdjusted] = useState(false);
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | undefined>();
  const [clock, setClock] = useState(() => Date.now());
  const [tableDiceMode, setTableDiceMode] = useState(false);
  const [tableDiceIndices, setTableDiceIndices] = useState<number[]>([]);
  const [tableRerolling, setTableRerolling] = useState(false);
  const [previewAlert, setPreviewAlert] = useState(false);
  const [callPresentation, setCallPresentation] = useState<CallPresentation | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [spectatorMode, setSpectatorMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([
    { id: 1, initials: initials(initial.userName), text: `${initial.userName} joined seven offline bots`, time: "Now", tone: "you" },
    { id: 2, initials: "EN", text: "Real engine rules are active", time: "Seeded test game", tone: "quiet" },
  ]);
  if (gameRef.current === null) gameRef.current = game;

  const setGame = useCallback((next: GameState) => {
    gameRef.current = next;
    setGameState(next);
  }, []);
  const user = game.players.find((player) => player.id === USER_ID) ?? game.players[0];
  const isSpectating = spectatorMode || user.diceCount === 0;
  const currentPlayer = game.phase === "playing" ? game.players.find((player) => player.id === game.currentPlayerId) : undefined;
  const activePlayers = game.players.filter((player) => player.diceCount > 0);
  const rollComplete = game.phase !== "playing" || roundRoll.round !== game.round || activePlayers.every((player) => roundRoll.readyIds.includes(player.id));
  const isYourTurn = game.phase === "playing" && game.currentPlayerId === USER_ID;
  const isYourActionTurn = isYourTurn && rollComplete && !callPresentation && !isSpectating;
  const legal = useMemo(() => isYourActionTurn ? getLegalActions(game, USER_ID) : noLegalActions, [game, isYourActionTurn]);
  const totalDice = useMemo(() => game.players.reduce((total, player) => total + player.diceCount, 0), [game.players]);
  const startingTotal = playerCount * 5;
  const selectedTableDice = tableDiceIndices.map((index) => user.hand[index]);
  const selectedBid: Bid = { quantity, denomination };
  const chosenLegal = legal.bids.some((bid) => bid.quantity === quantity && bid.denomination === denomination);
  const maxQuantity = totalDice;
  const secondsLeft = turnDeadlineAt ? Math.max(0, Math.ceil((turnDeadlineAt - clock) / 1_000)) : undefined;
  const tableDicePlayers = game.players.filter((player) => player.tableDice.length > 0);
  const tableDice = tableDicePlayers.flatMap((player) => player.tableDice);
  const tableSeats = game.players.slice(1).map((player, index) => ({ player, position: seatLayoutFor(playerCount)[index] }));

  const prepareControls = useCallback(() => {
    setTableDiceMode(false);
    setTableDiceIndices([]);
    setError(null);
  }, []);

  const stopClockSound = useCallback(() => {
    const sound = clockSoundRef.current;
    if (!sound) return;
    sound.pause();
    sound.currentTime = 0;
    clockSoundRef.current = undefined;
    clockSoundTurnRef.current = null;
  }, []);

  const addEvent = useCallback((text: string, tone: FeedEvent["tone"], name: string) => {
    const next: FeedEvent = { id: ++eventIdRef.current, initials: initials(name), text, time: "Just now", tone };
    setEvents((current) => [next, ...current.map((event) => ({ ...event, time: event.time === "Just now" ? "Moments ago" : event.time }))].slice(0, 14));
  }, []);

  const clearCallTimers = useCallback(() => {
    for (const timer of callTimersRef.current) window.clearTimeout(timer);
    callTimersRef.current = [];
  }, []);

  const beginCallPresentation = useCallback((state: RevealState, name: string) => {
    clearCallTimers();
    const key = `${state.round}:${state.resolution.kind}:${state.resolution.callerId}`;
    setCallPresentation({ key, kind: state.resolution.kind, name, correct: state.resolution.correct, resolved: false, showHands: false });
    safePlaySound("suspense");
    callTimersRef.current.push(window.setTimeout(() => {
      setCallPresentation((current) => current?.key === key ? { ...current, resolved: true } : current);
      safePlaySound(state.resolution.correct ? "rightGuess" : "wrongGuess");
      if (state.resolution.diceChanges.some((change) => change.after === 0)) safePlaySound("dead");
    }, CALL_RESOLVE_MS));
    callTimersRef.current.push(window.setTimeout(() => {
      setCallPresentation((current) => current?.key === key ? { ...current, showHands: true } : current);
    }, CALL_REVEAL_MS));
  }, [clearCallTimers]);

  const startRollGate = useCallback((round: number) => {
    rollSequenceRef.current += 1;
    setRoundRoll({ key: `${seedRef.current}:${round}:${rollSequenceRef.current}`, round, readyIds: [], userRolling: false });
    setShuffleFaces(undefined);
  }, []);

  const restartGame = useCallback((count = playerCount) => {
    if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current);
    clearCallTimers();
    const nextSeed = seedRef.current + 1;
    seedRef.current = nextSeed;
    const roster = createRoster(initial.userName, count, nextSeed);
    gameRandomRef.current = createSeededRandom(nextSeed);
    botRandomsRef.current = createBotRandoms(nextSeed, roster);
    timeoutRandomRef.current = createSeededRandom(nextSeed ^ 0x710e);
    historyRef.current = [];
    pendingBotTurnRef.current = null;
    lastTurnRef.current = null;
    selectedTurnRef.current = null;
    lastPlayedDenominationRef.current = undefined;
    clockSoundDeadlineRef.current = undefined;
    stopClockSound();
    const next = createOfflineGame(roster, gameRandomRef.current);
    setGame(next);
    prepareControls();
    startRollGate(1);
    setRoundBids({});
    setTableRerolling(false);
    setCallPresentation(null);
    setEvents([{ id: ++eventIdRef.current, initials: initials(initial.userName), text: `${initial.userName} joined ${count - 1} offline ${count === 2 ? "bot" : "bots"}`, time: "Now", tone: "you" }]);
  }, [clearCallTimers, initial.userName, playerCount, prepareControls, setGame, startRollGate, stopClockSound]);

  const choosePlayerCount = (count: number) => {
    setPlayerCount(count);
    restartGame(count);
  };

  useEffect(() => () => {
    clearCallTimers();
    if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current);
    if (turnPassTimerRef.current) window.clearTimeout(turnPassTimerRef.current);
    stopClockSound();
  }, [clearCallTimers, stopClockSound]);

  useEffect(() => {
    roundReadyIdsRef.current = roundRoll.readyIds;
  }, [roundRoll.readyIds]);

  useEffect(() => {
    const snapshot = gameRef.current;
    if (!snapshot || snapshot.phase !== "playing" || roundRoll.round !== snapshot.round) return;
    const alreadyReady = new Set(roundReadyIdsRef.current);
    const timers = snapshot.players.filter((player) => player.diceCount > 0 && !alreadyReady.has(player.id) && (player.id !== USER_ID || isSpectating)).map((player) => window.setTimeout(() => {
      if (roundReadyIdsRef.current.includes(player.id)) return;
      setRoundRoll((current) => current.key === roundRoll.key && !current.readyIds.includes(player.id) ? { ...current, readyIds: [...current.readyIds, player.id] } : current);
      addEvent(`${player.name} shook their cup`, "quiet", player.name);
    }, BOT_SHAKE_DELAY_MIN_MS + Math.floor(Math.random() * BOT_SHAKE_DELAY_SPREAD_MS)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [addEvent, isSpectating, roundRoll.key, roundRoll.round]);

  useEffect(() => {
    if (game.phase !== "playing" || !rollComplete) return;
    const turn = `${game.round}:${game.currentPlayerId}:${game.currentBid?.quantity ?? 0}:${game.currentBid?.denomination ?? 0}`;
    if (lastTurnRef.current !== turn) {
      lastTurnRef.current = turn;
      if (shakeStopActiveRef.current) pendingTurnPassRef.current = true;
      else safePlaySound("turnPass");
    }
  }, [game, rollComplete]);

  const minimumBidFor = useCallback((value: DieValue) => legal.bids.filter((candidate) => candidate.denomination === value).reduce<Bid | undefined>((minimum, candidate) => !minimum || candidate.quantity < minimum.quantity ? candidate : minimum, undefined), [legal.bids]);

  useEffect(() => {
    if (!isYourActionTurn || !legal.bids.length) return;
    const turn = `${game.round}:${game.currentPlayerId}:${game.currentBid?.quantity ?? 0}:${game.currentBid?.denomination ?? 0}`;
    if (selectedTurnRef.current === turn) return;
    const preferred = lastPlayedDenominationRef.current;
    const minimum = preferred ? minimumBidFor(preferred) : undefined;
    const fallback = minimumBidFor(2) ?? legal.bids.reduce((lowest, candidate) => candidate.quantity < lowest.quantity ? candidate : lowest);
    setDenomination((minimum ?? fallback).denomination);
    setQuantity((minimum ?? fallback).quantity);
    setQuantityManuallyAdjusted(false);
    setTableDiceMode(false);
    setTableDiceIndices([]);
    selectedTurnRef.current = turn;
  }, [game.currentBid, game.currentPlayerId, game.round, isYourActionTurn, legal.bids, minimumBidFor]);

  const timerTurnKey = game.phase === "playing" && rollComplete && !callPresentation
    ? `${game.round}:${game.currentPlayerId}:${game.currentBid?.quantity ?? 0}:${game.currentBid?.denomination ?? 0}`
    : undefined;

  useEffect(() => {
    stopClockSound();
    clockSoundDeadlineRef.current = undefined;
    const timer = window.setTimeout(() => {
      if (!timerTurnKey) {
        setTurnDeadlineAt(undefined);
        return;
      }
      const deadline = Date.now() + game.rules.turnTimeSeconds * 1_000;
      setClock(Date.now());
      setTurnDeadlineAt(deadline);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [game.rules.turnTimeSeconds, stopClockSound, timerTurnKey]);

  useEffect(() => {
    if (!turnDeadlineAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [turnDeadlineAt]);

  useEffect(() => {
    if (!turnDeadlineAt || secondsLeft === undefined || secondsLeft > 10 || clockSoundDeadlineRef.current === turnDeadlineAt) return;
    clockSoundDeadlineRef.current = turnDeadlineAt;
    stopClockSound();
    const sound = safePlaySound("clock");
    if (!sound) return;
    clockSoundRef.current = sound;
    clockSoundTurnRef.current = game.phase === "playing" ? game.currentPlayerId : null;
    sound.addEventListener("ended", () => { if (clockSoundRef.current === sound) clockSoundRef.current = undefined; }, { once: true });
  }, [game, secondsLeft, stopClockSound, turnDeadlineAt]);

  useEffect(() => {
    if (game.phase !== "playing" || game.currentPlayerId !== clockSoundTurnRef.current) stopClockSound();
  }, [game.currentPlayerId, game.phase, stopClockSound]);

  useEffect(() => {
    if (!turnDeadlineAt || !isYourActionTurn) return;
    const turn = timerTurnKey;
    const timer = window.setTimeout(() => {
      const snapshot = gameRef.current;
      if (!snapshot || snapshot !== game || snapshot.phase !== "playing" || snapshot.currentPlayerId !== USER_ID || timerTurnKey !== turn) return;
      try {
        stopClockSound();
        const observation: BotObservation = { playerId: USER_ID, view: projectForPlayer(snapshot, USER_ID), legalActions: getLegalActions(snapshot, USER_ID), history: [...historyRef.current] };
        const { choice } = chooseBotAction(botPolicyFor(user), observation, timeoutRandomRef.current);
        if (!isChoiceLegal(observation, choice)) throw new Error("Timeout bot selected an illegal action");
        const action = choice.type === "bid" ? { type: "bid" as const, playerId: USER_ID, bid: choice.bid } : { type: choice.type, playerId: USER_ID };
        const next = applyAction(snapshot, action, gameRandomRef.current);
        const outcome: PublicRoundOutcome | undefined = next.phase === "reveal" ? { kind: next.resolution.kind, bidderId: next.resolution.bidderId, bid: { ...next.resolution.bid }, correct: next.resolution.correct } : undefined;
        historyRef.current.push({ round: snapshot.round, playerId: USER_ID, action: choice.type === "bid" ? { type: "bid", bid: choice.bid } : choice, outcome });
        if (choice.type === "bid") {
          setRoundBids((current) => ({ ...current, [USER_ID]: { ...choice.bid } }));
          addEvent(`${user.name} ran out of time — bot bid ${choice.bid.quantity} ${denominationNames[choice.bid.denomination]}`, "you", user.name);
        } else if (next.phase === "reveal") {
          addEvent(`${user.name} ran out of time — bot called ${choice.type === "dudo" ? "Dudo" : "Calzo"}`, "you", user.name);
          beginCallPresentation(next, user.name);
        }
        setGame(next);
        prepareControls();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The timeout bot could not choose a move.");
      }
    }, Math.max(0, turnDeadlineAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [addEvent, beginCallPresentation, game, isYourActionTurn, prepareControls, setGame, stopClockSound, timerTurnKey, turnDeadlineAt, user]);

  useEffect(() => {
    if (game.phase !== "playing" || (game.currentPlayerId === USER_ID && !isSpectating) || !rollComplete || callPresentation) {
      pendingBotTurnRef.current = null;
      return;
    }
    const playerId = game.currentPlayerId;
    const turnKey = `${game.round}:${playerId}:${game.currentBid?.quantity ?? 0}:${game.currentBid?.denomination ?? 0}`;
    if (pendingBotTurnRef.current === turnKey) return;
    pendingBotTurnRef.current = turnKey;
    const timer = window.setTimeout(() => {
      if (gameRef.current !== game || pendingBotTurnRef.current !== turnKey) return;
      try {
        const observation: BotObservation = {
          playerId,
          view: projectForPlayer(game, playerId),
          legalActions: getLegalActions(game, playerId),
          history: [...historyRef.current],
        };
        const random = playerId === USER_ID ? timeoutRandomRef.current : botRandomsRef.current.get(playerId);
        if (!random) throw new Error(`Missing bot random source for ${playerId}`);
        const bot = game.players.find((player) => player.id === playerId);
        if (!bot) throw new Error(`Missing bot player ${playerId}`);
        const { choice } = chooseBotAction(botPolicyFor(bot), observation, random);
        if (!isChoiceLegal(observation, choice)) throw new Error("Bot selected an illegal action");
        stopClockSound();
        const action = choice.type === "bid"
          ? { type: "bid" as const, playerId, bid: choice.bid, ...(choice.tableDiceIndices ? { tableDiceIndices: choice.tableDiceIndices } : {}) }
          : { type: choice.type, playerId };
        const next = applyAction(game, action, gameRandomRef.current);
        const botName = game.players.find((player) => player.id === playerId)?.name ?? "Bot";
        const coveringSeat = playerId === USER_ID;
        const outcome: PublicRoundOutcome | undefined = next.phase === "reveal"
          ? { kind: next.resolution.kind, bidderId: next.resolution.bidderId, bid: { ...next.resolution.bid }, correct: next.resolution.correct }
          : undefined;
        historyRef.current.push({ round: game.round, playerId, action: choice, outcome });
        if (choice.type === "bid") {
          setRoundBids((current) => ({ ...current, [playerId]: { ...choice.bid } }));
          addEvent(`${coveringSeat ? `Bot covering ${botName} bid` : `${botName} bid`} ${choice.bid.quantity} ${denominationNames[choice.bid.denomination]}${choice.tableDiceIndices?.length ? ` and put ${choice.tableDiceIndices.length} on the table` : ""}`, coveringSeat ? "you" : "bid", botName);
          safePlaySound(choice.tableDiceIndices?.length ? "tableDice" : "denomination");
        } else if (next.phase === "reveal") {
          addEvent(`${coveringSeat ? `Bot covering ${botName} called` : `${botName} called`} ${choice.type === "dudo" ? "Dudo" : "Calzo"}`, "you", botName);
          beginCallPresentation(next, botName);
        }
        setGame(next);
        prepareControls();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "A bot could not choose its move.");
      } finally {
        pendingBotTurnRef.current = null;
      }
    }, PROTOTYPE_BOT_TURN_DELAY_MIN_MS + Math.floor(Math.random() * PROTOTYPE_BOT_TURN_DELAY_SPREAD_MS));
    return () => {
      window.clearTimeout(timer);
      if (pendingBotTurnRef.current === turnKey) pendingBotTurnRef.current = null;
    };
  }, [addEvent, beginCallPresentation, callPresentation, game, isSpectating, prepareControls, rollComplete, setGame, stopClockSound]);

  const shakeDice = () => {
    if (game.phase !== "playing" || roundRoll.userRolling || roundRoll.readyIds.includes(USER_ID) || user.diceCount === 0) return;
    safePlaySound("shake");
    setRoundRoll((current) => ({ ...current, userRolling: true }));
    let step = 0;
    const tumble = () => {
      setShuffleFaces(user.hand.map(() => (Math.floor(Math.random() * 6) + 1) as DieValue));
      step += 1;
      if (step < 14) {
        const delay = step < 8 ? 65 : 100 + (step - 8) * 38;
        shakeTimerRef.current = window.setTimeout(tumble, delay);
      } else {
        setShuffleFaces([...user.hand]);
        setRoundRoll((current) => ({ ...current, userRolling: false, readyIds: current.readyIds.includes(USER_ID) ? current.readyIds : [...current.readyIds, USER_ID] }));
        shakeStopActiveRef.current = true;
        const sound = safePlaySound("shakeStop");
        const finishShakeStop = () => {
          shakeStopActiveRef.current = false;
          if (!pendingTurnPassRef.current) return;
          pendingTurnPassRef.current = false;
          turnPassTimerRef.current = window.setTimeout(() => safePlaySound("turnPass"), 500);
        };
        if (sound) {
          sound.addEventListener("ended", finishShakeStop, { once: true });
          sound.addEventListener("error", finishShakeStop, { once: true });
        } else finishShakeStop();
        addEvent(`${user.name} shook their cup`, "you", user.name);
      }
    };
    tumble();
  };

  const toggleTableDie = (_value: number, index: number) => {
    setTableDiceIndices((current) => current.includes(index)
      ? current.filter((entry) => entry !== index)
      : current.length < user.hand.length - 1 ? [...current, index] : current);
  };

  const stepQuantity = (direction: -1 | 1) => {
    const next = Math.max(1, Math.min(maxQuantity, quantity + direction));
    if (next === quantity) return;
    setQuantity(next);
    setQuantityManuallyAdjusted(true);
    safePlaySound(direction < 0 ? "numDown" : "numUp");
  };

  const chooseDenomination = (value: DieValue) => {
    const minimum = minimumBidFor(value);
    if (!minimum) return;
    setDenomination(value);
    if (!quantityManuallyAdjusted) setQuantity(minimum.quantity);
    safePlaySound("denomination");
  };

  const bid = () => {
    if (!isYourActionTurn || game.phase !== "playing" || !chosenLegal || tableDiceMode && !selectedTableDice.length) return;
    try {
      stopClockSound();
      const shown = tableDiceMode ? tableDiceIndices : undefined;
      const action = { type: "bid" as const, playerId: USER_ID, bid: selectedBid, ...(shown ? { tableDiceIndices: shown } : {}) };
      const next = applyAction(game, action, gameRandomRef.current);
      historyRef.current.push({ round: game.round, playerId: USER_ID, action: { type: "bid", bid: selectedBid, ...(shown ? { tableDiceIndices: shown } : {}) } });
      lastPlayedDenominationRef.current = denomination;
      setRoundBids((current) => ({ ...current, [USER_ID]: { ...selectedBid } }));
      addEvent(`${user.name} bid ${quantity} ${denominationNames[denomination]}${shown?.length ? ` and put ${shown.length} on the table` : ""}`, "you", user.name);
      safePlaySound(shown?.length ? "tableDice" : "denomination");
      if (shown?.length) {
        setTableRerolling(true);
        window.setTimeout(() => setTableRerolling(false), 520);
      }
      setGame(next);
      prepareControls();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That move is not legal.");
    }
  };

  const call = (kind: "dudo" | "calzo") => {
    if (!isYourActionTurn || game.phase !== "playing") return;
    try {
      stopClockSound();
      const next = applyAction(game, { type: kind, playerId: USER_ID }, gameRandomRef.current);
      const outcome: PublicRoundOutcome | undefined = next.phase === "reveal"
        ? { kind, bidderId: next.resolution.bidderId, bid: { ...next.resolution.bid }, correct: next.resolution.correct }
        : undefined;
      historyRef.current.push({ round: game.round, playerId: USER_ID, action: { type: kind }, outcome });
      addEvent(`${user.name} called ${kind === "dudo" ? "Dudo" : "Calzo"}`, "you", user.name);
      if (next.phase === "reveal") beginCallPresentation(next, user.name);
      setGame(next);
      prepareControls();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That call is not legal.");
    }
  };

  const nextRound = () => {
    try {
      const next = applyAction(game, { type: "nextRound" }, gameRandomRef.current);
      const nextName = next.phase === "gameOver" ? next.players.find((player) => player.id === next.winnerId)?.name ?? "Player" : next.players.find((player) => player.id === next.currentPlayerId)?.name ?? "Table";
      addEvent(next.phase === "gameOver" ? `${nextName} won the game` : `Round ${next.round} is ready to shake`, "quiet", nextName);
      clearCallTimers();
      setCallPresentation(null);
      setRoundBids({});
      setGame(next);
      prepareControls();
      if (next.phase === "playing") {
        startRollGate(next.round);
        safePlaySound("nextRound");
      } else safePlaySound("winner");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The next round could not start.");
    }
  };

  const userStatus = !rollComplete ? roundRoll.userRolling ? "Shaking your cup" : roundRoll.readyIds.includes(USER_ID) ? "Ready · waiting for cups" : "Roll to begin" : isYourTurn ? "Your turn · make a move" : game.phase === "playing" ? `Waiting for ${currentPlayer?.name ?? "the table"}` : game.phase === "reveal" ? "Round revealed" : "Game complete";
  const controlsDisabled = !isYourActionTurn;
  const visibleHand = roundRoll.userRolling && shuffleFaces ? shuffleFaces : user.hand;
  const formattedTime = secondsLeft === undefined ? undefined : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const turnTimer = formattedTime && <div className={`tp-turn-timer${secondsLeft! <= 10 ? " tp-turn-timer--urgent" : ""}`} role="timer" aria-label={`${secondsLeft} seconds remaining`}><span>{formattedTime}</span><small>{isYourActionTurn ? "your turn" : "turn timer"}</small></div>;

  return (
    <main className="table-prototype-shell">
      <header className="tp-header">
        <div><p className="tp-eyebrow">{isSpectating ? "Offline spectator table" : `Offline engine · ${user.name} + bots`}</p><h1>Cachito</h1></div>
        <div className="tp-header-actions">
          <label className="tp-player-count-control"><span>Players</span><select aria-label="Offline players" value={playerCount} onChange={(event) => choosePlayerCount(Number(event.target.value))}>{Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => index + MIN_PLAYERS).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <button className="tp-quiet-button" type="button" onClick={() => restartGame()}>Restart</button>
          {user.diceCount > 0 && !spectatorMode && <button className="tp-quiet-button tp-watch-toggle" type="button" disabled={roundRoll.userRolling} onClick={() => { setSpectatorMode(true); prepareControls(); }}>Watch table</button>}
          <label className="tp-mystery-toggle"><input type="checkbox" checked={revealDistribution} onChange={(event) => setRevealDistribution(event.target.checked)} /><span>Reveal seat totals</span></label>
          <button className="tp-quiet-button tp-feed-toggle" type="button" aria-expanded={feedOpen} onClick={() => setFeedOpen((open) => !open)}>Activity <span>{events.length}</span></button>
          <button className="tp-quiet-button" type="button" onClick={onExit}>Back to current beta</button>
        </div>
      </header>

      <div className={`tp-play-layout${feedOpen ? " tp-play-layout--feed-open" : " tp-play-layout--feed-closed"}`}>
        <section className="tp-stage" aria-label={`${playerCount}-player offline table`}>
          <div className={`tp-table${roundRoll.userRolling ? " tp-table--shuffling" : ""}`}>
            <div className="tp-table-grain" aria-hidden="true" />
            <div className="tp-round-meta"><span>Offline engine</span><strong>Round {game.round}</strong><span>{game.paloFijo ? "Palo fijo" : "Normal play"}</span></div>
            {tableSeats.map(({ player, position }) => <PrototypePlayerSeat key={player.id} player={player} position={position} revealDistribution={revealDistribution} currentTurn={rollComplete && game.phase === "playing" && game.currentPlayerId === player.id} latestBid={roundBids[player.id]} rolling={!rollComplete && game.phase === "playing"} rollReady={roundRoll.readyIds.includes(player.id)} />)}
            {previewAlert && <div className="tp-table-alert" role="status"><span>Dudo called</span><strong>The full call sequence pauses before the reveal</strong><button type="button" aria-label="Dismiss Dudo alert" onClick={() => setPreviewAlert(false)}>×</button></div>}

            {game.phase === "reveal" ? callPresentation && !callPresentation.showHands ? <PrototypeCallout kind={callPresentation.kind} name={callPresentation.name} correct={callPresentation.correct} resolved={callPresentation.resolved} /> : <RoundResult state={game} onNext={nextRound} /> : game.phase === "gameOver" ? <PrototypeGameOver winnerName={game.players.find((player) => player.id === game.winnerId)?.name ?? "Player"} round={game.round} onRestart={() => restartGame()} /> : <>
              {!rollComplete && <RoundRollOverlay state={roundRoll} players={game.players} userName={user.name} spectating={isSpectating} onShake={shakeDice} />}
              <div className="tp-table-center">
                <DiceInventory inPlay={totalDice} startingTotal={startingTotal} />
                {game.currentBid ? <section className="tp-current-bid" aria-label={`Current bid: ${game.currentBid.quantity} ${denominationNames[game.currentBid.denomination]}`}><p>{game.players.find((player) => player.id === game.lastBidderId)?.name}’s bid</p><div><strong>{game.currentBid.quantity}</strong><span>×</span><b>{dieGlyphs[game.currentBid.denomination]}</b></div><h2>{denominationNames[game.currentBid.denomination]}</h2>{turnTimer}</section> : <section className="tp-current-bid tp-current-bid--empty"><p>Opening bid</p><h2>{currentPlayer?.name ?? "Table"}</h2>{turnTimer ?? <span className="tp-clock">Cups first</span>}</section>}
                <section className={`tp-exposed-dice${tableDice.length ? "" : " tp-exposed-dice--empty"}`}><div><span>Dice on table</span><small>{tableDicePlayers.length ? tableDicePlayers.map((player) => player.name).join(" · ") : "None yet"}</small></div>{tableDice.length > 0 && <DiceRow dice={tableDice} small />}</section>
              </div>
            </>}
          </div>

          {isSpectating ? <SpectatorDock user={user} currentPlayerName={currentPlayer?.name ?? (game.phase === "reveal" ? "Round result" : game.phase === "gameOver" ? "Game complete" : "Table")} currentBid={game.currentBid} round={game.round} totalDice={totalDice} formattedTime={formattedTime} eliminated={user.diceCount === 0} onReturn={() => { setSpectatorMode(false); prepareControls(); }} onActivity={() => setFeedOpen(true)} /> : <section className={`tp-action-dock${isYourActionTurn ? " tp-action-dock--your-turn" : ""}`} aria-label="Your hand and turn controls">
            <div className="tp-player-hud">
              <div className="tp-hud-owner"><div className="tp-avatar" aria-hidden="true">{initials(user.name)}</div><div><strong>{user.name}</strong><small>Your seat</small><span>{userStatus}</span></div></div>
              <div className="tp-hand"><div><p>{user.name}’s hand</p></div><DiceRow dice={visibleHand} className={`${roundRoll.userRolling ? "dice-row--shuffling" : ""}${tableRerolling ? " dice-row--table-reroll" : ""}`.trim()} selectedIndices={tableDiceMode ? tableDiceIndices : undefined} onDieClick={isYourActionTurn ? tableDiceMode ? toggleTableDie : (value) => chooseDenomination(value as DieValue) : undefined} getDieButtonLabel={(value, index, selected) => tableDiceMode ? `${selected ? "Remove" : "Choose"} die ${index + 1} for the table` : `Choose ${denominationNames[value as DieValue]} from die ${index + 1}`} />{tableDiceMode && <small className="tp-table-selection-help">Select up to {Math.max(1, user.hand.length - 1)} dice; one must stay private.</small>}</div>
            </div>
            <div className="tp-bid-builder"><div className="tp-quantity"><span>Quantity</span><div><button type="button" aria-label="Decrease quantity" disabled={controlsDisabled || quantity <= 1} onClick={() => stepQuantity(-1)}>−</button><strong>{quantity}</strong><button type="button" aria-label="Increase quantity" disabled={controlsDisabled || quantity >= maxQuantity} onClick={() => stepQuantity(1)}>+</button></div></div><div className="tp-denominations" aria-label="Choose denomination">{([1, 2, 3, 4, 5, 6] as DieValue[]).map((value) => <button type="button" key={value} aria-label={`Choose ${denominationNames[value]}`} aria-pressed={denomination === value} disabled={controlsDisabled || !minimumBidFor(value)} onClick={() => chooseDenomination(value)}><DenominationFace value={value} /></button>)}</div></div>
            <div className="tp-actions"><button className="tp-call tp-call--dudo" type="button" disabled={controlsDisabled || !legal.canDudo} onClick={() => call("dudo")}>Dudo</button><button className="tp-call tp-call--calzo" type="button" disabled={controlsDisabled || !legal.canCalzo} onClick={() => call("calzo")}>Calzo</button><button className="tp-table-dice-action" type="button" aria-pressed={tableDiceMode} disabled={controlsDisabled || !legal.canPutDiceOnTable && !tableDiceMode} onClick={() => { setTableDiceMode((active) => !active); setTableDiceIndices([]); safePlaySound("tableDice"); }}>{tableDiceMode ? "Cancel table dice" : user.tableDiceUsed ? "Dice already on table" : "Put dice on table"}</button><button className="tp-raise" type="button" disabled={controlsDisabled || !chosenLegal || tableDiceMode && !selectedTableDice.length} onClick={bid}>{tableDiceMode ? `Bid & put ${selectedTableDice.length || "…"} on table` : game.currentBid ? `Raise to ${quantity} ${denominationNames[denomination]}` : `Bid ${quantity} ${denominationNames[denomination]}`}</button></div>
            {error && <p className="tp-engine-error" role="alert">{error}</p>}
          </section>}
        </section>
        {feedOpen && <button className="tp-feed-backdrop" type="button" aria-label="Close table feed" onClick={() => setFeedOpen(false)} />}
        <TableFeed events={events} currentPlayerName={currentPlayer?.name ?? "Round complete"} isYourTurn={isYourActionTurn} onPreviewAlert={() => setPreviewAlert(true)} onClose={() => setFeedOpen(false)} />
      </div>
    </main>
  );
}
