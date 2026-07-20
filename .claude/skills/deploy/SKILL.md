---
name: deploy
description: Deploy Cachito to production — Cloud Run room server first, then Firebase Hosting. Use when the user says deploy, ship, push the bot live, or roll out changes. Git push alone deploys NOTHING.
---

# Deploy Cachito

Two manual surfaces, in this order (docs/BOT_AND_MATCH_ANALYSIS.md: server
before browser whenever the protocol, analysis schema, or snapshot shape
changes). Pushing to GitHub does NOT deploy anything.

## 0. Pre-flight (all must pass — check real exit codes, not piped tails)

```sh
npm test -- --run && npm run lint && npm run build
```

Bump `src/release.ts` (format `rYYYY.MM.DD.NNN`) in the deploy commit — the
stamp lands in match logs' `gameVersion` and is the only reliable way to
know which build served a game. Commit before deploying; push to GitHub
after, to keep origin in sync.

## 1. Room server (authoritative game + bots) — Cloud Run

```sh
/opt/homebrew/share/google-cloud-sdk/bin/gcloud run deploy cachito-rooms \
  --source /Users/ianduclos/Documents/Cachito --region europe-west4 --quiet
```

Builds via the root Dockerfile through Cloud Build; `.gcloudignore` already
excludes `lab/`, `node_modules`, `dist`, and the root DOCX. Takes ~3-5 min.

## 2. Browser app — Firebase Hosting

```sh
npm run build && firebase deploy --only hosting
```

Site `cachito` → https://cachito.web.app (serves `dist`; the Cloud Run
service also embeds a copy but the public URL is Hosting).

## 3. Verify (never assume the rollout happened)

```sh
bundle=$(curl -s https://cachito.web.app/ | grep -o 'assets/index[^"]*' | head -1)
curl -s "https://cachito.web.app/$bundle" | grep -o 'r2026\.[0-9.]*' | head -1
```

The printed stamp must equal `src/release.ts`. For the server side,
`gcloud run services list` shows the latest ready revision and time; the
next match log's `gameVersion` is the ground truth.
