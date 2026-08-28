# Human game language report

**Prepared:** 2026-08-11  
**Scope:** locally available completed Cachito matches with at least two human-controlled participants  
**Output intent:** internal product-language research for a fun end-game page; confidence rules below are implementation guidance, not player-facing disclaimer copy

## Recommendation in one page

The end-game page should tell one memorable, truthful story rather than grade every player. The most reliable structure is:

1. **Match headline:** winner, length, and the selected signature play.
2. **One style label per player:** chosen only from eligible match evidence.
3. **One factual verdict sentence:** bids, calls, table dice, or revealed outcomes.
4. **Up to two event badges:** exact Calzo, last-die stand, bid held, longest reach, and similar public events.
5. **Optional roast lexicon:** it changes the wording, never the underlying detection.

This corpus supports that structure. Across 13 fully structured qualifying matches there are 235 resolved rounds and 757 attributable human decisions after timeout coverage is removed. That is enough to find vivid match-local stories, but not enough to make durable claims about personality or skill.

**Implementation correction (2026-08-11):** the shipped Biggest Liar selector
scores bid choices, not revealed shortfalls. It looks at literal claimed-face
dice and whether the player introduced a face, continued at the engine’s
minimum, or gratuitously raised beyond that minimum. Two or more literal copies
make that bid score zero; one is partial backing; zero is the strongest support
factor. Aces use the same literal rule. Covered actions and blind multi-die Palo
Fijo are excluded. Earlier corpus award counts in this report describe
superseded outcome selectors and require recalculation before being quoted as
current product behavior.

The three existing 0–100 style axes should remain descriptive inputs, not the visible result by themselves. Fixed table-relative cutoffs currently collapse most players into the middle: under the existing `±8` aggression/challenge and `±12` claim-risk logic, 40 of 41 aggression-eligible seat-games are “balanced,” 42 of 46 claim-risk-eligible seat-games are “middle,” and 39 of 42 challenge-eligible seat-games are “measured.” A percentile-based label selector produces more varied but still grounded copy.

The playful **Biggest Liar** award belongs outside failure rankings. It can go to a skilled player or the winner. An optional neutral/default alternative is:

> The table’s boldest storyteller.

This is not a required static subtitle. The title should never be paired with “worst landings,” “most wrong,” or anything else that defines it as failure. The earlier 12-of-13 award count used the superseded broad-shortfall gate; do not quote it for the thin-unsupported selector without rerunning the corpus.

## 1. Corpus inventory

### Search and inclusion rule

Search scope:

- all repository JSON and JSONL files, including ignored `lab/` data;
- `/Users/ianduclos/Desktop`, `/Users/ianduclos/Downloads`, and `/Users/ianduclos/Documents` for Cachito-shaped JSON and room-log fields;
- the local Spotlight index for Cachito/match/game JSON filenames;
- likely derived lab replays and experiment outputs, checked separately to avoid counting transformed copies as new matches.

The repository root is:

`/Users/ianduclos/_SecondBrain/02_Areas/_Coding/Cachito`

A distinct match is included when:

- its terminal state is `gameOver`;
- at least two participants are recorded as `controller: "human"`;
- it is an authoritative room snapshot or the older authoritative reference snapshot, not a simulation, regression replay, visualization export, or analysis summary;
- duplicate files are counted once by match identity (`startedAt` + room code) and content hash.

For schema-v5 logs, participant composition is read from the persisted completed analysis roster when available, with the final state as a cross-check. This is important: the top-level `seats` array can omit players who disconnected before the final snapshot. Counting only `seats` would incorrectly describe several four- and five-player games as smaller matches.

### Included matches

Paths below are relative to the repository root. Player aliases used later in examples are regenerated per match and reveal no nickname.

| Alias | Authoritative path | Date | Composition | Rounds | Stored nested analysis | Attribution note |
|---|---|---:|---:|---:|---:|---|
| M01 | `lab/data/reference/2026-07-15T04-06-28-324Z-TZTHN.json` | 2026-07-15 | 4 humans | 16 | none | Legacy schema 4; no structured resolutions and no per-action coverage flag |
| M02 | `lab/data/room-logs/2026-07-22T01-07-55-061Z-44EQT.json` | 2026-07-22 | 3 humans | 10 | v3 | All 93 decisions are `covered`; public match facts only |
| M03 | `lab/data/room-logs/2026-07-22T01-09-02-281Z-8P39S.json` | 2026-07-22 | 4 humans | 16 | v3 | Fully attributable |
| M04 | `lab/data/room-logs/2026-07-22T01-39-38-849Z-Y7YLW.json` | 2026-07-22 | 4 humans | 24 | v3 | 1 covered decision excluded |
| M05 | `lab/data/room-logs/2026-07-22T02-13-26-766Z-FBEM5.json` | 2026-07-22 | 4 humans | 15 | v3 | Fully attributable |
| M06 | `lab/data/room-logs/2026-07-29T21-23-44-698Z-XM5ZF.json` | 2026-07-29 | 5 humans | 21 | v3 | 4 covered decisions excluded |
| M07 | `lab/data/room-logs/2026-07-30T01-33-19-910Z-YV5V4.json` | 2026-07-30 | 4 humans | 15 | v3 | 1 covered decision excluded |
| M08 | `lab/data/room-logs/2026-07-30T01-49-26-711Z-BZJVP.json` | 2026-07-30 | 5 humans | 21 | v3 | 1 covered decision excluded |
| M09 | `lab/data/room-logs/2026-07-30T02-26-45-135Z-FANYY.json` | 2026-07-30 | 5 humans | 18 | v3 | 1 covered decision excluded |
| M10 | `lab/data/room-logs/2026-08-10T01-03-59-946Z-EJ5BQ.json` | 2026-08-10 | 3 humans + 1 bot | 20 | v4 | Bot actions excluded from human aggregates |
| M11 | `lab/data/room-logs/2026-08-10T01-23-15-783Z-EJ5BQ.json` | 2026-08-10 | 3 humans | 10 | v4 | Fully attributable |
| M12 | `lab/data/room-logs/2026-08-10T01-31-02-221Z-EJ5BQ.json` | 2026-08-10 | 3 humans | 18 | v4 | Fully attributable |
| M13 | `lab/data/room-logs/2026-08-10T01-45-21-995Z-EJ5BQ.json` | 2026-08-10 | 3 humans | 17 | v4 | 64 of 87 decisions covered; only 23 attributed |
| M14 | `lab/data/room-logs/2026-08-10T01-56-57-288Z-6UYEX.json` | 2026-08-10 | 4 humans | 30 | v4 | 1 covered decision excluded |

