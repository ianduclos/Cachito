# Cachito Lab

Research workspace for **game analysis and bot AI**, worked on by Ian + Claude Code.
Separate from the product codebase, which Codex maintains. Nothing in `lab/` ships
to the app; promotion into `src/` is always an explicit, reviewed step.

Ground rules:

- `lab/` may **read** anything in the repo (especially `src/engine`, `src/bot`,
  `logs/`, `reports/`) and may import the engine for headless simulation, but must
  not modify code outside `lab/`.
- Same privacy contract as production: analyses of live games use only information
  that was legally visible to some seat at the time, plus post-reveal public data.
- Findings that imply product changes (logging hooks, bot promotion, rule-setting
  effects) get written up here first, then handed to the main codebase via AGENTS.md
  conventions — not patched in directly from the lab.

## The two threads

### 1. Deep statistical understanding of the game

Treat Cachito as an object of study: what does the state space look like, where do
games actually live inside it, and what separates strong play from weak play?
Data sources: headless self-play at scale (millions of games via the real engine),
plus human and hybrid game logs (to be provided).

Directions on the board:

- **Dice-equity function** — the game's analogue of poker's ICM: a map from the
  vector of stack sizes (and seat/starter position) to each player's win
  probability. Estimable from bulk self-play; once we have it, every die gained or
  lost has a precise equity value, marginal die value becomes measurable (it is
  certainly nonlinear), and Calzo's +1/−2 asymmetry gets a real denominator.
- **Round-as-escalation-ladder** — model each round as a survival process: hazard
  of Dudo as a function of bid quantity ÷ total dice, denomination, seats
  remaining, and who is on the clock. Where is the cliff?
- **Calibration surfaces** — P(bid is true) over (quantity, dice in play, round
  type, position in the bidding chain), for bots and humans separately.
- **Seat and structure effects** — starter advantage, right-neighbor effects
  (who you can punish / who punishes you), player-count scaling of strategy value
  (the 2026-07-13 league already showed bluffing decays sharply at big tables).
- **Information theory of bidding** — each bid updates everyone's posterior over
  the table count; measure bits revealed per action, treat bluffs as deliberate
  noise injection, and quantify the information cost of the table-dice mechanic.
- **Human fingerprinting** — style embeddings from action distributions; can we
  tell humans from bots, or one human from another, from public actions alone?

### 2. The most sophisticated bots for this game

Cachito is a multiplayer imperfect-information game in the Perudo family, with
three house twists that make it strategically richer than stock liar's dice:

- **Calzo** (asymmetric exact-call: +1 die vs −2) — a sniper move whose threshold
  should depend on the equity function, not a flat 0.72.
- **Table dice** (voluntarily reveal dice, then reroll the rest) — a costly
  signaling / commitment device. Genuinely unusual; little to no literature.
- **Palo Fijo blind rounds** — multi-die players bid with *no private
  information*: pure public-belief play, a naturally occurring "poker with the
  cards face down" laboratory.

Roadmap tiers (each tier must beat the previous one in a large held-out
tournament before it earns attention):

- **Tier 0 — honest baseline.** Fix the known gaps from the status doc: table
  dice dropped by the headless simulator, opponent-model Dudo/Calzo semantics,
  single-seed evaluation noise. Without this the benchmark itself is untrusted.
- **Tier 1 — Bayesian belief tracking.** Maintain an explicit posterior over each
  opponent's hand given their actions under a softmax model of their policy;
  level-k reasoning on top. Interpretable, no training required.
- **Tier 2 — exact endgame + search.** All states with few total dice are small
  enough to solve outright (tablebase); heads-up endgames are CFR-tractable.
  Public-belief-state search (ReBeL-style) for the midgame.
- **Tier 3 — learned policies.** Neural self-play (NFSP / PPO), trained as a
  *population* across player counts and styles (the July experiment's 6-player
  collapse is exactly the overfitting a league setup prevents). Safe exploitation
  of profiled opponents (restricted Nash response) rather than raw best response.

### Visualization (the connective tissue)

The goal is to *see* the game: belief-state explorer over a public history,
bid-escalation phase diagrams, hazard curves, equity landscapes over stack
vectors, calibration reliability plots, style radars, state-space embeddings
colored by win probability. Likely split: TypeScript (reusing the real engine)
for simulation and data generation; analysis/viz in whatever renders best.

## Layout (grows as needed)

- `LOG.md` — **the lab notebook**: all decisions, experiments, results. Keep it current.
- `notes/` — speculative writing, theory, literature connections
- `tools/` — barebones TypeScript tooling (run with `npx tsx`), imports the real engine
- `experiments/` — one directory per experiment: intent, code, seeds, results
- `data/` — generated datasets and imported logs (gitignored if large)
- `viz/` — visualization outputs and tools

Key working rules (2026-07-17): current bots are the permanent baseline; policies
must never see human-vs-bot controller tags (analysis may); see LOG.md for the
full decision record.

## Status

2026-07-17 — Lab founded, v0 tooling in progress (simulate + equity). See LOG.md.
