# lab/tools

Barebones TypeScript CLIs, run with `npx tsx`. Import the real engine and bots
from `src/`; never reimplement game rules. No new dependencies. See
`lab/README.md` and `lab/LOG.md` for the wider research context.

## simulate.ts — batch self-play runner

Runs headless bot-vs-bot games through `runBotMatch` and writes one compact
JSON record per game (JSONL). Skips and reports (never crashes the batch) if
a single game throws.

```
npx tsx lab/tools/simulate.ts \
  --games 2000 \
  --players 4 \
  --policies conservative,baseline \
  --seed 1 \
  --out lab/data/run-name.jsonl
```

Flags:

- `--games` — number of games to run (required).
- `--players` — seats per game, 2–8 (required).
- `--policies` — comma-separated policy names, assigned round-robin to seats.
  One name means every seat uses it. Seat/policy assignment rotates across
  games so no seat is permanently owned by one policy. Matching is
  case/space/hyphen-insensitive. Valid names: `Baseline`, `Conservative`,
  `Challenger`, `Bluffer`, `Exact seeker`, `Survivalist` (the permanent
  baseline league from `src/bot/adversarial.ts`). Run with a bad name to see
  the exact list.
- `--seed` — base seed; each game gets its own seed deterministically derived
  from it (default `1`).
- `--out` — output `.jsonl` path (required; parent directories are created).
- `--maxActions` — optional passthrough to `runBotMatch`'s action cap.

Each output line is a `CompactGameRecord` (see `lab/tools/shared.ts`):
`game`, `seed`, `players`, `seats` (`{id, policy, controller: 'bot'}` in seat
order — `controller` is future-proofing for human logs; bot policies never
see it), `winnerId`, `rounds`, `actions`, and `roundRows` — one row per round
with the round-start stack vector, starter, palo fijo flag, raise count, the
dudo/calzo outcome, and the resulting per-player dice deltas.

Progress prints every 500 games; a final summary reports games written,
elapsed time, games/sec, and win counts per policy.

## equity.ts — dice-equity aggregation

Aggregates one or more `simulate.ts` JSONL files into exact win-probability
counts keyed by the public stack vector at every round-start observation.

```
npx tsx lab/tools/equity.ts lab/data/run-name.jsonl [more.jsonl ...] \
  --out lab/data/run-name.equity.json
```

`--out` is optional; if omitted it defaults to `<first-input>.equity.json`.

State key: `ownDice | sorted other active stacks (comma-joined) | isStarter
(0/1) | playerCount`, where `playerCount` is the game's original seat count
(the currently-active count is already implied by the length of the "other
stacks" list — see the note in `equity.ts` for this judgment call). Label is
whether that player went on to win the game.

Output JSON has, per state key, `{n, wins, p}` (exact counting, no smoothing
— see the comment at the top of `equity.ts`), plus precomputed rollups:
`marginalByOwnDice` (P(win) by own-dice count, per player count) with
`marginalDeltas` (the delta vs one fewer die), and `starterVsNonStarter`.
The same marginal table and starter/non-starter split print to stdout.

## ingest.ts — schema-v4 room-log ingest

Converts online-room match logs (schema v4, written by `dev/onlineRooms.ts` to the GCS
log bucket) into the same `CompactGameRecord` JSONL that `simulate.ts` produces, so every
analysis tool — starting with `equity.ts` — runs identically on simulated and real
human/hybrid games. Reuses the real engine's `countBid` for ground-truth round resolution;
never reimplements bid/count rules.

```
npx tsx lab/tools/ingest.ts <file-or-dir> [more...] --out lab/data/rooms.jsonl
```

Accepts individual v4 JSON files or directories of them (non-recursive). Files with
`schemaVersion !== 4` or an unfinished game (no `winnerId` in the final state) are skipped
with a warning; the batch keeps going.

What it derives, per round:

- **Stacks** — each player's dice count at round start, from `roundDeals[].hands` (all
  original seats appear, 0 for already-eliminated players, matching the sim format).
- **Deltas** — the next round's stacks minus this round's (final `state.players` diceCount
  for the last round), which should always show dudo −1, calzo-wrong −2, calzo-correct +1
  (capped at 5).
- **Outcome (`correct`/`actualCount`)** — v4 logs carry no structured resolution on the
  dudo/calzo action itself; the true dice are reconstructed from `roundDeals` hands, with
  reveal-time hands corrected for anyone who put dice on the table that round (`tableDice`
  + `rerolledDice` recorded on that bid action — table dice reroll the bidder's remaining
  *private* dice mid-round, so round-start hands go stale for that player). `countBid` (the
  real engine's counting function) is then called on the reconstructed hands. If a
  table-dice bid is missing `rerolledDice` (older/malformed logs), that round is flagged
  `unverifiable` and reported separately — the reveal-time hand can't be reconstructed, so
  the derived `actualCount` for that round is best-effort only.
- **Ground-truth cross-checks** (both reported per file and totaled):
  - *Delta cross-check* — always available, no dice knowledge needed: whichever side
    (bidder or caller) actually lost/gained dice implies `correct` independently of the
    `countBid` derivation. A mismatch here is a red flag.
  - *History cross-check* — `history` is a rolling 30-entry window (server-side, oldest
    entries fall off), so it only ever covers the last few rounds of a finished game; its
    "Dudo/Calzo: correct/incorrect — N actual." lines are matched positionally
    (newest-first) against the same number of most-recent derived rounds, sidestepping the
    window's round-number ambiguity (it also contains a benign duplicate "Round N begins."
    line right at game-over).
- **Covered moves** — a turn is `covered: true` (a timeout bot moved for a human) if its
  matched `turnTimings` entry has `outcome: "timeout"`, never finished, or finished at/after
  its deadline; matching decisions to timings is positional-with-playerId-fallback per
  round. Ambiguous matches are conservatively marked covered. `covered` moves should be
  excluded from human-style analysis.
- **`turns`** — the per-round decision sequence in order (`{playerId, action, elapsedMs?,
  covered?}`), which the compact sim format doesn't carry.

`policy` on ingested seats holds the player's nickname/name (there's no bot-policy identity
in room logs); `seed` is `0` (no RNG seed concept for real games — `roomCode`/`startedAt`
are the real identifiers, carried as extra fields on the record).

Reference run (`lab/data/reference/2026-07-15T04-06-28-324Z-TZTHN.json`, 4 humans, 16
rounds): 0 stack-invariant violations, 33 covered moves detected, 4 table-dice rounds, 0
unverifiable rounds, 16/16 delta cross-checks matched, 3/3 history cross-checks matched.

## Smoke test

```
npx tsx lab/tools/simulate.ts --games 300 --players 4 --policies conservative,baseline --seed 1 --out lab/data/smoke.jsonl
npx tsx lab/tools/equity.ts lab/data/smoke.jsonl --out lab/data/smoke.equity.json
npx tsx lab/tools/ingest.ts lab/data/reference/2026-07-15T04-06-28-324Z-TZTHN.json --out lab/data/rooms.jsonl
npx tsx lab/tools/equity.ts lab/data/rooms.jsonl --out lab/data/rooms.equity.json
```