Corpus totals:

- **14 distinct completed matches**: 13 all-human and 1 three-human/one-bot hybrid.
- **54 human seat-games** and 1 bot seat-game. These are participations, not 54 unique people.
- Player-count distribution: 4 three-player matches, 7 four-player matches, and 3 five-player matches.
- **251 rounds** in total; match length ranges from 10 to 30 rounds, with mean 17.9 and median 17.5.
- All 14 matches used the same rules: 60-second turns, half-plus-one Ace conversion, one-die Palo Fijo trigger, blind multi-die Palo Fijo, visible dice amounts, and table dice enabled.

### Duplicates and non-qualifying material

- `/Users/ianduclos/Desktop/Cachito-Legendary-Match-2026-08-10-6UYEX.json` is byte-for-byte identical to M14. Both files have SHA-256 `616401cc259017c99d6a5d23663b5f6462eb44cc49245d122a087d8b774ccb8a`; it is inventoried but counted once.
- `lab/viz/replay-demo-room.json` is a derived visualization of M01, not a second match.
- `lab/data/rooms.jsonl` contains normalized copies of room logs already present under `lab/data/room-logs/`; it contributes no new qualifying match.
- `lab/data/exp-*` human-regression audits and replay outputs are partial analyses or counterfactual experiments, not authoritative completed-match logs.
- `logs/cachito-2026-07-13T*.json` are bot simulation logs and contain no human-controlled seats.
- `lab/data/room-logs/2026-07-30T02-25-15-944Z-BZJVP.json` has three human seats but is still `playing`, so it is excluded.
- Eleven other completed room logs are one-human/bot matches and fail the two-human inclusion rule.

### Analysis treatment and limitations

The 13 structured logs store nested analysis schema v3 or v4. Those versions are not directly comparable for claim risk: v4 changed `scores.bluff` to legal-view claim risk and added the verified-final-bid denominator. For a consistent research pass, M02–M14 were replayed in memory through the current schema-v5 `buildMatchAnalysis`; no match data was written. This also supplies current forced-escalation, literal unheld-face, bid-face, signature-play, and Biggest Liar semantics.

Privacy and attribution rules used throughout this report:

- `covered: true` actions remain table-level facts but are never described as the covered human’s choice or style.
- If the featured actor is attributable but the counterpart was covered, copy may describe “a Dudo followed” or “the previous claim,” but must not name the covered counterpart as choosing it.
- M01 contains 12 “ran out of time” history messages but no action-level coverage link. Its 49 bids, 14 Dudos, and 2 Calzos are therefore excluded from player-attributed style and signature examples.
- No private hand is reproduced. Legal-view aggregates such as claim risk, literal unheld-face count, and forced-raise status are used only as statistics a player can understand about their own visible information.
- Revealed `actualCount`, final bid, dice deltas, table-dice count, round-start dice count, and ladder history are post-reveal public facts.

The corpus is small, clustered over a few game nights, and likely includes repeat participants. Nicknames and player IDs are not a reliable unique-person key. Results describe this set of matches, not a general human population. No cloud bucket or unindexed external storage was queried.

## 2. What the structured human matches contain

M02–M14 contain 235 resolved rounds and 946 raw bid/call decisions:

- 166 decisions are timeout coverage and are excluded from strategy attribution.
- 757 are attributable human decisions: **552 bids, 148 Dudos, and 57 Calzos**.
- 23 are attributable bot decisions in the one hybrid match.
- Coverage is highly concentrated: M02 and M13 contribute 157 of 166 covered decisions (94.6%). This is why simply averaging raw logs would badly distort “human style.”

Public resolution distribution:

- 167 of 235 rounds ended in Dudo (71.1%); 68 ended in Calzo (28.9%).
- 24 rounds were Palo Fijo (10.2%).
- 65 final claims landed exactly, 56 had more than the claimed count, and 114 fell short.
- 38 resolution rounds eliminated a seat (16.2%).

Attributable human outcomes:

