---
project: Cachito
state: paused
updated: 2026-07-19
summary: Lab day three analyzed the first real heads-up games against the shipped persona bot, quantified its exact-count Dudo weakness (exp-013), and parked a full CFR-equilibrium plan (exp-014) as the next thread; all Codex handoffs closed.
machine: mac
next:
  - resume with exp-014 Phase 0/1 (CFR oracle for heads-up) — full parked plan in lab/notes/exp-014-cfr-plan.md
  - play more online games to grow the schema-v5 corpus (ingest is one command via the fetch-room-logs skill + lab/tools/ingest.ts)
  - if Codex replies about the held heads-up hybrid, fold its questions into exp-014 Phase 0
handoff_for: null
---

# Cachito — status

Two workstreams share this repo:

- **Product** (`src/`, `server/`, `dev/`): the playable web game, maintained by
  Codex under [AGENTS.md](AGENTS.md). Live release `r2026.07.18.001` promoted
  the persona bots and postgame analysis; schema-v5 match logs; the
  `runBotMatch` table-dice bug and the bluff-terminology issue are both fixed
  upstream.
- **Research lab** (`lab/`, its own nested git repo, gitignored by the parent):
  bot AI and game statistics, run by Ian + Claude Code. Charter in
  [lab/README.md](lab/README.md), full record in [lab/LOG.md](lab/LOG.md),
  plan in [lab/ROADMAP.md](lab/ROADMAP.md).

## Lab state (2026-07-19, day three — paused here)

- **First real games analyzed** (lab/LOG.md § Field observations): Ian beat
  the shipped Gen 2 + persona bot twice heads-up. Two findings: the exp-002b
  heads-up gate makes the persona layer inert at 2 players, and the bot loses
  Dudos overwhelmingly to *exactly-true* bids.
- **exp-013 baseline DONE**: the exploit is codified as a scripted benchmark
  bot (`lab/bots/exactCount.ts`, `duel.ts --candidate exactCount`). At scale:
  81.1% of Conservative's failed Dudos hit exactly-true bids — the signature
  metric any heads-up successor must collapse. The script alone still loses
  the match (31.75%): the human edge is honest bidding *plus* challenge
  timing. Heads-up hybrid build is ON HOLD with Codex's agreement.
- **exp-014 PARKED, fully planned**: CFR equilibrium core (oracle first,
  player second) — subtasks, Ian-confirmation points, and sidetrack warnings
  in [lab/notes/exp-014-cfr-plan.md](lab/notes/exp-014-cfr-plan.md). Driven
  by Ian's revised bar (2026-07-19): perceived intelligence, adaptability,
  and non-predictability at the table over threshold-readable internals.
  Process note: no heavyweight gates until its promotion phase.
- **Data pipeline complete**: GCS bucket access works (procedure = project
  skill `.claude/skills/fetch-room-logs/`, gcloud at
  `/opt/homebrew/share/google-cloud-sdk/bin/`); `ingest.ts` handles schema
  v4 AND v5 (v5 verified 14/14 cross-checks on the real games).
- Earlier history (day one/two: Gens 1–3, persona bluff, replay viewer,
  exp-001..012) lives in lab/LOG.md and lab/ROADMAP.md.
- Untracked in the parent root: `Cachito_Game_Rules_and_Bot_AI_Status.docx`
  (Ian's own export, deliberately uncommitted).
