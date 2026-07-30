---
project: Cachito
state: active
updated: 2026-07-30
summary: Product session shipped nine commits to production at release r2026.07.30.003 — two rule changes (palo fijo ace switch, table dice must match the bid), a rebuilt bluff stat with a biggest-liar crown, per-player lobby return, six bot names and two UI fixes; lab CFR thread (exp-014) still parked.
machine: mac
next:
  - play on the new build and confirm the two rule changes feel right at a real table (palo fijo ace switch, table-dice restriction)
  - decide whether the analysis "Claim risk" metric stays as the headline bluff stat or wants a different framing
  - look at bot Tachi Cabrera's 11 shortfalls in 28 rounds (24 dice of overclaim) in the 2026-07-30T01-09 log — possible unsupported-bid regression
  - resume exp-014 Phase 0/1 (CFR oracle for heads-up) — full parked plan in lab/notes/exp-014-cfr-plan.md
handoff_for: null
---

# Cachito — status

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