- **Dudo:** 84 correct from 148 attempts (56.8%).
- **Calzo:** 20 correct from 57 attempts (35.1%).
- **Verified human final bids:** 203.
- **Revealed shortfalls:** 104 of 203 verified final bids (51.2%); 86 were caught and 18 survived a non-Dudo outcome.
- Shortfall sizes were usually modest: 55 missed by one, 35 by two, 8 by three, 4 by four, 1 by six, and 1 by seven.
- **Forced final escalations:** 139 of 203 verified final bids (68.5%); 68 were caught and 71 survived. Thirty-one landed exactly, 40 included a final table-dice commitment, and 4 were made from a one-die seat.
- **Table-dice plays:** 101 of 552 human bids (18.3%). Forty-one verified final bids included a table-dice commitment.
- **Literal unheld-face bids:** 162 of 552 human bids (29.3%), excluding blind multi-die Palo Fijo and covered actions. This says only that the named face was absent from the bidder’s visible private dice at that moment; it does not say the bid lacked rule support or was intended as a bluff.

Face mix among the 552 attributable human bids:

| Face | Bids | Share |
|---|---:|---:|
| Aces | 202 | 36.6% |
| Dones | 33 | 6.0% |
| Trenes | 46 | 8.3% |
| Cuadras | 49 | 8.9% |
| Chinas | 70 | 12.7% |
| Sambas | 152 | 27.5% |

Face-affinity labels therefore need a table or population baseline. “Ace-heavy” based only on raw share would describe much of the corpus and would confuse game structure with personal style.

### Comparable style-score distributions

The following distributions use current schema-v5 semantics and the stricter eligibility gates recommended below. The scores are descriptive 0–100 coefficients, not skill or personality ratings.

| Axis | Internal eligibility | Eligible seat-games | Min | P25 | Median | P75 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| Claim risk | at least 6 attributable bids | 42/50 | 21 | 32 | 37 | 43 | 56 |
| Aggression | at least 5 attributable raises | 35/50 | 21 | 26.5 | 29 | 32.5 | 43 |
| Challenge risk | at least 4 attributable calls | 29/50 | 36 | 42 | 44 | 47 | 53 |

Only 23 of the 50 structured human seat-games clear all three stronger gates. The UI should not force a three-axis psychological portrait. When an axis is ineligible, use a verified event or habit badge instead.

## 3. Human-readable style taxonomy

### Selection model

Use two kinds of labels:

- **Style labels** summarize repeated attributable choices in this match.
- **Event/habit badges** summarize literal counts or public outcomes.

Internal confidence states:

| State | Claim risk | Aggression | Challenge risk | Product behavior |
|---|---:|---:|---:|---|
| Suppress | fewer than 6 bids | fewer than 5 raises | fewer than 4 calls | Do not label the axis; choose an event/habit instead |
| Eligible | 6–11 bids | 5–9 raises | 4–7 calls | A short style label is allowed |
| Strong within-match evidence | 12+ bids | 10+ raises | 8+ calls | Label plus a declarative factual fragment is allowed |

These states should not appear as “early read,” “low confidence,” or methodology prose on the fun end-game page. Insufficient evidence should change what is selected, not add a caveat.

For eligible axes, use a rolling population percentile, with the current corpus quartiles as provisional defaults. This creates useful contrast without pretending the scores have universal meaning. Recalibrate after a larger independent human corpus.

### Core style labels

| Evidence rule | Default label | Roastier alternative | Current qualifying count | Safe verdict fragment |
|---|---|---|---:|---|
| Claim risk at or above eligible P75; currently `>=43`, 6+ bids | Long-Range Claimer | Stretch Merchant | 12/42 eligible | “Sent more claims beyond the cup than most of this table.” |
| Claim risk at or below eligible P25; currently `<=32`, 6+ bids | Close-Backed Claimer | Receipts Attached | 12/42 | “Kept most claims close to the dice they could see.” |
| Aggression at or above eligible P75; currently `>=33`, 5+ raises | Pressure Setter | Bid Bulldozer | 9/35 | “Kept pushing when the ladder tightened.” |
| Aggression at or below eligible P25; currently `<=26`, 5+ raises | Patient Builder | Slow Cooker | 9/35 | “Built the ladder a step at a time.” |
| Challenge risk at or above eligible P75; currently `>=47`, 4+ calls | High-Wire Caller | Dudo Daredevil | 8/29 | “Made calls in the table’s least comfortable spots.” |
| Challenge risk at or below eligible P25; currently `<=42`, 4+ calls | Selective Caller | Button Saver | 10/29 | “Waited for narrower calling windows.” |

Do not expose the numeric percentile. Select one primary axis by salience: distance from the eligible median divided by the axis’s interquartile range. If two axes are close, prefer the one with more samples; if still tied, prefer the axis with the more concrete factual fragment.

### Habit and outcome labels

These work well when the style axes are ineligible and are often more fun even when style evidence exists.

| Internal eligibility | Default label | Roastier alternative | Observed count |
|---|---|---|---:|
| 8+ bids, 3+ table-dice plays, and table dice on at least 25% of bids | Table Setter | Cup Decorator | 10/50 seat-games |
| 2+ Calzo attempts | Calzo Hunter | Exact-Count Gremlin | 16/50 |
| 2+ correct Calzos | Exact Eye | Calzo Magnet | 6/50 |
| 4+ Dudo attempts | Dudo Regular | Dudo Button | 17/50 |
| 2+ correct Dudos | Sharp Calls | Receipts Inspector | 21/50 |
| 4+ verified final bids and 3+ forced final escalations | Forced Climber | No Support, No Problem | 24/50 |
| 2+ unsupported final bids survived, or 3+ forced escalations survived | Escape Artist | Somehow Still Here | 12/50 |
| 3+ verified final bids and none fell short | Every Claim Held | Receipts Attached | 2/50 |
| 3+ Dudos and all correct | Dudo Clean Sheet | Dudo Perfect | 4/50 |
| 2+ Calzos and all correct | Calzo Clean Sheet | Exact-Count Gremlin | 4/50 |

