# Cachito agent handoff

Read [docs/TABLE_PROTOTYPE.md](docs/TABLE_PROTOTYPE.md) before changing `/table-prototype`, game presentation, turn timing, sounds, bot pacing, or reveal/winner flows. That document records the interaction details that are easy to lose in a visual redesign.

Read [docs/BOT_AND_MATCH_ANALYSIS.md](docs/BOT_AND_MATCH_ANALYSIS.md) before changing production bot policy, personas, bot telemetry, private match logs, or the completed-game analysis. The offline prototype is now regression-only; production bot behavior lives in the authoritative online room service.

Project-wide rules:

- The engine in `src/engine/` is authoritative. UI code must use `getLegalActions` and `applyAction`; never recreate bid ordering, Dudo, Calzo, Palo Fijo, elimination, or table-dice rules in a component.
- Preserve privacy boundaries. Bots and normal players receive restricted views; hidden hands must not leak through UI state, logs, feeds, or policy inputs.
- `/table-prototype` is additive and must not replace the current beta route until the product decision is explicit.
- Preserve existing user work and inspect the worktree before editing. Keep unrelated changes out of a commit.
- Keep the landing page direct and product-like, not promotional. Do not add slogans or marketing copy; the one approved atmospheric line is “A game of nerve, memory, and five hidden dice.”
- Run `npm run lint`, `npm run build`, and `npm test -- --run` before handoff. The online-room tests open a temporary loopback WebSocket server and need an environment that permits local listening.
- When UI behavior changes, add a regression test and perform a live 1280×720 browser pass. Check the whole interaction sequence, not only the resting screenshot.

## `lab/` — research workspace (Claude Code + Ian)

`lab/` is a separate research area for bot-AI R&D and statistical analysis of games
(bot-only and human/hybrid). See [lab/README.md](lab/README.md) for its charter.

- Lab work reads the engine and logs but does not modify code outside `lab/`;
  conversely, product work should not depend on anything in `lab/`.
- Findings that call for product changes (e.g. richer game logging in online rooms,
  promoting a new bot policy) will arrive as explicit write-ups, not direct patches.
- `lab/` is exempt from the lint/build/test handoff checklist above unless it
  touches shared code.
