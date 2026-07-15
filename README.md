# Cachito

Cachito is a browser implementation of the hidden-dice game also known as Dudo, Liar's Dice, or Perudo. It supports 2–6 player local games and live, server-authoritative private online rooms.

See [RULES.md](./RULES.md) for the game rules, denomination names, bid examples, Palo Fijo behavior, and privacy rules. See [MACHINE_PLAYER.md](./MACHINE_PLAYER.md) for the staged bot plan.

## Current scope

The current app includes:

- 2–6 local players, each starting with five dice;
- a Human/Bot switch for every seat during setup, allowing mixed or all-bot local games;
- complete bidding, Dudo, Calzo, elimination, and Palo Fijo flows;
- private per-player hands on a shared device;
- a non-interactive normal spectator/public-table view and a clearly labeled admin testing view;
- downloadable, versioned JSON game logs with bot decision diagnostics;
- live private rooms with room codes, lobbies, reconnects, normal spectators, host bot management, and host kick controls;
- 90-second visible online turns, automatic round-shake and next-round fallbacks, and paced bot actions;
- sound effects, looping theme music, music/effects volume controls, and reduced-motion settings;
- a live, worker-backed adversarial learning dashboard with evolutionary progress, rankings, and exportable results;
- deterministic, testable engine behavior; and
- a clean boundary between rules, presentation, and future networking.

