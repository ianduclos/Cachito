---
project: Cachito
state: active
updated: 2026-07-22
summary: Product maintenance session shipped three fixes to production (turn-order seating, landscape-phone layout, corrected half-plus-one aces rule) at release r2026.07.22.003; lab CFR thread (exp-014) still parked.
machine: mac
next:
  - push both repos to origin — today's product commits (f8b4daf, 87775ea, ee5eeaa) and the lab commit (3fe182f) are unpushed
  - resume exp-014 Phase 0/1 (CFR oracle for heads-up) — full parked plan in lab/notes/exp-014-cfr-plan.md
  - play more online games to grow the schema-v5 corpus (fetch-room-logs skill + lab/tools/ingest.ts)
handoff_for: null
---

# Cachito — status

## 2026-07-22 — product maintenance session (deployed)

All shipped to production (Cloud Run `cachito-rooms-00042-gfp` + Firebase
Hosting, live release `r2026.07.22.003`, verified):

- **Turn-order seating fix** (`ee5eeaa`): the online table now rotates the
  turn-ordered player list so the player who acts right after you sits on your
  immediate left, counter-clockwise around to your right — like a real table.
  Previously it filtered you out but kept the raw array order. Hosting-only.
- **Landscape-phone layout** (`87775ea`): shared
  `(orientation: landscape) and (max-height: 500px)` query shrinks seats,
  center panel, hand and both docks (kept horizontal) — phones in landscape
  are wider than 650px so the portrait rules never fired. Hosting-only.
- **Aces conversion rule fix** (`f8b4daf`): the default half-plus-one rule now
  floors the halving before adding one — `floor(prev/2)+1`, not
  `ceil(prev/2)+1`. Coincides with plain-half for odd previous quantities,
  differs by one for even. Shared-engine change, so it deployed to the room
  server AND Hosting. Lab human-regression audit reconciled without editing
  the real logs (lab `3fe182f`, `acesRuleCorrectionExtraBids`).

Also reviewed the last 4 online games (all all-human tables) — findings stayed
in chat, not written to lab/LOG.md.

## Repo layout

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
