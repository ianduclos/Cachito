---
project: Cachito
updated: 2026-08-28
entries: 2
---

### Two decisions waiting on Ian — opened 2026-08-28, owner: ian
- done: Both are fully measured. (1) K2 trust weight 0.25 doubles the level-k consumer's legible challenge volume (30.0 vs 16.5 escalations per 100 matches) at unchanged accuracy (50.8%), confirmed on a fresh seed block, and a paired per-match test on 374 shared matches shows no measurable calibration cost. (2) Table dice has three candidate replacements for a shipped behaviour measured at -0.084 expected qualifying dice per reveal: veto-only (8.3% reveal rate, +0.625), active at leakage 1.5 (8.3%, +0.902, deterministic trigger), active at leakage 2.0 (1.6%, +1.333, fires only on the one-qualifier-in-five case).
- next: Ian picks. For (2) note that win share cannot separate these — every arm including a never-reveal arm was statistically indistinguishable from the champion — so it is a legibility judgement about how often the bot should visibly do this and how principled each instance should be.
- blockers: Decision only. (1) changes a value Ian ratified 2026-08-27 but is a lab parameter and deploys nothing. (2) would be a production change and still needs a leakage constant that is not fitted to the duel that judges it, plus a human read-back check.
- context: lab/LOG.md entries dated 2026-08-28; artifacts under lab/data/living-v4/ (level-k) and lab/data/living-v5/ (table dice).

### Reveal-side estimator bug in the duel tool — opened 2026-08-28, owner: claude
- done: Identified and characterised. lab/tools/tableDiceActiveDuel.ts reports `expectedChangeCi95` computed on a different grouping from `meanExpectedChangeOnReveal`, so means fall outside their own intervals (control: mean -0.0836, CI [-0.1547, -0.0913]). This is the same class of bug fixed earlier today in lab/tools/levelKConsumerFlipTaxonomy.ts — see that file's `deltaCi` comment for the fix pattern.
- next: Make the reported mean and CI the same estimator (per-match mean with a match-grouped bootstrap), then re-run both duel artifacts.
- blockers: none.
- context: The reveal MEANS are sound and cross-validate — veto +0.625/+0.627 across two runs plus an independent hand computation of +0.629, control -0.084 vs -0.058 on a different corpus. Only the intervals are wrong, so no conclusion drawn today depends on them.
