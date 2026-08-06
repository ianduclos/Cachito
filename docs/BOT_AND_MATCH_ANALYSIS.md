# Production bots and completed-match analysis

This is the maintainer contract for the online bot policy and the **Game analysis** view shown after a completed match. Read it before changing `src/bot/champion/`, `src/analysis/`, bot turns in `dev/onlineRooms.ts`, schema-v5 match logs, or the winner screen.

## Product status

- Online rooms are the product. `/table-prototype` is a deprecated, local regression harness and is not a second bot product.
- Every production bot uses **Respect gate → Persona → Gen 2 → Conservative**. Gen 2 combines the promoted belief filter with equity-aware Dudo/Calzo decisions. The Persona wrapper adds occasional, legible bid stories and deliberate table-dice use without changing challenge decisions. The outer respect gate can replace a marginal Dudo after repeated public evidence that the bidder's challenged bids hold.
- Matches that began with two seats delegate the Gen 2 and Persona layers completely to the proven Conservative heads-up path; the respect gate still wraps it. A larger match reduced to two active players does not take this fallback. Do not add persona bluffing back into original heads-up play without a new measured gate.
- **Heads-up policy hold (exp-013):** the Exact Count Prober confirmed that failed Dudos against exactly true bids are a structural Conservative weakness, but the probe still lost most matches. Do not retune Calzo or build a heads-up hybrid from this result. Wait for the exp-014 CFR handoff before changing the two-seat policy; use the exp-013 margin-zero failure share as a regression signature, not as a tuning target by itself.
- Lobby bots receive a recorded persona at creation. Current weighted assignment is 30% Patient reader, 45% Measured storyteller, and 25% Bold storyteller. The persona is persisted through room recovery and written to the private final log.
- Bot timing remains presentation: a fresh random 3–8 second pause each turn. Policy computation itself is immediate.

## Promotion boundary

The bundled policy code and static models under `src/bot/champion/` are product-owned promotion copies. Production code must never import from `lab/`, and `lab/` remains ignored by Git and ESLint. A future research champion needs an explicit promotion package and product tests before replacing these files.

The three promoted data files are:

- `data/equity.json` — match-equity lookup used to price risk;
- `data/likelihood.json` — bid likelihood model used by the belief filter;
- `data/style-models.json` — population priors used to stabilize small-sample player summaries.

Keep these as static imports so the Cloud Run server can load them without filesystem assumptions. Vite tree-shakes them from the browser because the client imports analysis types only.

## Privacy and reasoning

Bots receive only `projectForPlayer`, `getLegalActions`, and public action history. Never pass an authoritative state, opponent hand, controller identity, final result, or another bot’s diagnostic into a live decision.

`BotDecisionTrace.plainReason` is the only text intended for the human-facing postgame explanation. It must:

- describe the choice in ordinary language;
- be true to the policy branch that ran;
- contain no hidden opponent information or implementation jargon;
- be recorded only for real bot seats. A timeout safety move made for a human is marked `covered` and is not attributed as that human’s strategy.

Bot decision records remain private during play. The browser receives analysis only after the authoritative state is `gameOver`. Raw diagnostics, visible bot hands, probabilities, and the storage bucket are never exposed.

## Completed-game analysis

`buildMatchAnalysis` creates a compact, versioned summary after game over. It uses public actions, dealt-hand records, structured revealed-round resolutions, safe bot explanations, and the final state. The resulting browser payload deliberately omits raw hands and probability diagnostics.

Actions marked `covered: true` remain in the public round story because they
really happened, but they are excluded from the covered human's strategy
counts, scores, final-bid breakdown, table-dice metrics and **defining moment**.
Match facts such as dice gained/lost remain authoritative. The moment is the easy
one to miss: only a correct Calzo names the caller in `diceChanges`, so that is
the single path by which a timeout safety call could be written up as a human's
defining play — and from there reach the match headline through `keyMoment`.

The three 0–100 style coefficients are descriptive, not skill ratings:

