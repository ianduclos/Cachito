---
name: postgame-review
description: Fetch Ian's latest online match log and report what the bot did — respect-gate activity, challenge margins, exploit signatures, build verification. Use when Ian says he just played a game and wants commentary or a check.
---

# Post-game review

1. **Fetch the newest log** (see the `fetch-room-logs` skill for details):

```sh
latest=$(/opt/homebrew/share/google-cloud-sdk/bin/gcloud storage ls \
  gs://ian-duclos-cachito-bot-logs/online-matches/ | tail -1)
/opt/homebrew/share/google-cloud-sdk/bin/gcloud storage cp "$latest" lab/data/room-logs/
```

2. **Standard readout** (one `node -e` pass; keep output compact — never
   dump the raw log into context):
   - `gameVersion` vs `src/release.ts` — was the current build serving?
     A stale stamp means the deploy did not happen; stop and check.
   - `historyLength` on late decisions — full-ladder contract check
     (must be ≫ round−1; `round−1` means reveal-only, a regression).
   - Winner, rounds, per-round resolutions with **margins**
     (`actualCount − bid.quantity`; margin 0 = exactly-true bid).
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
