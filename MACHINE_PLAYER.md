# Machine player plan

## Current implementation

The first foundation is now available under `src/bot/`:

- a policy interface receiving only a restricted player view, legal actions, and public history;
- exact binomial probability utilities for normal rounds, Aces, and Palo Fijo;
- random-legal and probability-heuristic policies;
- separate seeded random streams for dice and each policy;
- complete headless matches, batches, and seat-balanced duels; and
- deterministic population-based parameter evolution with bounded mutation, crossover, and elite preservation;
- a live worker-backed learning dashboard with progress, charts, rankings, cancellation, and JSON export; and
- versioned match logs with public actions, reveal outcomes, and privacy-safe decision telemetry; and
- regression coverage for privacy, reproducibility, termination, and baseline strength.

The local interface also supports a Human/Bot switch for every startup seat and uses the probability heuristic for playable bot seats. Live bot hands remain hidden in Player and normal Spectator modes; only Admin testing mode exposes them. Each UI bot turn waits 800 ms, including consecutive bot bids; headless simulation has no delay. Dudo and Calzo reveal screens do not auto-advance, so the user can inspect the result before starting the next round.

Opponent modeling, information-set search, and neural policies remain future milestones. The current learned policy is an evolutionary optimization of the five interpretable probability-policy parameters.

## Logged decision data

Both local games and headless bot matches produce the same versioned JSON log shape. Each bot turn records the policy name, acting player and round, Palo Fijo status, public dice counts, the current bid, legal-action counts, the chosen action, and exact `atLeast`/`exact` probability diagnostics for relevant bids. The log also includes match metadata, ordered public actions, public reveal outcomes, and the eventual winner.

Decision telemetry is derived from the exact `BotObservation` used to select the action. Its `visibleHand` field can contain only the acting bot's legally visible hand and is absent when Palo Fijo hides that hand. Opponent hands are not copied into decision records. Hands revealed after Dudo or Calzo are stored in a separate round-resolution record, where they are public evidence rather than inference-time input. Admin testing views, authoritative live state, and random-stream state are excluded.

These records provide the first analysis dataset:

- score `P(bid true)` and `P(exact)` against revealed totals to produce calibration curves and Brier scores;
- measure Dudo and Calzo precision, attempt rate, and outcome value by policy, dice count, player count, and Palo Fijo status;
- compare action choices and win rates across seeds, seats, policy versions, and opponent mixes; and
- turn each bot decision into an imitation or offline-evaluation example using only its logged legal information and chosen action.

The first folder-level analyzer is available through `npm run logs:analyze`. It recursively validates and deduplicates exported logs, preserves file-level errors, and reports policy/action mixes, challenge correctness, and probability calibration overall and for normal versus Palo Fijo decisions. `--json` emits a machine-readable report suitable for archived experiment summaries. An optional directory argument supports isolated training, regression, and held-out evaluation folders.

Decision records now include a bounded policy trace describing thresholds, confidence, action reason, scored bid shortlist, selected rank, and consumed seeded random rolls. Use these traces to explain failures and compare policy versions; do not feed post-reveal outcomes back into the policy features for the earlier decision. The analyzer reports trace coverage and decision-reason mixes per policy.

Bid calibration joins a decision's logged prediction to the hands revealed at the end of that round and recomputes whether that specific bid was supported. This makes the reveal a post-decision label only; it is not merged into the observation or training features. Dudo and Calzo results are joined by round, caller, and challenge kind to avoid attributing another player's outcome to the bot.

Before learned self-play, add a dataset loader that validates `schemaVersion`, rejects malformed or information-leaking records, and constructs features only from the decision record plus prior public actions. Split data by whole match and held-out seed—not individual turns—so decisions from the same game cannot leak across training and evaluation. Keep public reveal outcomes as labels or post-action scoring data, never as policy inputs for earlier decisions.

Local matches now accumulate automatically in `logs/` while the development server is running. Treat that folder as raw, immutable source data for analysis jobs: loaders should read snapshots only after validating them and write derived tables or model-ready examples elsewhere.

## Recommended next step

