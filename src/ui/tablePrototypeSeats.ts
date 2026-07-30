import { MAX_PLAYERS } from "../engine";

export type SeatPosition = "top" | "left-top" | "left-middle" | "left-bottom" | "right-top" | "right-middle" | "right-bottom" | "bottom";

// Seats are listed in turn order, walking the table one seat at a time from the
// viewer's immediate left: up the left side, across the top, down the right side,
// ending at the player who acts right before the viewer on their immediate right.
// Every map must follow that single sweep — skipping around (e.g. left-top before
// left-bottom) makes turn order jump across the table instead of going round it.
const seatLayouts: Record<number, readonly SeatPosition[]> = {
  2: ["top"],
  3: ["left-middle", "right-middle"],
  4: ["left-middle", "top", "right-middle"],
  5: ["left-bottom", "left-top", "right-top", "right-bottom"],
  6: ["left-bottom", "left-top", "top", "right-top", "right-bottom"],
  7: ["left-bottom", "left-middle", "left-top", "right-top", "right-middle", "right-bottom"],
  8: ["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom"],
};

export function seatLayoutFor(playerCount: number): readonly SeatPosition[] {
  return seatLayouts[playerCount] ?? seatLayouts[MAX_PLAYERS];
}

// Spectators have no seat of their own, so all players are placed — but the same
// sweep applies, so consecutive players in turn order stay adjacent on the table.
const spectatorSeatLayouts: Record<number, readonly SeatPosition[]> = {
  2: ["left-middle", "right-middle"],
  3: ["left-middle", "top", "right-middle"],
  4: ["left-bottom", "left-top", "right-top", "right-bottom"],
  5: ["left-bottom", "left-top", "top", "right-top", "right-bottom"],
  6: ["left-bottom", "left-middle", "left-top", "right-top", "right-middle", "right-bottom"],
  7: ["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom"],
  8: ["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom", "bottom"],
};

export function spectatorSeatLayoutFor(playerCount: number): readonly SeatPosition[] {
  return spectatorSeatLayouts[playerCount] ?? spectatorSeatLayouts[MAX_PLAYERS];
}
