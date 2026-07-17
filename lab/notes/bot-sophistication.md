# Bot sophistication — the deep brainstorm

2026-07-17. Companion to [[equity-function]]. The question: what does "the most
sophisticated Cachito bot" actually look like, and what's the cheapest path there?

## Three structural facts that shape everything

**1. The hidden state is tiny.** An opponent's hand with k dice is a multiset
over 6 faces: C(k+5,5) types — at most 252 for k=5, six for k=1. Exact Bayesian
inference over every opponent's exact hand is trivially cheap (a few hundred
floats per opponent, updated per action). Cachito never needs particle filters
or neural belief encoders — the bottleneck is the *likelihood model* (how does a
player's action depend on their hand?), never the inference machinery. "Most
sophisticated" is therefore reachable with interpretable math.

**2. Every round ends in a full reveal.** Unlike poker (mucked hands), Cachito
hands us ground truth after every single round: for each observed bid we later
see the bidder's entire hand. Consequences:
- Opponent modeling is *supervised* and fast-converging — no need for the
  current shrunk-Beta guesswork; attribute every past bid against the revealed
  hand ("was it supported by what they held?") and build per-player honesty/
  style profiles with real labels.
- Behavior cloning of humans is straightforward (state, action, and eventually
  the hand are all observable).
- Likelihood models for the Bayes filter can be *fit from logs* instead of
  assumed: P(action | hand, public state) harvested from millions of sim
  reveals, or from human reveals for human-model variants.

**3. The equity table is the value function.** exp-001's stack-vector → P(win)
map is exactly the leaf evaluation for within-round search: every round ends in
a reveal that moves one stack by {−1, −2, +1}, then equity applies. So a
depth-limited solver over the *current round only*, bottoming out in equity
lookups, prices every action globally (it inherits elimination effects, Palo
Fijo protection, starter initiative — everything the table measured). Round
structure gives Cachito a natural search horizon that poker lacks.

## The sophistication ladder

Each level must beat the previous in a held-out multi-seed tournament before it
earns the next investment (see LOG decision: current bots are the permanent
baseline).

- **L1 — Equity-aware heuristic** (exp-002). Baseline Conservative with flat
  thresholds replaced by table lookups: state-dependent Calzo breakevens
  (0.50–0.85 measured vs flat 0.72), Dudo priced by *whose* die is at stake and
  what their marginal die is worth, bid targets weighted by downstream equity.
  Zero new machinery; validates the whole approach.

- **L2 — Exact Bayesian hand filter** (exp-003). Per opponent, a ≤252-state
  posterior over their hand, updated on every bid/call with a fitted likelihood
  model. Output: a posterior over the table count that replaces the independent
  binomial. Evaluate as a *predictor first* (Brier/calibration on bid support
  vs. reveals) before wiring into decisions — if the filter doesn't out-predict
  the binomial, stop.
  - Naive likelihood v0: fit logistic "P(bids denomination d | holds m of d)"
    from sim logs. Known exploit to capture: all current bots (and most humans)
    over-bid denominations they hold.
  - Bluff-poisoning: the filter's trust in bids is itself a parameter; set it
    per-opponent online from reveal-based attribution (structural fact 2), which
    converges in a handful of rounds.

- **L3 — Within-round search on the public belief state** (exp-004). Expectimax
  (later CFR for the equilibrium version) over the current round's action tree:
  chance nodes = the L2 posterior; leaves = reveal outcomes → equity table.
  Action space per node is small (legal raises are bounded, plus Dudo/Calzo).
  This is where "which raise do I choose" stops being a scored heuristic and
  becomes lookahead: a raise is priced by the whole ladder it starts.

- **L4 — Endgame tablebases + equilibrium** (exp-005). Heads-up with few dice
  is exactly solvable (CFR+; info sets = own hand × public history, tiny for
  ≤2v2, feasible well beyond). All games funnel into these states, and equity
  there is decisive. Precompute Nash, graft on as an override. The 1v1-die
  subgame (starter wins 78.4% empirically) should be solved *analytically* as a
  lab exercise — it's the "KQ vs K rook endgame" of Cachito.

- **L5 — Population training** (later). PSRO/NFSP-style league with L1–L4 as
  fixed anchors, multi-seed evaluation, player-count diversity (the July
  experiment's 6p collapse is the cautionary tale). Neural nets only if they
  beat the interpretable stack; given facts 1–3, it is genuinely possible they
  never need to.

## The multiplayer dark arts (where theory is silent)

Multiplayer (>2) breaks Nash guarantees; these are the phenomena a sophisticated
bot must at least model, and the analysis thread should measure:

- **Loss steering.** Raising vs calling determines *who* ends up exposed. You
  can route damage toward the leader (policing) or the short stack (elimination
  hunting). Elimination is a public good — everyone's equity rises, but the
  challenger pays the risk. Measure: who pays the elimination cost in practice,
  and is paying it +EV?
- **Ladder parity / rung-burning.** For a given total T and denomination, the
  "danger zone" starts near the expected count; the number of safe rungs left
  plus turn order determines who gets zugzwanged into calling. Raising quantity
  by 2 (or converting through Aces, which compresses/expands the ladder by its
  ×2 rules) burns rungs and shifts the parity. This is a Nim-like tactical layer
  sitting inside a stochastic game — bid *amounts* are tempo moves, not just
  claims. The Ace conversion thresholds (ceil(q/2)+1 / 2q+1) make the lattice
  non-uniform: mapping its geometry is a lab analysis in itself.
- **Trap bids.** Bids from which every legal raise is unsupported for the next
  player — engineered zugzwang. Detectable in logs (bids whose successors have
  uniformly low support), teachable to a bot via search (L3 finds them free).
- **Deliberate Palo Fijo triggering.** Falling to the threshold buys a round
  where aces aren't wild, multi-die players bid blind, and one-die players keep
  denomination freedom. Is sacrificing a die to *enter* that round ever +EV?
  The equity table already contains the answer in aggregate; a targeted query
  (2-dice states vs 1-die states, >2 players, trigger not yet burned — needs the
  trigger flag added to the state key, exp-001 caveat 3) settles it.
- **Blind Palo Fijo is public-belief poker.** Multi-die players have *zero*
  private information — their optimal play is computable from public state
  alone, so a bot is at no structural disadvantage and can approach perfection
  there. Cleanest testbed for the L3 search machinery.
- **Table dice as costly signaling.** Reveal k qualifying dice: raises the
  public floor (deters Dudo), then rerolls your remaining dice (injects variance
  into your own support, narrows Calzo exactness). Reverse-tells and committed
  bluffs live here. No literature exists on this mechanic. Blocked on the
  simulator dropping table-dice actions (`toGameAction` in `src/bot/simulator.ts`
  strips `tableDiceIndices`) — lab fix: our own match runner in `lab/tools/`
  (copy + correct; lab may not edit src/).
- **Range balancing.** Bids leak hand information (that's what L2 exploits);
  a bot facing L2-style opponents must *balance* — sometimes bid the board, not
  the hand. This is where equilibrium (L4/CFR) feeds back into full-table play.

## The human dimension

- **Style vectors from reveals + timings**: per-player honesty rate, bluff
  frequency by state, Calzo affinity, denomination habits, escalation speed,
  and response-time patterns (turnTimings). Feeds: analysis dashboards, fun
  end-screen stats ("boldest bidder"), human-like bots via behavior cloning,
  and difficulty tiers (sophistication dial: inference off / on / exploitative).
- **Open design question for Ian:** is time-to-act legal bot input? Humans
  perceive it at the table (it's public in the room), but current bots don't
  receive it. Legal-parity argument says yes; comfort argument says maybe not.
  Decide before L2 likelihood models are fit on human logs.
- **Exploitation with a safety net**: restricted-Nash-style play — deviate from
  the balanced strategy only as far as reveal-backed evidence about this
  opponent justifies. The reveal stream makes the evidence accumulate unusually
  fast; the cap should be principled (confidence bounds), not a hardcoded 12.

## One architecture, three consumers

The L2 belief engine (posteriors over hands + table counts) should be a
standalone lab module consumed by:
1. **the bot** (decisions),
2. **the visualizer** (bot-intent panels, live "what does the table believe"
   displays, post-game equity graphs — end-screen material), and
3. **the centaur helper** (same posteriors + equity surfaced to a human,
   later).

Interpretability is a product feature, not just hygiene: "called Dudo because
P(≥7 Chinas) = 0.31 against an equity-priced threshold of 0.42" is an
explanation a game screen can show.

## Experiment queue implied by all this

- exp-002: L1 equity-aware thresholds — duel + league vs baselines, multi-seed.
- exp-003: L2 belief filter as pure predictor — calibration vs binomial on held-out logs.
- exp-004: L3 within-round search bot.
- exp-005: heads-up endgame solver/tablebase; 1v1-die analytic solution.
- exp-006: lab match runner with table dice executed; first measurements of the mechanic.
- exp-007: equity v2 — add Palo-Fijo-trigger flag + distance-from-starter to the
  state key; smoothed/monotone estimator; per-population versions.
- Parallel analysis thread: ladder-parity geometry, trap-bid census, loss-steering
  accounting, human style vectors (once bulk room logs land).