Treat Conservative as the current general-purpose baseline. The first evolutionary run trained over 3,000 games and evaluated over 2,000 held-out games. Its learned champion improved bid Brier score from 0.204 to 0.173 and was strong with two and four players, but its six-player win rate was only 18.0% versus Conservative's 37.5%. This exposed selection noise and player-count overfitting rather than a general improvement.

Next, retain fixed anchor policies in every generation, aggregate candidate fitness over several seed blocks, maintain historical champions, and select the released champion through a larger held-out tournament. After that benchmark is stable, fit a small public-history opponent model from decision traces. Ship a model only if it improves held-out calibration and win rate without weakening privacy or unfamiliar-opponent performance. Do not begin neural training or large game-tree search until this benchmark is reproducible.

The production bot receives only a `PlayerView`, public action history, and legal actions generated by the engine. It never receives the authoritative game state, hidden hands, random generator state, or Admin testing view. The simulator may inspect authoritative state to score outcomes, but it must call the bot through the same restricted interface used in a local or online match.

## Information boundary

The bot input should contain only information a human in the same seat can legally know:

- public player identities, seating order, remaining dice, active status, round number, current player, current bid, bidder, Palo Fijo status, and public action/reveal history;
- the bot's own hand during a normal round;
- the bot's single die during Palo Fijo only if the bot has exactly one die;
- no hand, including its own, when the bot has more than one die during Palo Fijo; and
- the engine's legal-action list for the current state.

The bot returns one action from that legal-action list. The engine remains responsible for validation. Automated privacy tests should fail if a hidden hand or admin-only field appears anywhere in the bot input.

## Probability model

Start with exact binomial calculations rather than Monte Carlo sampling.

For a normal-round bid on Dones through Sambas:

- each unknown die qualifies with probability `2/6`, because the target denomination and Aces both count;
- visible matching dice and visible Aces are known qualifying dice; and
- the probability that a bid is supported is `P(known qualifiers + Binomial(unknown dice, 2/6) >= bid quantity)`.

For a normal-round bid on Aces:

- each unknown die qualifies with probability `1/6`;
- only visible Aces are known qualifiers; and
- use the same binomial tail with `p = 1/6`.

During Palo Fijo:

- Aces are ordinary and non-wild, so every denomination has `p = 1/6` per unknown die;
- a one-die bot knows whether its visible die matches and treats every other die as unknown; and
- a bot with more than one die cannot view its own hand, so its own dice are included in the unknown pool.

Compute both the tail probability `P(total >= quantity)` for Dudo and bid evaluation, and the point probability `P(total = quantity)` for Calzo. Use stable cumulative-distribution functions or cached dynamic programming so results remain accurate near zero and one.

## Beliefs and bluff modeling

The first competent bot can use the independent-dice model without interpreting opponents. Add a lightweight belief layer only after that bot is measured.

Represent each opponent with public, incrementally updated tendencies:

- frequency and size of raises;
- preferred denominations;
- Dudo and Calzo thresholds;
- behavior by their dice count, table position, and Palo Fijo status;
- reveal-backed bluff rate: how often their final bid was unsupported by their revealed hand and the table result; and
- recent behavior with strong shrinkage toward population defaults so a few rounds do not cause extreme conclusions.

Bid history is evidence, not truth. A practical model assigns a likelihood to each opponent action under sampled or enumerated hidden hands, then reweights beliefs about qualifying totals. Preserve a minimum probability for bluffing so a confident bid never collapses uncertainty to zero. Initially use coarse player types such as cautious, neutral, and aggressive; later fit continuous parameters from self-play logs.

All updates must be derived from public bids and publicly revealed hands. Do not retain a hand that was seen through an admin testing view.

## Action scoring

Score only legal actions. Use expected utility rather than selecting the bid with the highest raw probability.

### Dudo

Estimate `P(actual total < current quantity)`. Compare the expected outcomes of:

- a correct Dudo, where the bidder loses one die; and
- an incorrect Dudo, where the bot loses one die and may be eliminated or trigger Palo Fijo.

The challenge threshold should depend on the utility of those outcomes, not a fixed 50% rule.

### Calzo

