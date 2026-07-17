---
project: Cachito
updated: 2026-07-17
entries: 2
---

### Codex: bot + replay-visualizer integration write-up — opened 2026-07-17, owner: codex
- done: full handoff doc at [docs/lab-handoff-bots-and-replay.md](docs/lab-handoff-bots-and-replay.md) — which bot to promote (Gen 2), data dependencies, difficulty tiers, privacy invariant, replay-page integration options, and the standing asks (seeded bot randomness, log schema v5)
- next: Codex reads it and reacts (or leaves questions here); lab supplies the formal champion package on request
- context: AGENTS.md § lab (write-ups, not patches)

### Bulk room-log access for the lab — opened 2026-07-17, owner: ian
- done: schema-v4 ingest tool works (verified on the one hand-exported game at lab/data/reference/); analyses are ready to consume real games
- next: Ian provides bucket name + read access (or a periodic export) so the lab can pull the full match-log corpus from GCS
- blockers: only Ian has the GCS credentials/bucket config (`logBucket` in dev/onlineRooms.ts)
- context: lab/LOG.md "Data sources" section; lab/tools/README.md (ingest usage)
