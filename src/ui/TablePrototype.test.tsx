import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_NAMES } from "../bot";
import type { EnginePlayer } from "../engine";
import { PrototypeCallout, PrototypeGameOver, PrototypePlayerSeat, TablePrototype } from "./TablePrototype";
import { seatLayoutFor, spectatorSeatLayoutFor } from "./tablePrototypeSeats";

beforeEach(() => localStorage.setItem("cachito-display-name", "Ian"));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function finishManualRoll() {
  fireEvent.click(screen.getByRole("button", { name: "Shake my dice" }));
  expect(screen.getByRole("button", { name: "Shuffling…" })).toBeDisabled();
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(screen.queryByRole("dialog", { name: "Shake dice" })).not.toBeInTheDocument();
}

describe("TablePrototype", () => {
  it("uses deliberate symmetric seat maps for every supported player count", () => {
    expect(seatLayoutFor(2)).toEqual(["top"]);
    expect(seatLayoutFor(3)).toEqual(["left-middle", "right-middle"]);
    expect(seatLayoutFor(4)).toEqual(["left-middle", "top", "right-middle"]);
    expect(seatLayoutFor(5)).toEqual(["left-top", "left-bottom", "right-top", "right-bottom"]);
    expect(seatLayoutFor(6)).toEqual(["left-top", "left-bottom", "top", "right-top", "right-bottom"]);
    expect(seatLayoutFor(7)).toEqual(["left-top", "left-middle", "left-bottom", "right-top", "right-middle", "right-bottom"]);
    expect(seatLayoutFor(8)).toEqual(["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom"]);
    expect(spectatorSeatLayoutFor(2)).toEqual(["left-middle", "right-middle"]);
    expect(spectatorSeatLayoutFor(8)).toEqual(["left-bottom", "left-middle", "left-top", "top", "right-top", "right-middle", "right-bottom", "bottom"]);
  });

  it("keeps eliminated players visibly seated as spectators", () => {
    const player: EnginePlayer = { id: "out", name: "Min-chi Park", diceCount: 0, hand: [], tableDice: [], tableDiceUsed: false, paloFijoTriggered: false };
    render(<PrototypePlayerSeat player={player} position="top" revealDistribution={false} currentTurn={false} rolling={false} rollReady={false} />);
    const seat = screen.getByRole("article", { name: "Min-chi Park, out and spectating" });
    expect(seat).toHaveClass("tp-seat--out");
    expect(seat).toHaveTextContent("Out · spectating");
    expect(seat).toHaveTextContent("Out");
  });

  it("renders success as one green word and failure as independently falling letters", () => {
    const { rerender, container } = render(<PrototypeCallout kind="calzo" name="Ian" correct resolved />);
    expect(screen.getByRole("status", { name: "CALZO call, correct" })).toHaveClass("tp-callout--right");
    expect(container.querySelectorAll(".tp-callout strong i")).toHaveLength(0);

    rerender(<PrototypeCallout kind="dudo" name="Ian" correct={false} resolved />);
    expect(screen.getByRole("status", { name: "DUDO call, wrong" })).toHaveClass("tp-callout--wrong");
    expect(container.querySelectorAll(".tp-callout strong i")).toHaveLength(4);
  });

  it("restores the final winner card and full confetti burst", () => {
    const { container } = render(<PrototypeGameOver winnerName="Min-chi Park" round={9} onRestart={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Game winner" })).toHaveTextContent("Min-chi Park wins!");
    expect(screen.getByText("Game complete · 9 rounds")).toBeInTheDocument();
    expect(container.querySelectorAll(".tp-confetti i")).toHaveLength(132);
  });

  it("uses the saved username, established bot names, and full player-card information", () => {
    render(<TablePrototype onExit={vi.fn()} />);

    expect(screen.getByText("Ian", { selector: ".tp-hud-owner strong" })).toBeInTheDocument();
    expect(screen.getByLabelText("40 dice in play; no dice lost")).toBeInTheDocument();
    expect(screen.getByText("No dice lost yet")).toBeInTheDocument();
    expect(screen.getAllByText("Bot")).toHaveLength(7);
    const botCards = screen.getAllByRole("article");
    expect(botCards).toHaveLength(7);
    expect(botCards.every((card) => BOT_NAMES.some((name) => card.getAttribute("aria-label")?.startsWith(name)))).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Reveal seat totals" }));
    expect(screen.getAllByLabelText("5 dice")).toHaveLength(7);
    expect(screen.queryByText("Dice hidden")).not.toBeInTheDocument();
  });

  it("requires a manual cup shake before the first bid", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<TablePrototype onExit={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Shake dice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bid 1 Dones" })).toBeDisabled();
    await finishManualRoll();
    expect(screen.getByRole("button", { name: "Bid 1 Dones" })).toBeEnabled();
  });

  it("provides a private-safe spectator dashboard and bot cover for an active seat", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<TablePrototype onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Watch table" }));
    expect(screen.getByRole("region", { name: "Spectator view" })).toHaveTextContent("A bot is covering Ian’s seat.");
    expect(document.querySelector(".tp-hand")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shake my dice" })).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(2_999));
    expect(screen.queryByRole("dialog", { name: "Shake dice" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(screen.getByText(/Bot covering Ian (bid|called)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Return to seat" }));
    expect(screen.getByLabelText("Your hand and turn controls")).toBeInTheDocument();
  });

  it("restores pip-face controls, hand shortcuts, manual quantity intent, and the turn clock", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<TablePrototype onExit={vi.fn()} />);
    await finishManualRoll();

    expect(screen.getByRole("img", { name: "Aces" }).querySelectorAll(".tp-face-pip:not(.tp-face-pip--empty)")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Sambas" }).querySelectorAll(".tp-face-pip:not(.tp-face-pip--empty)")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose Chinas" }));
    expect(screen.getByRole("button", { name: "Bid 3 Chinas" })).toBeEnabled();

    const handShortcut = screen.getAllByRole("button", { name: /Choose .+ from die/ })[0];
    const handFace = handShortcut.getAttribute("aria-label")!.match(/Choose (.+) from/)![1];
    fireEvent.click(handShortcut);
    expect(screen.getByRole("button", { name: `Bid 3 ${handFace}` })).toBeEnabled();
    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.getByRole("timer", { name: "60 seconds remaining" })).toHaveTextContent("1:00");
    await act(async () => vi.advanceTimersByTime(50_000));
    expect(screen.getByRole("timer", { name: "10 seconds remaining" })).toHaveClass("tp-turn-timer--urgent");
  });

  it("leaves room for multi-word usernames and omits redundant private-hand copy", () => {
    localStorage.setItem("cachito-display-name", "María Fernanda López");
    render(<TablePrototype onExit={vi.fn()} />);
    expect(screen.getByText("María Fernanda López", { selector: ".tp-hud-owner strong" })).toBeInTheDocument();
    expect(screen.queryByText(/Private ·/)).not.toBeInTheDocument();
  });

  it("returns to the current beta without touching game state", () => {
    const onExit = vi.fn();
    render(<TablePrototype onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to current beta" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("lets the named player select table dice while keeping one die private", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<TablePrototype onExit={vi.fn()} />);
    await finishManualRoll();

    fireEvent.click(screen.getByRole("button", { name: "Put dice on table" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose die 1 for the table" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose die 2 for the table" }));
    fireEvent.click(screen.getByRole("button", { name: "Bid & put 2 on table" }));

    expect(screen.getByText("Ian bid 1 Dones and put 2 on the table")).toBeInTheDocument();
    expect(screen.getByText("Ian", { selector: ".tp-exposed-dice small" })).toBeInTheDocument();
    expect(document.querySelector(".tp-hand .dice-row--table-reroll")).toBeInTheDocument();
  });

  it("previews high-signal calls over the table", () => {
    render(<TablePrototype onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview a Dudo alert" }));
    expect(screen.getByRole("status")).toHaveTextContent("full call sequence pauses");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Dudo alert" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens and collapses the activity feed without changing the table", () => {
    render(<TablePrototype onExit={vi.fn()} />);

    const activity = screen.getByRole("button", { name: "Activity 2" });
    fireEvent.click(activity);
    expect(activity).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse table feed" }));
    expect(activity).toHaveAttribute("aria-expanded", "false");
  });

  it("restarts real offline games from two through eight players", () => {
    render(<TablePrototype onExit={vi.fn()} />);

    const players = screen.getByRole("combobox", { name: "Offline players" });
    fireEvent.change(players, { target: { value: "2" } });
    expect(screen.getByLabelText("2-player offline table")).toBeInTheDocument();
    expect(screen.getByLabelText("10 dice in play; no dice lost")).toBeInTheDocument();
    fireEvent.change(players, { target: { value: "8" } });
    expect(screen.getByLabelText("8-player offline table")).toBeInTheDocument();
  });

  it("keeps seats fixed, waits 3–8 seconds for bots, and stages calls before revealing hands", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<TablePrototype onExit={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Offline players" }), { target: { value: "2" } });
    const botCard = screen.getByRole("article");
    const fixedSeatClass = botCard.className;
    const botName = botCard.getAttribute("aria-label")!;
    await finishManualRoll();

    fireEvent.click(screen.getByRole("button", { name: "Bid 1 Dones" }));
    expect(screen.getByLabelText("Current bid: 1 Dones")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: `${botName}, current turn` })).toHaveClass("tp-seat--top");
    await act(async () => vi.advanceTimersByTime(2_999));
    expect(screen.getByLabelText("Current bid: 1 Dones")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByRole("article").className).toContain("tp-seat--top");
    expect(screen.getByRole("article").className).not.toBe("");
    expect(fixedSeatClass).toContain("tp-seat--top");

    if (!screen.queryByRole("status", { name: /call, checking/i })) fireEvent.click(screen.getByRole("button", { name: "Dudo" }));
    expect(screen.getByRole("status", { name: /call, checking/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Round result" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(2_099));
    expect(screen.getByRole("status", { name: /call, checking/i })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status", { name: /call, (correct|wrong)/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Round result" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1_200));
    expect(screen.getByRole("dialog", { name: "Round result" })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Ian said Dudo to ${botName}’s bid\\.`))).toBeInTheDocument();
    expect(document.querySelector(".tp-result-verdict strong")).toHaveTextContent(/^(Correct|Wrong) call\.$/);
    expect(document.querySelector(".tp-result-verdict span")).toHaveTextContent(/(gains|loses) \d+ (die|dice)\.$/);
    expect(screen.queryByText(/qualifying dice/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next round" }));
    expect(screen.getByRole("dialog", { name: "Shake dice" })).toBeInTheDocument();
    expect(screen.getByLabelText(/dice in play; [12] (?:die|dice) lost/)).toBeInTheDocument();
  });
});
