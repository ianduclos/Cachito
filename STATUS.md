---
project: Cachito
state: active
updated: 2026-08-28
summary: Ian played the champion and found its bluffing transparent, which opened Living 6 as top priority, produced a structural finding (self-play cannot measure believability) and a drafted design now awaiting his review; local match logging is fixed and shipped to the working tree. — both of the day's decisions are applied (K2 weight 0.25, table dice active@leakage 1.5), the table-dice change is now confirmed to be a single-site edit, and the read-back approach was rebuilt after playing games proved a bad way to judge an 8%-frequency motif.
machine: mac
next:
  - Ian reviews the forced-escalation spec (TOP PRIORITY, blocking) — docs/superpowers/specs/2026-08-28-forced-escalation-design.md; one section is flagged an open assumption, not a decision
  - On approval, run writing-plans against that spec; phase 1 changes no bot code, it baselines the detector against the unchanged champion
  - Implement active@leakage 1.5 at the single coin-flip branch in src/bot/champion/personaBluff.ts, then re-duel with the production policy as candidate
  - Build the reveal reel — one page of ~15 generated reveal moments, current bot vs active@1.5 side by side — as the read-back Ian can actually do
  - Finish the level-k falsification suite — arms 4 (passthrough) and 5 (exploit audit) are still unbuilt, WIP at lab 155b272
  - Decide whether lab/ joins tsc and eslint at all (60 pre-existing type errors under the app config, none from this session)
handoff_for: ian
---

# Cachito — status

## 2026-08-28 (fifth) — Living 6 designed off a single game Ian played

The session's most valuable input was Ian playing one match. His read — bluffing
"read exactly as what it was, and as I'm not a bot, it was an easy dudo" —
opened a packet, produced a structural finding about the lab's own methods, and
ended in a drafted design (`b5a157a`,
`docs/superpowers/specs/2026-08-28-forced-escalation-design.md`).

**The defect.** `champion/beliefEquity.ts:416-440` prices Dudo-vs-raise as
`evDudo > evBestBid` with `evBestBid = equityNow` — identical whether the best
available raise is supported or hopeless. A cornered bot therefore raises
without noticing, and the bluff is the residue of a comparison rather than a
choice. It bypasses `personaBluff.ts`'s deliberate-bluff design entirely. This
was a *ratified* scope boundary, not a bug, so the packet crosses it explicitly.

**The structural finding, which outlives this packet.** A bot survived 7 of 10
transparent bluffs — judged by other bots, while the one human called them
instantly. Self-play cannot measure believability, so duels and win share are
blind to this whole class of defect. Non-inferiority is a floor, never evidence.
Saved to memory; it retroactively limits anything justified as "non-inferior in
self-play."

**The design.** Keep the bluff rate, make it believable: price the raise
honestly, build it with the persona's existing constructor (which already solves
two of Ian's three tells), and mix voluntary bluffs so the situation stops
leaking. Gate is a cornered-ness detector over public information — measured
with, never trained against. Awaiting Ian's review; section 2 carries an open
assumption he rubber-stamped rather than decided.

## 2026-08-28 (fourth) — local games now record themselves; the table-dice change is smaller than thought

Continuation. One production-code commit (`4c7e4b3`, dev + online UI); the bot
itself is unchanged and nothing is deployed.

**Local match logging fixed (`4c7e4b3`).** A room served locally wrote *nothing*
to disk — match logs went only to GCS, gated on `MATCH_LOG_BUCKET` — so a
27-round game played tonight was recoverable only by opening a WebSocket to the
running server and spectating the room. Now the dev server writes the same
schema-5 record to `logs/online-matches/` (gitignored), atomically, one file per
match, announcing at startup which mode it is in. The directory is passed
explicitly by the caller rather than defaulting on — the first cut defaulted it
whenever no bucket was set, which made the test suite write 15 match logs into
the repo (`c4ba77b`). Production sets the bucket, so that path is untouched. Also added an **Export log** button
to the online analysis header, mirroring the hot-seat game's own.

**The table-dice change is a SINGLE site.** `champion/personaBluff.ts` sets
`toldStory` in three places but marks only two with `personaBluffFired`, which
is why a bot can reveal with `deliberatePersonaBluffs: 0` — the third branch is
Gen 2 continuing the story face on its own. All three feed one
`random() < tableDiceChance` coin flip. The other candidate path is dead: Gen 2
never emits table-dice indices, and `tableDicePlan` in `policies.ts` belongs to
`createProbabilityPolicy`, which only the local hot-seat app runs.

**The read-back approach was wrong and is replaced.** "Play against it" was not
executable — the change is not written, and the motif fires on ~8% of decisions,
so hunting it by hand is hopeless. Evidence: Ian played 27 rounds, came back
with detailed reactions to the Calzos and the bid ladders, and never mentioned
table dice. There were 5 bot reveals in that game. **That invisibility is the
finding** — active@1.5 is less a value upgrade than the difference between a
motif that registers and one that does not. Replacement plan: generate the
matches in the lab and hand Ian a page of ~15 reveal moments, current bot
alongside active@1.5.

