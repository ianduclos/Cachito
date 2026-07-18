# Lab → Codex handoff: integrating the lab bots and the replay visualizer

2026-07-17, from the research lab (`lab/`, see AGENTS.md § lab). This is the
explicit write-up the boundary rules call for — no lab patches touch product
code. Questions → Ian, or leave notes in HANDOFF.md.

> **Promotion status — July 18, 2026:** Gen 2 + Persona is now the policy for every production online bot, with Conservative preserved for two-player play. The promotion copies and data live under `src/bot/champion/`; production has no `lab/` dependency. Schema v5, covered timeout flags, structured resolutions, recorded personas, table-dice forwarding, safe bot explanations, and the completed-room **Game analysis** view are implemented. Seeded/replayable online bot randomness remains future work. The maintained product contract is [BOT_AND_MATCH_ANALYSIS.md](./BOT_AND_MATCH_ANALYSIS.md).

## 1. The bots

Three gated generations exist in `lab/bots/`, all implementing the same
policy interface as `src/bot/policies.ts` (they import the engine read-only
and were evaluated through `runBotMatch`):

| Gen | Module | Status | One-liner |
|---|---|---|---|
| 1 | `equityAware.ts` (`createEquityAwarePolicy`) | Gated ✅ | Conservative with measured equity thresholds instead of hand-tuned constants |
| 2 | `beliefEquity.ts` (`createBeliefEquityPolicy`) | Gated ✅ — **recommended champion** | Adds Bayesian hand-reading; ~2.4–2.8× fair share vs the production league |
| 3 | `beliefSearch.ts` (`createBeliefSearchPolicy`) | Gated ✅ head-to-head, ⚠ not production-ready | Within-round lookahead; beats Gen 2 head-to-head but underperforms it against diverse opponents — hold until the opponent model is fixed |
| P | `personaBluff.ts` (persona layer over Gen 2) | Non-inferiority verified ✅ | Deliberate, story-consistent bluffing (~12% of bids, configurable) + intentional table-dice plays; costs ~2pp of win share by design — the "personality" seat |

Integration notes:

- **Promote Gen 2, not Gen 3.** Gen 2 ("Belief Equity") is the current
  practical champion for mixed tables.
- **Data dependencies** (must ship with the policy): the equity table
  (`lab/data/exp-001/league-all.equity.json`, ~measured from 115k games) and
  the belief-filter likelihood model it loads (see `loadLikelihoodModel` /
  `loadEquityTable` in `beliefEquity.ts`). Bundling/format is Codex's call;
  the lab can re-emit them in any shape needed.
- **Difficulty tiers for free**: easy = existing Baseline/Conservative,
  normal = Gen 1, hard = Gen 2, hard-with-personality = Gen 2 + the
  `personaBluff.ts` layer. Same architecture, one dial.
- **Persona layer specifics** (Ian-approved direction: intentionality over
  win-rate): it wraps Gen 2 and reshapes only BID decisions — challenge
  (Dudo/Calzo) decisions pass through the champion untouched, so its
  strength floor is Gen 2's. Bluff frequency and aggression flavor are
  config knobs. Measured cost at the ~12% bluff setting: ≈2pp of win share
  (22.99% vs 25% fair over 8,000 games), accepted deliberately as the
  price of legible theater. Demo replay: `lab/viz/replay-demo-persona.html`.
- **Heads-up (2p) behavior**: Gen 1–3 all deliberately delegate to plain
  Conservative at 2 players (measured as the stronger choice there).
- **Privacy invariant (binding)**: no policy ever receives human/bot
  controller identity — preserve this in any integration.
- **Formal promotion**: when Codex is ready, the lab will supply a champion
  package per promotion: policy version, parameters, exact lab-repo
  revision, eval evidence, rollback plan.

Asks that make bot integration better (previously flagged, still open):
1. **Seeded online-bot randomness** — replayable live games.
2. **Log schema v5** — structured round resolutions + `covered` flag on
   timeout moves (removes the lab's reconstruction step).
3. Keep the 3–8s cosmetic bot delay as-is for now; a confidence-coupled
   think-time "tell" is a designed future feature (room-configurable,
   never default), not something to improvise.

**🐛 Bug report (found 2026-07-17, verified):** `src/bot/simulator.ts`'s
private `toGameAction` (line ~45) drops `BotChoice.tableDiceIndices` when
building the engine bid action — so in `runBotMatch` (headless matches),
bots that choose the table-dice mechanic never actually execute it (their
`traceReason: 'table_dice_pressure'` fires, but the engine always receives
`tableDiceIndices: []`). Live online rooms are unaffected
(`dev/onlineRooms.ts` forwards the field). One-line fix: include
`tableDiceIndices: choice.tableDiceIndices` in the bid branch. The lab
works around it with its own wrapper (`lab/tools/tableDiceMatch.ts`) and
measured the mechanic at ~4.8% of rounds once restored; fixing upstream
matters for anything else that uses `runBotMatch` (tests, dev tools).

## 2. The replay visualizer

The lab has a working match-replay pipeline (built 2026-07-17):

- **`lab/tools/replayExport.ts`** — turns any logged game (a schema-v4 room
  log run through `lab/tools/ingest.ts`, or any sim log) into ONE compact
  replay JSON: per-round stacks, per-player win probability (from the
  measured equity table), the full bid ladder, reveals, and bluff
  annotations; plus per-decision bot beliefs when telemetry exists.
- **`lab/viz/replay.template.html`** — a single self-contained page (no
  network, no dependencies, light/dark aware) with a `__REPLAY_DATA__`
  placeholder. Splice the JSON in and it renders: win-probability graph
  over the game, a round/turn stepper with plain-language bot reasoning,
  and reveal panels. Human games degrade gracefully (belief panels hide).
- Working demos exist (`lab/viz/replay-demo-sim.html`, `replay-demo-room.html`).

The viewer now also includes (added 2026-07-17, later the same day):
- **Table reads / intent panels**: per-turn public-information style reads
  of the current bidder and per-player style cards (bluff-rate read,
  aggression, challenge courage) that work on human games too — built on
  `lab/tools/styleEstimator.ts`.
- **End-of-game match summary** (`#summary` anchor): per-player
  plain-language verdict, aggression/bluffing/challenge bars vs the table
  average, style-over-time mini-chart, ground-truth bluff counts kept
  separate from reads, and a "biggest bluff / boldest call" moment line.
  **This summary view is Ian's preferred end-screen candidate** — treat it
  as the reference design when lifting anything into the product.

Integration options, cheapest first:
1. **Post-game replay page**: at game end, run the room's log through
   ingest + export server-side, splice into the template, serve as a static
   page (or offer as a share link). Zero product-UI surgery.
2. **End-of-game screen**: lift the match-summary view (above) and/or the
   win-probability graph into the real end screen. Ian curates which stats
   graduate; the lab will provide per-component data shapes on request.
3. Later, with bulk logs: per-player style cards from the fingerprint/style
   pipeline (aggressor / rock / sniper badges).

Practical notes: exporter and template are plain TypeScript/HTML with no
lab-only dependencies — they can be vendored into the product build if
depending on `lab/` paths is undesirable (boundary rules say product must
not depend on `lab/`; vendoring a copy at promotion time, like the bot
modules, is the intended move). Schema v5 (ask #2 above) would remove the
most fragile part of ingest (round-resolution reconstruction).