The local app includes a playable probability bot and an experimental parameter-learning lab. Realtime room play is live at [cachito.ianduclos.com](https://cachito.ianduclos.com): it uses Firebase Hosting for the browser app and a server-authoritative Cloud Run service for rooms. Accounts, public matchmaking, and durable relational persistence are not implemented.

## Live online play

1. Choose **Play online**, then create a room, join a room code, or watch a room as a spectator.
2. The host can add bots, remove bots, or remove players while still in the lobby. Two or more players are required to start.
3. The host can propose room rules in the lobby. Every seated player must approve a proposal before it takes effect (bots approve automatically), and the match cannot start while an approval is pending.
3. Every active player shakes at the beginning of a round. Humans have one minute to do so; bots shake after 2–3 seconds. Eliminated players skip this step and spectate.
4. Once all active cups are ready, every turn shows the same 90-second timer. Bots act after a 6–8 second thinking pause, not a shortened timer.
5. The first action of a round is a **Make bid**; later bids are **Raise bid**. Dudo and Calzo resolve the round, reveal hands, and let active players select **Next round**. The room advances when all active players are ready or after one minute.

The final-ten-seconds clock cue stops immediately when a move resolves. Theme music ducks for longer effects, and the settings menu controls music and effects separately. A reconnect token stored in the browser restores an existing player after a brief connection loss when the room is still active.

## Maintainer handoff — production reminders

Read this before changing or deploying online play.

- **Bump the visible release marker** in `src/release.ts` for every production interface release. It is deliberately subtle on the opening screen and is the quickest way to confirm that a visitor has the current build.
- **Run all checks before publishing:** `npm run build && npm test && npm run lint`.
- **Deploy the server first** when changing `dev/onlineRooms.ts`, `src/online/protocol.ts`, or engine behavior used online. The room service is Cloud Run service `cachito-rooms` in project `ian-duclos`, region `europe-west4`. Wait until its new revision receives traffic before deploying the browser.
- **Build the browser with the production room endpoint**, then deploy Firebase Hosting:

  ```sh
  VITE_ENABLE_ONLINE=true VITE_ONLINE_ENDPOINT=https://cachito-rooms-ribcxidnzq-ez.a.run.app npm run build
  firebase deploy --only hosting --project ian-duclos
  ```

- **Do not weaken the no-cache header** in `firebase.json`. `Cache-Control: no-store, max-age=0` is intentional: it prevents old game clients being left behind after a release. Verify it, and the live favicon, with `curl -I https://cachito.ianduclos.com/` after deployment.
- **Keep the room server authoritative.** Never send an opponent's live hand, an admin view, or a bot's private observation to any browser. Generate `projectForPlayer` / `projectForSpectator` views on the server.
- **Current online pacing is intentional:** 90 seconds per turn; a reveal advances once all active players select **Next round**, or automatically after one minute; unshaken cups auto-shake after another minute. Bots shake after 2–3 seconds, decide a turn after 6–8 seconds, and wait 4–6 seconds before next-round readiness. The final-ten-seconds clock cue must stop when a move resolves.
- **Keep private match data private.** Production room snapshots go to the `ian-duclos-cachito-bot-logs` bucket; do not expose that bucket through Hosting or browser APIs. Local `logs/*.json` remains ignored by Git.
- **Connection audit data is private.** Online snapshots record connection, reconnect, and disconnect events with a salted HMAC-SHA-256 IP fingerprint, IP version, forwarding-hop count, hashed user-agent, origin, primary language, and protocol. Never store raw IPs or raw user-agent strings. `IP_HASH_SALT` must be configured as a Cloud Run secret before enabling this audit trail.
- **Favicon source:** `public/favicon.png`. Replace that file when changing the browser icon.

## Run locally

Install dependencies, then use the project scripts:

```sh
npm install
npm run dev
```

Other available checks:

```sh
npm test
npm run test:watch
npm run build
npm run lint
```

- `dev` starts the Vite development server.
- `start` serves a built app and its realtime room server (run `npm run build` first).
- `test` runs the Vitest suite once.
- `test:watch` reruns tests while files change.
- `build` type-checks the project and creates a production build.
- `lint` runs the configured ESLint checks.

## Design

The engine is the sole authority on legal actions and state transitions:

```text
player action → engine validation → state transition → restricted view → interface
```

The interface must not reimplement bid ordering, challenge resolution, Palo Fijo, or elimination rules. It may ask the engine which actions are legal and explain rejected actions to the user.

Three state shapes matter:

- **Internal game state:** complete authoritative state, including every hand.
- **Player view:** public information plus the requesting player's hand only when the rules allow it. In Palo Fijo, players with more than one die do not receive their own hand.
- **Normal spectator view:** public information only while a round is live; it may show revealed hands after a challenge.
- **Admin testing spectator view:** a visibly labeled development/testing view that may show every live hand. It is not an ordinary player or spectator role and must not be exposed in production play.

This separation is a security property, not merely a visual choice. A future online server must generate player and normal spectator views before sending updates to clients; admin testing access uses a separate authorized path.

## Local pass-and-play

One device can safely move between players using an explicit handoff:

1. The public table identifies the next player without showing any live hand.
2. In a normal round, that player takes the device and deliberately reveals their own dice. During Palo Fijo, only a player holding one die may reveal their hand; players with more dice act without seeing it.
3. They choose a legal bid, Dudo, or Calzo.
4. Their dice are hidden before the next player takes the device.
5. Dudo or Calzo temporarily reveals every hand on the public result screen.

The public table is also the local normal spectator view. Normal spectators can follow the turn, current bid, dice remaining, history, and round results, but cannot inspect live hands or submit actions. The separate admin testing view can expose all hands for debugging and must be clearly marked.

Bot seats obey the same privacy boundary. Their live hands are hidden in Player and normal Spectator modes and are visible only in Admin testing mode. A bot takes its turn automatically after a short delay; consecutive bot bids continue without a human handoff. Dudo and Calzo still stop on the public reveal screen so a user can inspect the result and explicitly start the next round.

Each UI bot turn has a 6–8 second thinking delay. This delay is presentation-only: headless matches and later training runs execute without waiting.

## Game logs

While the local development server is running, every new game and subsequent logged action is saved automatically to the project `logs/` folder. The same filename is updated atomically throughout the match, so an interrupted game still leaves its latest completed snapshot. The header reports whether the latest snapshot was saved; if local persistence is unavailable, manual export still works.

Use **Export log** in the game header to download the match so far. After a match ends, use **Download log** on the winner screen. Automatic and manual filenames include the match start time and seed, and the document contains:

- a schema version, match seed, start time, seat identities, Human/Bot controllers, and bot policy names;
- the ordered public action history;
- public round resolutions and hands only after those hands have been revealed by Dudo or Calzo;
- the winner once the game is complete; and
- one diagnostic record per bot turn: its policy, visible hand when legally available, public dice counts, legal-action summary, chosen action, and exact probability estimates for the current or chosen bid.

Probability-bot records also include a decision trace: model version and settings, the reason for acting, effective Dudo/Calzo thresholds, current-bid confidence, the number of legal bid candidates, a bounded top-candidate shortlist with score components, selected rank, and the seeded random rolls used for bluff and tie selection. The trace records values—not hidden hands or random-generator state.

Bot diagnostics are created from the exact restricted observation passed to the policy. They never include an opponent's live hand, an Admin testing view, authoritative game state, or random-generator state. A bot's own `visibleHand` is present only when that bot could legally see it; during Palo Fijo it is omitted for a bot with more than one die. Revealed hands appear separately in round resolutions because they are public at that point.

Logs are intended for local inspection now and later batch analysis. Keep `schemaVersion` when building importers, group comparisons by seed and seat assignment, and treat decision probabilities as predictions to score against later public round resolutions. Logs can become evaluation or self-play examples without granting a learner information that the acting bot did not have at decision time.

### Private online snapshots

Production online snapshots are private, server-only records. Schema version 3 retains the unanimously approved game rules alongside the nickname and controller for every seat, every round's full dealt hands, nickname-labelled actions, and a timing record for each completed turn (start, deadline, finish, elapsed/remaining time, and bid/Dudo/Calzo/timeout outcome). These fields are recorded for new online matches and are never sent to players or spectators.

### Analyze a logs folder

Put exported files in `logs/`, then run:

```sh
npm run logs:analyze
npm run logs:analyze -- --json
npm run logs:analyze -- path/to/another-folder
```

The report also summarizes trace coverage, decision-reason counts, and average candidate-set size per policy.

The dependency-free analyzer searches subfolders for JSON files, validates the game-log shape, and deduplicates copies using the match seed and start time (or a stable content identity for older logs). Invalid files are listed without preventing valid matches from being analyzed; the command returns a failing exit status when invalid files are present so automated data pipelines can notice them.

The report covers match completion and player counts, actions, resolved rounds, bot decisions, policy action mixes, Dudo/Calzo correctness, and bot bid calibration. Calibration reports Brier score, mean prediction, and observed support overall and separately for normal and Palo Fijo turns. Revealed dice are used only as post-decision truth labels—never as bot features. Run the analyzer's focused tests with `npm run logs:test`.

The local autosave endpoint is provided by the development server. A hosted build cannot write to a visitor's filesystem directly; online play should implement the same endpoint on the authoritative game server or replace it with database/object storage.

## Project structure

The source tree is organized around responsibility rather than screens:

```text
src/
  analytics/    Versioned game logs and privacy-safe bot decision records
  bot/          Privacy-safe policies, probability model, and seeded match simulation
  engine/       Pure rules, state transitions, legal actions, views, and engine tests
  scripts/      Dependency-free exported-log analysis and its tests
  ui/           Reusable React interface pieces and game screens
  test/         Shared test setup
  App.tsx       Local game flow and top-level view selection
```

As online play is introduced, server-authoritative room code should live outside the browser app and depend on the engine rather than duplicating it. Machine players should consume the same restricted player view and legal-action API as humans so they cannot inspect opponents' hands.

## Roadmap

### 1. Rules engine and basic interface

- Encode the rules as pure state transitions.
- Inject or seed dice randomness for repeatable tests.
- Generate legal actions from state instead of duplicating legality in controls.
- Create sanitized player, normal spectator, and admin testing views.
- Cover denomination naming, bid transitions, wild Aces, Dudo, Calzo, elimination, Palo Fijo activation, and Palo Fijo hand visibility with tests.
- Complete a full 2–6 player game through the pass-and-play interface.

### 2. Hardening

- Simulate many complete games using random legal actions to detect deadlocks and broken invariants.
- Verify that private dice never leak into another player or normal spectator view, including the rule that multi-die players cannot see their own hands during Palo Fijo.
- Improve mobile layout, accessibility, keyboard support, error explanations, and reveal/handoff clarity.
- Make state serializable and retain a public event log suitable for replay and reconnects.
- Profile only after measuring; correctness and clean state boundaries matter more than raw performance at this scale.

### 3. Machine player

The probability-based heuristic bot is playable locally. Each startup seat can be switched between Human and Bot, and mixed or consecutive bot turns run through the normal engine action flow. The bot receives only the same legal player view and public history available to a human, including Palo Fijo restrictions.

The experimental learning dashboard remains available only as development code; it is not part of the player-facing local or online experience.

The first 3,000-game learning experiment found a well-calibrated 2/4-player specialist but did not beat Conservative overall on a separate 2,000-game evaluation because six-player performance did not generalize. The next bot step is therefore stronger multi-seed and held-out selection, followed by a public bid-history opponent model. See [MACHINE_PLAYER.md](./MACHINE_PLAYER.md) and [the experiment report](./reports/adversarial-learning-2026-07-13.md).

### 4. Realtime multiplayer

Realtime multiplayer is live through **Play online**. The server validates every action and sends each player or spectator a separately sanitized projection; the local admin view is never exposed online. The production service remains intentionally small and in-memory, so deployments must verify the Cloud Run revision, Firebase Hosting release, and the custom-domain no-cache response before inviting players.

### 5. Later possibilities

- Configurable house rules.
- Private invitations and public matchmaking.
- Additional bot personalities and difficulty levels.
- Match history, accounts, rankings, cosmetics, and additional game modes.

These features should follow a reliable engine and privacy-safe online architecture rather than shape the first implementation.
