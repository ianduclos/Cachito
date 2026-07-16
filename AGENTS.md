# Cachito agent handoff

Read [docs/TABLE_PROTOTYPE.md](docs/TABLE_PROTOTYPE.md) before changing `/table-prototype`, game presentation, turn timing, sounds, bot pacing, or reveal/winner flows. That document records the interaction details that are easy to lose in a visual redesign.

Project-wide rules:

- The engine in `src/engine/` is authoritative. UI code must use `getLegalActions` and `applyAction`; never recreate bid ordering, Dudo, Calzo, Palo Fijo, elimination, or table-dice rules in a component.
- Preserve privacy boundaries. Bots and normal players receive restricted views; hidden hands must not leak through UI state, logs, feeds, or policy inputs.
- `/table-prototype` is additive and must not replace the current beta route until the product decision is explicit.
- Preserve existing user work and inspect the worktree before editing. Keep unrelated changes out of a commit.
- Run `npm run lint`, `npm run build`, and `npm test -- --run` before handoff. The online-room tests open a temporary loopback WebSocket server and need an environment that permits local listening.
- When UI behavior changes, add a regression test and perform a live 1280×720 browser pass. Check the whole interaction sequence, not only the resting screenshot.

