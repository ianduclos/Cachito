# Lab notebook

Running log of decisions, experiments, and results. Newest entries at the top of
each section. Every experiment gets an entry here even if it also has its own
directory under `experiments/`.

## Decisions

- **2026-07-17 — Founding decisions (Ian):**
  - Build our own super-barebones tooling; start working immediately.
  - **Current bots are the permanent baseline.** Every new bot generation is
    measured against them (Conservative is the strongest published baseline:
    1.437× fair share in the 2026-07-13 league).
  - **Bots must never distinguish bots from humans** — to a policy, every seat is
    just a player. The human/bot controller tag exists only in *our analysis
    layer* (logs and stats may use it; policy inputs must not).
  - Tooling: open; we chose TypeScript on top of the real engine (`npx tsx`,
    no new dependencies) for simulation/data-gen; viz medium decided per tool.
  - Goals, in order: (1) a super-advanced bot inserted into the game over time,
    (2) a visualization tool — bot intent, game stats, human style, fun stats,
    best ones may graduate to the end-of-game screen, (3) later: a centaur-style
    gameplay helper (not an immediate priority).
  - Compute: multi-hour local runs are fine (not overnight); renting compute is
    on the table when needed.
  - Workflow: Claude orchestrates Sonnet coding agents; agents consult back when
    blocked.

## Experiments

- **exp-001 RESULTS (2026-07-17)** — 115k games, 8.13M round-start observations,
  4,294 state keys, `lab/data/exp-001/league-all.equity.json`. Headlines:
  1. **Marginal die value is cleanly concave at scale** (smoke-run's 2→3 dip was
     noise): every added die is worth less. 2p: 1→2 = +20.6pp, 4→5 = +3.3pp.
     6p: 1→2 = +6.0pp, 4→5 = +2.6pp.
  2. **Deconfounded starter effect is POSITIVE, +2.6pp overall** (raw marginal
     was negative purely from the loser-starts confound). Weighted within-state
     comparison, 1,240 states with n≥200 both sides: +2.0 to +3.6pp by table
     size. BUT it flips by state: 5v5 heads-up starter is *worse* (0.456 vs
     0.544 — opening leaks info), while 1v1-die heads-up starter is hugely
     *better* (0.784 vs 0.216 — near-zugzwang for the responder).
  3. **Calzo's flat 0.72 threshold is badly mispriced.** Marginal-equity
     breakeven P(exact) by own dice: ~0.50–0.62 at 1 die, ~0.75–0.85 at 2–4
     dice, ~1.0 at 5 dice (gain capped ⇒ value-Calzo never correct at 5, modulo
     the starter-initiative bonus this v1 math ignores). The live bot's "extra
     caution near elimination" is exactly BACKWARDS for the 1-die case: with 1
     die you can only lose 1 die, so Calzo gets CHEAPER, not dearer.
  Caveats: marginal-based (not fully state-conditional), equity is under the
  6-policy baseline population, correlated observations within games, starter
  bonus/round-ending side effects not priced into the Calzo breakevens.
  - **Visualization published** (2026-07-17): interactive artifact — equity
    curves, Calzo breakeven heatmap, starter bars, and a state explorer over all
    3,915 states with n≥50 —
    https://claude.ai/code/artifact/94f5681a-7d9a-4482-84db-a5a3a627f097
    (source `lab/viz/exp-001-equity.template.html` + `exp001-data.json`; rebuild
    by re-running the injection one-liner in `lab/viz/`, republish same path).
  - Obvious next step: an **equity-aware Conservative variant** (state-dependent
    Calzo/Dudo thresholds read from this table) as the first lab bot to duel the
    baseline. Also: end-of-game "win probability over time" chart is now
    buildable for any logged game (sim or ingested room log).
