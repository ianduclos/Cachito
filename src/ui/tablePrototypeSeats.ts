import { MAX_PLAYERS } from "../engine";

export type SeatPosition = "top" | "left-top" | "left-middle" | "left-bottom" | "right-top" | "right-middle" | "right-bottom" | "bottom";

const seatLayouts: Record<number, readonly SeatPosition[]> = {
  2: ["top"],
  3: ["left-middle", "right-middle"],
  4: ["left-middle", "top", "right-middle"],
  5: ["left-top", "left-bottom", "right-top", "right-bottom"],
  6: ["left-top", "left-bottom", "top", "right-top", "right-bottom"],
  7: ["left-top", "left-middle", "left-bottom", "right-top", "right-middle", "right-bottom"],
  8: ["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom"],
};

export function seatLayoutFor(playerCount: number): readonly SeatPosition[] {
  return seatLayouts[playerCount] ?? seatLayouts[MAX_PLAYERS];
}

const spectatorSeatLayouts: Record<number, readonly SeatPosition[]> = {
  2: ["left-middle", "right-middle"],
  3: ["left-middle", "top", "right-middle"],
  4: ["left-top", "left-bottom", "right-top", "right-bottom"],
  5: ["left-top", "left-bottom", "top", "right-top", "right-bottom"],
  6: ["left-top", "left-middle", "left-bottom", "right-top", "right-middle", "right-bottom"],
  7: ["left-top", "left-middle", "left-bottom", "top", "right-top", "right-middle", "right-bottom"],
  8: ["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom", "bottom"],
};

export function spectatorSeatLayoutFor(playerCount: number): readonly SeatPosition[] {
  return spectatorSeatLayouts[playerCount] ?? spectatorSeatLayouts[MAX_PLAYERS];
}
