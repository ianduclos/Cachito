import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { MatchAnalysis, MatchAnalysisPlayer, MatchAnalysisRoundStory } from "../analysis";
import type { Die, PublicGameView } from "../engine";
import { ConnectionNotice } from "./OnlineConnectionNotice";
import { useModalFocus } from "./OnlineModal";

const metricHelp = {
  bluff: "How often a final claim was unsupported when the dice were revealed. This describes the outcome, not whether the player meant to bluff. Early scores lean toward the table baseline.",
  aggression: "How strongly and quickly someone raised: bolder raises into uncertain bids score higher.",
  challenge: "How much risk someone accepted by calling Dudo or Calzo. Call accuracy is shown separately.",
} as const;

const metricLabels = { bluff: "Unsupported", aggression: "Aggression", challenge: "Challenge" } as const;
const denominationNames: Record<Die, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const dieGlyphs: Record<Die, string> = { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" };

/** Plain words for how far a revealed count landed from the final bid. */
function marginPhrase(margin: number): string {
  if (margin === 0) return "exactly true";
  if (margin > 0) return `${margin} more than claimed`;
  return `${Math.abs(margin)} short`;
}

function Help({ label, text }: { label: string; text: string }) {
  return <i className="analysis-help" tabIndex={0} data-tooltip={text} aria-label={`${label}: ${text}`}>?</i>;
}

function AnalysisMetric({ name, player }: { name: keyof MatchAnalysisPlayer["scores"]; player: MatchAnalysisPlayer }) {
  const score = player.scores[name];
  const label = metricLabels[name];
  return <div className="analysis-metric"><div><span>{label} <Help label={label} text={metricHelp[name]} /></span><strong>{score.value}</strong></div><div className="analysis-meter" aria-label={`${label} score ${score.value} out of 100`}><i style={{ width: `${score.value}%` }} /></div><small>{score.earlyRead ? `Early read · ${score.samples} ${score.samples === 1 ? "moment" : "moments"}` : `${score.samples} moments`}</small></div>;
}

function ClaimBreakdown({ player }: { player: MatchAnalysisPlayer }) {
  const stat = (name: keyof MatchAnalysisPlayer["stats"]) => player.stats[name] ?? 0;
  const rows = [
    { label: "Unsupported", help: "The final bid was above the number revealed. This is an outcome, not proof of intent.", total: stat("unsupportedFinalBids"), caught: stat("unsupportedCaught"), survived: stat("unsupportedSurvived") },
    { label: "Deliberate", help: "The persona bot explicitly chose a bluffing play. Human intent is not inferred.", total: player.controller === "bot" ? stat("deliberatePersonaBluffs") : undefined, caught: stat("deliberateBluffsCaught"), survived: stat("deliberateBluffsSurvived") },
    { label: "Forced raise", help: "No legal raise could be fully covered by that player’s own dice at the time.", total: stat("forcedEscalations"), caught: stat("forcedEscalationsCaught"), survived: stat("forcedEscalationsSurvived") },
  ];
  return <section className="analysis-claim-breakdown" aria-label={`${player.name} final bid breakdown`}>{rows.map((row) => <div key={row.label}><span>{row.label} <Help label={row.label} text={row.help} /></span><strong>{row.total ?? "—"}</strong><small>{row.total === undefined ? "Intent not recorded" : `${row.caught} caught · ${row.survived} survived`}</small></div>)}</section>;
}

/** Dice each player held after every round, as one absolute-count series per player. */
function diceSeries(analysis: MatchAnalysis): Array<{ playerId: string; counts: number[] }> {
  return analysis.startingDice.map(({ playerId, dice }) => ({
    playerId,
    counts: [dice, ...analysis.momentum.map((round) => round.players.find((entry) => entry.playerId === playerId)?.dice ?? 0)],
  }));
}

/**
 * Stacked-area SVG of dice held per player over the match. Absolute counts —
 * the shrinking total is the story. Not a win-probability chart.
 */
function DiceFlowChart({ analysis, colorOf, nameOf }: { analysis: MatchAnalysis; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string }) {
  const series = diceSeries(analysis);
  const points = series[0]?.counts.length ?? 0;
  if (points < 2) return null;
  const width = 640;
  const height = 170;
  const pad = { top: 8, right: 8, bottom: 20, left: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxTotal = Math.max(1, ...Array.from({ length: points }, (_, index) => series.reduce((sum, entry) => sum + entry.counts[index], 0)));
  const x = (index: number) => pad.left + (index / (points - 1)) * innerW;
  const y = (value: number) => pad.top + innerH - (value / maxTotal) * innerH;
  // Cumulative stacking in seat order; each band keeps its player's color.
  const stacked = series.map((entry, seriesIndex) => {
    const lower = Array.from({ length: points }, (_, index) => series.slice(0, seriesIndex).reduce((sum, below) => sum + below.counts[index], 0));
    const upper = lower.map((value, index) => value + entry.counts[index]);
    const forward = upper.map((value, index) => `${x(index)},${y(value)}`).join(" ");
    const backward = lower.map((value, index) => `${x(index)},${y(value)}`).reverse().join(" ");
    return { ...entry, path: `${forward} ${backward}` };
  });
  const gridLines = [Math.round(maxTotal / 2), maxTotal];
  const stories = new Map(analysis.roundStories.map((story) => [story.round, story]));
  return (
    <figure className="analysis-flow" role="img" aria-label={`Dice held by each player across ${points - 1} rounds`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {gridLines.map((line) => <g key={line}><line className="analysis-flow-grid" x1={pad.left} x2={width - pad.right} y1={y(line)} y2={y(line)} /><text className="analysis-flow-tick" x={pad.left - 5} y={y(line) + 3} textAnchor="end">{line}</text></g>)}
        {stacked.map((entry) => <polygon key={entry.playerId} points={entry.path} fill={colorOf(entry.playerId)} stroke="var(--analysis-surface)" strokeWidth="2" />)}
        {Array.from({ length: points }, (_, index) => {
          const label = index === 0
            ? "Start"
            : `After round ${index}${stories.get(index) ? ` — ${nameOf(stories.get(index)!.callerId)} called ${stories.get(index)!.kind === "dudo" ? "Dudo" : "Calzo"} (${stories.get(index)!.correct ? "right" : "wrong"})` : ""}`;
          const detail = series.map((entry) => `${nameOf(entry.playerId)}: ${entry.counts[index]}`).join(" · ");
          return <g key={index}>
            <rect className="analysis-flow-hover" x={x(index) - innerW / (points - 1) / 2} y={pad.top} width={innerW / (points - 1)} height={innerH}><title>{`${label}\n${detail}`}</title></rect>
            <text className="analysis-flow-tick" x={x(index)} y={height - 6} textAnchor="middle">{index === 0 ? "start" : `R${index}`}</text>
          </g>;
        })}
      </svg>
      <figcaption>Band height = dice that player still held. The whole shape shrinking is the match burning down. Hover a column for exact counts.</figcaption>
    </figure>
  );
}

function LadderBars({ story, maxQuantity, colorOf, nameOf }: { story: MatchAnalysisRoundStory; maxQuantity: number; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string }) {
  return <span className="analysis-ladder" aria-label={`${story.bids.length} bids this round`}>
    {story.bids.map((bid, index) => <i
      key={index}
      style={{ height: `${18 + (bid.quantity / Math.max(1, maxQuantity)) * 26}px`, background: colorOf(bid.playerId) } as CSSProperties}
      title={`${nameOf(bid.playerId)}: ${bid.quantity} × ${denominationNames[bid.denomination]}${bid.tableDice ? ` · put ${bid.tableDice} ${bid.tableDice === 1 ? "die" : "dice"} on the table` : ""}`}
      className={bid.tableDice ? "analysis-ladder-bar analysis-ladder-bar--table" : "analysis-ladder-bar"}
    >{dieGlyphs[bid.denomination]}</i>)}
  </span>;
}

/** One row per round: the public ladder, the call, and how the reveal landed. */
function RoundRail({ analysis, colorOf, nameOf }: { analysis: MatchAnalysis; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string }) {
  if (!analysis.roundStories.length) return null;
  const maxQuantity = Math.max(...analysis.roundStories.flatMap((story) => story.bids.map((bid) => bid.quantity)), 1);
  return <section className="analysis-rounds" aria-label="Round by round">
    <div><h3>Round by round</h3><small>Every bid in order, then who called and what the dice actually said.</small></div>
    <ol>
      {analysis.roundStories.map((story) => {
        const finalBid = story.bids.at(-1);
        return <li key={story.round}>
          <b>R{story.round}{story.paloFijo && <em title="Palo Fijo round: aces were not wild."> PF</em>}</b>
          <LadderBars story={story} maxQuantity={maxQuantity} colorOf={colorOf} nameOf={nameOf} />
          <span className={`analysis-call analysis-call--${story.correct ? "right" : "wrong"}`}>
            <strong>{nameOf(story.callerId)} → {story.kind === "dudo" ? "Dudo" : "Calzo"} {story.correct ? "✓" : "✗"}</strong>
            <small>
              {finalBid ? `${nameOf(story.bidderId)}’s ${finalBid.quantity} × ${denominationNames[finalBid.denomination]}` : "the final bid"} was {marginPhrase(story.margin)} — {story.actualCount} on the table.
              {story.diceChanges.map((change) => ` ${nameOf(change.playerId)} ${change.delta > 0 ? `gains ${change.delta}` : `loses ${Math.abs(change.delta)}`}.`).join("")}
            </small>
          </span>
        </li>;
      })}
    </ol>
  </section>;
}

/** Every challenge in the match, grouped by caller, with margins in plain words. */
function CallBoard({ analysis, colorOf, nameOf }: { analysis: MatchAnalysis; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string }) {
  const byCaller = new Map<string, MatchAnalysisRoundStory[]>();
  for (const story of analysis.roundStories) {
    byCaller.set(story.callerId, [...(byCaller.get(story.callerId) ?? []), story]);
  }
  if (!byCaller.size) return null;
  return <section className="analysis-callboard" aria-label="Calls and accuracy">
    <div><h3>Who dared to call</h3><small>Each Dudo and Calzo, and how close the truth was. “Exactly true” means the bid was a Calzo waiting to happen.</small></div>
    <div className="analysis-callboard-grid">
      {[...byCaller.entries()].map(([callerId, calls]) => {
        const right = calls.filter((call) => call.correct).length;
        return <article key={callerId}>
          <header><span className="analysis-player-dot" style={{ background: colorOf(callerId) }} /><strong>{nameOf(callerId)}</strong><small>{right}/{calls.length} right</small></header>
          <ul>
            {calls.map((call) => <li key={call.round} className={call.correct ? "analysis-callchip analysis-callchip--right" : "analysis-callchip analysis-callchip--wrong"}>
              <b>R{call.round} {call.kind === "dudo" ? "Dudo" : "Calzo"} {call.correct ? "✓" : "✗"}</b>
              <span>on {nameOf(call.bidderId)} · bid was {marginPhrase(call.margin)}</span>
            </li>)}
          </ul>
        </article>;
      })}
    </div>
  </section>;
}

/** Small per-player dice trajectory, drawn from the same data as the flow chart. */
function DiceSparkline({ counts, color }: { counts: number[]; color: string }) {
  if (counts.length < 2) return null;
  const width = 132;
  const height = 34;
  const max = Math.max(...counts, 1);
  const points = counts.map((value, index) => `${2 + (index / (counts.length - 1)) * (width - 4)},${height - 3 - (value / max) * (height - 8)}`).join(" ");
  return <svg className="analysis-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Dice per round: ${counts.join(", ")}`}>
    <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx={Number(points.split(" ").at(-1)?.split(",")[0])} cy={Number(points.split(" ").at(-1)?.split(",")[1])} r="3" fill={color} />
  </svg>;
}

/** Which faces this player kept bidding, from the public ladder record. */
function FaceBars({ playerId, analysis }: { playerId: string; analysis: MatchAnalysis }) {
  const counts = new Map<Die, number>();
  for (const story of analysis.roundStories) for (const bid of story.bids) {
    if (bid.playerId === playerId) counts.set(bid.denomination, (counts.get(bid.denomination) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const max = Math.max(...counts.values());
  return <div className="analysis-faces" aria-label="Faces this player bid on">
    <span>Bid faces <Help label="Bid faces" text="How often this player named each face across every public bid — a fingerprint of their story-telling, not of their actual dice." /></span>
    <div>{([1, 2, 3, 4, 5, 6] as Die[]).map((die) => {
      const count = counts.get(die) ?? 0;
      return <div key={die} title={`${denominationNames[die]}: ${count} ${count === 1 ? "bid" : "bids"}`}><i style={{ height: `${count ? 4 + (count / max) * 22 : 2}px` }} data-empty={count === 0 ? "" : undefined} /><b>{dieGlyphs[die]}</b></div>;
    })}</div>
  </div>;
}

function GameAnalysisPanel({ analysis, onClose }: { analysis: MatchAnalysis; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const seatIndex = new Map(analysis.players.map((player, index) => [player.id, index]));
  const colorOf = (playerId: string) => `var(--analysis-player-${(seatIndex.get(playerId) ?? 0) % 8})`;
  const nameOf = (playerId: string) => analysis.players.find((player) => player.id === playerId)?.name ?? "Someone";
  const calls = analysis.roundStories.length;
  const rightCalls = analysis.roundStories.filter((story) => story.correct).length;
  const exactBids = analysis.roundStories.filter((story) => story.margin === 0).length;
  const tableDicePlays = analysis.players.reduce((sum, player) => sum + player.stats.tableDicePlays, 0);
  const series = diceSeries(analysis);
  const tiles = [
    { label: "Rounds", value: String(analysis.rounds), note: `${analysis.totalTurns} turns` },
    { label: "Calls", value: `${rightCalls}/${calls}`, note: "ended right", help: "Every round ends with a Dudo or Calzo. This is how many of those calls were correct." },
    { label: "Knife-edge bids", value: String(exactBids), note: "exactly true", help: "Final bids where the revealed count matched the claim exactly — the boldest true bids in the game." },
    { label: "Table dice", value: String(tableDicePlays), note: "public commitments", help: "Times a player revealed part of their hand to back a bid and rerolled the rest." },
  ];
  return <section className="game-analysis" role="dialog" aria-modal="true" aria-label="Game analysis" tabIndex={-1} ref={dialogRef}>
    <header><div><p>Completed match · {analysis.rounds} {analysis.rounds === 1 ? "round" : "rounds"}</p><h2>Game analysis</h2><strong>{analysis.headline}</strong></div><button className="button button--ghost" type="button" onClick={onClose}>Back to winner</button></header>
    <div className="analysis-scroll">
      <section className="analysis-tiles" aria-label="Match at a glance">
        {tiles.map((tile) => <div key={tile.label}><span>{tile.label}{tile.help && <> <Help label={tile.label} text={tile.help} /></>}</span><strong>{tile.value}</strong><small>{tile.note}</small></div>)}
      </section>
      {analysis.keyMoment && <section className="analysis-key-moment"><span>Turning point</span><strong>{analysis.keyMoment}</strong></section>}
      <section className="analysis-momentum"><div><h3>The match, burning down</h3><small>Dice each player still held after every round — raw counts, not a chance of winning.</small></div>
        <DiceFlowChart analysis={analysis} colorOf={colorOf} nameOf={nameOf} />
        <div className="analysis-legend">{analysis.players.map((player) => <span key={player.id}><i style={{ background: colorOf(player.id) }} />{player.name}</span>)}</div>
      </section>
      <RoundRail analysis={analysis} colorOf={colorOf} nameOf={nameOf} />
      <CallBoard analysis={analysis} colorOf={colorOf} nameOf={nameOf} />
      <section className="analysis-player-grid">{analysis.players.map((player, index) => <article className={`analysis-player${player.winner ? " analysis-player--winner" : ""}`} key={player.id} style={{ "--player-color": `var(--analysis-player-${index % 8})` } as CSSProperties}>
        <header><div><span className="analysis-player-dot" /><h3>{player.name}</h3>{player.winner && <b>Winner</b>}</div>{player.controller === "bot" && <small>{player.persona ?? "Bot"}</small>}</header>
        <DiceSparkline counts={series.find((entry) => entry.playerId === player.id)?.counts ?? []} color={`var(--analysis-player-${index % 8})`} />
        <p>{player.verdict}</p>
        <div className="analysis-metrics"><AnalysisMetric name="bluff" player={player} /><AnalysisMetric name="aggression" player={player} /><AnalysisMetric name="challenge" player={player} /></div>
        <ClaimBreakdown player={player} />
        <FaceBars playerId={player.id} analysis={analysis} />
        <dl><div><dt>Bids</dt><dd>{player.stats.bids}</dd></div><div><dt>Dudo</dt><dd>{player.stats.dudoCorrect}/{player.stats.dudoAttempts}</dd></div><div><dt>Calzo</dt><dd>{player.stats.calzoCorrect}/{player.stats.calzoAttempts}</dd></div><div><dt>Dice swing</dt><dd>{player.stats.diceGained ? `+${player.stats.diceGained}` : "0"} / −{player.stats.diceLost}</dd></div></dl>
        {player.moment && <aside><span>Defining moment</span>{player.moment}</aside>}
        {player.botReasoning?.length ? <details><summary>What this bot was thinking</summary>{player.botReasoning.map((reason, reasonIndex) => <p key={`${reason.round}-${reasonIndex}`}><b>Round {reason.round} · {reason.action}</b>{reason.explanation}</p>)}</details> : null}
      </article>)}</section>
      <p className="analysis-caveat">Style numbers describe what happened at this table — they are not skill ratings, and small samples lean on typical-table baselines (marked “Early read”).</p>
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
