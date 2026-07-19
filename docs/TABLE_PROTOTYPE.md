# Table prototype design and behavior contract

This is the maintainer handoff for the table presentation now used by live online rooms and retained as an offline regression harness at `http://localhost:5173/table-prototype`. The layout changes presentation only; both paths continue to use the existing game engine.

## Product intent

The target is a calmer table-game atmosphere: an oval felt table, fixed people around it, one anchored player dashboard, and enough ceremony around challenges to create suspense. Poker clients are a useful spatial reference, but Cachito should remain quieter and easier to read.

The table is the persistent place. Normal transitions must not replace it with a separate page. Result, shuffle, pause, and settings states use fully opaque, crisp rectangular cards over the visible table. Do not bring back translucent popup cards, a full-table oval veil, circular blended panel, or blurred backdrop for those states. Dudo/Calzo suspense is the deliberate exception: its enormous word appears directly on the uncovered table with a fully transparent background.

## Architecture and invariants

- Entry point: `src/App.tsx`. Live rooms enter through **Play online**; `/table-prototype` remains the offline test harness.
- Shared table presentation: `src/ui/TablePrototype.css`, `src/ui/tablePrototypeSeats.ts`, and `src/ui/Dice.tsx`.
- Live online presentation: `src/online/OnlineGame.tsx` and `src/online/OnlineTable.css`. Shared connection and focus behavior lives in `OnlineConnectionNotice.tsx` and `OnlineModal.ts`; the winner and postgame analysis live in `OnlineGameAnalysis.tsx`. Keep new presentation responsibilities in focused modules rather than growing `OnlineGame.tsx` again. It must render only the server-provided `PublicGameView` and `LegalActions`. The waiting player may derive a provisional bid list from public bid-ordering rules for advance preparation, but submission remains turn-gated and server-authoritative.
- Offline harness: `src/ui/TablePrototype.tsx`.
- Rules and transitions: `src/engine/`; the prototype calls the real `getLegalActions` and `applyAction` functions.
- Bot decisions: `src/bot/`, using restricted `projectForPlayer` observations and public history.
- Production bots and the completed winner analysis: `docs/BOT_AND_MATCH_ANALYSIS.md`. Online bots use Gen 2 + Persona; the offline route is regression-only and must not become a competing policy surface.
- Shared bot names: `src/bot/names.ts`. Use this pool instead of inventing prototype-only names.
- Sounds and music ducking: `src/ui/sound.ts`.

Do not fork or simplify the engine. Presentation timers may delay what is shown, but they must not alter the authoritative result. The July 17, 2026 product decision promoted this presentation to online play; keep the offline route as a fast behavior and visual regression harness rather than a second product implementation.

The July 18 product decision deprecated the offline prototype as a product path. Preserve it only where it cheaply catches engine, animation, audio, or layout regressions; new online features do not need a parallel offline implementation.

## Seating and layout

- Support two through eight total players. Offline prototype games default to one named human plus seven autonomous bots.
- Bot seats are assigned once and remain fixed. Never rotate cards to put the active player at a preferred compass point.
- Choose the seat map from the total player count at game creation; do not merely fill the eight-player map from one side. The deliberate maps are: 2 = top; 3 = left/right middle; 4 = left middle/top/right middle; 5 = left/right top and bottom; 6 = those four plus top; 7 = all three left and all three right; 8 = those six plus top. The bottom dashboard remains the human seat in every map.
- The human is represented by the bottom dashboard, which is their fixed seat. Show the saved display name, not the word “You.”
- Names commonly contain two or three words. Seat and dashboard names must allow two lines without destroying the layout.
- The current bot seat and the human dashboard need an unmistakable active-turn treatment.
- The page must fit in one viewport at 1280×720 and must not require document scrolling. The activity feed may scroll internally.
- The table should not grow without limit on wide/full-screen displays. Use the feed or constrained table sizing to preserve proportions.
- Do not repeat room code, round number, or “Normal play” along the upper felt; that information already lives in the page header and status controls.

## Player cards and table memory

Cards show the established information: name, bot label, hidden/visible dice status, public table-dice status, active-turn flag, and latest bid. Latest-bid dice use a visibly large die-face icon; do not reduce them to a tiny numeral.

Elimination does not remove or reflow a seat. Keep the card in its original position, convert its body and game information to neutral styling, retain the name and relevant public history, and show both an **Out** badge and **Out · spectating** status. Do not lower opacity on the whole card: eliminated seats must remain readable. The Online/Covered/Offline badge deliberately retains green/amber/red color so connection state remains independently scannable.

The center inventory represents table memory:

- Always state the total dice still in play.
- Physically display only lost dice, grouped in fives, using Ace faces without adjacent numeric labels.
- Do not draw every live die in a crowded pile. The distribution between seats remains the mystery.

The three center surfaces are primary game information, not decoration. At desktop sizes they must use comfortably readable labels, totals, dice, and timer text. The current/last bid always sits on its own high-contrast rectangular card with a visible border and shadow so it remains the first thing a player can scan from across the table.

## Round setup and manual roll

Every round begins with the real manual cup sequence:

- The human must press **Shake my dice** before bidding.
- Human dice tumble and settle with the shake and shake-stop sounds.
- Bots become ready after independently randomized two-to-three-second delays.
- The opening bid waits until all active cups are ready.
- The shuffle card is rectangular, compact, and unblurred over the visible table. It is not a full-table oval overlay.
- If the turn-pass cue becomes ready while the shake-stop sound is playing, queue it until shake-stop finishes, then allow a short separation before playing it.

## Spectator and eliminated-player mode

