# Table prototype design and behavior contract

This is the maintainer handoff for `http://localhost:5173/table-prototype`. The prototype explores a more physical, social table without replacing the current beta or changing the game engine. It is a real offline game, not a static mockup.

## Product intent

The target is a calmer table-game atmosphere: an oval felt table, fixed people around it, one anchored player dashboard, and enough ceremony around challenges to create suspense. Poker clients are a useful spatial reference, but Cachito should remain quieter and easier to read.

The table is the persistent place. Normal transitions must not replace it with a separate page. Result and shuffle states use crisp rectangular cards over the visible table. Do not bring back a full-table oval veil, circular blended panel, or blurred backdrop for those states. Dudo/Calzo suspense is the deliberate exception: its enormous word appears directly on the uncovered table with a fully transparent background.

## Architecture and invariants

- Entry point: `src/App.tsx`, route `/table-prototype`.
- Game and presentation: `src/ui/TablePrototype.tsx` and `src/ui/TablePrototype.css`.
- Rules and transitions: `src/engine/`; the prototype calls the real `getLegalActions` and `applyAction` functions.
- Bot decisions: `src/bot/`, using restricted `projectForPlayer` observations and public history.
- Shared bot names: `src/bot/names.ts`. Use this pool instead of inventing prototype-only names.
- Sounds and music ducking: `src/ui/sound.ts`.

Do not fork or simplify the engine for the prototype. Presentation timers may delay what is shown, but they must not alter the authoritative result. Keep the prototype separate from the current beta route.

## Seating and layout

- Support two through eight total players. Offline prototype games default to one named human plus seven autonomous bots.
- Bot seats are assigned once and remain fixed. Never rotate cards to put the active player at a preferred compass point.
- The human is represented by the bottom dashboard, which is their fixed seat. Show the saved display name, not the word “You.”
- Names commonly contain two or three words. Seat and dashboard names must allow two lines without destroying the layout.
- The current bot seat and the human dashboard need an unmistakable active-turn treatment.
- The page must fit in one viewport at 1280×720 and must not require document scrolling. The activity feed may scroll internally.
- The table should not grow without limit on wide/full-screen displays. Use the feed or constrained table sizing to preserve proportions.

## Player cards and table memory

Cards show the established information: name, bot label, hidden/visible dice status, public table-dice status, active-turn flag, and latest bid. Latest-bid dice use a visibly large die-face icon; do not reduce them to a tiny numeral.

The center inventory represents table memory:

- Always state the total dice still in play.
- Physically display only lost dice, grouped in fives, using Ace faces without adjacent numeric labels.
- Do not draw every live die in a crowded pile. The distribution between seats remains the mystery.

## Round setup and manual roll

Every round begins with the real manual cup sequence:

- The human must press **Shake my dice** before bidding.
- Human dice tumble and settle with the shake and shake-stop sounds.
- Bots become ready after independently randomized two-to-three-second delays.
- The opening bid waits until all active cups are ready.
- The shuffle card is rectangular, compact, and unblurred over the visible table. It is not a full-table oval overlay.
- If the turn-pass cue becomes ready while the shake-stop sound is playing, queue it until shake-stop finishes, then allow a short separation before playing it.

## Turn pacing and clock

- Bot decisions use a fresh random delay between three and eight seconds on every turn, including consecutive bot turns.
- The visible clock follows `game.rules.turnTimeSeconds` (60 seconds under current prototype rules) and resets for every new actor/action state.
- At ten seconds, enter the urgent visual state and start the clock cue exactly once for that deadline.
- Stop the clock cue immediately when an action resolves, the actor changes, the phase changes, or a call begins.
- If the human reaches zero, a restricted-observation safety bot makes one legal move and the feed says that time ran out.
- Do not shorten the visible bot clock merely because bots usually act earlier.

## Bid-control quality of life

The denominator selector uses square die-face buttons with real pip layouts and the Cachito names Aces, Dones, Trenes, Cuadras, Chinas, and Sambas.

