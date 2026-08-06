---
project: Cachito
state: active
updated: 2026-08-06
summary: Deploy call confirmed and shipped — all three corrected bot contracts (f8eeadd) live in production as r2026.08.06.001; Stage 1 activates when Ian's heads-up games land.
machine: mac
next:
  - Ian: play heads-up games on the current build whenever easy — activates Stage 1 (Calzo-trap human test + exp-002b gate retest)
  - Stage 2/3 follow-up now motivated: persona bluff adaptivity vs outcome-reading opponents is the honest route back to the old win number
handoff_for: ian
---

# Cachito — status

## 2026-08-06 — deploy: corrected bot contracts live (r2026.08.06.001)

Ian confirmed the Stage 0.5 deploy call. Shipped all three f8eeadd
corrections (opponent outcome semantics, table-dice beliefs, eliminating-Dudo
starter pricing) to production: Cloud Run room server first, then Firebase
Hosting, per `.claude/skills/deploy/`. Pre-flight green (302 tests, lint,
build); live stamp verified in the served bundle. The attr-A/B/C worktrees
were removed after the deploy. Docs updated: ROADMAP (Stage 0.5 row,
dependencies), LOG (decision entry), BOT_AND_MATCH_ANALYSIS (pre-deploy gate
resolved).

## 2026-08-05 (session B) — Stage 0.5 attribution + mechanism (lab-only, nothing deployed)

Three lab commits (`cdb06be`, `925653f`, `d11dd06`); product untouched except
a root `opencode.json` (`permission: allow`, Ian's request, uncommitted —
takes effect on opencode restart). Lab suite green 122/122.

- **exp-024 attribution (16k games p6, seed 9001, single-revert worktrees):**
  reverting the outcome-semantics correction alone recovers the full exp-023
  gap (+2.00pp, CI excludes corrected); table-dice-beliefs revert inert;
  starter-pricing revert within noise. Paired ground-truth calibration (new
  `lab/tools/componentCalibration.ts`, 133k decision joins): table-dice
  beliefs decisively more accurate in their active region (Brier 0.167 vs
  0.218); keep all three corrections.
- **exp-025 mechanism (new `bluffPunishmentAudit.ts`, `opponentModelFit.ts`):**
  the champion's own play is identical across versions and it never consumes
  the corrected signal — the correction strengthens the probability-policy
  PANEL's bluff reads (legacy reliability ≈ 1 − corrected; a caught bluff
  used to raise trust). The gate failure is a moving-baseline artifact.
  Consumer retune proven non-executable (standing hold in ROADMAP).
- **Deploy picture:** production rooms seat only the champion stack, so the
  correction is online-inert; it fixes the LOCAL-table bots' inverted read
  of human bluffs. Recommendation: deploy all three. Awaiting Ian.
- **Paper trail:** `lab/notes/exp-024-025-outcome-semantics-attribution.md`
  (methods, controls, limitations, decision record, reproducibility commands).
- Gate-design lesson recorded in ROADMAP: future candidate leagues pin the
  panel and compare within one codebase.

## 2026-08-05 — bot Stage 0 verification run (lab-focused, not deployed)

## 2026-08-05 — bot Stage 0 verification run (lab-focused, not deployed)

Five K2.7 worker rounds orchestrated via kimi-router; all work reviewed and
committed (product `d30f4aa`; lab `8b8b854`, `0e74983`, `1013a65`,
`7c5bcf0`). Full suite green 3/3 consecutively (two load-flaky sim tests
given explicit timeouts).

- **Skeptical review of Wave 1 (f8eeadd, d3f5d83): PASS.** The belief fix
  cannot double-count (engine allows one reveal per player per round), the
  eliminating-Dudo starter pricing matches engine semantics exactly, and the
  online room history carries `tableDiceIndices`/`actualCount`, so the
  corrected paths are live in production.
- **exp-022 respect audit:** 329 sim overrides — 41.9% converted vs a ~50%
  thin-margin baseline overall, but 58.0% converted multiplayer; a third of
  replacement raises sit at support <0.25 and lose a die 46% within the
  round. Corpus side reproduces exp-020 exactly (locked as a test).
