import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createGame,
  createSeededRandom,
  getLegalActions,
  projectForAdminSpectator,
  projectForPlayer,
  projectForSpectator,
  type Bid,
  type Die,
  type GameState,
  type PublicGameView,
  type RandomSource,
} from "./engine";
import {
  chooseBotAction,
  createProbabilityPolicy,
  isChoiceLegal,
  type BotObservation,
  type BotChoice,
  type PublicActionEntry,
  type PublicRoundOutcome,
} from "./bot";
import {
  createBotDecisionRecord,
  createGameLogBuilder,
  saveGameLogInBackground,
  serializeGameLog,
  type GameLog,
} from "./analytics";
import { DiceRow, Die as DieFace } from "./ui/Dice";
import { SetupScreen, type LocalSeatSetup } from "./ui/SetupScreen";
import { playSound, useGenericButtonSounds } from "./ui/sound";
import { OnlineGame } from "./online/OnlineGame";
import "./styles.css";

type LogEntry = { id: number; text: string };
type ViewMode = "player" | "spectator" | "admin";
type BackgroundSaveState = "idle" | "saving" | "saved" | "unavailable";

const denominationNames: Record<Die, string> = {
  1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas",
};

const botPolicy = createProbabilityPolicy();
export const BOT_TURN_DELAY_MIN_MS = 6_000;
export const BOT_TURN_DELAY_SPREAD_MS = 2_000;

function playerName(view: PublicGameView, id: string | null | undefined) {
  return view.players.find((player) => player.id === id)?.name ?? "Unknown player";
}

function formatBid(bid: Bid) {
  return `${bid.quantity} ${denominationNames[bid.denomination]}`;
}

function backgroundSaveLabel(state: BackgroundSaveState): string {
  if (state === "saving") return "Saving log…";
  if (state === "saved") return "Log saved";
  if (state === "unavailable") return "Autosave unavailable";
  return "Log pending";
}