“Forced Climber” is common in this rule set—24 of 50 seat-games meet the proposed gate—so it is supporting texture, not usually the headline. “Escape Artist” is an outcome label, not a claim that the player planned the escape.

### Biggest Liar / Boldest Storyteller

Treat this as a special table-relative roast award, not as one of the three style axes.

- **Party title:** Biggest Liar
- **Optional neutral/default alternative:** “The table’s boldest storyteller.” This is optional copy, not a static active subtitle.
- **Eligibility:** at least one positive-scoring attributable bid choice; never award it from covered actions or a blind multi-die Palo Fijo hand.
- **Current v5 ranking:** total choice points. Literal support factor is `1` for zero copies, `0.4` for one, and `0` for two or more. Choice factor is `2` for an opening/switch, `0.25` for a same-face engine-minimum continuation, then `+0.5` for each additional engine-legal same-face quantity skipped. Deterministic ties use invented faces, gratuitous overraises, excess steps, scored bids, then fixed seat order.
- **Winner status:** irrelevant to eligibility. A good storyteller can win. Corpus incidence under the thin selector has not yet been recomputed.

Outcome-aware roast line:

- Winner: **“Lied. Won. No notes.”**
- Nonwinner with `scoredUnsupportedSurvived > scoredUnsupportedCaught`: **“Got away with it. Lost anyway.”**
- Otherwise, including ties: **“The dice kept the receipts.”**

Earlier branch counts used the superseded broad-shortfall gate and need recalculation. Do not substitute a failure-only description: the award is about the broadest table story, not simply who was caught most.

## 4. Memorable move and event taxonomy

All examples below are sanitized to a per-match alias and `Player A/B/...`. No nickname or hidden hand is shown. Face names, round-start dice counts, table-dice counts, bid ladders, and reveal totals were public at the table.

Event categories overlap. A one-die exact Calzo can be a correct Calzo, last-die stand, exact landing, and lead swing at once. The renderer should select one headline and attach secondary badges rather than repeat the same play four times.

### Correct Dudo

**Detection:** attributable human Dudo; revealed `actualCount < final quantity`.

**Corpus:** 84 correct from 148 attributable human attempts (56.8%).

**Template:**

> `{actor}` called Dudo on `{quantity} {face}`. Only `{actual}` showed—`{gap}` short.

**Roastier:**

> `{quantity} {face}` walked in. `{actual}` walked out.

**Sanitized example:** M09, round 1: Player D called Dudo on 13 Aces; 7 showed, a six-die shortfall.

### Correct Calzo

**Detection:** attributable human Calzo; `actualCount === final quantity`.

**Corpus:** 20 correct from 57 attributable human attempts (35.1%).

**Template:**

> `{actor}` found the exact count: `{quantity} {face}`. Calzo.

**Roastier:**

> Exact count. Zero notes.

**Sanitized example:** M14, round 14: Player B started on one die, called Calzo on 4 Chinas, hit exactly 4, and gained a die.

### Bid held under Dudo

**Detection:** attributable human final bidder; a later Dudo is incorrect because `actualCount >= quantity`. The caller need not be attributable for the bidder’s real play to qualify, but a covered caller must remain unnamed.

**Corpus:** 62 attributable human bid-held events.

**Template:**

> Dudo followed `{actor}`’s `{quantity} {face}`. The table showed `{actual}`.

**Roastier:**

> Called. Counted. Still standing.

### Exact bait / exact landing

“Exact bait” is acceptable as an editorial event name, not an assertion that the bidder intended to trap anyone.

**Detection:** bid-held event with `actualCount === quantity`.

**Corpus:** 33 of 62 attributable bid-held events landed exactly (53.2%).

**Default label:** Exact Landing  
**Roast label:** Exact Bait

**Template:**

> The Dudo arrived. `{quantity} {face}` landed exactly.

**Sanitized example:** M07, round 8: Player A’s 7 Cuadras landed exactly; the Dudo cost a one-die caller their last die. The copy should credit the exact landing, not claim Player A planned the elimination.

### Last-die stand

**Detection:** the attributable featured actor began the round with one die and either made a correct Dudo/Calzo or had a final bid hold under Dudo.

**Corpus:** 19 events: 6 correct Dudos, 8 correct Calzos, 3 exact held bids, and 2 held bids with more than the claimed count.

**Template:**

> One die left. `{actor}` hit `{event}` and stayed alive.

**Roastier:**

> One die. No exit.

**Sanitized example:** M04, rounds 18 and 20: Player D hit exact Calzos from one die twice in three rounds—first 1 Samba, then 2 Cuadras—gaining a die each time.

### Last-die duel

**Detection:** both featured caller and bidder began the round on one die; the attributable action eliminates the counterpart.

**Template:**

> One die each. One call left the table.