The prototype supports two paths into the same privacy-safe watch experience:

- An active human can choose **Watch table**. Their private hand and every action control disappear immediately. A normal restricted-observation bot covers that seat, including the current round's cup and any later turns, using the same randomized delays as the other bots. **Return to seat** stops future bot cover as long as the player is still active. Do not switch modes in the middle of the manual tumble animation; the watch action remains disabled until that shake settles.
- A human at zero dice enters spectator mode automatically for the rest of the match. They cannot return to play, but their greyed-out seat remains visible at the table.

The spectator dashboard is a compact at-a-glance surface, not a disabled player hand. It must show the viewer identity/status, current actor and clock, current bid, round, dice in play, and an activity action. It must never render the private-hand component or live hand values. Result screens may show all hands only after the engine enters `reveal`, as normal Cachito rules require.

For the offline prototype, bot cover may read the covered seat's engine-restricted player projection in order to act. That private observation is never rendered. In live online play, normal spectators receive only the existing sanitized spectator projection from the server; never reconstruct spectator privacy in CSS or from a full client-side state object. Pure spectators use the dedicated eight-position spectator maps so every seated player remains visible, including the bottom seat. A seated player uses the bottom dashboard as their own fixed seat and the remaining position map for opponents.

During the round-setup card, a spectator sees every active cup settle automatically and has no manual shake button. An eliminated player is already absent from the active-cup list. Spectator mode keeps the table audio, suspense, results, activity feed, and winner ceremony so watching remains a first-class experience.

## Turn pacing and clock

- Bot decisions use a fresh random delay between three and eight seconds on every turn, including consecutive bot turns.
- The visible clock follows `game.rules.turnTimeSeconds` (60 seconds under current prototype rules) and resets for every new actor/action state.
- A new actor must be published with only their fresh deadline; never render the previous actor's deadline first. Room updates that do not change the actor may preserve or shorten the deadline, but never add time.
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
- After cups settle, a seated player may prepare quantity and denomination while another player acts. The disabled submit button reads **Prepared** for a legal choice and **Preparing** for a temporarily illegal combination. Incoming bids preserve the prepared choice when it remains legal and otherwise advance it to a legal minimum. Dudo, Calzo, table-dice selection, and actual submission remain disabled until the server grants that player the turn.
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

The result card is the main rapid-reading checkpoint. Preserve the uploaded/reference hierarchy: context, very large bid-versus-actual evidence, popping color-coded verdict, short consequence, then revealed hands. At eight players, use four readable hand cards per row; names and dice must remain readable at 1280×720 without adding page scroll.

All purposeful sounds go through `playSound`. The sound module eagerly preloads one warm voice for every effect plus the theme so the first cue does not wait on a network fetch or decode; it creates an additional voice only when a clip genuinely overlaps itself. Web Audio is resumed on the earliest user gesture so amplified cues do not pay a first-use wake-up delay. Playback starts the theme if needed and ducks it for effects lasting at least one second. Preserve the 120 ms duck, 16% music target, and 1.05 second recovery unless audio is deliberately redesigned. Do not layer the clock, shake-stop, turn-pass, suspense, and result cues over one another accidentally.

## Winner presentation

When `nextRound` produces `gameOver`, play the winner sound and replace the table with a deliberately excessive full-viewport champion ceremony. It includes the winner’s real display name at headline scale, crown, round count, standings, replay/leave actions, layered radial bloom, and the full 132-piece gold/coral/green/cream confetti burst. Confetti must layer above the opaque winner surface, not behind it. It must not look like another centered modal. Respect reduced-motion preferences: the result remains clear without requiring animation.

## Settings and forfeit

During an active online game, Settings includes pause/resume, audio, reduced motion, exit, and **Forfeit game**. Forfeit always requires an inline confirmation explaining that the player will be out and continue as a spectator. A confirmed forfeit eliminates that fixed seat, clears the interrupted bid, starts a clean round for remaining players, and immediately declares a winner when only one player remains. It is not equivalent to disconnecting or leaving the room.

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

Then inspect a real local online room at 1280×720. Use the deprecated offline harness only when the changed behavior still exists there. Join the online room once as a seated player and once as a normal spectator:

1. Eight-player initial shuffle card is rectangular and the table remains visible.
2. Manual shake blocks the first bid; bots settle in two to three seconds.
3. Timer, face controls, hand shortcuts, quantity intent, and table-dice reroll behave as documented.
4. Player cards remain fixed and long names fit; active turn and latest bid are legible.
5. Counts 2–8 each produce a balanced seat map; changing counts starts a new game without changing the engine rules.
6. **Watch table** removes the private hand, auto-settles the human cup, bot-covers the seat after the normal delay, and **Return to seat** restores the player dashboard. Eliminated seats stay fixed, grey, and explicitly marked Out.
7. Dudo and Calzo show pending, resolved-success, resolved-failure, and delayed reveal states.
8. Result context names caller and bidder, verdict color is correct, and highlighted dice match engine rules.
9. A complete short match ends with winner sound, crown, standings, and confetti for players and spectators. **Game analysis** opens an opaque full-screen summary, explains Bluff/Aggression/Challenge on hover and keyboard focus, shows early reads honestly, and can return to the winner ceremony.
10. There is no document scrollbar, clipped primary action, runtime error, private-hand leak, or accidental blurred/opaque full-table overlay.

Before a production release, bump `src/release.ts`, deploy the room service first when its supported player count or protocol differs from production, then deploy the production-endpoint browser build. Verify the visible release marker and repeat the seated-player and spectator privacy checks on `https://cachito.web.app`.
