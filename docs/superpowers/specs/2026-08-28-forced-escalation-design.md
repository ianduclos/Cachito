# Forced escalation: the bluff nobody chose — design

**Status:** draft, awaiting Ian's review. Nothing implemented.
**Packet:** Living 6 (`lab/ROADMAP.md`). Priority raised by Ian 2026-08-28,
above the table-dice wiring.

## The problem

Playing 27 rounds against the champion, Ian read its bluffing as transparent:

> "'bluffing' should be more selective and try to be believable. when playing,
> it read exactly as what it was. and as i'm not a bot, it was an easy dudo."

Bots repeatedly make final bids as **forced escalations** — states where no
fully-supported raise exists (`src/analysis/matchAnalysis.ts:594`,
`fullySupportedRaiseExists`) — and raise rather than challenge. In that match
McDonald Lewis did it on 10 of 15 final bids, Gonchi on 6 of 11.

### Mechanism

`src/bot/champion/beliefEquity.ts:416-440` decides Dudo-vs-raise as
`evDudo > evBestBid`, where **`evBestBid = equityNow`** — current-state equity.
That number is identical whether the best available raise is fully supported or
hopeless, so the comparison cannot see the quality of the bid it defaults to. A
bot with nothing supported does not notice, and raises.

**The bluff is therefore never chosen. It is the residue of a comparison.**
Nothing on that path is trying to be believable, which is exactly why it reads
as what it is. It also bypasses `src/bot/champion/personaBluff.ts` entirely —
these bids come from `selectBeliefBid`'s fallback, not from the persona's
deliberate-bluff machinery.

**This was not a bug.** `beliefEquity.ts:40-43` records it as a ratified scope
boundary from the original brief: *"Thresholds/EV pricing stay equity-based
exactly as in equityAware"*, on the reasoning that there was "no
probability-of-a-bid involved, so there is nothing to swap there." That was true
when written. The belief layer has since created the missing input. **This
packet crosses a boundary Ian previously ratified, and does so explicitly.**

### Why the existing measurement apparatus cannot see it

McDonald Lewis **survived 7 of its 10** forced escalations. That is not evidence
the bluffs were sound — other bots adjudicated them, and the one human at the
table called them trivially. An unbelievable bluff and a believable one score
identically against opponents that cannot tell the difference.

**Self-play cannot measure believability.** The duel / win-share /
non-inferiority apparatus this lab runs on is structurally blind to this class
of defect. A duel must not be the opening move, and non-inferiority is a floor
to clear, never the evidence of success.

## Goal

Ian's choice, from three options: **bluff about as often as now, but
believably.** Not "bluff less" — a bot that only ever raises when supported is
an open book, readable in the opposite direction and further from the bar.

### What "believable" means, from Ian's own read

Asked what tipped him off, he named three tells (and explicitly *not* repetition
across rounds — it was readable in the moment, not learned):

1. **The timing / situation** — the state was visibly desperate.
2. **The size of the raise** — too big a jump for the spot.
3. **The face it chose** — a denomination with no story behind it.

Tells 2 and 3 are already solved in code that these bids never reach:
`personaBluff`'s deliberate bluff takes the **cheapest legal raise**
(`cheapestLegalBidForFace`) on a face it **holds or is already telling a story
about** (`pickHeldFace`, `findStoryAnchor`). Tell 1 is unaddressed:
`isCheapMoment` asks whether the bot can *afford* to lose a die, not whether the
moment *looks* desperate from outside.

## Approach

Chosen over two alternatives (see "Rejected alternatives"): three changes, each
in a seam that already exists.

### Section 1 — price the raise honestly (belief layer)

`selectBeliefBid` already computes `supportProbability` for every candidate bid.
The Dudo branch already applies the same function to the *opponent's* bid to get
`pUnsupported`. The fix is symmetric and needs no new probability machinery:

```
now:      evBestBid = equityNow
proposed: evBestBid = f(beliefBidResult.best.supportProbability, equity terms)
```

**Open modelling choice inside `f`.** An unsupported bid costs nothing unless
someone *calls* it.

- Assume always called → over-penalises bluffing, collapses to "never bluff",
  which Ian rejected.
- Model a call probability → correct, but needs an opponent model this layer
  does not have.
- **Chosen:** weight the downside by a fixed, documented **call-rate constant**,
  swept in the lab exactly as `leakagePerDie` was, and named so it can never be
  mistaken for a measured quantity. Starting range informed by the observed 55%
  call rate on forced escalations in the 2026-08-28 match.

Ian approved this section, including crossing the ratified boundary and
preferring a constant to a derived call model.

### Section 2 — build the bluff in the character layer (persona)

Division of responsibility, matching the existing layering:

- **Gen 2 decides *whether* to raise** (section 1).
- **The persona decides *what the raise looks like*.** It reads
  `base.trace.belief.bidSelection.best.supportProbability` — already exposed on
  the trace it receives, no new plumbing — and when the layer beneath is about
  to raise on something it does not believe, it takes over construction:
  cheapest legal raise, held or story-anchored face. Reuses
  `cheapestLegalBidForFace`, `pickHeldFace`, `findStoryAnchor`.

