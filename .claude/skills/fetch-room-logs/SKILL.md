---
name: fetch-room-logs
description: Download production Cachito match logs (schema v5) from the private GCS bucket into ignored lab storage for analysis. Use when the user wants to analyze real games played online.
---

# Fetch production room logs

Production Cachito logs are private in Google Cloud Storage:

`gs://ian-duclos-cachito-bot-logs/online-matches/`

`gcloud` is not on the sandbox PATH — use the full path
`/opt/homebrew/share/google-cloud-sdk/bin/gcloud`.

List recent logs:

```sh
gcloud storage ls --long gs://ian-duclos-cachito-bot-logs/online-matches/
```

Download a selected log into an ignored lab directory:

```sh
mkdir -p lab/data/room-logs
gcloud storage cp \
  gs://ian-duclos-cachito-bot-logs/online-matches/<filename>.json \
  lab/data/room-logs/
```

Use only completed games where:

- `schemaVersion === 5`
- `state.phase === "gameOver"`
- `analysis` is present
- Check `gameVersion` when comparing builds; the current release is `r2026.07.18.001` (as of 2026-07-18).

Schema-v5 logs contain:

- `seats`, including bot policy and persona
- `actions`, with timeout coverage marked as `covered`
- `roundDeals`
- `roundResolutions`
- `botDecisions`, including privacy-safe `trace.plainReason`
- `analysis`
- `turnTimings`
- final authoritative `state`

Avoid `active-rooms/` unless diagnosing recovery. Those files are mutable and
contain reconnect tokens and in-progress private state.

All logs are sensitive: they include dealt hands, connection audit data, and
bot diagnostics. Keep downloads inside ignored `lab/` storage, never commit
them.