**Sanitized example:** M08, round 19: a one-die Player B correctly called Dudo on a one-die Player A’s 3 Chinas; only 1 showed and Player A was eliminated.

### Table-dice gambit

**Detection:** the attributable featured bidder committed at least one die to the table on the final bid.

**Corpus:** 41 verified final bids. Outcomes: 23 caught by correct Dudo, 11 held under Dudo, 3 met a correct Calzo, and 4 survived an incorrect Calzo. Final commitments were one die 29 times, two dice 6 times, three dice 5 times, and four dice once.

**Template:**

> `{actor}` put `{tableDice}` dice in public and finished at `{quantity} {face}`. `{resolution}`

**Roastier:**

> Dice on the table. Subtlety off the table.

**Sanitized example:** M08, round 1: Player C committed four table dice on the final 11 Chinas claim; 10 showed and Dudo landed.

### Table-dice fireworks

This is a round-level spectacle, not a claim that any one player caused the outcome.

**Detection:** total table dice at the call reaches a high table-relative percentile, optionally combined with a long ladder or exact result.

**Template:**

> `{tableDice}` dice were already public when the ladder reached `{quantity} {face}`.

**Sanitized example:** M08, round 6: a nine-bid ladder left nine dice on the table; the final 12 Chinas landed exactly and an attributable Calzo hit.

### Longest reach

Prefer this factual award over “worst lie.”

**Detection:** largest `quantity - actualCount` among attributable revealed final bids in the match.

**Corpus:** 104 attributable shortfalls. The maximum gap was 7; only two gaps exceeded 4.

**Template:**

> `{quantity} {face}` met `{actual}` at the reveal—the table’s longest reach at `{gap}`.

**Roastier:**

> A `{gap}`-die gap between the story and the table.

**Sanitized example:** M09, round 2: Player C’s 10 Aces met 3 at the reveal, a seven-die reach. The Calzo was also wrong, so the unsupported claim survived the round; that distinction should remain in the copy.

### Forced climb

**Detection:** on the actor’s legal view, no legal raise before the final bid could be fully supported by the actor’s own visible hand under engine counting rules. Covered and blind multi-die Palo Fijo choices are not attributed.

**Corpus:** 139 of 203 verified human final bids; 68 were caught and 71 survived. Because this is common, promote it only when combined with exactness, one-die stakes, a long ladder, or a large table-dice commitment.

**Template:**

> No fully backed raise was available. `{actor}` climbed to `{quantity} {face}`—and it `{held/came up short}`.

**Roastier:**

> No support. Still climbing.

**Sanitized example:** M03, round 8: with no legal raise fully backed by the bidder’s visible dice, Player C finished at 5 Chinas; exactly 5 showed and the Dudo failed.

### Ladder record

**Detection:** number of bid actions before the resolving call. For a player-attributed signature, the featured actor’s action must be attributable; covered intermediate actions may remain a table-level count but should not be credited to their nominal players.

**Corpus:** the mechanical maximum is 17 bids, but that entire M02 round is timeout-covered and is ineligible for player credit. The longest fully uncovered ladders contain 9 bids.

**Template:**

> The table climbed `{ladderLength}` bids and finished at `{quantity} {face}`.

**Roastier:**

> `{ladderLength}` bids. Nobody found the brakes.

**Sanitized example:** M08, round 6 is the clean nine-bid, nine-table-dice, exact-12-Chinas Calzo described above.

### Lead movement

Momentum is dice share, not win probability. Ties matter.

Use three distinct events:

- **Broke clear:** a tied leader set becomes one sole dice leader. This happened 33 times.
- **Lead reopened:** a sole leader becomes tied. This happened 20 times.
- **Lead changed hands:** one sole leader is replaced directly by another sole leader. This happened only once.

The broader set of top-dice seats changed 83 times, but most were tie composition changes. Calling all 83 “lead changes” would overstate the drama.

**Template, broke clear:**

> `{actor}` broke clear with `{dice}` dice.

**Template, strict change:**

> The sole lead moved from `{from}` to `{to}` in round `{round}`.

**Sanitized example:** M10, round 12 produced the corpus’s only strict sole-leader switch: a four-die leader lost two on a Calzo, leaving another seat alone in front with three dice.

### Elimination swing and match clincher

**Detection:** a public dice change reaches zero; for a player signature, the action causing it must be attributable. A match clincher additionally leaves the final winner.

**Corpus:** 38 public resolution rounds eliminated a seat.

**Template:**

> `{event}` cost `{counterpart}` the last die.

**Roastier:**

> Last die, last call.

Do not automatically make the final round the signature. A routine clincher is often less memorable than a one-die Calzo, exact held bid, or table-dice spectacle earlier in the match.

### Streak and sequence events

Single-round fields can support multi-round stories after grouping by actor:

- two correct Calzos within three rounds;
- consecutive correct Dudos;
- multiple exact held bids;
- a one-die seat gaining a die, falling back to one, and gaining again;
- a winner emerging from outside the sole lead.

Require each attributed action in the sequence to be uncovered. The M04 double-Calzo sequence is a strong real example.

## 5. Labels and claims to avoid

### Intent claims

Avoid for humans unless the player explicitly self-reports intent:

- “deliberate bluff,” “planned bluff,” “baited,” “set a trap,” “knew,” “read their opponent,” “panicked,” or “choked”;
- “caught lying” as analytical prose;
- “honest player,” “dishonest player,” or a claim that an unsupported result proves deception;
- converting a bot-only persona trace into a human label.