- **Claim risk** — averaged over *every* bid the player made, the probability that the claim was false when they made it, evaluated from their own dice plus the public table (`evaluateBidDistribution` on a view carrying only that bidder's hand). The wire-format key remains `scores.bluff`. It replaced a smoothed unsupported-outcome rate whose 20-strength prior swamped the one or two verified samples a match produces, so every player scored the same baseline. Two invariants: a player blind to their own hand (multi-die seat in blind Palo Fijo) is scored on the public view alone, never on dice they could not see; and the label and prose must stay about risk taken, never about intent. Revealed outcomes remain a separate count — see the final-bid breakdown below.
- **Aggression** — how strongly a player raised into a claim that looked uncertain from the public table. Higher means bolder pressure, not necessarily better play.
- **Challenge** — how much risk the player accepted by calling Dudo or Calzo. Accuracy is shown separately as correct calls / attempts.

Aggression and challenge pull small samples toward population priors; claim risk does not, because it has one sample per bid rather than per reveal. All three are labeled **Early read** below their sample threshold. Do not present these values as psychological traits, rankings, or precise probabilities. Hover/focus help for all three definitions is required in the UI.

Momentum shows each player’s share of remaining dice after a round. It is not a win-probability graph. A defining moment is selected from verified calls or the largest revealed bluff gap. Bot reasoning is limited to the last three distinct plain-language explanations.

Analysis schema v3 (2026-07-20) adds `startingDice` and `roundStories`: the public per-round record — the full bid ladder (bidder, quantity, denomination, table-dice count), the call, the revealed `actualCount`, its margin against the final bid, and dice deltas. Everything in a round story was visible at the table; it must never grow hidden-hand fields. The browser renders these as the stacked dice-flow chart, the round-by-round rail, and the call board; the player-color palette in `OnlineTable.css` is CVD-validated against the panel surface and assigned by fixed seat order.

Analysis schema v4 (2026-07-30) redefines `scores.bluff` as claim risk (above) and adds `stats.verifiedFinalBids`, the count of that player's final bids that actually reached a reveal — the denominator the browser shows beside `unsupportedFinalBids` so a "1 unsupported" reads as "1 of 4 revealed" rather than a bare tally.

Analysis schema v2 separates three facts that must never be collapsed into “confirmed bluffs”:

- `unsupportedFinalBids` records revealed outcomes (`actualCount < bid.quantity`), split into `unsupportedCaught` and `unsupportedSurvived`;
- `deliberatePersonaBluffs` records bot intent only when the policy’s own trace sets `settings.personaBluffFired === 1`, split into caught and survived. Never infer human intent, and never treat the generic `controlled_bluff` reason as proof—the cautious base policy can emit it too;
- `forcedEscalations` records a final raise made when no legal raise could be fully supported by the player’s own hand, split into caught and survived. Generate legal raises through engine `getLegalActions` and test support through engine counting rules; do not reproduce bid ordering or ace/Palo Fijo rules in analysis code.

These categories can overlap: a deliberate or forced raise may turn out to be supported, and an unsupported bid need not have been intentional. The browser shows the counts as a compact final-bid breakdown and shows “Intent not recorded” for humans.

The analysis button appears only on the full-screen winner ceremony and only when the server has supplied a completed analysis. Returning to the winner view must remain possible. The panel uses a fully opaque background, keyboard focus containment, Escape-to-close, and an internal scroll area at short viewport heights.

## Private log schema v5

Final Cloud Storage snapshots use schema version 5 and include the visible `gameVersion`. In addition to the previous rules, seats, deals, timing, connection audit, actions, and final state, v5 records:

- bot policy name, stable persona key, and display label per bot seat;
- structured `roundResolutions` with public revealed hands;
- privacy-safe `botDecisions`, including `plainReason`;
- `covered: true` on timeout safety moves made for a human;
- the exact versioned `analysis` delivered after game over (currently analysis schema v4, nested inside match-log schema v5).

Active recovery snapshots retain their separate schema version and may carry the in-progress arrays privately so a server restart does not erase later analysis. Deploy the room server before the browser whenever this shape or the online protocol changes.

## Required checks

Add focused tests for policy legality, heads-up fallback, table-dice forwarding, analysis math/privacy, winner-panel behavior, and server delivery. Probability-sensitive policy changes also require semantic truth tests for Dudo/Calzo outcome interpretation, fixed public table dice plus reroll resets, and next-round starter pricing. Use cover-safe real-game and one-step counterfactual checks alongside self-play; do not infer a counterfactual winner after the first changed action.

A semantic truth test must be able to fail. A belief test written against a uniform likelihood model exercises bookkeeping only — the posterior update is an identity there — and a test whose expected value is also what the defensive compatibility branch produces proves nothing. Delete the code path and confirm the test goes red before trusting it.

**Pre-deploy gate (resolved 2026-08-06).** The 2026-07-31 correctness packet failed its fresh-seed non-inferiority league (exp-023), but attribution (exp-024/025) showed the loss was a moving-baseline artifact — the correction strengthened the panel's bluff reads while the champion's own play was untouched. Ian confirmed the deploy call; all three corrections shipped to production in r2026.08.06.001. Semantic correctness is not a strength argument — keep requiring fresh untouched-seed non-inferiority runs for future probability-contract changes.

Then run the standard lint/build/full-test gate. When the UI changes, inspect a completed online room at 1280×720 and confirm the winner ceremony, analysis opening/closing, hover/focus definitions, long names, eight-player density, early-read labels, and bot reasoning.
