import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { MatchAnalysis, MatchAnalysisPlayer, MatchAnalysisRoundStory } from "../analysis";
import type { Die, PublicGameView } from "../engine";
import { GameSettings } from "../ui/GameSettings";
import { ConnectionNotice } from "./OnlineConnectionNotice";
import { useModalFocus } from "./OnlineModal";
import { OnlineRoundReplay } from "./OnlineRoundReplay";

const denominationNames: Record<Die, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const dieGlyphs: Record<Die, string> = { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" };
const metricHelp = {
  bluff: "The average chance a claim was false when it was made, based on the player’s own visible dice and the public table.",
  aggression: "How strongly someone raised into uncertain bids.",
  challenge: "How much risk someone accepted by calling Dudo or Calzo. Accuracy is shown separately.",
} as const;
const metricLabels = { bluff: "Claim risk", aggression: "Aggression", challenge: "Challenge" } as const;

type BiggestLiar = {
  playerId: string;
  score?: number;
  deceptionPoints?: number;
  components: {
    scoredBids?: number;
    inventedFaceBids?: number;
    singleCopyBids?: number;
    whiteLieBids?: number;
    gratuitousOverraises?: number;
    excessRaiseSteps?: number;
    scoredUnsupportedCaught?: number;
    scoredUnsupportedSurvived?: number;
    // Recovery compatibility for matches completed before the choice-based award.
    unsupportedFinalBids?: number;
    unheldFaceBids?: number;
    averageUnheldFaceQuantity?: number;
  };
  widestScoredShortfall?: { round: number; bid: { quantity: number; denomination: Die }; actualCount: number; shortfall: number; callerId: string; caught: boolean };
  widestRevealedShortfall?: { round: number; bid: { quantity: number; denomination: Die }; actualCount: number; shortfall: number; callerId: string; caught: boolean };
};
type SignaturePlay = { round: number; kind: "correct-calzo" | "correct-dudo" | "bid-held"; actorId: string; counterpartId: string; counterpartAttributable: boolean; bid: { quantity: number; denomination: Die }; actualCount: number; callKind: "dudo" | "calzo"; diceChanges: Array<{ playerId: string; delta: number }>; ladderLength: number; tableDice: number; surprise: "long-shot" | "bold" | "notable" };
type AnalysisV5 = MatchAnalysis & { biggestLiar?: BiggestLiar; signaturePlay?: SignaturePlay };
type PlayerWithStyleRead = MatchAnalysisPlayer & { style?: string; styleRead?: string; badges?: Array<{ label: string; read: string }> };

function Help({ label, text }: { label: string; text: string }) {
  return <i className="analysis-help" tabIndex={0} data-tooltip={text} aria-label={`${label}: ${text}`}>?</i>;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function metric({ name, player }: { name: keyof MatchAnalysisPlayer["scores"]; player: MatchAnalysisPlayer }) {
  const score = player.scores[name];
  const label = metricLabels[name];
  const unit = name === "bluff" ? "bid" : name === "aggression" ? "raise" : "call";
  return <div className="analysis-metric"><div><span>{label} <Help label={label} text={metricHelp[name]} /></span><strong>{score.value}</strong></div><div className="analysis-meter" aria-label={`${label} score ${score.value} out of 100`}><i style={{ width: `${score.value}%` }} /></div><small>{score.earlyRead ? `Early read · ${countLabel(score.samples, unit)}` : countLabel(score.samples, unit)}</small></div>;
}

function ClaimBreakdown({ player }: { player: MatchAnalysisPlayer }) {
  const stats = player.stats;
  return <section className="analysis-claim-breakdown" aria-label={`${player.name} bidding evidence`}>
    <div><span>Unsupported <Help label="Unsupported final bids" text="Revealed final bids that landed above the count on the table." /></span><strong>{stats.unsupportedFinalBids}/{stats.verifiedFinalBids}</strong><small>{stats.unsupportedCaught} caught · {stats.unsupportedSurvived} survived</small></div>
    {player.controller === "bot" && <div><span>Deliberate <Help label="Deliberate persona bluffs" text="Times this bot explicitly chose a bluffing play." /></span><strong>{stats.deliberatePersonaBluffs}</strong><small>{stats.deliberateBluffsCaught} caught · {stats.deliberateBluffsSurvived} survived</small></div>}
    <div><span>Forced raise <Help label="Forced raise" text="No legal raise could be fully covered by that player’s own dice at the time." /></span><strong>{stats.forcedEscalations}</strong><small>{stats.forcedEscalationsCaught} caught · {stats.forcedEscalationsSurvived} survived</small></div>
    <div><span>Absent face <Help label="Absent face bids" text="All their bids that named a literal face absent from their visible hand. Covered timeout actions are excluded." /></span><strong>{stats.unheldFaceBids}</strong><small>{stats.unheldFaceBids ? `${stats.averageUnheldFaceQuantity.toFixed(1)} named on average` : "No attributable examples"}</small></div>
  </section>;
}

function diceSeries(analysis: MatchAnalysis) {
  return analysis.startingDice.map(({ playerId, dice }) => ({ playerId, counts: [dice, ...analysis.momentum.map((round) => round.players.find((entry) => entry.playerId === playerId)?.dice ?? 0)] }));
}

function DiceFlowChart({ analysis, colorOf, nameOf }: { analysis: MatchAnalysis; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string }) {
  const series = diceSeries(analysis);
  const points = series[0]?.counts.length ?? 0;
  if (points < 2) return null;
  const width = 720, height = 190, pad = { top: 8, right: 22, bottom: 24, left: 28 };
  const innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
  const maxTotal = Math.max(1, ...Array.from({ length: points }, (_, index) => series.reduce((sum, entry) => sum + entry.counts[index], 0)));
  const x = (index: number) => pad.left + (index / (points - 1)) * innerW;
  const y = (value: number) => pad.top + innerH - (value / maxTotal) * innerH;
  const stepPoints = (values: number[]) => values.flatMap((value, index) => index < values.length - 1 ? [`${x(index)},${y(value)}`, `${x(index + 1)},${y(value)}`] : [`${x(index)},${y(value)}`]);
  const stacked = series.map((entry, seriesIndex) => {
    const lower = Array.from({ length: points }, (_, index) => series.slice(0, seriesIndex).reduce((sum, below) => sum + below.counts[index], 0));
    const upper = lower.map((value, index) => value + entry.counts[index]);
    return { ...entry, path: `${stepPoints(upper).join(" ")} ${stepPoints(lower).reverse().join(" ")}` };
  });
  const stories = new Map(analysis.roundStories.map((story) => [story.round, story]));
  const tickEvery = Math.max(1, Math.ceil((points - 1) / 8));
  const ticks = new Set([0, points - 1, ...Array.from({ length: points }, (_, index) => index).filter((index) => index > 0 && index <= points - 1 - tickEvery && index % tickEvery === 0)]);
  const gridStep = maxTotal > 20 ? 10 : 5;
  const gridLines = Array.from({ length: Math.floor(maxTotal / gridStep) }, (_, index) => (index + 1) * gridStep);
  if (!gridLines.includes(maxTotal)) gridLines.push(maxTotal);
  return <figure className="analysis-flow" aria-labelledby="match-arc-title flow-caption">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Dice held by each player across ${points - 1} rounds`}>
      {gridLines.map((line) => <g key={line}><line className="analysis-flow-grid" x1={pad.left} x2={width - pad.right} y1={y(line)} y2={y(line)} /><text className="analysis-flow-tick" x={pad.left - 5} y={y(line) + 3} textAnchor="end">{line}</text></g>)}
      {stacked.map((entry) => <polygon key={entry.playerId} points={entry.path} fill={colorOf(entry.playerId)} stroke="var(--analysis-surface)" strokeWidth="2" />)}
      {Array.from({ length: points }, (_, index) => {
        const story = index > 0 ? stories.get(index) : undefined;
        const callRead = story
          ? story.callerAttributable === true
            ? `${nameOf(story.callerId)} called ${story.kind === "dudo" ? "Dudo" : "Calzo"}`
            : `a ${story.kind === "dudo" ? "Dudo" : "Calzo"} followed`
          : undefined;
        const label = index === 0 ? "Start" : `After round ${index}${story && callRead ? ` — ${callRead}, ${story.correct ? "right" : "wrong"}` : ""}`;
        const detail = series.map((entry) => `${nameOf(entry.playerId)}: ${entry.counts[index]}`).join(" · ");
        return <g key={index}><rect className="analysis-flow-hover" x={x(index) - innerW / (points - 1) / 2} y={pad.top} width={innerW / (points - 1)} height={innerH}><title>{`${label}\n${detail}`}</title></rect>{ticks.has(index) && <text className="analysis-flow-tick" x={x(index)} y={height - 7} textAnchor={index === points - 1 ? "end" : index === 0 ? "start" : "middle"}>{index === 0 ? "start" : `R${index}`}{story && <tspan className={story.correct ? "analysis-flow-mark--right" : "analysis-flow-mark--wrong"} dx="2">{story.correct ? "✓" : "✗"}</tspan>}</text>}</g>;
      })}
    </svg>
    <figcaption id="flow-caption">Band height is dice still held; each step is a public reveal. Round labels adapt to the match length.</figcaption>
    <details className="analysis-flow-values"><summary>View round values</summary><div><table><thead><tr><th>Round</th>{series.map((entry) => <th key={entry.playerId}>{nameOf(entry.playerId)}</th>)}</tr></thead><tbody>{Array.from({ length: points }, (_, index) => <tr key={index}><th>{index === 0 ? "Start" : index}</th>{series.map((entry) => <td key={entry.playerId}>{entry.counts[index]}</td>)}</tr>)}</tbody></table></div></details>
  </figure>;
}

function LadderBars({ story, maxQuantity, colorOf, nameOf }: { story: MatchAnalysisRoundStory; maxQuantity: number; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string }) {
  return <span className="analysis-ladder" aria-label={`${countLabel(story.bids.length, "bid")} this round`}>{story.bids.map((bid, index) => {
    const attributable = bid.attributable === true;
    const label = attributable
      ? `${nameOf(bid.playerId)}: ${bid.quantity} × ${denominationNames[bid.denomination]}`
      : `Covered bid ${index + 1}: ${bid.quantity} × ${denominationNames[bid.denomination]}`;
    return <i key={index} style={{ height: `${18 + (bid.quantity / Math.max(1, maxQuantity)) * 26}px`, background: attributable ? colorOf(bid.playerId) : "var(--analysis-covered-bid)" } as CSSProperties} title={label} aria-label={label} className={`analysis-ladder-bar${bid.tableDice ? " analysis-ladder-bar--table" : ""}${attributable ? "" : " analysis-ladder-bar--covered"}`}>{dieGlyphs[bid.denomination]}</i>;
  })}</span>;
}

function RoundTape({ analysis, colorOf, nameOf, onReplay, signatureRound }: { analysis: MatchAnalysis; colorOf: (playerId: string) => string; nameOf: (playerId: string) => string; onReplay: (story: MatchAnalysisRoundStory) => void; signatureRound?: number }) {
  const [filter, setFilter] = useState<"all" | "dudo" | "calzo" | "exact" | "elimination" | "table">("all");
  const eliminatedInRound = (story: MatchAnalysisRoundStory) => story.diceChanges.some((change) => {
    if (change.delta >= 0) return false;
    const after = analysis.momentum.find((round) => round.round === story.round)?.players.find((entry) => entry.playerId === change.playerId)?.dice;
    const before = story.round === 1
      ? analysis.startingDice.find((entry) => entry.playerId === change.playerId)?.dice
      : analysis.momentum.find((round) => round.round === story.round - 1)?.players.find((entry) => entry.playerId === change.playerId)?.dice;
    return after === 0 && (before ?? 0) > 0;
  });
  const stories = analysis.roundStories.filter((story) => filter === "all" || filter === story.kind || (filter === "exact" && story.margin === 0) || (filter === "elimination" && eliminatedInRound(story)) || (filter === "table" && story.bids.some((bid) => bid.tableDice)));
  const maxQuantity = Math.max(...analysis.roundStories.flatMap((story) => story.bids.map((bid) => bid.quantity)), 1);
  const headline = (story: MatchAnalysisRoundStory, bid: MatchAnalysisRoundStory["bids"][number] | undefined) => {
    if (!bid) return "The reveal settled the table.";
    const claim = `${bid.quantity} ${denominationNames[bid.denomination]}`;
    const callerAttributable = story.callerAttributable === true;
    const bidderAttributable = bid.attributable === true;
    const finalClaim = bidderAttributable ? `${nameOf(bid.playerId)}’s ${claim}` : `the final ${claim}`;
    if (!callerAttributable) {
      const reveal = story.actualCount === 1 ? "1 was there" : `${story.actualCount} were there`;
      return `A ${story.kind === "dudo" ? "Dudo" : "Calzo"} followed ${finalClaim}. ${reveal}.`;
    }
    if (!bidderAttributable) {
      if (story.kind === "calzo" && story.correct) return `${nameOf(story.callerId)} found the final claim exact: ${claim}.`;
      if (story.kind === "dudo" && story.correct) return `${nameOf(story.callerId)} called Dudo on the final claim. ${claim} walked in; ${story.actualCount} walked out.`;
      if (story.kind === "dudo") return `${nameOf(story.callerId)} called Dudo on the final claim. ${story.actualCount} backed ${claim}.`;
      return `${nameOf(story.callerId)} called Calzo on the final claim. ${claim} met ${story.actualCount}.`;
    }
    if (story.kind === "calzo" && story.correct) return `${nameOf(story.callerId)} found ${claim} exactly. Zero notes.`;
    if (story.kind === "dudo" && story.correct) return `${nameOf(story.callerId)} called Dudo. ${claim} walked in; ${story.actualCount} walked out.`;
    if (story.kind === "dudo") return `Dudo bounced. ${nameOf(bid.playerId)} had ${story.actualCount} for ${claim}.`;
    return `${nameOf(story.callerId)} called Calzo. ${claim} met ${story.actualCount}.`;
  };
  const badges = (story: MatchAnalysisRoundStory) => [
    ...(story.kind === "calzo" && story.correct ? ["Exact"] : []),
    ...(story.margin === 0 ? ["Exact landing"] : []),
    ...(story.paloFijo ? ["Palo Fijo"] : []),
    ...(story.bids.some((bid) => bid.tableDice) ? ["Table dice"] : []),
    ...(story.bids.length >= 6 ? [`${story.bids.length}-bid ladder`] : []),
    ...(story.diceChanges.some((change) => eliminatedInRound(story) && change.delta < 0) ? ["Elimination"] : []),
    ...(story.round === signatureRound ? ["Play of the match"] : []),
  ];
  return <section className="analysis-rounds" aria-label="Round tape"><div className="analysis-section-heading"><div><p>Round tape</p><h3>The stories worth opening</h3></div><small>Every ladder ends with a reveal. Pick one and play the whole round back.</small></div><div className="analysis-filters" aria-label="Filter rounds">{([ ["all", "All"], ["dudo", "Dudo"], ["calzo", "Calzo"], ["exact", "Exact"], ["elimination", "Eliminations"], ["table", "Table dice"] ] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}</div>{stories.length ? <ol>{stories.map((story) => { const finalBid = story.bids.at(-1); const storyBadges = badges(story); const finalClaim = finalBid ? `${finalBid.quantity} ${denominationNames[finalBid.denomination]}` : undefined; return <li key={story.round}><button type="button" className={`analysis-round-card analysis-round-card--${story.kind} ${story.correct ? "analysis-round-card--right" : "analysis-round-card--wrong"}`} onClick={() => onReplay(story)} aria-label={`Replay round ${story.round}: ${headline(story, finalBid)}`}><span className="analysis-round-card__round">R{story.round}</span><span className="analysis-round-card__story"><strong>{headline(story, finalBid)}</strong><span>{finalBid ? `${finalBid.attributable === true ? `${nameOf(finalBid.playerId)}’s final` : "Final claim:"} ${finalClaim} · ${story.actualCount === 1 ? "1 was" : `${story.actualCount} were`} there` : "Reveal"}</span><em>{storyBadges.map((badge) => <i key={badge}>{badge}</i>)}</em></span><LadderBars story={story} maxQuantity={maxQuantity} colorOf={colorOf} nameOf={nameOf} /><span className="analysis-round-card__action">Replay round <b aria-hidden="true">→</b></span></button></li>; })}</ol> : <div className="analysis-round-empty" role="status"><strong>No rounds match that filter.</strong><span>Try another story thread — the whole tape is still here.</span><button type="button" onClick={() => setFilter("all")}>Show all rounds</button></div>}</section>;
}

function DiceSparkline({ counts, color }: { counts: number[]; color: string }) {
  if (counts.length < 2) return null;
  const width = 132, height = 34, max = Math.max(...counts, 1);
  const points = counts.map((value, index) => `${2 + (index / (counts.length - 1)) * (width - 4)},${height - 3 - (value / max) * (height - 8)}`).join(" ");
  return <svg className="analysis-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Dice per round: ${counts.join(", ")}`}><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /><circle cx={Number(points.split(" ").at(-1)?.split(",")[0])} cy={Number(points.split(" ").at(-1)?.split(",")[1])} r="3" fill={color} /></svg>;
}

function FaceBars({ player }: { player: MatchAnalysisPlayer }) {
  const counts = player.stats.bidFaceCounts ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const max = Math.max(...Object.values(counts), 1);
  return <div className="analysis-faces" aria-label={`${player.name} attributable bids by face`}><span>Bid faces <Help label="Bid faces" text="Every attributable bid by face. Covered timeout actions are excluded." /></span><div>{([1, 2, 3, 4, 5, 6] as Die[]).map((die) => { const count = counts[die]; return <div key={die} title={`${denominationNames[die]}: ${countLabel(count, "bid")}`}><i style={{ height: `${count ? 4 + (count / max) * 22 : 2}px` }} data-empty={count === 0 ? "" : undefined} /><b>{dieGlyphs[die]}</b></div>; })}</div></div>;
}

function badgeFor(player: MatchAnalysisPlayer) {
  if (player.stats.calzoAttempts >= 2 && player.stats.calzoCorrect === player.stats.calzoAttempts) return `Calzo ${player.stats.calzoCorrect}/${player.stats.calzoAttempts}`;
  if (player.stats.dudoAttempts >= 3 && player.stats.dudoCorrect / player.stats.dudoAttempts >= .75) return `Dudo ${player.stats.dudoCorrect}/${player.stats.dudoAttempts}`;
  if (player.stats.tableDicePlays >= 3) return `${player.stats.tableDicePlays} table-dice plays`;
  return undefined;
}

function styleReadFor(player: MatchAnalysisPlayer) {
  const styled = player as PlayerWithStyleRead;
  const fallbackBadge = badgeFor(player);
  return {
    label: styled.style,
    evidence: styled.styleRead ?? player.verdict,
    badges: styled.badges ?? (fallbackBadge ? [{ label: fallbackBadge, read: fallbackBadge }] : []),
  };
}

function signatureSentence(signature: SignaturePlay, nameOf: (id: string) => string) {
  const reveal = `${signature.actualCount === 1 ? "One was" : `${signature.actualCount} were`} there.`;
  if (!signature.counterpartAttributable) {
    return signature.kind === "bid-held"
      ? `${nameOf(signature.actorId)} made it ${signature.bid.quantity} ${denominationNames[signature.bid.denomination]}. A ${signature.callKind === "dudo" ? "Dudo" : "Calzo"} followed. ${reveal}`
      : `${nameOf(signature.actorId)} called ${signature.callKind === "dudo" ? "Dudo" : "Calzo"} on ${signature.bid.quantity} ${denominationNames[signature.bid.denomination]}. ${reveal}`;
  }
  return `${nameOf(signature.actorId)} ${signature.kind === "bid-held" ? "made it" : signature.callKind === "calzo" ? "said Calzo on" : "said Dudo to"} ${signature.bid.quantity} ${denominationNames[signature.bid.denomination]}. ${signature.kind === "bid-held" ? `${nameOf(signature.counterpartId)} said ${signature.callKind === "dudo" ? "Dudo" : "Calzo"}.` : `${nameOf(signature.counterpartId)} made the final bid.`} ${reveal}`;
}

const surpriseLabels: Record<SignaturePlay["surprise"], string> = { "long-shot": "Long shot", bold: "Bold", notable: "Notable" };

function LiarAward({ liar, player, nameOf }: { liar: BiggestLiar; player: MatchAnalysisPlayer | undefined; nameOf: (id: string) => string }) {
  const shortfall = liar.widestScoredShortfall ?? liar.widestRevealedShortfall;
  const caught = liar.components.scoredUnsupportedCaught ?? player?.stats.unsupportedCaught ?? 0;
  const survived = liar.components.scoredUnsupportedSurvived ?? player?.stats.unsupportedSurvived ?? 0;
  const roast = player?.winner
    ? "Lied. Won. No notes."
    : survived > caught
      ? "Got away with it. Lost anyway."
      : "The dice kept the receipts.";
  const choiceEvidence = [
    liar.components.inventedFaceBids ? countLabel(liar.components.inventedFaceBids, "invented face") : undefined,
    liar.components.singleCopyBids ? countLabel(liar.components.singleCopyBids, "one-die stretch", "one-die stretches") : undefined,
    liar.components.gratuitousOverraises ? `${countLabel(liar.components.gratuitousOverraises, "unnecessary jump")} · ${countLabel(liar.components.excessRaiseSteps ?? 0, "extra step")}` : undefined,
    liar.components.whiteLieBids ? countLabel(liar.components.whiteLieBids, "polite little fib") : undefined,
  ].filter(Boolean).join(" · ");
  const legacyEvidence = `${countLabel(liar.components.unheldFaceBids ?? 0, "absent-face bid")} · ${countLabel(liar.components.unsupportedFinalBids ?? 0, "unsupported final bid")}`;
  return <section className="analysis-supporting-award" aria-label="Biggest liar explanation"><p>Biggest liar</p><h3>{nameOf(liar.playerId)}</h3><strong>{roast}</strong><span>{choiceEvidence || legacyEvidence}</span>{shortfall && <small>Widest exposed miss: R{shortfall.round}, {shortfall.bid.quantity} {denominationNames[shortfall.bid.denomination]} claimed, {shortfall.actualCount === 1 ? "1 was" : `${shortfall.actualCount} were`} there — {shortfall.shortfall} short.</small>}</section>;
}

function GameAnalysisPanel({ analysis: rawAnalysis, onClose }: { analysis: MatchAnalysis; onClose: () => void }) {
  const analysis = rawAnalysis as AnalysisV5;
  const [tab, setTab] = useState<"overview" | "tape">("overview");
  const [selectedStory, setSelectedStory] = useState<MatchAnalysisRoundStory>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.defaultPrevented) return; if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  const seatIndex = new Map(analysis.players.map((player, index) => [player.id, index]));
  const colorOf = (playerId: string) => `var(--analysis-player-${(seatIndex.get(playerId) ?? 0) % 8})`;
  const nameOf = (playerId: string) => analysis.players.find((player) => player.id === playerId)?.name ?? "they";
  const calls = analysis.roundStories.length, rightCalls = analysis.roundStories.filter((story) => story.correct).length, exactBids = analysis.roundStories.filter((story) => story.margin === 0).length, tableDicePlays = analysis.players.reduce((sum, player) => sum + player.stats.tableDicePlays, 0), series = diceSeries(analysis);
  const signature = analysis.signaturePlay;
  const selectTab = (nextTab: "overview" | "tape") => { setTab(nextTab); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  return <section className="game-analysis" role="dialog" aria-modal="true" aria-label="Game analysis" tabIndex={-1} ref={dialogRef}>
    <header><div><p>Completed match · {analysis.rounds} {analysis.rounds === 1 ? "round" : "rounds"}</p><h2>Game analysis</h2><strong>{analysis.headline}</strong></div><div className="analysis-header-actions"><nav aria-label="Analysis views"><button type="button" className={tab === "overview" ? "is-active" : ""} aria-current={tab === "overview" ? "page" : undefined} onClick={() => selectTab("overview")}>Overview</button><button type="button" className={tab === "tape" ? "is-active" : ""} aria-current={tab === "tape" ? "page" : undefined} onClick={() => selectTab("tape")}>Round tape</button></nav><GameSettings /><button className="button button--ghost" type="button" onClick={onClose}>Back to winner</button></div></header>
    <div className="analysis-scroll" ref={scrollRef}>{tab === "overview" ? <>
      <p className="analysis-scoreline">{countLabel(analysis.rounds, "round")} · {countLabel(analysis.totalTurns, "turn")} · {rightCalls} of {calls} calls landed · {countLabel(exactBids, "exact final bid")} · {countLabel(tableDicePlays, "table-dice play")}</p>
      <section className="analysis-momentum"><div className="analysis-editorial-rail"><p>The table remembers</p><h3>Play of the match</h3>{signature ? <button type="button" className="analysis-signature-replay" onClick={() => { const story = analysis.roundStories.find((entry) => entry.round === signature.round); if (story) setSelectedStory(story); }} aria-label={`Replay play of the match from round ${signature.round}`}><strong>Round {signature.round} · {surpriseLabels[signature.surprise]}</strong><span>{signatureSentence(signature, nameOf)}</span><em>Replay this round <b aria-hidden="true">→</b></em></button> : <span>{analysis.keyMoment ?? "The dice did not leave one defining public moment."}</span>}</div><div><h3 id="match-arc-title">Match arc</h3><small>Dice each player still held after every round — counts, not odds of winning.</small><DiceFlowChart analysis={analysis} colorOf={colorOf} nameOf={nameOf} /><div className="analysis-legend">{analysis.players.map((player) => <span key={player.id}><i style={{ background: colorOf(player.id) }} />{player.name}</span>)}</div></div></section>
      <section className="analysis-roster" aria-labelledby="roster-title"><div className="analysis-section-heading"><div><p>Around the table</p><h3 id="roster-title">How everyone’s game read</h3></div><small>Open a dossier for the deeper record.</small></div><div className="analysis-player-grid" data-player-count={analysis.players.length}>{analysis.players.map((player, index) => { const style = styleReadFor(player); return <article className={`analysis-player${player.winner ? " analysis-player--winner" : ""}`} key={player.id} style={{ "--player-color": `var(--analysis-player-${index % 8})` } as CSSProperties}><header><div><span className="analysis-player-dot" /><h3>{player.name}</h3>{player.winner && <b>Winner</b>}</div>{player.controller === "bot" && <small>{player.persona ?? "Bot"}</small>}</header><DiceSparkline counts={series.find((entry) => entry.playerId === player.id)?.counts ?? []} color={`var(--analysis-player-${index % 8})`} /><p className="analysis-player-read">{style.label && <strong>{style.label}</strong>}{style.evidence}</p><dl><div><dt>Bids</dt><dd>{player.stats.bids}</dd></div><div><dt>Calls</dt><dd>{player.stats.dudoCorrect + player.stats.calzoCorrect}/{player.stats.dudoAttempts + player.stats.calzoAttempts}</dd></div><div><dt>Dice</dt><dd>+{player.stats.diceGained} / −{player.stats.diceLost}</dd></div></dl>{style.badges.length > 0 && <div className="analysis-evidence-badges" aria-label={`${player.name} match badges`}>{style.badges.map((badge) => <em className="analysis-evidence-badge" key={badge.label} aria-label={`${badge.label}: ${badge.read}`} title={badge.read}>{badge.label}</em>)}</div>}<details><summary>Open dossier</summary><div className="analysis-metrics">{metric({ name: "bluff", player })}{metric({ name: "aggression", player })}{metric({ name: "challenge", player })}</div><ClaimBreakdown player={player} /><FaceBars player={player} />{player.moment && <aside><span>Defining moment</span>{player.moment}</aside>}{player.botReasoning?.length ? <section className="analysis-reasoning"><span>Bot reasoning</span>{player.botReasoning.map((reason, reasonIndex) => <p key={`${reason.round}-${reasonIndex}`}><b>Round {reason.round} · {reason.action}</b>{reason.explanation}</p>)}</section> : null}</details></article>; })}</div></section>
      {analysis.biggestLiar && <section className="analysis-supporting"><LiarAward liar={analysis.biggestLiar} player={analysis.players.find((player) => player.id === analysis.biggestLiar?.playerId)} nameOf={nameOf} /></section>}
    </> : <RoundTape analysis={analysis} colorOf={colorOf} nameOf={nameOf} signatureRound={signature?.round} onReplay={setSelectedStory} />}</div>
    <OnlineRoundReplay story={selectedStory} open={Boolean(selectedStory)} onClose={() => setSelectedStory(undefined)} nameOf={nameOf} colorOf={colorOf} />
  </section>;
}

export function GameSummary({ view, analysis, history, connected, canReturnToLobby, lobbyWaiting = false, onReturnToLobby, onExit }: { view: PublicGameView; analysis?: MatchAnalysis; history: string[]; connected: boolean; canReturnToLobby: boolean; lobbyWaiting?: boolean; onReturnToLobby: () => void; onExit: () => void }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const winner = view.players.find((player) => player.id === view.winnerId);
  const standings = [...view.players].sort((left, right) => Number(right.id === view.winnerId) - Number(left.id === view.winnerId) || right.diceCount - left.diceCount || left.name.localeCompare(right.name));
  const lastCall = history.find((entry) => !entry.endsWith("wins the match.")) ?? history[0];
  const confetti = Array.from({ length: 132 }, (_, index) => { const angle = (index * 137.508) * Math.PI / 180, distance = 18 + (index % 11) * 7; return <i key={index} style={{ "--burst-x": `${Math.cos(angle) * distance}vw`, "--burst-y": `${Math.sin(angle) * distance * .62}vh`, "--drift": `${((index * 19) % 27) - 13}vw`, "--spin": `${540 + (index % 8) * 135}deg`, "--delay": `${(index % 24) * .028}s`, "--duration": `${2.9 + (index % 6) * .17}s`, width: `${5 + (index % 6)}px`, height: `${7 + (index % 8)}px` } as CSSProperties} />; });
  return <>{!showAnalysis && <><div className="tp-confetti" aria-hidden="true">{confetti}</div><section className="tp-game-over online-game-over-card" role="dialog" aria-label="Game winner"><ConnectionNotice connected={connected} context="game" /><p>Champion of the table</p><span className="tp-winner-crown" aria-hidden="true">♛</span><h2>{winner?.name} wins!</h2><strong>The table is theirs · {view.round} {view.round === 1 ? "round" : "rounds"}</strong><ol className="summary-standings">{standings.map((player, index) => <li key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><em>{player.id === view.winnerId ? "Winner" : player.diceCount ? player.diceCount === 1 ? "1 die left" : `${player.diceCount} dice left` : "Out"}</em></li>)}</ol>{lastCall && <p className="summary-last-call">Last call: {lastCall}</p>}<div className="game-over-actions">{analysis && <button className="button game-analysis-button" onClick={() => setShowAnalysis(true)}>Game analysis</button>}{canReturnToLobby && <button className="button game-lobby-button" disabled={!connected} onClick={onReturnToLobby}>Back to lobby</button>}<button className="button button--ghost" disabled={!connected} onClick={onExit}>Leave game</button></div>{canReturnToLobby && <small className="game-over-hint">{lobbyWaiting ? "The room is already back in its lobby, waiting for you." : "The lobby keeps this room, its players, bots and rules for another game."}</small>}</section></>}{showAnalysis && analysis && <GameAnalysisPanel analysis={analysis} onClose={() => setShowAnalysis(false)} />}</>;
}
