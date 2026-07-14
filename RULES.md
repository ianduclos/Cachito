# Cachito rules

This document is the rules contract for the game engine. It describes the agreed rules for the first version of Cachito (also known as Dudo, Liar's Dice, or Perudo).

## Goal and setup

- The game supports 2–6 players.
- Players sit in a fixed turn order. Play passes to the player on the right, skipping eliminated players.
- Every player starts with five standard six-sided dice and a cup.
- At the start of a round, each active player rolls all of their remaining dice.
- In a normal round, a player may see only their own current roll. During Palo Fijo, only one-die players may see their own roll. Other live rolls stay hidden until the round is resolved.
- The last player with at least one die wins the game.

## Denomination names

The interface and documentation use the traditional denomination names:

| Face | Name |
| ---: | --- |
| 1 | Aces |
| 2 | Dones |
| 3 | Trenes |
| 4 | Cuadras |
| 5 | Chinas |
| 6 | Sambas |

## Bids and turns

A bid is a quantity and a denomination: for example, “four Chinas” predicts that the table contains at least four qualifying Chinas.

On a player's turn, they must take one legal action:

1. Make a higher bid.
2. Call **Dudo** against the previous bid.
3. Call **Calzo** on the previous bid.

Dudo and Calzo require an existing bid. The player whose turn it is is the only player who may act.

### Normal-to-normal bids

When both bids use denominations 2–6, the new bid is higher if either:

- its quantity is higher (the denomination may be any normal denomination), or
- its quantity is unchanged and its denomination is higher.

Examples:

- Four Trenes → four Chinas is legal.
- Four Sambas → five Dones is legal.
- Four Chinas → four Trenes is illegal.
- Four Chinas → three Sambas is illegal.

### Changing to or from aces

Aces (ones) have special bid transitions in a normal round:

- From a normal denomination to aces, the minimum ace quantity is `ceil(previous quantity / 2)`.
- From aces to a normal denomination, the minimum normal quantity is `(previous ace quantity × 2) + 1`.
- An ace bid followed by another ace bid must increase the quantity.

Examples:

- Five Chinas → three Aces is legal: `ceil(5 / 2) = 3`.
- Six Chinas → three Aces is legal: `ceil(6 / 2) = 3`.
- Six Chinas → two Aces is illegal.
- Three Aces → seven Dones is legal: `(3 × 2) + 1 = 7`.
- Three Aces → six Sambas is illegal.

The ceiling rule is the agreed rule for the first release. Bid conversion formulas may become configurable variants later.

## Counting dice

During a normal round:

- For a bid on Dones through Sambas, matching dice and all Aces qualify. For example, three Chinas plus two Aces count as five Chinas.
- For a bid on Aces, only Aces qualify.

During Palo Fijo, aces are not wild. Every die counts only as its printed denomination.

## Dudo

Dudo claims that the previous bid's quantity is too high.

1. All hands are revealed.
2. Qualifying dice are counted under the current round's wild-ace rule.
3. If the actual count is lower than the bid, the Dudo caller is correct and the player who made the bid loses one die.
4. If the actual count is equal to or higher than the bid, the Dudo caller is wrong and loses one die.
5. The player who lost a die starts the next round. If that player was eliminated, the next active player on their right starts instead.

Example: the bid is five Cuadras and the normal-round table contains three Cuadras and one Ace. The qualifying total is four, so Dudo is correct and the bidder loses one die.

## Calzo

Calzo claims that the previous bid's quantity is exact.

1. All hands are revealed.
2. Qualifying dice are counted under the current round's wild-ace rule.
3. If the actual count equals the bid exactly, the caller gains one die, up to the five-die maximum. A caller already holding five dice stays at five.
4. If the actual count is not exact, the caller loses two dice. A player cannot have a negative dice count, so this can eliminate a player who has one or two dice.
5. After a failed Calzo, the caller is the player who lost dice and therefore starts the next round if still active.
6. After a successful Calzo, the caller starts the next round.

Calzo is an alternative to raising or calling Dudo and may be called only by the current player.

## Elimination and the next round

- A player with zero dice is eliminated and is skipped in turn order.
- If only one active player remains after a reveal, that player wins immediately.
- Otherwise, all active players reroll their remaining dice for the next round.
- The player who lost a die or dice starts the next round. If eliminated, turn order advances to the next active player on that player's right.

## Palo Fijo

Palo Fijo is a special round triggered the first time each distinct player is reduced to exactly one die, provided more than two players remain active after that reduction.

- The immediately following round is Palo Fijo.
- Reaching one die does not make every later round Palo Fijo; each trigger creates one Palo Fijo round.
- Each player can trigger Palo Fijo at most once during a game. Remaining at one die, rising above one through Calzo, and later returning to one cannot make that same player trigger it again.
- Different players can each trigger their own Palo Fijo round when they first fall to one die.
- Palo Fijo is disabled once the game has only two active players. A reduction to one die with two or fewer active players does not create a Palo Fijo round.
- A player who is already at one die still receives the one-die privileges below whenever somebody else's Palo Fijo round occurs.
- A player who goes directly from two dice to zero does not trigger Palo Fijo.
- During Palo Fijo, aces are not wild.
- Ones are an ordinary denomination for Palo Fijo bid ordering; the normal-round ace conversion formulas do not apply.
- Only players holding exactly one die may view their own hand. Players holding more than one die bid without seeing their dice during that round.
- Players holding more than one die must keep the current bid's denomination when raising.
- Any player holding exactly one die may change the denomination when making a legal ordinary raise; the privilege is not limited to the player whose loss triggered Palo Fijo. An ordinary raise increases the quantity with any denomination, or keeps the quantity and increases the denomination.

Examples:

- If Ana falls from two dice to one while Ana, Bruno, and Carla remain active, the next round is Palo Fijo and Ana starts it because she lost the die.
- If only Ana and Bruno remain active when Ana falls to one die, the next round is a normal round; Palo Fijo is disabled heads-up.
- Ana opens with two Cuadras. Bruno has three dice, so he cannot view his hand and may raise to three Cuadras but may not change the denomination. Carla has one die, so she may view her die and has the privilege to change the denomination as part of a legal higher bid.
- In that round, Carla may raise two Cuadras to two Sambas or three Aces. She may not raise it to two Aces, because at the same quantity Ace is a lower denomination. The normal-round Ace conversion rule is not used.
- A table containing two Chinas and two Aces counts as two Chinas during Palo Fijo, not four.
- If Bruno later returns to one die after already triggering Palo Fijo once, he does not trigger another Palo Fijo round. He still has denomination-change privileges during any Palo Fijo round triggered by another player.

## Hidden information and views

The engine owns the complete state, including every hand, but consumers receive restricted views:

- A **player view** contains all public game information and that player's current dice only when the rules permit them to see the hand. In a normal round this means their own hand; in Palo Fijo, a player with more than one die receives no hand while a one-die player receives their single die.
- A **normal spectator view** contains public game information and no private dice while a round is live. A normal spectator cannot act.
- An **admin testing spectator view** may display every live hand to help verify the local engine and interface. It is a development/testing capability, must be visibly labeled, and must never be available as an ordinary online spectator role.
- After Dudo or Calzo resolves a round, the revealed hands and result are public to players and spectators.
- A future server must build player and normal spectator views server-side. It must never send the full live state to an ordinary browser and rely on the interface to hide other hands. Any admin testing access must be explicitly authorized and excluded from production play.

For local pass-and-play, the shared table screen doubles as the normal spectator/public view. A privacy handoff screen must hide the previous player's dice before the device changes hands. In a normal round, the active player explicitly reveals their own hand, takes an action, then hides it again. In Palo Fijo, this reveal control is available only to a player holding one die; other active players act from the public table without seeing their hand.

## Future configurable variants

The first implementation should keep the rules centralized so variants can be introduced without duplicating logic. Possible future settings include:

- alternative normal-to-ace conversion formulas;
- player-count and starting-dice limits;
- Calzo eligibility, reward, and penalty;
- Palo Fijo activation and denomination rules;
- turn timers; and
- optional house rules.

These are future possibilities, not part of the initial rules unless stated elsewhere in this document.