- **exp-001 design (2026-07-17) — Dice-equity function.** Estimate P(win) as a
  function of the stack vector (own dice, others' dice multiset, isStarter) from
  bulk self-play. Data: 115k games, full 6-policy league, 2/3/4/5/6 players
  (seeds 1002/1003/1004/1005/1006), output in `lab/data/exp-001/`. Output feeds:
  Calzo/Dudo thresholds, marginal die value curve, end-of-game "win probability
  over time" fun stat.
  - Early signal from the 300-game smoke run (4p): marginal die value is NOT
    monotone in stack size — the 1→2 jump (+0.11) dwarfs 2→3 (+0.02). The first
    die is life; middle dice are cheap. If this holds at scale it directly
    reprices Calzo's −2.
  - **Starter confound found:** raw starter P(win) < non-starter, but the engine
    makes last round's loser the next starter, so "starter" correlates with
    "just lost a die". Starter effect must be measured within fixed stack
    vectors (the state key already allows this).
  - Stats caveat: round-start observations within one game are correlated (one
    winner per game); raw n overstates effective sample size. Fine for point
    estimates; be careful with error bars later.

## Data sources

- **2026-07-17 — Online rooms DO log full matches** (correcting the founding-day
  claim): `dev/onlineRooms.ts` writes **schema v4** match records to a GCS bucket
  when `logBucket` is configured. Reference sample saved at
  `lab/data/reference/2026-07-15T04-06-28-324Z-TZTHN.json` (4 humans, 16 rounds,
  copied from Ian's temp export "cachito-finished-2plus-humans").
- **Schema v4 contents** (rich!): `rules`, `seats` (with `controller:
  human|bot`), `actions` (timestamped; bids include `tableDiceIndices` + revealed
  `tableDice`), `roundDeals` (**full dealt hands every round** + starter +
  paloFijo flag = ground truth for calibration/bluff analysis), `turnTimings`
  (per-turn elapsed/remaining ms — response-time style signal), `history`
  (human-readable strings), privacy-hashed `connectionEvents`, final `state`.
- **Data-quality wrinkle — timeout covers:** when a human times out, a bot moves
  for them, but the action itself carries no structured marker; only the
  `history` strings record "ran out of time — a bot made the move". Human-style
  analysis MUST exclude covered moves (parse history, or match timings where
  finishedAt ≥ deadlineAt). Future ask for Codex: structured `covered` flag on
  actions in schema v5.

## Open questions / blocked

- Bulk access to the GCS log bucket: how many match logs exist, and how does the
  lab pull them (Ian exported by hand this time)? Bucket name/creds TBD.
- End-of-game screen stats: quality bar TBD once we have candidates.

## Tooling status

- 2026-07-17: **v0 tooling DONE** (built by Sonnet agent, verified by Claude) —
  `lab/tools/simulate.ts` (headless batch runner → compact JSONL with per-round
  stack snapshots from authoritative `diceChanges`/`publicDiceCounts`, seeded,
  seat-rotated, ~50 games/s at 4p, ~236 games/s at 2p) and `lab/tools/equity.ts`
  (state-key → P(win) with marginal die values + starter split). Usage in
  `lab/tools/README.md`. Smoke invariants: 0 violations over 5,496 rounds.
  Known v0 limits: whole run buffered in memory (fine ≤ ~50k games/file; stream
  later), no smoothing, rotation is not a perfect Latin square.
- 2026-07-17: **ingest.ts DONE** (built by Sonnet agent) — schema-v4 room-log →
  same `CompactGameRecord` JSONL (`shared.ts` widened: `controller: 'bot' |
  'human'`, optional `source`/`roomCode`/`startedAt`/`rules`/`turns`, all
  backward-compatible — smoke.equity.json byte-identical post-change). Outcome
  `correct`/`actualCount` reconstructed from `roundDeals` hands via the real
  `countBid`, corrected for table-dice reroll (`rerolledDice` on the bid
  action); covered-move detection via `turnTimings` (positional match,
  conservative on ambiguity). Reference file (4 humans, 16 rounds): 0 stack
  violations, 33 covered moves, 4 table-dice rounds, 0 unverifiable, 16/16
  delta cross-checks + 3/3 history cross-checks all matched — no reimplemented
  rule ever disagreed with the engine's own resolution. `history` turned out to
  be a rolling 30-entry window (not full-game), so it's only usable as a
  tail-end cross-check, not a primary source. Usage in `lab/tools/README.md`.