The sanctioned **Biggest Liar** title is party-language backed by descriptive pre-action choice evidence. Its implementation must still avoid intent inference. Revealed outcomes may flavor the punchline but never the ranking. “The table’s boldest storyteller” is available as optional neutral/default copy, not as a required subtitle.

### Metric collapses

Do not collapse these distinct facts:

- **Claim risk** is a legal-view estimate across every attributable bid; it is not revealed bluff frequency and not intent. The wire key `scores.bluff` should continue to be presented as Claim risk in analytical UI.
- **Unsupported final bid** means `actualCount < quantity` at reveal. It may be forced, accidental, deliberate, caught, or allowed to survive by a wrong Calzo.
- **Forced escalation** means no fully own-hand-supported legal raise existed. It does not mean the chosen raise was irrational or intended as a bluff.
- **Literal unheld face** means the denomination itself was absent from visible private dice. Aces are not treated as holding another face for this statistic, and blind Palo Fijo is excluded.
- **Challenge risk** is not call accuracy or call frequency.
- **Aggression** is pressure applied in uncertain raises, not temperament or quality.
- **Dice share** is momentum, not match equity or win probability.

### Outcome overclaims

Avoid:

- “impossible Calzo” or precise probability language when only a coarse surprise band is public;
- “comeback” unless the player demonstrably trailed on public dice and later won or took the sole dice lead;
- “lead changed hands” when the table merely moved between a tie and a sole leader;
- “perfect game” from perfect Dudo or Calzo accuracy on one or two attempts;
- “all bids held” when only final bids that reached a reveal are verified;
- comparing raw bid quantity across three- and five-player tables without normalizing for dice in play;
- using action time as decisiveness or hesitation without separating network delay, disconnection, and coverage.

### Coverage language

Never name a covered human as choosing an action. Safe renderings include:

- “A Dudo followed.”
- “The previous claim reached the reveal.”
- “The round ended at 7 Cuadras.”

Unsafe renderings include:

- “Player B bravely called Dudo” when that call was covered;
- “Player C bluffed to 7 Cuadras” when the final bid was covered;
- a streak, style score, or defining moment built from timeout actions.

## 6. Schema and derived-stat requirements

### Already available

| Need | Existing source | Status |
|---|---|---|
| Completion, winner, final public dice | `state.phase`, `state.winnerId`, final players | Available |
| Rules and game version | `rules`, `gameVersion` | Available |
| Bid ladder and resolving call | `analysis.roundStories[].bids`, `callerId`, `bidderId`, `kind` | Available in nested analysis v3+ |
| Reveal result | `actualCount`, `margin`, `correct`, `diceChanges` | Available and public |
| Palo Fijo | `roundStories[].paloFijo` | Available |
| Table-dice count per bid | `roundStories[].bids[].tableDice` | Available when used |
| Covered action attribution | private `actions[].covered` → public `bids[].attributable` / `callerAttributable` | Available in schema-v5; missing legacy joins fail closed |
| Round-start dice count | `roundStories[].startingDice` | Materialized in schema-v5 |
| Postgame open-dice chronology | `roundStories[].replayFrames` | Optional schema-v5; setup + exact pre-action hand/table snapshots, omitted when provenance is incomplete |
| Post-round dice share | `analysis.momentum` | Available; explicitly not equity |
| Per-player bid/call/table-dice totals | `analysis.players[].stats` | Available |
| Claim risk, aggression, challenge plus samples | `analysis.players[].scores` | Current definitions available in builder; stored v3/v4 semantics differ |
| Verified final-bid denominator | `stats.verifiedFinalBids` | Current v5 builder and stored v4; absent from stored v3 |
| Forced-final-bid totals | `stats.forcedEscalations*` | Available as per-player totals |
| Bid-face and literal unheld-face totals | `bidFaceCounts`, `unheldFaceBids`, `averageUnheldFaceQuantity` | Current v5 builder; not persisted in this corpus’s v3/v4 nested analyses |
| One selected signature play | `analysis.signaturePlay` | Current v5 builder; safe coarse surprise only |
| Biggest Liar components | `deceptionPoints`, choice components, `widestScoredShortfall` | Current v5 builder; outcome is roast/evidence only |

### Recommended additions or materializations

1. **Authoritative completed participant roster.** Add a stable `participants` array with fixed `seatIndex`, display name at game end, controller, and persona where applicable. Do not rely on the connection-oriented top-level `seats`; it omitted eliminated/disconnected players in several logs.

2. **Monotonic action sequence.** Add `sequence` to every action. Timestamps are useful but should not be the only way to join final bid, call, bot trace, and resolution.

3. **Server-side attribution bit.** Derive `attributionEligible` from controller and coverage. Keep raw timeout detail private if desired. For a signature counterpart, include `counterpartAttributable` so the renderer knows whether it may name that person.

4. **Public dice counts at both ends of a round.** Materialize `diceBefore` and `diceAfter` by player in the private analysis input or safe completed payload. This supports last-die stands, eliminations, and tie-aware lead movement without consulting hand arrays.

5. **Final action provenance in each round story.** Add final bid action sequence, call action sequence, bidder/caller attribution eligibility, actor’s table-dice commitment, and total table dice at the call. All are derivable now; materialization prevents fragile action matching.