**From the match itself.** Ian out-called the table (7/11 Dudos, 1/2 Calzos vs
3/8 Dudos pooled for the bots) and still went out second. Two genuinely strong
bot Calzos: Gonchi's 4x3 holding one with three hidden across 15 dice, and
McDonald Lewis's 3x6 holding **zero** sixes. 18 of 87 bot bids ran at >=1.5x the
statistically expected count and 7 of those were true at reveal — the "wild"
ladders track something real often enough to read as human. A suspected
challenge-donation signature did NOT survive scrutiny: seating put Ian
immediately before Monkoky, so Ian was its only legal Dudo target in 24 of 33
turns. That check is now written into the `postgame-review` skill.

## 2026-08-28 (third) — both decisions made and applied; estimator bug closed

Continuation session. Still lab-only; **no `src/` change**, production untouched.
Six lab commits (`59030f2`..`d46759a`).

**Estimator bug fixed (`59030f2`, `9386f4d`).** The reveal-side statistics
reported a pooled per-decision mean next to a match-grouped bootstrap interval,
so the quoted point estimate could sit outside its own CI. Fixed in
`tableDiceActiveDuel.ts` and `tableDiceRevealAudit.ts`, plus three further
instances found in the unrun falsification suite before arms 4/5 get built on
them. The bootstrap draws are unchanged, so every interval is bit-identical and
a field-by-field diff of old against new artifacts is identical outside the two
renamed fields — 3 of 7 main-duel arms and 3 of 8 refine arms previously failed
the mean-inside-its-own-CI check; none do now. All three artifacts regenerated.

**K2 trust weight 0.25 adopted (`a73f9c1`, Ian).** Applied as the weight and the
band floor, which are one parameter, not two: trust on a certain-K2 seat *is*
the weight, so a floor above it clamps the discount away. The floor now derives
from the weight. This surfaced two stale duplicates of the ratified constant,
one live: `FLIP_TAXONOMY_TRUST_FLOOR` was a hardcoded `0.5` and at the new
weight flagged 209 in-band trust readings as integrity violations. Artifacts
generated before today were produced at w=0.5 and no longer reproduce.

**Table dice ratified: active at leakage 1.5 (`41c9e26`, Ian).** A fresh seed
block (810001, 1600 matches/arm) discharged the blocker that the constant was
fitted to the duel judging it — reveal rate 7.96% against 8.31%, value +0.9060
[+0.8966, +0.9147] against +0.9116 [+0.8973, +0.9260]. It also killed a
false alarm: the main duel's `leakage 1.0` arm had shown +4.25pp surviving a
Bonferroni correction by a hair, but across three runs it reads z=2.69 / 1.46 /
1.64, so it was one high draw. "Strength cannot decide this mechanic" stands, and
the choice was made on legibility. Full record in
`lab/notes/table-dice-reveal-decision.md`.

**Also found:** `lab/tools/levelKConsumerShadow.ts` held two raw NUL bytes as
map-key separators, which made `grep` return *nothing* for every pattern in that
file without saying why. Now unicode escapes; no other tracked file has one.

## 2026-08-28 (later) — table dice: strength cannot decide it, so legibility must

Second half of the session. Still lab-only; production untouched.

**Level-k settled (`420976f`).** The paired per-match calibration test on 374
shared matches gives w=0.25 minus w=0.5 as dBrier -0.0027 [-0.0066, +0.0003]
and dLogLoss -0.0065 [-0.0155, +0.0012] — favouring the larger discount, CIs
spanning zero. Combined with the fresh-seed confirmation (30.0 vs 16.5
escalations per 100 matches at 50.8% vs 48.5% accuracy), **w=0.25 is indicated
at no measurable cost**. An interim claim that it degraded calibration came
from mixing a pooled per-decision mean with a per-match interval and is
retracted.

**Table dice (`0ea2688`).** An active reveal policy and a veto-only arm were
duelled against the champion. The decisive result is negative: every arm's
win-share CI spans zero, including an arm that never reveals at all. Win share
carries no signal here, so the choice is a legibility choice. On that axis
leakage 1.5 dominates the veto — same 8.3% reveal rate, better spots (+0.902
vs +0.625 expected qualifying dice), and it derives *when* from the hand
instead of filtering the persona's random coin flip. Leakage 2.0 fires only
with exactly one qualifier in a five-die hand, converging on Ian's own
described ace play.