Use `P(actual total = current quantity)`. A correct Calzo gains one die up to five; a wrong Calzo loses two. Score the real before/after dice states:

- the reward is zero when already at five dice;
- a miss at one or two dice is elimination;
- a miss can trigger Palo Fijo when the bot falls to one with more than two active players; and
- gaining a die is more valuable near elimination than at four dice, but the two-die penalty must dominate low-confidence attempts.

Calzo should therefore be rare and calibrated. Track its predicted exact probability and actual success separately.

### Bids

For each legal bid, estimate:

- probability the bid is true under the current belief;
- expected chance the next player calls Dudo, calls Calzo, or raises;
- loss risk if challenged immediately;
- information revealed by the size and denomination change;
- turn-position effects and which opponent is pressured next; and
- strategic value of a controlled bluff.

Use a small randomized choice among near-equal actions so the bot is not mechanically exploitable. Seed that randomness for replay and tests.

### Utility and risk calibration

Use a nonlinear state value rather than treating every die as equally valuable. At minimum include:

- a large negative value for elimination and a large positive value for winning;
- current dice count and opponents' dice counts;
- number of active players;
- probability and consequences of entering Palo Fijo;
- whether the bot can see its hand in the current round;
- relative stack position: leader, middle, or shortest stack; and
- adjustable risk style.

A one-die bot should generally protect its last die, while a leader can accept somewhat more variance to pressure a short stack. Calibrate these tendencies through evaluation instead of hard-coding dramatic personality differences at first.

## Simulation and evaluation harness

Build a headless runner around the real engine. It should support 2–6 seats, mixed policies, fixed seeds, recorded action logs, replay, parallel batches, and rule configurations. The runner may know the final authoritative state for scoring, but each policy invocation must receive only its restricted view.

Required baselines:

1. **Random legal:** uniformly chooses a legal action, with optional limits to prevent unrealistic Calzo spam.
2. **Probability threshold:** uses the independent-dice probabilities with fixed Dudo/Calzo thresholds and chooses conservative supported bids.
3. **Heuristic candidate:** uses expected utility, state-aware risk, and controlled bluffing.
4. **Oracle diagnostic, offline only:** may use hidden hands to estimate the ceiling created by perfect information. It must be structurally impossible to select this policy in production.

Run balanced tournaments that rotate every policy through every seat and starting position. Include heads-up, three-player, and six-player tables; even and uneven dice counts; normal rounds; Palo Fijo with visible and hidden own hands; and endgame states.

Track at least:

- match win rate with confidence intervals and an Elo- or TrueSkill-style summary;
- average finishing position and dice differential;
- Dudo precision, recall, and expected value;
- Calzo attempt rate, precision, and expected value;
- calibration curves and Brier score for `P(bid true)` and `P(exact)`;
- illegal-action count, which must remain zero;
- decision latency at median and 95th percentile;
- action diversity and bluff frequency; and
- failures to terminate, privacy violations, and replay mismatches, all of which must remain zero.

Use a fixed published regression seed set for comparable builds plus fresh hidden seeds to prevent tuning only to the benchmark.

## Staged milestones

### Milestone 0 — Bot contract and baselines (foundation implemented)

Implement the restricted bot interface, seeded action selection, random legal baseline, probability-threshold baseline, and headless match runner.

Exit criteria:

- bot inputs pass privacy tests in normal and Palo Fijo rounds;
- 10,000 seeded games complete without an illegal action, privacy leak, deadlock, or replay mismatch; and
- tournament results are reproducible from configuration and seed.

### Milestone 1 — Probability heuristic (playable baseline implemented; calibration ongoing)

Implement exact probability calculations, Dudo and Calzo expected values, supported-bid selection, nonlinear life-state utility, and small seeded action randomization.

Exit criteria:

- probability functions match exhaustive enumeration on small dice pools;
- predicted probabilities are calibrated on held-out simulations;
- in at least 10,000 balanced two-player games against random legal play, the bot wins at least 65%, with the 95% confidence interval remaining above 50%;
- at 3- and 6-player tables containing one bot and otherwise random players, its win rate exceeds the fair-share baseline with a 95% confidence interval; and
- median decision time is suitable for immediate local play, with a target below 50 ms on the development machine.