6. **Per-event forced-escalation record.** The current payload has only totals. Add a private derived event with round, action sequence, final/nonfinal status, outcome, and a boolean `forcedEscalation`. If sent to the browser, send only the boolean and public event fields—never the hand or candidate legal bids.

7. **Tie-aware leader fields.** Derive `leaderIds`, `leaderDice`, and `leadChangeKind: tie-to-sole | sole-to-tie | sole-switch | tie-set-change` after each round. This prevents momentum copy from inventing a unique leader.

8. **Public event tags on the selected signature.** Suggested tags: `exact`, `last-die`, `elimination`, `match-clincher`, `table-dice`, `long-ladder`, `widest-shortfall`, `forced`, `palo-fijo`, `sole-lead-switch`. Tags allow human copy without exposing probabilities or hands.

9. **Candidate provenance server-side.** Retain a private ranked candidate list or debug record containing candidate type, component scores, and disqualification reason. Continue sending only the selected privacy-safe signature to the browser.

10. **Coverage migration state.** For old logs use `coverageKnown: false`, not `covered: false`. Unknown legacy attribution must suppress player credit.

11. **Outcome-aware Biggest Liar branch inputs.** Winner, `scoredUnsupportedCaught`, and `scoredUnsupportedSurvived` already exist. Keep them adjacent to the award renderer so the three canonical roast lines cannot drift into a failure-only fallback; none may affect ranking.

12. **Optional sequence aggregates.** Correct-call streak, exact-held streak, and one-die recovery sequence can be derived from event tags and actor IDs. No new raw information is needed.

Fields that should remain private:

- any live or in-progress hand projection; exact historical hands have one
  explicit exception in completed-match `roundStories[].replayFrames` after
  game over;
- raw legal-view probabilities and model diagnostics;
- bot traces beyond approved plain-language reasons;
- connection details and raw timeout mechanics;
- inferred human intent.

## 7. Signature-play ranking candidates

### Hard eligibility

A candidate can be ranked only when:

- the featured action resolved in a completed round;
- the featured actor’s action is attributable and not covered;
- the public payload can explain it using bid, reveal, table dice, dice counts, and deltas only;
- blind Palo Fijo or hidden-hand information is not smuggled into the copy;
- if the counterpart action was covered, the counterpart is not named as choosing it.

### Candidate families

| Candidate | Corpus support | Ranking note |
|---|---:|---|
| Correct Calzo | 20 | Naturally rare and positive; boost one-die and multi-die table contexts |
| Correct Dudo | 84 | Boost larger public shortfall, one-die caller, elimination, or long ladder |
| Exact held bid under Dudo | 33 | Strong, simple story; boost caller elimination or one-die bidder |
| Other held bid under Dudo | 29 | Use when margin, stakes, or ladder is notable |
| Last-die stand | 19 | Strong stakes multiplier; category overlaps call/held events |
| Final table-dice gambit | 41 | Boost larger commitment and notable resolution; do not imply it caused success |
| Table-dice fireworks | 101 total table-dice plays | Round-level drama; total table dice should be percentile-normalized |
| Widest revealed shortfall | 104 shortfalls; max 7 | Prefer factual “Longest Reach”; outcome may be caught or survive |
| Forced climb | 139 | Too common alone; promote only with exactness, survival, last die, or table dice |
| Elimination swing | 38 rounds | Boost when the featured action is attributable and stakes were visible |
| Clean ladder record | max 9 fully uncovered bids | Avoid awarding the 17-step covered ladder to players |
| Strict sole-lead switch | 1 | Rare, strong momentum event; distinguish from tie transitions |
| Multi-round streak | at least one strong double-Calzo example | Every action in the sequence must be attributable |
| Match clincher | up to one per match | Useful fallback, not automatic winner of the ranking |

### Recommended scoring

For a fun, explainable page, public drama should outweigh opaque model surprise:

- **35% stakes:** one-die actor, elimination, match clincher, dice gained, or counterpart dice lost.
- **25% event rarity:** correct Calzo, exact held bid, strict lead switch, unusual streak.
- **20% table drama:** ladder-length percentile and total table-dice percentile.
- **15% reveal shape:** exactness for Calzo/held bids; normalized shortfall for Dudo.
- **5% momentum swing:** tie-to-sole or sole-leader switch based on dice, not equity.

The existing legal-view surprise classification can remain an internal tie-break or coarse badge (`notable`, `bold`, `long-shot`), but raw probabilities should not be serialized and should not drown out a much clearer public story.

Recommended deterministic tie-break order:

1. actor started the round on one die;
2. attributable action eliminated a seat or clinched the match;
3. exact outcome for Calzo/held bid, or larger normalized shortfall for Dudo;
4. longer bid ladder;
5. more total table dice, then more dice committed by the featured actor;
6. later round;
7. lower action sequence;
8. fixed seat order only as the final invisible tie-break.

Normalize quantities and shortfalls by dice in play before comparing different table sizes. Never use nickname, controller identity, or seat order as a substantive ranking feature.

### Recommended rendered shape

One selected signature is enough:

> **LAST-DIE CALZO**  
> Player B found exactly 4 Chinas in Round 14 and climbed back to two dice.

Then attach compact secondary tags such as `EXACT`, `ONE DIE`, and `+1 DIE`. Do not show a ranked list of “best moves”; it invites false precision and repeats overlapping facts.