export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [showOnlineGame, setShowOnlineGame] = useState(() => /^\/join\/[A-Z0-9]{5}\/?$/i.test(window.location.pathname));
  const [viewMode, setViewMode] = useState<ViewMode>("player");
  const [handRevealed, setHandRevealed] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [backgroundSaveState, setBackgroundSaveState] = useState<BackgroundSaveState>("idle");
  const [botPlayerIds, setBotPlayerIds] = useState<Set<string>>(() => new Set());
  const gameRef = useRef<GameState | null>(null);
  const actionHistoryRef = useRef<PublicActionEntry[]>([]);
  const botRandomsRef = useRef<Map<string, RandomSource>>(new Map());
  const diceRandomRef = useRef<RandomSource>(createSeededRandom(0xcac1170));
  const gameSequenceRef = useRef(0);
  const gameSeedRef = useRef<number | null>(null);
  const gameStartedAtRef = useRef<string | null>(null);
  const gameLogRef = useRef<ReturnType<typeof createGameLogBuilder> | null>(null);
  const backgroundSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const backgroundSaveSequenceRef = useRef(0);
  const pendingBotTurnRef = useRef<string | null>(null);
  const lastTurnRef = useRef<string | null>(null);
  const lastResolvedRoundRef = useRef<string | null>(null);
  const lastWinnerRef = useRef<string | null>(null);
  // Firebase Hosting publishes the prebuilt static bundle, so rooms stay enabled
  // unless a deployment deliberately turns them off.
  const onlineEnabled = import.meta.env.VITE_ENABLE_ONLINE !== "false";
  useGenericButtonSounds();

  useEffect(() => {
    if (!game || game.phase !== "playing") {
      lastTurnRef.current = null;
      return;
    }
    const turn = `${game.round}:${game.currentPlayerId}`;
    if (lastTurnRef.current !== turn) {
      playSound("turnPass");
      lastTurnRef.current = turn;
    }
  }, [game]);

  useEffect(() => {
    if (!game || game.phase !== "gameOver" || lastWinnerRef.current === game.winnerId) return;
    lastWinnerRef.current = game.winnerId;
    playSound("winner");
  }, [game]);

  useEffect(() => {
    if (!game || game.phase !== "reveal") return;
    const resolution = game.resolution;
    const round = `${game.round}:${resolution.kind}:${resolution.callerId}`;
    if (lastResolvedRoundRef.current === round) return;
    lastResolvedRoundRef.current = round;
    playSound("suspense");
    const resultTimer = window.setTimeout(() => {
      playSound(resolution.correct ? "rightGuess" : "wrongGuess");
      if (resolution.diceChanges.some((change) => change.after === 0)) playSound("dead");
    }, 1_100);
    return () => window.clearTimeout(resultTimer);
  }, [game]);

  const addLog = useCallback((text: string) => {
    setLogs((current) => [{ id: (current[0]?.id ?? -1) + 1, text }, ...current]);
  }, []);

  const enqueueBackgroundSave = useCallback((log: GameLog) => {
    const sequence = ++backgroundSaveSequenceRef.current;
    const snapshot = structuredClone(log);
    setBackgroundSaveState("saving");
    backgroundSaveQueueRef.current = backgroundSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await saveGameLogInBackground(snapshot);
          if (backgroundSaveSequenceRef.current === sequence) setBackgroundSaveState("saved");
        } catch {
          if (backgroundSaveSequenceRef.current === sequence) setBackgroundSaveState("unavailable");
        }
      });
  }, []);

  const startGame = (seats: LocalSeatSetup[]) => {
    gameSequenceRef.current += 1;
    const gameSeed = 0xcac1170 + gameSequenceRef.current * 10_007;
    const startedAt = new Date().toISOString();
    gameSeedRef.current = gameSeed;
    gameStartedAtRef.current = startedAt;
    diceRandomRef.current = createSeededRandom(gameSeed);
    const players = seats.map((seat, index) => ({ id: `player-${index + 1}`, name: seat.name }));
    const initial = createGame(players, diceRandomRef.current);
    const botIds = new Set(seats.flatMap((seat, index) => seat.isBot ? [`player-${index + 1}`] : []));
    botRandomsRef.current = new Map(
      [...botIds].map((id, index) => [id, createSeededRandom(gameSeed + 1_009 + index * 97)]),
    );
    actionHistoryRef.current = [];
    const logBuilder = createGameLogBuilder({
      seed: gameSeed,
      startedAt,
      seats: seats.map((seat, index) => ({
        id: `player-${index + 1}`,
        name: seat.name,
        controller: seat.isBot ? "bot" : "human",
        ...(seat.isBot ? { policyName: botPolicy.name } : {}),
      })),
    });
    gameLogRef.current = logBuilder;
    enqueueBackgroundSave(logBuilder.snapshot());
    pendingBotTurnRef.current = null;
    gameRef.current = initial;
    setGame(initial);
    setBotPlayerIds(botIds);
    setViewMode("player");
    setHandRevealed(false);
    setLogs([{ id: 0, text: `${seats[0].name} opens the first round.` }]);
    setError(null);
  };

  useEffect(() => {
    if (!game || game.phase !== "playing" || !botPlayerIds.has(game.currentPlayerId)) {
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
          history: [...actionHistoryRef.current],
        };
        const random = botRandomsRef.current.get(playerId);
        if (!random) throw new Error(`Missing decision random source for ${playerId}`);
        const { choice, trace } = chooseBotAction(botPolicy, observation, random);
        if (!isChoiceLegal(observation, choice)) throw new Error("Bot selected an illegal action");

        const action = choice.type === "bid"
          ? { type: "bid" as const, playerId, bid: choice.bid }
          : { type: choice.type, playerId };
        const next = applyAction(game, action);
        const logBuilder = gameLogRef.current;
        logBuilder?.recordBotDecision(createBotDecisionRecord(observation, botPolicy.name, choice, trace));
        logBuilder?.recordPublicAction({ round: game.round, playerId, action: choice });
        if (next.phase === "reveal") logBuilder?.recordRoundResolution(next);
        if (logBuilder) enqueueBackgroundSave(logBuilder.snapshot());
        gameRef.current = next;
        const outcome: PublicRoundOutcome | undefined = next.phase === "reveal"
          ? { kind: next.resolution.kind, bidderId: next.resolution.bidderId, bid: { ...next.resolution.bid }, correct: next.resolution.correct }
          : undefined;
        actionHistoryRef.current.push({ round: game.round, playerId, action: choice, outcome });
        setGame(next);
        setError(null);
        setHandRevealed(false);
        const name = playerName(projectForSpectator(game), playerId);
        const text = choice.type === "bid"
          ? `${name} bids ${formatBid(choice.bid)}.`
          : `${name} calls ${choice.type === "dudo" ? "Dudo" : "Calzo"}!`;
        addLog(text);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The bot could not choose an action.");
      } finally {
        pendingBotTurnRef.current = null;
      }
    }, BOT_TURN_DELAY_MIN_MS + Math.floor(Math.random() * BOT_TURN_DELAY_SPREAD_MS));

    return () => {
      window.clearTimeout(timer);
      if (pendingBotTurnRef.current === turnKey) pendingBotTurnRef.current = null;
    };
  }, [addLog, enqueueBackgroundSave, game, botPlayerIds]);

  if (!game) {
    return showOnlineGame
      ? <OnlineGame onExit={() => { window.history.replaceState({}, "", "/"); setShowOnlineGame(false); }} />
      : <SetupScreen onStart={startGame} onOpenOnline={onlineEnabled ? () => setShowOnlineGame(true) : undefined} />;
  }

  const activePlayerId = game.phase === "playing" ? game.currentPlayerId : null;
  const botTurn = activePlayerId !== null && botPlayerIds.has(activePlayerId);
  const view = viewMode === "admin"
    ? projectForAdminSpectator(game)
    : viewMode === "spectator" || !activePlayerId || botTurn
      ? projectForSpectator(game)
      : projectForPlayer(game, activePlayerId);
  const spectating = viewMode !== "player";

  const act = (action: Parameters<typeof applyAction>[1], logText?: string, publicChoice?: BotChoice) => {
    try {
      const next = applyAction(game, action, diceRandomRef.current);
      const logBuilder = gameLogRef.current;
      let logChanged = false;
      if (publicChoice && "playerId" in action) {
        logBuilder?.recordPublicAction({ round: game.round, playerId: action.playerId, action: publicChoice });
        logChanged = true;
      }
      if (next.phase === "reveal") {
        logBuilder?.recordRoundResolution(next);
        logChanged = true;
      }
      if (next.phase === "gameOver") {
        logBuilder?.finalize(next.winnerId);
        logChanged = true;
      }
      if (logBuilder && logChanged) enqueueBackgroundSave(logBuilder.snapshot());
      gameRef.current = next;
      setGame(next);
      setError(null);
      if (logText) addLog(logText);
      if (publicChoice && "playerId" in action) {
        const outcome: PublicRoundOutcome | undefined = next.phase === "reveal"
          ? { kind: next.resolution.kind, bidderId: next.resolution.bidderId, bid: { ...next.resolution.bid }, correct: next.resolution.correct }
          : undefined;
        actionHistoryRef.current.push({ round: game.round, playerId: action.playerId, action: publicChoice, outcome });
      }
      if (next.phase === "playing") setHandRevealed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That action is not allowed.");
    }
  };

  const downloadGameLog = () => {
    const builder = gameLogRef.current;
    const seed = gameSeedRef.current;
    const startedAt = gameStartedAtRef.current;
    if (!builder || seed === null || !startedAt) return;

    const blob = new Blob([serializeGameLog(builder.snapshot(), 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const dateStamp = startedAt.replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
    anchor.download = `cachito-${dateStamp}-seed-${seed}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (game.phase === "gameOver") {
    const winner = game.players.find((player) => player.id === game.winnerId);
    return (
      <main className="game-over">
        <section>
          <h1>{winner?.name} wins!</h1>
          <p className={`autosave-status autosave-status--${backgroundSaveState}`}>{backgroundSaveLabel(backgroundSaveState)}</p>
          <div className="game-over-actions">
            <button className="button button--ghost" onClick={downloadGameLog}>Download log</button>
            <button className="button button--primary" onClick={() => setGame(null)}>New game</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="game-shell">
      <header className="game-header">
        <div className="wordmark">Cachito</div>
        <div className="round-label">Round {view.round}{view.paloFijo ? " · Palo fijo" : ""}</div>
        <div className="header-actions">
          <span className={`autosave-status autosave-status--${backgroundSaveState}`} title="Saved to the local logs folder">
            {backgroundSaveLabel(backgroundSaveState)}
          </span>
          <button className="mode-button log-download-button" onClick={downloadGameLog}>Export log</button>
          <button className="mode-button" aria-pressed={viewMode === "player"} onClick={() => { setViewMode("player"); setHandRevealed(false); }}>Player</button>
          <button className="mode-button" aria-pressed={viewMode === "spectator"} onClick={() => { setViewMode("spectator"); setHandRevealed(false); }}>Spectator</button>
          <button className="mode-button mode-button--admin" aria-pressed={viewMode === "admin"} onClick={() => { setViewMode("admin"); setHandRevealed(false); }}>Admin</button>
        </div>
      </header>

      <div className="table-layout">
        <main className="table-main">
          <PlayersStrip view={view} botPlayerIds={botPlayerIds} />
          <section className="felt-table" aria-live="polite">
            {view.phase === "reveal"
              ? <Reveal view={view} spectator={spectating} onNext={() => {
                  const resolution = view.resolution;
                  const nextName = playerName(view, resolution?.nextStarterId);
                  playSound("nextRound");
                  act({ type: "nextRound" }, `A new round begins with ${nextName}.`);
                }} />
              : <PlayingTable
                  key={`${game.round}:${activePlayerId}:${game.currentBid?.quantity ?? 0}:${game.currentBid?.denomination ?? 0}`}
                  game={game}
                  view={view}
                  viewMode={viewMode}
                  botTurn={botTurn}
                  handRevealed={handRevealed}
                  error={error}
                  onBid={(bid) => {
                    const name = playerName(view, activePlayerId);
                    act({ type: "bid", playerId: activePlayerId!, bid }, `${name} bids ${formatBid(bid)}.`, { type: "bid", bid });
                  }}
                  onDudo={() => {
                    const name = playerName(view, activePlayerId);
                    act({ type: "dudo", playerId: activePlayerId! }, `${name} calls Dudo!`, { type: "dudo" });
                  }}
                  onCalzo={() => {
                    const name = playerName(view, activePlayerId);
                    act({ type: "calzo", playerId: activePlayerId! }, `${name} calls Calzo!`, { type: "calzo" });
                  }}
                />}
          </section>
        </main>
        <aside className="sidebar">
          <section className="side-card">
            <h2>Game history</h2>
            <ol className="log-list" aria-label="Game history">
              {logs.map((entry) => <li className="log-item" key={entry.id}>{entry.text}</li>)}
            </ol>
          </section>
          <section className="side-card rules-note">
            <h2>{view.paloFijo ? "Palo fijo" : "Rules"}</h2>
            {view.paloFijo
              ? "Aces are not wild. Only a player with one die may change denomination."
              : "Aces are wild for every non-Aces bid. Raise the quantity, denomination, or call the bluff."}
          </section>
        </aside>
      </div>

      {view.phase === "playing" && !spectating && !botTurn && !handRevealed && (
        <PrivacyScreen player={playerName(view, activePlayerId)} onReveal={() => setHandRevealed(true)} />
      )}
    </div>
  );
}

function PlayersStrip({ view, botPlayerIds }: { view: PublicGameView; botPlayerIds: ReadonlySet<string> }) {
  return (
    <section className="players-strip" aria-label="Players">
      {view.players.map((player) => (
        <article className={`player-chip${player.id === view.currentPlayerId ? " player-chip--active" : ""}${player.eliminated ? " player-chip--out" : ""}${botPlayerIds.has(player.id) ? " player-chip--bot" : ""}`} key={player.id}>
          <div className="player-name">{player.name}{botPlayerIds.has(player.id) && <span className="player-type-badge">Bot</span>}</div>
          <div className="dice-count">{player.eliminated ? "Out" : <><span className="dice-dots">{"◆".repeat(player.diceCount)}</span> · {player.diceCount} {player.diceCount === 1 ? "die" : "dice"}</>}</div>
        </article>
      ))}
    </section>
  );
}

type PlayingProps = {
  game: GameState;
  view: PublicGameView;
  viewMode: ViewMode;
  botTurn: boolean;
  handRevealed: boolean;
  error: string | null;
  onBid: (bid: Bid) => void;
  onDudo: () => void;
  onCalzo: () => void;
};

function PlayingTable({ game, view, viewMode, botTurn, handRevealed, error, onBid, onDudo, onCalzo }: PlayingProps) {
  const currentId = view.currentPlayerId!;
  const legal = useMemo(() => getLegalActions(game, currentId), [game, currentId]);
  const firstLegalBid = legal.bids[0];
  const [quantity, setQuantity] = useState(firstLegalBid?.quantity ?? 1);
  const [denomination, setDenomination] = useState<Die>(firstLegalBid?.denomination ?? 2);
  const maxQuantity = game.players.reduce((sum, player) => sum + player.diceCount, 0);

  const chosenLegal = legal.bids.some((bid) => bid.quantity === quantity && bid.denomination === denomination);
  const currentPlayer = view.players.find((player) => player.id === currentId);
  const hand = currentPlayer?.hand ?? [];
  const spectating = viewMode !== "player";
  const admin = viewMode === "admin";
  const handRestrictedByPaloFijo = view.paloFijo && (currentPlayer?.diceCount ?? 0) > 1;

  return (
    <>
      <div>
        <p className="turn-kicker">{admin ? "Admin spectator" : viewMode === "spectator" ? "Spectator" : "Current turn"}</p>
        <h2 className="turn-name">{currentPlayer?.name}</h2>
        {view.paloFijo && <span className="palo-badge">Palo fijo</span>}
      </div>

      <CurrentBid view={view} />

      {botTurn && !admin ? (
        <section className="controls-card bot-choosing" aria-live="polite">
          <h3>Bot thinking…</h3>
          <p className="bot-thinking-copy">Considering the table before making a move.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      ) : spectating ? (
        <section className="controls-card">
          <h3>{admin ? "Admin spectator mode" : "Spectator view"}</h3>
          <p className="rules-note">{admin ? "Testing mode: all live hands are visible. Actions are disabled." : "Live hands and actions are hidden."}</p>
        </section>
      ) : (
        <section className="controls-card" aria-label="Turn controls">
          <div className="controls-title"><span>Bid</span><span>{legal.bids.length} legal bids</span></div>
          <div className="bid-inputs">
            <div>
              <label className="field-label" htmlFor="bid-quantity">Quantity</label>
              <div className="stepper">
                <button data-sound="number" onClick={() => { playSound("numDown"); setQuantity((value) => Math.max(1, value - 1)); }} disabled={quantity <= 1} aria-label="Decrease quantity">−</button>
                <span id="bid-quantity">{quantity}</span>
                <button data-sound="number" onClick={() => { playSound("numUp"); setQuantity((value) => Math.min(maxQuantity, value + 1)); }} disabled={quantity >= maxQuantity} aria-label="Increase quantity">+</button>
              </div>
            </div>
            <div>
              <span className="field-label">Denomination</span>
              <div className="denominations">
                {([1,2,3,4,5,6] as Die[]).map((value) => (
                  <button
                    className="denom-button"
                    key={value}
                    aria-pressed={denomination === value}
                    data-sound="denomination"
                    onClick={() => { playSound("denomination"); setDenomination(value); }}
                    disabled={!legal.bids.some((bid) => bid.quantity === quantity && bid.denomination === value)}
                    aria-label={`Choose ${denominationNames[value]}`}
                  ><span>{value}</span><small>{denominationNames[value]}</small></button>
                ))}
              </div>
            </div>
          </div>
          <div className="action-row">
            <button className="challenge-button challenge-button--dudo" onClick={onDudo} disabled={!legal.canDudo}>Dudo</button>
            <button className="challenge-button challenge-button--calzo" onClick={onCalzo} disabled={!legal.canCalzo}>Calzo</button>
            <button className="button button--primary" onClick={() => onBid({ quantity, denomination })} disabled={!chosenLegal}>{view.currentBid ? "Raise bid" : "Make bid"}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      )}

      <section className="hand-panel">
        <p className="hand-label">{admin ? "Admin: all hands" : viewMode === "spectator" ? "Hands hidden" : "Your dice"}</p>
        {admin ? (
          <div className="admin-hands">
            {view.players.filter((player) => !player.eliminated).map((player) => (
              <div className="admin-hand" key={player.id}>
                <strong>{player.name}</strong>
                <DiceRow dice={player.hand ?? []} small />
              </div>
            ))}
          </div>
        ) : viewMode === "spectator" || botTurn ? (
          <DiceRow dice={Array(currentPlayer?.diceCount ?? 0).fill(1)} hidden />
        ) : handRestrictedByPaloFijo ? (
          <p className="hand-restriction">During Palo Fijo, only players with one die may see their dice.</p>
        ) : handRevealed && <DiceRow dice={hand} />}
      </section>
    </>
  );
}

function CurrentBid({ view }: { view: PublicGameView }) {
  if (!view.currentBid) return <div className="current-bid bid-empty">No bid yet.</div>;
  return (
    <div className="current-bid bid-card">
      <span className="bid-quantity">{view.currentBid.quantity}</span>
      <DieFace value={view.currentBid.denomination} />
      <div className="bid-copy"><strong>{denominationNames[view.currentBid.denomination]}</strong><span>called by {playerName(view, view.lastBidderId)}</span></div>
    </div>
  );
}

function PrivacyScreen({ player, onReveal }: { player: string; onReveal: () => void }) {
  return (
    <div className="privacy-overlay" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <section className="privacy-card">
        <div className="cup" aria-hidden="true" />
        <p className="eyebrow">Pass the device</p>
        <h2 id="privacy-title">{player}'s turn</h2>
        <p>Make sure only {player} can see the screen.</p>
        <button className="button button--primary" autoFocus onClick={onReveal}>Continue</button>
      </section>
    </div>
  );
}

function Reveal({ view, spectator, onNext }: { view: PublicGameView; spectator: boolean; onNext: () => void }) {
  const resolution = view.resolution!;
  const caller = playerName(view, resolution.callerId);
  const changed = resolution.diceChanges[0];
  const changedName = playerName(view, changed.playerId);
  const result = resolution.kind === "dudo"
    ? `${caller}'s doubt was ${resolution.correct ? "right" : "wrong"}.`
    : `${caller}'s Calzo was ${resolution.correct ? "exact" : "incorrect"}.`;
  const changeText = changed.delta > 0
    ? `${changedName} gains a die.`
    : changed.delta === 0
      ? `${changedName} stays at five dice.`
      : `${changedName} loses ${Math.abs(changed.delta)} ${Math.abs(changed.delta) === 1 ? "die" : "dice"}.`;

  return (
    <section className="reveal-panel">
      <div className="result-banner">
        <p className="turn-kicker">All hands revealed · {resolution.actualCount} actual</p>
        <h3>{result}</h3>
        <p>The bid was {formatBid(resolution.bid)}. {changeText}</p>
      </div>
      <div className="revealed-hands">
        {view.players.filter((player) => player.hand && player.hand.length > 0).map((player) => (
          <div className="revealed-hand" key={player.id}>
            <strong>{player.name}</strong>
            <DiceRow dice={player.hand!} small />
          </div>
        ))}
      </div>
      {spectator
        ? <p className="rules-note">Switch back to Player when the table is ready to start the next round.</p>
        : <button className="button button--primary" onClick={onNext}>Start next round <span aria-hidden="true">→</span></button>}
    </section>
  );
}