- **Packet C:** 14/14 brute-force property tests on the corrected table-dice
  belief path (uniform-likelihood bookkeeping only).
- **exp-023 non-inferiority league: GATE FAILED.** New
  `lab/tools/championLeague.ts` (seats the exact shipped stack; runs
  verbatim against a pre-correction worktree at 6765d62). 16k games/size:
  −1.23pp p4, −1.86pp p6, −1.32pp p8 (CIs exclude 0); p2 inconclusive.
  One of the three corrected contracts was load-bearing → component-
  attribution leagues at p6 are the next step (lab/LOG.md exp-023).
- **Heads-up Calzo trap found and diagnosed:** the p2 champion calls Calzo
  at ~6% accuracy (72/72 sampled calls on opponent ace bids; estimated
  P(exact) 0.797 vs 4.2% realized) — Conservative's binomial `exact` ignores
  the opponent's bid, soft `riskCost` lets Calzo win ladder-top argmaxes,
  wrong Calzo costs two dice. Exactly Ian's 2026-07-31 commitment trap;
  feeds Stage 1, unpatched by design.
- **lab/ROADMAP.md rewritten** as the stage-gated program (stages 0–5,
  standing holds, note index).

Pre-correction A/B worktree: `../Cachito-precorr` (detached at 6765d62,
node_modules symlinked) — keep it until attribution finishes.

## 2026-07-30 — product session (deployed, r2026.07.30.003)

Nine commits, all live (Cloud Run `cachito-rooms-00045-xfm` + Firebase
Hosting, live stamp verified in the served bundle). Full suite green at every
checkpoint: 243 tests, lint and typecheck clean.

**Rule changes (shared engine — affect online, local and bots):**

- **Palo fijo ace switch** (`f733d58`): a player holding exactly one die may
  now answer two Cuadras with two Aces — aces top the equal-quantity ladder in
  Palo Fijo. Ranking them above Sambas (rather than whitelisting the swap)
  keeps two one-die players from raising in circles at the same quantity; from
  N Aces the only way up is N+1. `RULES.md` examples updated, including one
  that asserted the opposite.
- **Table dice must count toward the bid** (`cb1272d`): `placeBid` rejects any
  selection holding a die that does not count toward the claim — its own
  denomination plus wild aces where they count. `countsTowardBid` is extracted
  from `countBid` and exported so the rule and the counting cannot drift.
  Both tables dim/disable non-qualifying dice; shipped bot policies already
  chose qualifying dice only, so bot play is unchanged.

**Analysis report:**

- **Claim risk replaces the unsupported rate** (`e1e945b`, analysis schema
  v3 → **v4**): the old `scores.bluff` was a smoothed unsupported-final-bid
  rate, but only challenged bids get verified — one or two samples a match
  against a prior of strength 20, so every player scored the same ~16-20
  baseline. It is now the mean over *every* bid of P(claim false | own dice +
  public table): one sample per bid, no prior. A seat blind to its own hand
  (multi-die in blind Palo Fijo) is scored on the public view alone. Outcome
  facts stay separate per the doc's discipline, now with the
  `stats.verifiedFinalBids` denominator ("1 of 4 revealed").
- **Biggest liar crown** (`6d930ee`): the widest revealed shortfall of the
  match gets an at-a-glance tile and a card badge in roast red. Computed from
  the public round stories — no payload change — and absent when every
  revealed claim held up.

**Online table:**

- **Back to lobby, per player** (`215c725`, `d87a99f`): was host-only, and the
  winner card's actions were clipped off a landscape phone (fixed full-screen,
  `overflow: hidden`). Now any seated player can take the room back to its
  lobby, and leaving the winner screen is per player — whoever asks first
  resets the room; everyone else keeps the summary and their analysis until
  they press it themselves. The server treats a repeat request as done rather
  than an error. It is a peer of Game analysis and Leave game, not the primary
  action.
- **Opening quantity** (`6d930ee`): a new round opens the bid builder at 1.
  The previous quantity was kept whenever still legal — and an opening bid has
  nothing to beat — so a round that climbed to 9 left 9 armed for the next.
  Online only; the local table already reset.
