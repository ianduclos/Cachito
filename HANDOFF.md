---
project: Cachito
updated: 2026-08-28
entries: 1
---

### Table-dice read-back — approach replaced, work not started — opened 2026-08-28, owner: claude
- done: The decision is made (active@leakage 1.5, ratified by Ian) and every measurable blocker is discharged, including the fresh-seed confirmation on block 810001. Tonight established two things that change the remaining work: the production edit is a SINGLE site (the `random() < tableDiceChance` branch in `src/bot/champion/personaBluff.ts`, ~line 289 — all three `toldStory` branches feed it, and the `base.choice.tableDiceIndices` pass-through is dead because Gen 2 never emits reveals), and asking Ian to "play against it" does not work.
- next: Implement active@1.5 at that branch, re-duel with the production policy as the candidate to confirm it reproduces the lab arm, then build the reveal reel — one page of ~15 generated reveal moments, current coin-flip bot alongside active@1.5, so the legibility judgement takes two minutes instead of an hour of play.
- blockers: none for the implementation. The read-back itself still needs Ian, but as a page to skim rather than games to play.
- context: `lab/notes/table-dice-reveal-decision.md` (decision, evidence, promotion path, and the single-site verification). Artifacts in `lab/data/living-v5/`. The read-back rationale is in STATUS.md's 2026-08-28 (fourth) entry: Ian played 27 rounds, reported on Calzos and bid ladders in detail, and never mentioned table dice — there were 5 bot reveals in that game, and that invisibility is the argument for the change.
