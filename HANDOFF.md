---
project: Cachito
updated: 2026-08-28
entries: 3
---

### Two decisions waiting on Ian — opened 2026-08-28, owner: ian
- done: Both options are measured and written up. (1) K2 trust weight 0.25 roughly doubles the level-k consumer's legible challenge volume (30 vs 16.5 escalations per 100 matches) at unchanged accuracy (50.8%), confirmed on a fresh seed block. (2) A table-dice veto flips the shipped reveal from -0.058 to +0.629 expected qualifying dice.
- next: Ian picks either, both, or neither. Neither is a code change yet.
- blockers: Decision only. Note (1) changes a value Ian personally ratified on 2026-08-27, and (2) is a change to shipped behaviour that needs a non-inferiority duel before it goes out.
- context: lab/LOG.md entries dated 2026-08-28; lab/ROADMAP.md "Next actionable packet"; artifacts lab/data/living-v4/level-k-consumer-weight-sweep.json and lab/data/living-v5/table-dice-reveal-audit.json.

### Paired calibration test unfinished — opened 2026-08-28, owner: claude
- done: The taxonomy and sweep now compute match-grouped bootstrap CIs and a paired per-match comparison between weight arms. A bug was fixed along the way: a pooled per-decision mean was being quoted against a per-match interval, which put point estimates outside their own CIs.
- next: Re-run `npx tsx lab/tools/levelKConsumerWeightSweepCli.ts --now 2026-08-28T00:00:00Z --seed 510001 --matches-per-size 100 --arms 0.5,0.25 --out lab/data/living-v4/level-k-consumer-weight-confirm.json` (~20 min), then commit the two modified tools with the numbers in LOG.md.
- blockers: none — the run was simply still going at session end. Do NOT redirect stderr to /dev/null; an earlier failure was silently swallowed that way.
- context: lab/tools/levelKConsumerFlipTaxonomy.ts and lab/tools/levelKConsumerWeightSweep.ts are modified and uncommitted; everything else is committed through e581d46.

### Table dice beyond the veto — opened 2026-08-28, owner: claude
- done: The passive half is built and committed — an audit of what existing reveals buy, and a value calculator returning reroll and proof gain separately per number of dice revealed.
- next: Build an ACTIVE reveal policy (lab bot variant, shadow first) that decides when and how much to reveal, then test it by duel against the current champion.
- blockers: The calculator has no information-leakage term, so it always recommends revealing everything — which exp-015 already measured as costing ~2.7pp of win share. Leakage must be modelled (or swept as a parameter and pinned by duel) before an active policy means anything.
- context: lab/tools/tableDiceValue.ts, lab/tools/tableDiceShadow.ts, lab/notes/exp-021-calzo-and-table-dice-2026-07-31.md; the live decision being replaced is src/bot/champion/personaBluff.ts ~283-303.
