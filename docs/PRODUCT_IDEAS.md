# Product ideas — not committed roadmap

These are ideas worth preserving without treating them as approved implementation work.

## Tutorial mode

Consider an optional guided online table that teaches the first round in context: shaking, reading the current bid, making a legal raise, and choosing Dudo or Calzo. It should use the authoritative engine and normal online presentation rather than revive the deprecated offline prototype. Keep the language brief, reveal concepts only when relevant, and allow experienced players to skip it immediately.

## Deliberation-paced bot timing (Idea, Ian 2026-08-27)

Bot response delay could scale with decision difficulty: straightforward bids
fire quickly, contested Dudo/Calzo or thin-margin raises take a beat longer.
Reads as human deliberation rather than computation. If ever built: timing
changes live in the presentation/pacing layer only (see
docs/TABLE_PROTOTYPE.md for the pacing contract), never in policy; the delay
signal must not leak decision-type information opponents could exploit
beyond what a human face gives away — and note that a *predictable*
difficulty→delay map is itself a tell.

## Table dice as a short-stack gamble (Idea, Ian 2026-08-28)

Ian's instinct: there are moments where showing dice is a lifesaving gamble,
worth taking but not worth overdoing. The bot already uses the mechanic on
~11.9% of its decisions (976 of 8,195 across the 200-match level-k shadow
corpus), gated by `src/bot/tableDice.ts`: it shows dice only when the move
raises modeled P(bid supported) by >= 0.04 and leaves resulting support
>= 0.68.

The open question is the `shortStackDice` rule (default 2): at or below two
dice the bot refuses outright, to "preserve the private hand." That is
exactly the spot Ian describes as lifesaving, so the current policy and the
intuition disagree, and the disagreement is testable — measure short-stack
outcomes with the rule on vs off before changing anything. Note also that
`CANONICAL_TABLE_DICE_DEFAULTS` is documented as "calibrated so far only
against lab shadow matrices", i.e. never checked against real play.

Not approved for implementation; captured so the question is not lost.