**Mechanism found.** `src/bot/champion/beliefEquity.ts:191` resets the
revealer's posterior to a blank prior on a reveal — correct, since those dice
were rerolled, but it means revealing **launders your bid history**. That
reconciles exp-015 ("reveal fewer dice") with this session ("reveal more
often"): fewer dice shown means more rerolled, so more laundering and less
leaked. Nobody had priced this benefit.

## 2026-08-28 — level-k consumer measured properly; table-dice reveal found net-negative

Lab-only. **No production code changed**; the sole main-repo commit is a docs
note (`d1d7afd`). Five lab commits (`155b272`..`e581d46`).

**Recovered work.** The previous Kimi session did not crash — it hit a 5-hour
usage quota mid-subagent on 2026-08-27 at 19:32. Its unfinished pass-2
falsification suite (3 of 5 arms, no tests, no CLI, never run) is preserved as
`155b272`. Arms 4 and 5 remain unbuilt.

**Level-k consumer (`f716360`, `60b53a1`).** The pass-1 packet's 3.3% flip rate
overstated the effect: 54 of the 227 core flips land on decisions the champion's
upper layers already override, so the behavioural rate is 2.5%. Of the 173 real
flips only 29 are challenge escalations; 124 are bid re-selections with no
legible intent. Those 29 select well — 57.1% for Dudo escalations against a
19.7% base rate for an indiscriminate Dudo at the same decisions. A K2 trust
weight sweep then showed volume scales hard with the weight while accuracy does
not degrade, and a fresh-seed confirmation (400 matches, seed 510001)
replicated it almost exactly: 30 escalations per 100 matches at w=0.25 versus
16.5 at the ratified 0.5, both at 50.8% accuracy. Whether w=0.25 costs
calibration was still being measured by a paired per-match test when the
session ended.

**Table dice (`e6f8114`, `e581d46`).** The module everyone assumed was the
decision logic (`src/bot/tableDice.ts`) is not wired into any policy — its own
header says so. The live reveal is a per-persona coin flip in
`personaBluff.ts` with no value calculation, and it is measurably harmful:
-0.058 expected qualifying dice per reveal, CI entirely below zero, because
revealing one die sends every other matching die back into the reroll. Three
self-computable veto rules flip that positive; the best keeps 44.3% of reveals
at +0.629. Not licensed for production — the reroll axis ignores information
leakage, and exp-015 showed this mechanic moves win share by ~2.7pp.

**Method gap.** `lab/` is excluded from both `tsc -b` and eslint and has never
been typechecked. With a working config: 0 errors in today's files, 11
pre-existing errors in `lab/bots/levelPolicies.ts` and
`lab/tools/levelKIdentifiability.ts`.

## 2026-08-17 — Living 2H complete: two-turn variation retired (lab-only)

Five lab commits (`b26ccc4`..`28b458d`); product untouched. The Living 0–2
packet was committed from a stale working tree, corpus gates were re-locked
on the enlarged 25-file log corpus, and the Living 2H replay
(`lab/tools/livingHumanContextReplay.ts`) passively reconstructed all 367
strategic decisions from the five 2026-08-10 friend-session logs through the
authoritative engine (zero legality mismatches, covered actions excluded,
roster via `analysis.players`). Verdict: 48/48 seat×persona lanes diverge
from real human play within two decisions (47/48 deterministic), so
setup-and-continue plans starve everywhere; one-decision offers exist at
26.9% of human decisions with the 0.02 allowance binding at 2.9%. Roadmap now
points at a one-decision motif contract (keep-story first). Lab suite 230/230.
Details: lab/LOG.md 2026-08-17 entry; canonical artifact
`lab/data/living-v2/human-context-replay.json`.

## 2026-08-06 (evening) — heads-up Gen 2 promotion live (r2026.08.06.002)

Same-day follow-up to the corrections deploy. Ian's four real heads-up games
(8JW7N, KJBHC, HHXPM ×2 — "Agus Calchetti"/"Gustavo Dudamel"/"n" are all Ian)
drove Stage 1 to completion in one session:

- **exp-026** (new `ungatedHeadsUpReplay.ts`): replaying all 67 logged bot
  decisions through the shipped stack with `twoPlayerGate: false` — 39%
  diverge, every foregone Dudo correctly foregone, Calzo activates 4/7 exact.
- **exp-027**: the 3 wrong Calzos share a q-vs-(q+1) adjacency miss; repaired
  with the constant-free mode guard (P(q) ≥ breakeven AND P(q) > P(q+1)).
- **exp-028** (new `twoSeatGateLeague.ts`): 10k fresh-seed H2H — ungated
  84.2% vs gated champion; 86.8% with the guard. Calzo 77.8% accurate,
  Dudo accuracy 31% → 59%, respect overrides 0.66 → 0.04/game.
- **Product:** `dev/onlineRooms.ts` constructs the stack with
  `twoPlayerGate: false`; mode guard in `src/bot/champion/beliefEquity.ts` +
  4 falsifiable tests (delete-the-guard-goes-red verified). Persona stays
  exp-017-gated heads-up. Suite 329/329, lint/build clean; Cloud Run
  `cachito-rooms-00047-zxs` + Hosting, live stamp verified.

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
- Lab commit `d46759a` is the lab repo's tip; that repo has no remote.
- Earlier history (day one/two: Gens 1–3, persona bluff, replay viewer,
  exp-001..012) lives in lab/LOG.md and lab/ROADMAP.md.
- Untracked in the parent root: `Cachito_Game_Rules_and_Bot_AI_Status.docx`
  (Ian's own export, deliberately uncommitted).
