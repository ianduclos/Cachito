---
project: Cachito
updated: 2026-07-17
entries: 1
---

### Bulk room-log access for the lab — opened 2026-07-17, owner: ian
- done: schema-v4 ingest tool works (verified on the one hand-exported game at lab/data/reference/); analyses are ready to consume real games
- next: Ian provides bucket name + read access (or a periodic export) so the lab can pull the full match-log corpus from GCS
- blockers: only Ian has the GCS credentials/bucket config (`logBucket` in dev/onlineRooms.ts)
- context: lab/LOG.md "Data sources" section; lab/tools/README.md (ingest usage)