This preserves the file's invariant that the persona never touches Dudo/Calzo,
only bids. Section 1 lands in the belief layer, section 2 in the character
layer, no overlap.

**OPEN ASSUMPTION — needs Ian's explicit confirmation.** Gen 2 prices
raise-vs-challenge using *its* best bid's support probability, then the persona
substitutes a different, smaller bid — so the comparison is made against a bid
that is never played. The proposal is to accept and document this, because it
errs safe: Gen 2 evaluates its strongest option, so if even that does not beat
challenging, it challenges. The alternative (pricing against the bid actually
played) inverts the layering for a second-order gain. **Ian did not give this a
considered yes; it was rubber-stamped late in a long session and is carried here
as an assumption, not a decision.**

### Section 3 — mixing, so the situation stops leaking (tell 1)

Balancing counts is not enough. In the 2026-08-28 match, **3 voluntary bluffs
against 20 forced ones** — seeing a bluff-shaped bid meant ~87% chance the
bidder was cornered. McDonald Lewis was at 0 voluntary / 10 forced: perfectly
transparent.

Two levers, both existing: `bluffRate` per persona (0.07 / 0.11 / 0.16) and the
`isCheapMoment` gate. Note section 1 improves the ratio from the other end too,
by converting the worst forced escalations into challenges — so the required
intervention is smaller than the raw numbers suggest.

**The target is not a count ratio.** Even with balanced totals, if voluntary
bluffs cluster early-round and forced ones late, a detector using
round-and-ladder features separates them trivially. The requirement is that the
detector cannot separate them **conditional on public features** — strictly
stronger than global balance.

Method: sweep `bluffRate` (and, if needed, the cheap-moment gating) and pick the
smallest intervention that brings detector AUC toward chance, subject to the
win-share floor.

### Section 4 — the detector (the gate)

Ian chose this over an exploiter bot and over a human-read reel.

- **Input:** public information only, at the moment of a bid — the round's
  ladder, per-player dice counts, table dice on show, current bid, the bid made,
  position in the ladder. **Never the bidder's hand.**
- **Label:** was the bidder cornered? Computable from ground truth via the
  existing `fullySupportedRaiseExists`.
- **Model:** deliberately simple and interpretable — logistic regression on
  hand-built features, or a small tree. We need to know *which feature leaks* so
  the behaviour can be fixed rather than obscured.
- **Metric:** AUC. 0.5 = undetectable. Report per-feature contribution.
- **Discipline:** train and evaluate on separate seed blocks.

**Phase 1 is to run this against the UNCHANGED champion**, before any fix. That
baseline number is the quantitative form of "it was an easy dudo" and is the
packet's first deliverable. Measurement before change, per lab convention.

**Never train the bot against the detector.** Optimising the metric directly
(rejected alternative C) would teach the bot to fool this specific classifier
while still looking strange to a human. Measure with it; never fit to it.

**Proposed control, and a good one:** run the detector on **Ian's own bids**. He
made 3 forced escalations in that match and all 3 survived. If the detector
predicts a *human's* cornered-ness about as well, then that much detectability
is inherent to the game rather than a bot defect, and the target is human parity
rather than AUC 0.5. Sample size is currently far too small — this is a control
to build toward as human match logs accumulate (now possible: local games
persist as of `4c7e4b3`).

## Gates

1. **Primary:** detector AUC on held-out seeds moves from the phase-1 baseline
   toward chance (or toward human parity, if the control above is available).
2. **Floor:** win-share non-inferiority against the current champion. A floor,
   never the evidence of success.
3. **Confirmatory before shipping:** a generated reel of bluff moments for Ian
   to read, in the same format planned for table dice. Optional per his choice
   of gate, but recommended before anything reaches production.

## Rejected alternatives

- **Balanced ranges at bid selection.** Make bid selection itself mix, so the
  action distribution is similar cornered or not. Genuinely the right long-term
  answer, and genuinely the parked exp-014 CFR-equilibrium project — a much
  larger build. Not smuggled in under this packet.
- **Optimise directly against the detector.** Goodhart: the bot learns to fool
  the classifier, not to look believable. Ruled out with Ian's agreement.

## Risks

- Section 1 over-suppresses bluffing and the bot turns passive → caught by the
  win-share floor; the call-rate constant is the control.
- The persona substituting smaller bids weakens them in belief terms → also the
  win-share floor.
- The detector latches onto something inherent to the game (ladder height) and
  reports high AUC for a non-defect → the human-bid control exists precisely for
  this; treat AUC as uninterpretable until that control has data.
- Future work fits to the detector, quietly → the prohibition is documented here
  and belongs in the tool's own docstring.

## Files expected to change

- `src/bot/champion/beliefEquity.ts` — section 1.
- `src/bot/champion/personaBluff.ts` — sections 2 and 3.
- `lab/tools/` — new detector tool plus CLI and tests; new sweep for the
  call-rate constant and `bluffRate`.
- No production deploy. Everything behind the lab gates first.
