import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { MatchAnalysis, MatchAnalysisPlayer } from "../analysis";
import type { PublicGameView } from "../engine";
import { ConnectionNotice } from "./OnlineConnectionNotice";
import { useModalFocus } from "./OnlineModal";

const metricHelp = {
  bluff: "How often a final claim was unsupported when the dice were revealed. This describes the outcome, not whether the player meant to bluff. Early scores lean toward the table baseline.",
  aggression: "How strongly and quickly someone raised: bolder raises into uncertain bids score higher.",
  challenge: "How much risk someone accepted by calling Dudo or Calzo. Call accuracy is shown separately.",
} as const;

const metricLabels = { bluff: "Unsupported", aggression: "Aggression", challenge: "Challenge" } as const;

function AnalysisMetric({ name, player }: { name: keyof MatchAnalysisPlayer["scores"]; player: MatchAnalysisPlayer }) {
  const score = player.scores[name];
  const label = metricLabels[name];
  return <div className="analysis-metric"><div><span>{label} <i className="analysis-help" tabIndex={0} data-tooltip={metricHelp[name]} aria-label={`${label}: ${metricHelp[name]}`}>?</i></span><strong>{score.value}</strong></div><div className="analysis-meter" aria-label={`${label} score ${score.value} out of 100`}><i style={{ width: `${score.value}%` }} /></div><small>{score.earlyRead ? `Early read · ${score.samples} ${score.samples === 1 ? "moment" : "moments"}` : `${score.samples} moments`}</small></div>;
}

function ClaimBreakdown({ player }: { player: MatchAnalysisPlayer }) {
  const stat = (name: keyof MatchAnalysisPlayer["stats"]) => player.stats[name] ?? 0;
  const rows = [
    { label: "Unsupported", help: "The final bid was above the number revealed. This is an outcome, not proof of intent.", total: stat("unsupportedFinalBids"), caught: stat("unsupportedCaught"), survived: stat("unsupportedSurvived") },
    { label: "Deliberate", help: "The persona bot explicitly chose a bluffing play. Human intent is not inferred.", total: player.controller === "bot" ? stat("deliberatePersonaBluffs") : undefined, caught: stat("deliberateBluffsCaught"), survived: stat("deliberateBluffsSurvived") },
    { label: "Forced raise", help: "No legal raise could be fully covered by that player’s own dice at the time.", total: stat("forcedEscalations"), caught: stat("forcedEscalationsCaught"), survived: stat("forcedEscalationsSurvived") },
  ];
  return <section className="analysis-claim-breakdown" aria-label={`${player.name} final bid breakdown`}>{rows.map((row) => <div key={row.label}><span>{row.label} <i className="analysis-help" tabIndex={0} data-tooltip={row.help} aria-label={`${row.label}: ${row.help}`}>?</i></span><strong>{row.total ?? "—"}</strong><small>{row.total === undefined ? "Intent not recorded" : `${row.caught} caught · ${row.survived} survived`}</small></div>)}</section>;
}