- **Seat maps** (`a00e1eb`): the 2026-07-22 fix rotated the player list, but
  the 5/6/7-player seat *position* maps were not in rotational order, so turn
  order zig-zagged across the table. Only the 8-player map (the one the test
  covered) was right. All maps now walk one sweep from the viewer's immediate
  left, with a ring-walk invariant test at every player count.

**Bot names** (`96d82a8`, `ad42bac`, `d87a99f`): Mark Vito, Cori Soldevilla,
Diego Exebio Lozt, Melchorita, Renata Canepa.

Verification notes: layouts were checked with headless-Chrome shots of a
standalone harness at 844×390, 390×844 and 1440×900 — not a live game, and
without the webfont loaded. Nothing user-visible is confirmed in the real app
yet.

Also answered from production logs (chat only, not written to lab/LOG.md):
tonight's biggest liar was **Agus Calchetti** — claimed 10 Aces with 3 there,
7 short, and it survived uncalled (2026-07-30T02-26 log, the only game of the
night on the new build).

## Repo layout

Two workstreams share this repo:

- **Product** (`src/`, `server/`, `dev/`): the playable web game. Claude owns
  it as of 2026-07-19 (Codex is gone); conventions in [AGENTS.md](AGENTS.md),
  rules in [RULES.md](RULES.md), analysis/bot contract in
  [docs/BOT_AND_MATCH_ANALYSIS.md](docs/BOT_AND_MATCH_ANALYSIS.md). Deploys
  are manual and never happen on `git push` — project skill
  `.claude/skills/deploy/`.
- **Research lab** (`lab/`, its own nested git repo, gitignored by the parent):
  bot AI and game statistics. Charter in [lab/README.md](lab/README.md), full
  record in [lab/LOG.md](lab/LOG.md), plan in
  [lab/ROADMAP.md](lab/ROADMAP.md).

## Lab state (2026-07-19, day three — paused here)

- **First real games analyzed** (lab/LOG.md § Field observations): Ian beat
  the shipped Gen 2 + persona bot twice heads-up. Two findings: the exp-002b
  heads-up gate makes the persona layer inert at 2 players, and the bot loses
  Dudos overwhelmingly to *exactly-true* bids.
- **exp-013 baseline DONE**: the exploit is codified as a scripted benchmark
  bot (`lab/bots/exactCount.ts`, `duel.ts --candidate exactCount`). At scale:
  81.1% of Conservative's failed Dudos hit exactly-true bids — the signature
  metric any heads-up successor must collapse. The script alone still loses
  the match (31.75%): the human edge is honest bidding *plus* challenge
  timing. Heads-up hybrid build is ON HOLD.
- **exp-014 PARKED, fully planned**: CFR equilibrium core (oracle first,
  player second) — subtasks, Ian-confirmation points, and sidetrack warnings
  in [lab/notes/exp-014-cfr-plan.md](lab/notes/exp-014-cfr-plan.md). Driven
  by Ian's revised bar (2026-07-19): perceived intelligence, adaptability,
  and non-predictability at the table over threshold-readable internals.
  Process note: no heavyweight gates until its promotion phase.
- **Data pipeline complete**: GCS bucket access works (procedure = project
  skill `.claude/skills/fetch-room-logs/`, gcloud at
  `/opt/homebrew/share/google-cloud-sdk/bin/`); `ingest.ts` handles schema
  v4 AND v5 (v5 verified 14/14 cross-checks on the real games). Note for log
  work: a log's `seats` array is only whoever was still in the room when it
  was written — the finished game's full roster is in `analysis.players` /
  `state.players`.
- Lab commit `3fe182f` is the lab repo's tip; that repo has no remote.
- Earlier history (day one/two: Gens 1–3, persona bluff, replay viewer,
  exp-001..012) lives in lab/LOG.md and lab/ROADMAP.md.
- Untracked in the parent root: `Cachito_Game_Rules_and_Bot_AI_Status.docx`
  (Ian's own export, deliberately uncommitted).
