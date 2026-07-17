---
project: Cachito
state: active
updated: 2026-07-17
summary: Lab day two produced four verified experiments (exp-009 through exp-012), a persona bot that bluffs deliberately at an accepted ~2pp cost, a full replay viewer with intent panels and an end-of-game style summary, a table-dice sim fix that uncovered a product bug, and a complete integration handoff for Codex.
machine: mac
next:
  - Codex reads docs/lab-handoff-bots-and-replay.md — bot promotion (Gen 2 + persona layer), runBotMatch table-dice bug fix, match-summary end-screen
  - bulk room-log access from the GCS bucket (Ian) — unblocks human-style analysis at scale
  - future bot thread when wanted, Gen 5 bid-level bluff discrimination (exp-011 defined the problem precisely)
handoff_for: ian
---

# Cachito — status

Two workstreams share this repo:

- **Product** (`src/`, `server/`, `dev/`): the playable web game, maintained by
  Codex under [AGENTS.md](AGENTS.md). Not this session's domain — but see the
  open bug report in [HANDOFF.md](HANDOFF.md).
- **Research lab** (`lab/`, its own nested git repo, gitignored by the parent):
  bot AI and game statistics, run by Ian + Claude Code. Charter in
  [lab/README.md](lab/README.md), full record in [lab/LOG.md](lab/LOG.md),
  plan in [lab/ROADMAP.md](lab/ROADMAP.md).

## Lab state (2026-07-17, day two)

- **Direction change (Ian, evening)**: win-rate ladder is done as a goal —
  bots are "smart enough." New bar: intentionality without self-sabotage,
  non-inferiority gates, human-readable end-of-game style charts, strict
  token frugality in agent workflows.
- **Bots**: Gen 3 "Belief Search" passed its gate (modest 1.12×; league
  regression documented, Gen 2 stays champion). **"Persona Bluff"** wraps
  Gen 2 with deliberate story-consistent bluffing (11.7% of bids, 94%
  story-consistent) + intentional table dice, at an accepted ≈2pp win-share
  cost. Gen 4 skipped per Ian.
- **Findings**: exp-009 resolved the Dudo-accuracy scare (a polarity bug in
  an earlier spot-check — Gen 2 is actually the best challenger); exp-010/011
  built an online per-player style estimator and pinned its one limitation
  (per-player rates can't identify which bid is a bluff — that's Gen 5's job).
- **Viewer**: full replay pipeline — any logged game (sim or real room) →
  win-probability graph, per-turn bot reasoning, public "table reads,"
  end-of-game match summary per player. Three published artifacts (sim demo,
  human room demo, persona demo); sources in `lab/viz/`.
- **Infra**: headless sims now execute the table-dice mechanic (product's
  `runBotMatch` silently dropped it — bug reported to Codex with a one-line
  fix); schema-v4 ingest and all analysis CLIs under `lab/tools/`.
- **Codex handoff**: [docs/lab-handoff-bots-and-replay.md](docs/lab-handoff-bots-and-replay.md)
  covers bot promotion, difficulty tiers, the persona layer, replay/end-screen
  integration, the bug, and the standing asks (seeded bot RNG, schema v5).
