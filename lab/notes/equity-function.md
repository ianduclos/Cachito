# exp-001 design note — the dice-equity function

**Question.** What is P(win) for a player as a function of the public stack
configuration? Formally: equity(ownDice, multiset of opponents' dice, position
info) → [0, 1].

**Why it's foundational.** It is the game's value function at round boundaries.
Everything prices off it:

- **Marginal die value.** ΔEquity from 3→2 dice is not the same as from 2→1.
  The current bot hand-codes "extra caution at 1–2 dice"; the equity curve
  replaces that intuition with a measurement.
- **Calzo pricing.** Correct = +1 die (capped at 5), wrong = −2. The real
  threshold is where p·ΔE(+1) > (1−p)·ΔE(−2), which depends on the whole table —
  not the flat 0.72 the live bot uses. Prediction: correct Calzo thresholds vary
  a lot by state; some states make Calzo far better than the bot thinks (e.g.
  when −2 doesn't change much because you're doomed anyway, or +1 crosses a
  cliff).
- **Dudo pricing.** Same logic: a wrong Dudo costs you a die, a right one costs
  the bidder. Risk both ways should be equity-weighted, not probability-only.
- **Fun stat / end-screen candidate.** "Win probability over the game" chart per
  player — the poker-broadcast equity graph. Cheap to produce once the table
  exists.

**Estimator (v0).** Exact frequency counting over bulk self-play at round
starts: key = (ownDice, sorted opponent stacks, isStarter, playerCount). Round
starts are the natural sampling points because stacks only change at round
boundaries.

**Known caveats (accepted for v0, revisit later):**

1. **Policy-dependence.** This is equity *under the baseline bot population*,
   not game-theoretic value. That's fine — it's the relevant value function for
   beating the current baseline, and we can re-estimate under stronger
   populations later (equity tables are versioned by the population that
   generated them).
2. **State aliasing.** v0 ignores *which* opponent has which stack relative to
   turn order (right-neighbor matters: you hand them the bid). The sorted
   multiset merges those. Check later whether position-resolved keys change
   conclusions; sample size will decide.
3. **Palo Fijo pending state.** Whether a player has already burned their Palo
   Fijo trigger is real state that v0 ignores. Likely second-order; flag it.
4. **Starter flag only.** v0 records isStarter but not distance-from-starter.
5. **No smoothing.** Rare states (e.g. 8-player tails) will be noisy; a
   symmetrized / model-smoothed estimator (monotone in own dice, exchangeable in
   opponents) is the obvious v1.

**Sanity predictions to check against first data:**

- Equity monotonically increasing in ownDice, decreasing in each opponent stack.
- 2-player 5v5 ≈ 0.5 (up to starter effect); starter effect sign and size is
  itself an open question — first mover reveals information but also applies
  pressure.
- Fair-share checks: mean equity across seats at the all-5s start = 1/n.
- The 1-die state should show strong sensitivity to playerCount (Palo Fijo
  protection exists only with >2 active players).

**Success criteria.** A versioned equity table + marginal-value curves we trust
enough to (a) publish as lab plots, (b) use to re-derive Calzo/Dudo thresholds
for a "equity-aware baseline" bot — the first candidate to duel the Conservative
baseline.
