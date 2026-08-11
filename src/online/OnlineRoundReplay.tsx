import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import type { MatchAnalysisRoundStory } from "../analysis";
import { countsTowardBid, type Die } from "../engine";
import { Die as DieFace } from "../ui/Dice";
import { useModalFocus } from "./OnlineModal";
import "./OnlineRoundReplay.css";

const denominationNames: Record<Die, string> = { 1: "Aces", 2: "Dones", 3: "Trenes", 4: "Cuadras", 5: "Chinas", 6: "Sambas" };
const dieGlyphs: Record<Die, string> = { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" };

export type RoundReplayPhase = "setup" | "ladder" | "call" | "reveal" | "result";

/**
 * `revealedHands` is deliberately post-round public information. It is optional
 * while old saved matches are still supported, but no other hand source is read.
 */
type ReplayStory = Omit<MatchAnalysisRoundStory, "startingDice"> & {
  startingDice?: Array<{ playerId: string; dice: number }>;
  revealedHands?: Array<{ playerId: string; dice: Die[] }>;
};

export type OnlineRoundReplayProps = {
  story?: MatchAnalysisRoundStory;
  open: boolean;
  onClose: () => void;
  /** Names are supplied by the analysis roster, never inferred from a hand. */
  nameOf?: (playerId: string) => string;
  /** A fixed-seat colour supplied by the analysis roster. */
  colorOf?: (playerId: string) => string;
  initialPhase?: RoundReplayPhase;
};

type ReplayStep = { phase: RoundReplayPhase; bidIndex?: number; label: string };

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function phaseIndex(story: Pick<MatchAnalysisRoundStory, "bids">, phase: RoundReplayPhase) {
  if (phase === "setup") return 0;
  if (phase === "ladder") return 1;
  if (phase === "call") return story.bids.length + 1;
  if (phase === "reveal") return story.bids.length + 2;
  return story.bids.length + 3;
}

function matchFace(die: Die, story: Pick<MatchAnalysisRoundStory, "bids" | "paloFijo">) {
  const finalBid = story.bids.at(-1);
  return finalBid ? countsTowardBid(die, finalBid, story.paloFijo) : false;
}

function FaceSummary({ dice }: { dice: Die[] }) {
  const shown = [...new Set(dice)].sort((left, right) => left - right) as Die[];
  return <p className="round-replay-face-summary">
    <span aria-hidden="true">Faces:</span>{" "}
    {shown.map((die) => <span key={die}><b aria-hidden="true">{dieGlyphs[die]}</b> {denominationNames[die]}</span>)}
  </p>;
}

function PlayerHand({ playerId, dice, story, nameOf, colorOf }: { playerId: string; dice: Die[]; story: Pick<MatchAnalysisRoundStory, "bids" | "paloFijo">; nameOf: (id: string) => string; colorOf: (id: string) => string }) {
  const matching = dice.filter((die) => matchFace(die, story)).length;
  return <article className="round-replay-hand" style={{ "--replay-player-color": colorOf(playerId) } as CSSProperties}>
    <header><i aria-hidden="true" /><strong>{nameOf(playerId)}</strong><small>{matching ? `${countLabel(matching, "match", "matches")} to the final bid` : "No matching dice"}</small></header>
    <div className="round-replay-dice" aria-label={`${nameOf(playerId)} revealed ${dice.map((die) => denominationNames[die]).join(", ")}`}>
      {dice.map((die, index) => <span className="round-replay-die" key={`${die}-${index}`}><DieFace value={die} highlighted={matchFace(die, story)} /><b aria-hidden="true">{dieGlyphs[die]}</b><span>{denominationNames[die]}</span></span>)}
    </div>
    <FaceSummary dice={dice} />
  </article>;
}

function bidIsAttributable(bid: MatchAnalysisRoundStory["bids"][number] | undefined) {
  return bid?.attributable === true;
}

function bidActorLabel(bid: MatchAnalysisRoundStory["bids"][number], nameOf: (id: string) => string) {
  return bidIsAttributable(bid) ? nameOf(bid.playerId) : "A covered bid";
}

function callContext(story: ReplayStory, nameOf: (id: string) => string) {
  const call = story.kind === "dudo" ? "Dudo" : "Calzo";
  const finalBid = story.bids.at(-1);
  const callerAttributable = story.callerAttributable === true;
  const finalBidAttributable = bidIsAttributable(finalBid);
  if (callerAttributable && finalBidAttributable) return `${nameOf(story.callerId)} challenged ${nameOf(story.bidderId)}’s final bid.`;
  if (callerAttributable) return `${nameOf(story.callerId)} challenged the final bid.`;
  if (finalBidAttributable) return `A ${call} followed ${nameOf(story.bidderId)}’s final bid.`;
  return `A ${call} followed the final bid.`;
}

function OnlineRoundReplayContent({ story: publicStory, open, onClose, nameOf = (id) => id, colorOf = () => "#d7b36a", initialPhase = "setup" }: OnlineRoundReplayProps & { story: MatchAnalysisRoundStory }) {
  const story = publicStory as ReplayStory;
  const dialogRef = useRef<HTMLElement>(null);
  const steps = useMemo<ReplayStep[]>(() => [
    { phase: "setup", label: "Table set" },
    ...story.bids.map((_, bidIndex) => ({ phase: "ladder" as const, bidIndex, label: `Bid ${bidIndex + 1}` })),
    { phase: "call", label: story.kind.toUpperCase() },
    { phase: "reveal", label: "Open dice" },
    { phase: "result", label: "Result" },
  ], [story.bids, story.kind]);
  const [stepIndex, setStepIndex] = useState(() => Math.min(steps.length - 1, phaseIndex(story, initialPhase)));
  const step = steps[stepIndex] ?? steps[0];
  const finalBid = story.bids.at(-1);
  const neutralAccent = "#809c90";
  const publicTableDice = story.bids.reduce((total, bid) => total + (bid.tableDice ?? 0), 0);
  const publicPlayerIds = [...new Set([
    ...story.bids.map((bid) => bid.playerId),
    story.callerId,
    story.bidderId,
    ...story.diceChanges.map((change) => change.playerId),
    ...(story.revealedHands?.map((hand) => hand.playerId) ?? []),
  ])];

  useModalFocus(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      // This is nested inside analysis. Mark the key handled before the parent
      // dialog's bubble listener gets it, so Escape closes only this replay.
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose, open]);

  const next = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  const back = () => setStepIndex((index) => Math.max(0, index - 1));
  const activeBid = step.phase === "ladder" ? story.bids[step.bidIndex ?? 0] : undefined;
  const verdict = story.correct ? "Correct call." : "Wrong call.";
  const lastStep = stepIndex === steps.length - 1;
  const narration = step.phase === "setup" ? `Round ${story.round}. The table is set.`
    : activeBid ? bidIsAttributable(activeBid)
      ? `${nameOf(activeBid.playerId)} bid ${activeBid.quantity} ${denominationNames[activeBid.denomination]}.`
      : `A covered bid: ${activeBid.quantity} ${denominationNames[activeBid.denomination]}.`
      : step.phase === "call" ? story.callerAttributable === true ? `${nameOf(story.callerId)} called ${story.kind.toUpperCase()}.` : `A ${story.kind === "dudo" ? "Dudo" : "Calzo"} followed.`
        : step.phase === "reveal" ? "All dice are now open. Matching dice are marked."
          : `${verdict} ${story.actualCount === 1 ? "One die matched" : `${story.actualCount} dice matched`} the final bid.`;

  return <div className="round-replay-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="round-replay" role="dialog" aria-modal="true" aria-labelledby="round-replay-title" tabIndex={-1} ref={dialogRef}>
      <div className="round-replay-live" aria-live="polite" aria-atomic="true">{narration}</div>
      <header className="round-replay-header"><div><p>Round replay</p><h2 id="round-replay-title">Round {story.round} · open dice</h2></div><button type="button" className="round-replay-close" onClick={onClose} aria-label="Close round replay">×</button></header>
      <div className="round-replay-progress"><span>{stepIndex + 1} / {steps.length}</span><ol aria-label="Replay progress">{steps.map((item, index) => <li key={`${item.phase}-${item.bidIndex ?? ""}`} className={index === stepIndex ? "is-current" : index < stepIndex ? "is-done" : ""} aria-current={index === stepIndex ? "step" : undefined}><span aria-hidden="true" /> <b>{item.label}</b></li>)}</ol></div>
      <main className="round-replay-stage">
        {step.phase === "setup" && <section className="round-replay-setup"><p className="round-replay-kicker">Before the claims</p><h3>{story.paloFijo ? "Palo Fijo: one face, no shortcuts." : "Fresh cups. Same suspicious friends."}</h3><p>{story.paloFijo ? "This was a Palo Fijo round; only the bid face counted." : "Aces could support a non-Ace bid in this round."}{publicTableDice ? ` ${countLabel(publicTableDice, "die")} went public on the table during the ladder.` : " No dice went public on the table."}</p>{story.startingDice?.length ? <dl className="round-replay-starting-dice">{publicPlayerIds.map((playerId) => { const dice = story.startingDice?.find((entry) => entry.playerId === playerId)?.dice; return <div key={playerId}><dt>{nameOf(playerId)}</dt><dd>{dice ?? "—"} <span>{dice === 1 ? "die" : "dice"}</span></dd></div>; })}</dl> : <p className="round-replay-missing-context">Round-start dice counts: <strong>Not retained</strong> in this older match.</p>}</section>}
        {activeBid && <section className="round-replay-bid"><p className="round-replay-kicker">The ladder · {step.bidIndex! + 1} of {story.bids.length}</p><span className="round-replay-bidder" style={{ "--replay-player-color": bidIsAttributable(activeBid) ? colorOf(activeBid.playerId) : neutralAccent } as CSSProperties}><i aria-hidden="true" />{bidActorLabel(activeBid, nameOf)}</span><h3><b aria-hidden="true">{dieGlyphs[activeBid.denomination]}</b> {activeBid.quantity} {denominationNames[activeBid.denomination]}</h3><p>{activeBid.tableDice ? `${countLabel(activeBid.tableDice, "die")} put on the table with this bid.` : bidIsAttributable(activeBid) ? "No table dice here. Just a claim and a poker face." : "No table dice here. Attribution is intentionally withheld."}</p><div className="round-replay-ladder-preview" aria-label={`${step.bidIndex! + 1} bids shown of ${story.bids.length}`}>{story.bids.slice(0, step.bidIndex! + 1).map((bid, index) => <i key={index} style={{ "--replay-player-color": bidIsAttributable(bid) ? colorOf(bid.playerId) : neutralAccent, height: `${26 + bid.quantity * 5}px` } as CSSProperties} title={`${bidActorLabel(bid, nameOf)}: ${bid.quantity} ${denominationNames[bid.denomination]}`}>{dieGlyphs[bid.denomination]}</i>)}</div></section>}
        {step.phase === "call" && <section className={`round-replay-call round-replay-call--${story.kind}`}><p>{callContext(story, nameOf)}</p><h3>{story.kind.toUpperCase()}</h3><strong>{finalBid ? `${finalBid.quantity} ${denominationNames[finalBid.denomination]}` : "The final bid"}</strong><span>Time to stop pretending.</span></section>}
        {step.phase === "reveal" && <section className="round-replay-reveal"><div><p className="round-replay-kicker">The receipts</p><h3>All dice, face up</h3><small>{finalBid ? `Gold-edged dice count toward ${finalBid.quantity} ${denominationNames[finalBid.denomination]}.` : "The round's public reveal."}</small></div>{story.revealedHands?.length ? <div className="round-replay-hands">{story.revealedHands.map((hand) => <PlayerHand key={hand.playerId} {...hand} story={story} nameOf={nameOf} colorOf={colorOf} />)}</div> : <p className="round-replay-missing-reveal">This older saved match has the public outcome, but not its open-dice layout.</p>}</section>}
        {step.phase === "result" && <section className={`round-replay-result${story.correct ? " is-correct" : " is-wrong"}`}><p className="round-replay-kicker">Verdict</p><h3>{verdict}</h3><strong>{finalBid ? <><b aria-hidden="true">{dieGlyphs[finalBid.denomination]}</b> {finalBid.quantity} claimed · {story.actualCount} there</> : `${story.actualCount} there`}</strong><p>{story.margin === 0 ? "Exactly true. Rude, but technically fair." : story.margin > 0 ? `${story.margin} more than claimed. The bid held with room to spare.` : `${Math.abs(story.margin)} short. The table was not buying it.`}</p><dl>{story.diceChanges.map((change) => <div key={change.playerId} style={{ "--replay-player-color": colorOf(change.playerId) } as CSSProperties}><dt><i aria-hidden="true" />{nameOf(change.playerId)}</dt><dd className={change.delta > 0 ? "is-gain" : "is-loss"}>{change.delta > 0 ? "+" : ""}{change.delta} {Math.abs(change.delta) === 1 ? "die" : "dice"}</dd></div>)}</dl></section>}
      </main>
      <footer className="round-replay-actions"><button type="button" onClick={back} disabled={stepIndex === 0}>Back</button>{lastStep ? <button type="button" className="round-replay-done" onClick={onClose}>Done</button> : <button type="button" className="round-replay-next" onClick={next}>Next <span aria-hidden="true">→</span></button>}</footer>
    </section>
  </div>;
}

/** A safe wrapper for callers that keep the replay mounted while no round is selected. */
export function OnlineRoundReplay({ story, open, onClose, nameOf, colorOf, initialPhase }: OnlineRoundReplayProps) {
  if (!open || !story) return null;
  return <OnlineRoundReplayContent story={story} open onClose={onClose} nameOf={nameOf} colorOf={colorOf} initialPhase={initialPhase} />;
}