- On a new human turn, prefer the denomination they last played and select its minimum legal quantity. Fall back to Dones when available.
- Choosing a denomination automatically selects that denomination’s minimum legal quantity until the human has manually changed quantity.
- Once quantity is changed with plus/minus, switching denomination must preserve that manual quantity, even when the resulting bid is temporarily illegal. Disable the final bid button until the combination is legal.
- Quantity buttons move one integer at a time; they do not jump between legal bid quantities.
- Clicking a die in the private hand chooses that face as the denomination when table-dice selection is inactive.
- Put-dice-on-table sits below Dudo and Calzo. It must remain a prominent button, not tiny helper text.
- Table-dice mode allows one or more selected dice but always leaves at least one private. Submitted table dice stay public for the round and the remaining private dice visibly reroll.

## Calls, suspense, results, and sound

The presentation sequence is intentional and should be changed only with a product decision:

1. An actor calls Dudo or Calzo. Stop the turn clock immediately and play `suspense`.
2. Show the enormous call word directly on the table with no dim, blur, or opaque backing.
3. At 2.1 seconds, a correct call becomes a single green word with the success sound. A wrong call breaks into separately falling letters with the failure sound. Play the elimination sound when a player reaches zero dice.
4. At 3.3 seconds, replace the word with the rectangular result card and revealed highlighted dice.

Result copy has a stable hierarchy:

- Context: “{caller} said Dudo/Calzo to {bidder}’s bid.”
- Evidence: “{quantity} × {denomination} · {actual count} there”
- Verdict: “Correct call.” in green or “Wrong call.” in red, larger and visually popping.
- Consequence: a short sentence such as “Min-chi Park loses 1 die.”
- Helper: highlighted dice counted toward the bid.

Avoid long prose that explains the arithmetic in a sentence. The bid and actual count already communicate that evidence.

All purposeful sounds go through `playSound`, which starts the theme if needed and ducks it for effects lasting at least one second. Preserve the 120 ms duck, 16% music target, and 1.05 second recovery unless audio is deliberately redesigned. Do not layer the clock, shake-stop, turn-pass, suspense, and result cues over one another accidentally.

## Winner presentation

When `nextRound` produces `gameOver`, play the winner sound and show the final winner card over the table. It includes the winner’s real display name, crown, round count, replay action, radial bloom, and the full 132-piece gold/coral/green/cream confetti burst. Respect reduced-motion preferences: the result remains clear without requiring animation.

## Responsive and accessibility requirements

- Keep controls reachable and labeled by purpose, not merely by glyph.
- Die faces need accessible denomination names; private hand shortcuts should announce both face and die position.
- Call state, result, shuffle, timer, and winner surfaces retain meaningful roles and labels.
- Do not rely on color alone for correct/wrong or active-turn state; text and borders carry the same information.
- At narrow sizes, prioritize the anchored hand and actions. The activity feed becomes a closable drawer.
- Re-check long names, eight seats, five-die hands, table dice, revealed hands, and the urgent clock at every responsive breakpoint.

## Regression and live-review checklist

Run:

```sh
npm test -- --run src/ui/TablePrototype.test.tsx
npm run lint
npm run build
npm test -- --run
```

Then inspect the live route at 1280×720:

1. Eight-player initial shuffle card is rectangular and the table remains visible.
2. Manual shake blocks the first bid; bots settle in two to three seconds.
3. Timer, face controls, hand shortcuts, quantity intent, and table-dice reroll behave as documented.
4. Player cards remain fixed and long names fit; active turn and latest bid are legible.
5. Dudo and Calzo show pending, resolved-success, resolved-failure, and delayed reveal states.
6. Result context names caller and bidder, verdict color is correct, and highlighted dice match engine rules.
7. A complete short match ends with winner sound, crown, replay card, and confetti.
8. There is no document scrollbar, clipped primary action, runtime error, or accidental blurred/opaque full-table overlay.