function GameAnalysisPanel({ analysis, onClose }: { analysis: MatchAnalysis; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const recentMomentum = analysis.momentum.slice(-8);
  return <section className="game-analysis" role="dialog" aria-modal="true" aria-label="Game analysis" tabIndex={-1} ref={dialogRef}>
    <header><div><p>Completed match · {analysis.rounds} {analysis.rounds === 1 ? "round" : "rounds"}</p><h2>Game analysis</h2><strong>{analysis.headline}</strong></div><button className="button button--ghost" type="button" onClick={onClose}>Back to winner</button></header>
    <div className="analysis-scroll">
      {analysis.keyMoment && <section className="analysis-key-moment"><span>Turning point</span><strong>{analysis.keyMoment}</strong></section>}
      {recentMomentum.length > 0 && <section className="analysis-momentum"><div><h3>How the table shifted</h3><small>Share of the dice remaining after each round</small></div><div className="analysis-momentum-rounds">{recentMomentum.map((round) => <div key={round.round}><b>R{round.round}</b><span>{round.players.map((player, index) => <i key={player.playerId} title={`${analysis.players.find((entry) => entry.id === player.playerId)?.name}: ${player.dice} dice`} style={{ width: `${player.share}%`, "--player-color": `var(--analysis-player-${index % 8})` } as CSSProperties} />)}</span></div>)}</div></section>}
      <section className="analysis-player-grid">{analysis.players.map((player, index) => <article className={`analysis-player${player.winner ? " analysis-player--winner" : ""}`} key={player.id} style={{ "--player-color": `var(--analysis-player-${index % 8})` } as CSSProperties}>
        <header><div><span className="analysis-player-dot" /><h3>{player.name}</h3>{player.winner && <b>Winner</b>}</div>{player.controller === "bot" && <small>{player.persona ?? "Bot"}</small>}</header>
        <p>{player.verdict}</p>
        <div className="analysis-metrics"><AnalysisMetric name="bluff" player={player} /><AnalysisMetric name="aggression" player={player} /><AnalysisMetric name="challenge" player={player} /></div>
        <ClaimBreakdown player={player} />
        <dl><div><dt>Bids</dt><dd>{player.stats.bids}</dd></div><div><dt>Dudo</dt><dd>{player.stats.dudoCorrect}/{player.stats.dudoAttempts}</dd></div><div><dt>Calzo</dt><dd>{player.stats.calzoCorrect}/{player.stats.calzoAttempts}</dd></div><div><dt>Dice swing</dt><dd>{player.stats.diceGained ? `+${player.stats.diceGained}` : "0"} / −{player.stats.diceLost}</dd></div></dl>
        {player.moment && <aside><span>Defining moment</span>{player.moment}</aside>}
        {player.botReasoning?.length ? <details><summary>What this bot was thinking</summary>{player.botReasoning.map((reason, reasonIndex) => <p key={`${reason.round}-${reasonIndex}`}><b>Round {reason.round} · {reason.action}</b>{reason.explanation}</p>)}</details> : null}
      </article>)}</section>
    </div>
  </section>;
}

export function GameSummary({ view, analysis, history, connected, isHost, onReturnToLobby, onExit }: { view: PublicGameView; analysis?: MatchAnalysis; history: string[]; connected: boolean; isHost: boolean; onReturnToLobby: () => void; onExit: () => void }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const winner = view.players.find((player) => player.id === view.winnerId);
  const standings = [...view.players].sort((left, right) => Number(right.id === view.winnerId) - Number(left.id === view.winnerId) || right.diceCount - left.diceCount || left.name.localeCompare(right.name));
  const lastCall = history.find((entry) => !entry.endsWith("wins the match.")) ?? history[0];
  const confetti = Array.from({ length: 132 }, (_, index) => {
    const angle = (index * 137.508) * Math.PI / 180;
    const distance = 18 + (index % 11) * 7;
    return <i key={index} style={{ "--burst-x": `${Math.cos(angle) * distance}vw`, "--burst-y": `${Math.sin(angle) * distance * .62}vh`, "--drift": `${((index * 19) % 27) - 13}vw`, "--spin": `${540 + (index % 8) * 135}deg`, "--delay": `${(index % 24) * .028}s`, "--duration": `${2.9 + (index % 6) * .17}s`, width: `${5 + (index % 6)}px`, height: `${7 + (index % 8)}px` } as CSSProperties} />;
  });
  return <>{!showAnalysis && <><div className="tp-confetti" aria-hidden="true">{confetti}</div><section className="tp-game-over online-game-over-card" role="dialog" aria-label="Game winner"><ConnectionNotice connected={connected} context="game" /><p>Champion of the table</p><span className="tp-winner-crown" aria-hidden="true">♛</span><h2>{winner?.name} wins!</h2><strong>The table is theirs · {view.round} {view.round === 1 ? "round" : "rounds"}</strong><ol className="summary-standings">{standings.map((player, index) => <li key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><em>{player.id === view.winnerId ? "Winner" : player.diceCount ? `${player.diceCount} dice left` : "Out"}</em></li>)}</ol>{lastCall && <p className="summary-last-call">Last call: {lastCall}</p>}<div className="game-over-actions">{analysis && <button className="button game-analysis-button" onClick={() => setShowAnalysis(true)}>Game analysis</button>}{isHost && <button className="button button--primary" disabled={!connected} onClick={onReturnToLobby}>Return to lobby</button>}<button className="button button--ghost" disabled={!connected} onClick={onExit}>Leave game</button></div></section></>}{showAnalysis && analysis && <GameAnalysisPanel analysis={analysis} onClose={() => setShowAnalysis(false)} />}</>;
}
