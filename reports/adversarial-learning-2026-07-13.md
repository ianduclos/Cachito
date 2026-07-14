# Adversarial evolutionary learning experiment

Date: 2026-07-13

## Method

- Training: 10 generations, 8 candidates, 300 games per generation
- Training games: 3,000 across 2-, 4-, and 6-player tables
- Training seed: `20260714`
- Evolution: two elites retained per generation, with bounded crossover and mutation
- Fitness: 65% overall fair-share performance, 25% worst table-size performance, and 10% bid calibration
- Held-out evaluation: 2,000 games on seed `20260715`, with rotating seats and the original fixed policies

The held-out seed and opponent league were not used during evolution.

## Learned parameters

| Parameter | Learned value |
|---|---:|
| Dudo threshold | 0.6635 |
| Calzo threshold | 0.8409 |
| Target bid confidence | 0.8185 |
| Bluff rate | 0.0340 |
| Near-equal choice window | 0.0225 |

The learned policy bids substantially more cautiously than the original Conservative policy, while retaining a small bluff rate. It made no Calzo calls during the held-out tournament.

## Held-out evaluation

The performance ratio compares actual wins with fair-share wins across the mixed table sizes.

| Policy | Wins / appearances | Performance ratio | Dudo accuracy | Bid Brier | 2-player win rate | 4-player win rate | 6-player win rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| Conservative | **548 / 1,332** | **1.646** | 65.4% | 0.204 | 57.2% | 38.5% | **37.5%** |
| Learned champion | 459 / 1,338 | 1.369 | **68.7%** | **0.173** | **66.2%** | **42.5%** | 18.0% |
| Survivalist | 363 / 1,332 | 1.090 | 60.4% | 0.217 | 59.0% | 30.0% | 14.9% |
| Baseline | 284 / 1,335 | 0.850 | 60.6% | 0.238 | 42.2% | 17.0% | 17.1% |
| Bluffer | 173 / 1,330 | 0.521 | 57.0% | 0.238 | 30.8% | 10.2% | 9.0% |
| Challenger | 173 / 1,331 | 0.520 | 50.6% | 0.237 | 44.3% | 11.7% | 3.5% |

Fair-share win rates are 50.0%, 25.0%, and 16.7% for 2-, 4-, and 6-player games.

## Interpretation

The evolutionary search found a real improvement in bid calibration and a strong 2/4-player specialist. It beat Conservative head-to-head at those table sizes in this league, but its six-player performance only barely exceeded fair share. Conservative therefore remained the strongest general policy overall.

The training estimate for the final champion's six-player performance ratio was 1.64, while held-out evaluation measured 1.08. That gap is direct evidence that 300 games per generation is too noisy for reliable robust selection. Generation-best fitness was also non-monotonic because every generation used a fresh seed and champions were selected from that generation alone.

## Recommended learner revision

1. Keep Conservative and Survivalist as permanent anchor opponents in every generation.
2. Evaluate candidates over several seed blocks and aggregate results before selection.
3. Maintain a hall of fame and choose the released champion by a larger held-out tournament, not simply the last generation.
4. Increase or adapt the game budget for close candidates, particularly at six-player tables.
5. Show training and held-out validation as separate lines in the dashboard.

This experiment validates the evolutionary framework and the dashboard, while also demonstrating why held-out evaluation must remain part of every learning run.
