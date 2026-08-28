---
name: postgame-review
description: Fetch Ian's latest online match log and report what the bot did — respect-gate activity, challenge margins, exploit signatures, build verification. Use when Ian says he just played a game and wants commentary or a check.
---

# Post-game review

0. **Ask WHERE he played first — production or the local dev server.** They
   store logs in different places and the wrong guess wastes the session (it
   did on 2026-08-28). Local rooms have no GCS object at all; since
   `4c7e4b3` they write to `logs/online-matches/` instead, so the newest local
   game is just:

   ```sh
   ls -t logs/online-matches/ | head -1
   ```

   Two more traps worth knowing. **The local hot-seat game is NOT the champion**
   — `src/App.tsx` hardcodes `createProbabilityPolicy()`, so only ONLINE rooms
   (`dev/onlineRooms.ts`) run persona bluff + respect gate; a hot-seat log says
   nothing about champion behaviour. And a game played before `4c7e4b3` left no
   file at all: if the server is still up, spectate the room over its WebSocket
   (`{ type: "join-room", roomCode, spectator: true }` to `ws://localhost:5173/online`,
   no Origin header needed) and capture the `state` message, which carries the
   full `analysis`. He can also hit **Export log** in the analysis header.

1. **For a PRODUCTION game, fetch the newest log** (see the `fetch-room-logs`
   skill for details):

```sh
latest=$(/opt/homebrew/share/google-cloud-sdk/bin/gcloud storage ls \
  gs://ian-duclos-cachito-bot-logs/online-matches/ | tail -1)
/opt/homebrew/share/google-cloud-sdk/bin/gcloud storage cp "$latest" lab/data/room-logs/
```

2. **Standard readout** (one `node -e` pass; keep output compact — never
   dump the raw log into context):
   - `gameVersion` vs `src/release.ts` — was the current build serving?
     A stale stamp means the deploy did not happen; stop and check. (Skip for
     a local game: it always carries the working tree's own stamp.)
   - `historyLength` on late decisions — full-ladder contract check
     (must be ≫ round−1; `round−1` means reveal-only, a regression).
   - Winner, rounds, per-round resolutions with **margins**
     (`actualCount − bid.quantity`; margin 0 = exactly-true bid).
   - **Check seating before reading anything into WHO a bot challenged.** You
     may only Dudo the previous bidder, so a bot seated after Ian can have him
     as its only legal target — that looks exactly like selective targeting and
     is not. Derive the order from consecutive `bids[]` entries first
     (2026-08-28: a "donation signature" evaporated on this check).
   - **Respect gate**: decisions with `trace.respectGate` — slack vs
     required, the read (held/revealed, exactHolds, signature), and
     `overrode`. This is the primary "did the bot adapt to Ian" signal.
   - Bot `trace.decisionReason` + `plainReason` variety (monotony is the
     known heads-up legibility problem).

3. **Interpret against the standing signatures** (lab/LOG.md):
   - *Challenge-donation* (exp-013): bot failed Dudos at margin 0 against
     Ian's true bids — should now be rare after 2 revealed holds
     (respect gate, exp-016).
   - *Readable ladders* (seen 2026-07-20): the cautious heads-up line
     raises one face predictably and Ian snipes the top (his correct
     Dudos at margin −1/−2 on bot bids). Open thread: CFR-oracle mixing
     for heads-up play.

4. Report to Ian in plain language: what fired, what he exploited, what
   that implies for the roadmap. Log durable findings in `lab/LOG.md`.