The playable probability baseline is implemented; these exit criteria define when its calibration milestone is complete.

### Milestone 2 — Public-history opponent model

Add reveal-backed opponent tendencies, bluff priors, bid-history likelihood updates, and response prediction. Keep a configuration switch for the independent model so the benefit can be measured directly.

Exit criteria:

- the model improves held-out log likelihood or calibration on public action/reveal traces;
- it produces a statistically reliable win-rate gain over Milestone 1 in mixed-opponent tournaments; and
- performance does not regress against unfamiliar or randomized strategies.

### Milestone 3 — Information-set search

Sample hidden hands from the current belief, roll out legal continuations, and aggregate action values across determinizations. Use the heuristic policy for rollout and value estimates. Do not let a sampled hidden state escape into the persistent policy state.

Naive perfect-information search can suffer from strategy fusion, so compare it against the no-search bot and consider information-set MCTS or counterfactual-regret methods if determinization gives unstable results.

Exit criteria:

- search stays within a defined turn budget, initially 250–500 ms for a higher difficulty setting;
- fixed-seed results are reproducible;
- it improves balanced-seat win rate over Milestone 2 on held-out seeds; and
- privacy instrumentation confirms that decisions depend only on sampled beliefs derived from legal information.

### Milestone 4 — Learned policy

Only after the simulator, metrics, and heuristic/search teachers are stable, consider imitation learning from strong self-play followed by reinforcement learning or regret-based training. Encode observations from `PlayerView`, mask illegal actions, and keep rule variants in the observation/configuration rather than training accidental assumptions.

Use a diverse self-play population containing heuristic versions, search agents, risk styles, and historical checkpoints. Hold out opponent populations and seeds for evaluation to reduce overfitting and cyclic dominance.

Exit criteria:

- the learned policy beats its teacher and historical checkpoint population with confidence across player counts and seats;
- probability calibration, Calzo discipline, action diversity, and latency remain within release targets;
- no hidden-state feature is present in training or inference observations; and
- a deterministic checkpoint, model metadata, training configuration, code revision, and evaluation seeds reproduce the reported result.

## Reproducibility requirements

Every experiment should record:

- engine and bot version;
- rule configuration;
- policy parameters or model checkpoint hash;
- master seed and per-game derived seeds;
- seat assignments and opponent versions;
- aggregate metrics and confidence intervals; and
- enough public action history and final revealed state to replay failures.

The game-log JSON now captures the initial form of this record. Local games can be downloaded with **Export log** during play or **Download log** after game over; headless `runBotMatch` results expose the same log directly. Future tournament reports should store these raw logs alongside aggregates so calibration, privacy, and replay checks can be rerun after metric code changes.

Separate random streams for dice, bot exploration, hidden-hand sampling, and tournament scheduling. A policy must not infer dice outcomes from shared random-number consumption.

## Adversarial self-play

Adversarial self-learning is a good later option, particularly because strong labeled human game data is unlikely to be available. It should begin only after the simulator, probability baseline, privacy checks, and evaluation pool are trustworthy.

Use population-based self-play rather than training only against the newest copy of the same policy. A useful league contains:

- the random and probability baselines;
- several fixed heuristic risk styles;
- historical learned checkpoints;
- the current main policy; and
- occasional exploiter policies trained to find weaknesses in the main policy.

This reduces cyclic behavior where policy A beats B, B beats C, and C beats A, and makes it harder for two current policies to develop brittle conventions that fail against unfamiliar players. Rotate seats and player counts, sample rule states and opponent mixes, and keep a permanently held-out evaluation league.

For a first learned experiment, imitate strong heuristic or search decisions and then fine-tune through population self-play with a legal-action mask and terminal match rewards. Pure policy-gradient self-play is the simplest experimental route; regret-based or fictitious-play methods are stronger theoretical fits for hidden-information games but are a substantially larger implementation step. Regardless of method, the acting policy must receive only `BotObservation`; admin or authoritative hands must never enter its training or inference features.