## 8. Reusable language bank

This section is intentionally player-facing and contains no methodology caveats.

### Match headlines

- `{winner} takes the table after {rounds} rounds.`
- `{winner} closes a {rounds}-round marathon.`
- `{winner} wins with {dice} dice still standing.`
- `One die. One exact Calzo. A different match.`
- `{actor}’s Round {round} Dudo catches a {gap}-die shortfall.`
- `The ladder climbs {ladderLength} bids—and lands exactly.`
- `{tableDice} dice on the table. {quantity} {face}. Exact.`
- `A last-die Dudo sends the other last die home.`
- `{actor} survives the Dudo with exactly {quantity} {face}.`
- `{winner} wins—and the table keeps one more story.`

### Signature-play titles

- CORRECT CALZO
- DUDO LANDED
- BID HELD
- EXACT LANDING
- EXACT BAIT
- LAST-DIE STAND
- LAST-DIE DUEL
- TABLE-DICE GAMBIT
- TABLE-DICE FIREWORKS
- LONGEST REACH
- FORCED CLIMB
- LADDER RECORD
- BROKE CLEAR
- LEAD CHANGED HANDS
- ELIMINATION SWING
- MATCH CLINCHER
- DOUBLE CALZO

### Style labels

Default:

- Long-Range Claimer
- Close-Backed Claimer
- Pressure Setter
- Patient Builder
- High-Wire Caller
- Selective Caller
- Table Setter
- Calzo Hunter
- Exact Eye
- Dudo Regular
- Forced Climber
- Escape Artist
- Boldest Storyteller

Roastier:

- Stretch Merchant
- Receipts Attached
- Bid Bulldozer
- Slow Cooker
- Dudo Daredevil
- Button Saver
- Cup Decorator
- Exact-Count Gremlin
- Dudo Button
- No Support, No Problem
- Somehow Still Here
- Biggest Liar

### Verdict fragments

- `Set the pace with {raises} attributable raises.`
- `Put dice on the table {tableDicePlays} times.`
- `Hit {dudoCorrect} of {dudoAttempts} Dudos.`
- `Found {calzoCorrect} exact Calzos.`
- `{held} revealed final claims held; {short} fell short.`
- `Survived {survived} challenged final claims.`
- `Climbed without a fully backed raise {forced} times.`
- `Turned one die into two with Calzo in Round {round}.`
- `Reached {gap} beyond the reveal—the widest gap at this table.`
- `Kept every one of {verified} revealed final claims standing.`
- `Made the table count all the way to {quantity} {face}.`
- `Broke clear of the tie with {dice} dice.`

### Biggest Liar block

**Title:** Biggest Liar

**Optional neutral/default alternative:** `The table’s boldest storyteller.`

- Winner: `Lied. Won. No notes.`
- Nonwinner with more unsupported claims surviving than caught: `Got away with it. Lost anyway.`
- Otherwise/tie: `The dice kept the receipts.`

### Badges

- EXACT
- ONE DIE
- +1 DIE
- DUDO HIT
- CALZO HIT
- BID HELD
- LAST-DIE STAND
- TABLE DICE
- FOUR DICE PUBLIC
- NINE-BID LADDER
- LONGEST REACH
- ALL CLAIMS HELD
- DUDO CLEAN SHEET
- CALZO CLEAN SHEET
- FORCED CLIMB
- ESCAPE HATCH
- BROKE CLEAR
- SOLE-LEAD SWING
- MATCH CLINCHER
- BIGGEST LIAR

### Compact event templates

- **Correct Dudo:** `{actor} called {quantity} {face}. Only {actual} showed.`
- **Correct Calzo:** `{actor} found exactly {quantity} {face}.`
- **Held bid:** `Dudo followed. {actual} backed {actor}’s {quantity}.`
- **Exact landing:** `{quantity} {face}. Called. Exact.`
- **Last die:** `One die left. {actor} stayed alive.`
- **Table dice:** `{actor} put {count} dice in public and kept climbing.`
- **Longest reach:** `{quantity} met {actual}: a {gap}-die reach.`
- **Forced climb:** `No fully backed raise. Still climbing.`
- **Lead:** `{actor} broke clear with {dice} dice.`
- **Elimination:** `{event} cost {counterpart} the last die.`

## 9. Product priorities

1. **Ship truthful signature copy first.** Correct Calzo/Dudo, exact held bid, last-die, table dice, and public reveal margin already produce excellent stories.
2. **Enforce attribution before ranking.** Add counterpart attribution state so covered humans are never named as choosing a call or bid.
3. **Use stricter internal style gates and percentile bands.** Suppress weak axes silently; do not put methodology disclaimers on the celebration page.
4. **Make Biggest Liar choice-based and outcome-aware only in the punchline.** Rank attributable pre-action choice points, preserve the three winner/survival/receipts lines as roast-only copy, and keep outcomes out of eligibility and scoring. “The table’s boldest storyteller” remains optional neutral/default copy, not a static subtitle.
5. **Materialize per-event tags and tie-aware leader state.** This removes brittle joins and prevents misleading “lead change” prose.
6. **Keep roast mode lexically separate.** Detection stays the same; only labels and punchlines change.

The clearest real-match proof of concept is M08 round 6: nine bids, nine table dice, a final 12 Chinas, and an exact Calzo. It needs no invented psychology, no hidden hand, and no probability disclaimer. It is already a story.
