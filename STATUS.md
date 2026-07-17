---
project: Cachito
state: active
updated: 2026-07-17
machine: mac
summary: Research lab founded inside the project (nested repo lab/) and produced two bot generations that beat the production baseline plus two published visualizations; product side is separately maintained by Codex.
next:
  - Gen 5 conditional bluffing (exp-007) — now properly scoped by exp-011's finding: needs bid-level bluff discrimination, not just per-player rates
  - Codex reactions: bot/replay integration write-up + runBotMatch table-dice bug fix (docs/lab-handoff-bots-and-replay.md, HANDOFF.md)
  - get bulk room-log access from the GCS bucket (Ian) — unblocks human-style analysis at scale
  - build the game replay viewer (any logged game, win-prob graph + bot beliefs per turn)
  - get bulk room-log access from the GCS bucket (Ian) to start human-style analysis
  - write up Codex asks — log schema v5, champion promotion format, seeded online bot randomness
handoff_for: ian
---

# Cachito — status

Two workstreams share this repo:

- **Product** (`src/`, `server/`, `dev/`): the playable web game, maintained by
  Codex under [AGENTS.md](AGENTS.md). Not this session's domain.
- **Research lab** (`lab/`, its own nested git repo, gitignored by the parent):
  bot AI and game statistics, run by Ian + Claude Code. Charter in
  [lab/README.md](lab/README.md), full experiment record in
  [lab/LOG.md](lab/LOG.md), forward plan in [lab/ROADMAP.md](lab/ROADMAP.md).

## Lab state (2026-07-17, founding day)

- **Measurements**: dice-equity function from 115k self-play games (concave die
  value, +2.6pp starter edge, Calzo threshold mispricing); behavioral
  fingerprints (bluff rate is the dominant personality axis; all bots
  transparently bid faces they hold).
- **Bots**: Gen 1 "Equity Conservative" (measured thresholds) beats the
  production baseline at 4–6p; Gen 2 "Belief Equity" (Bayesian hand-reading +
  equity pricing) beats Gen 1 at ~2× fair share, ~2.4× in the full league.
  Both gated, multi-seed, independently reproduced.
- **Pipelines**: headless simulation with decision telemetry, schema-v4 room-log
  ingest (human games flow into the same analyses), fingerprint and duel CLIs —
  all under `lab/tools/`, no product code touched.
- **Visualizations** (claude.ai artifacts, sources in `lab/viz/`): equity
  explorer and the belief-replay page.
