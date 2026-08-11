import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatchAnalysisRoundStory } from "../analysis";
import { OnlineRoundReplay } from "./OnlineRoundReplay";

const story = {
  round: 7,
  paloFijo: false,
  startingDice: [{ playerId: "ana", dice: 5 }, { playerId: "min", dice: 3 }],
  bids: [
    { playerId: "ana", quantity: 2, denomination: 5, attributable: true },
    { playerId: "min", quantity: 4, denomination: 5, attributable: true, tableDice: 1 },
  ],
  callerId: "ana",
  callerAttributable: true,
  bidderId: "min",
  kind: "dudo",
  correct: true,
  actualCount: 3,
  margin: -1,
  diceChanges: [{ playerId: "min", delta: -1 }],
  revealedHands: [
    { playerId: "ana", dice: [1, 5, 2] },
    { playerId: "min", dice: [5, 3] },
  ],
  replayFrames: [
    { phase: "setup", actionIndex: -1, players: [{ playerId: "ana", hand: [1, 5, 2], tableDice: [] }, { playerId: "min", hand: [5, 3], tableDice: [] }] },
    { phase: "before-action", actionIndex: 0, actorId: "ana", attributable: true, action: { type: "bid", bid: { quantity: 2, denomination: 5 } }, players: [{ playerId: "ana", hand: [1, 5, 2], tableDice: [] }, { playerId: "min", hand: [5, 3], tableDice: [] }] },
    { phase: "before-action", actionIndex: 1, actorId: "min", attributable: true, action: { type: "bid", bid: { quantity: 4, denomination: 5 }, tableDice: [5] }, players: [{ playerId: "ana", hand: [1, 5, 2], tableDice: [] }, { playerId: "min", hand: [5, 3], tableDice: [] }] },
    { phase: "before-action", actionIndex: 2, actorId: "ana", attributable: true, action: { type: "dudo" }, players: [{ playerId: "ana", hand: [1, 5, 2], tableDice: [] }, { playerId: "min", hand: [2], tableDice: [5] }] },
  ],
} satisfies MatchAnalysisRoundStory & { revealedHands: Array<{ playerId: string; dice: Array<1 | 2 | 3 | 4 | 5 | 6> }> };

function renderReplay(onClose = vi.fn()) {
  return { onClose, ...render(<OnlineRoundReplay story={story} open onClose={onClose} nameOf={(id) => id === "ana" ? "Ana María" : "Min-chi Park"} colorOf={(id) => id === "ana" ? "#3987e5" : "#d55181"} />) };
}

describe("OnlineRoundReplay", () => {
  afterEach(cleanup);

  it("moves through a round only when the viewer presses Next or Back", () => {
    renderReplay();
    expect(screen.getByText("Fresh cups. Same suspicious friends.")).toBeInTheDocument();
    expect(screen.getByText("Table set").closest("li")).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("2 Chinas")).toBeInTheDocument();
    expect(screen.getByText("Bid 1").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Table set").closest("li")).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Fresh cups. Same suspicious friends.")).toBeInTheDocument();
  });

  it("keeps hindsight hands visible from setup through bid, call, count and result", () => {
    renderReplay();
    expect(screen.getByRole("complementary", { name: "Hindsight, cups open" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ana María retrospective hand: Aces, Chinas, Dones; public table dice: none")).toBeInTheDocument();
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
      expect(screen.getByRole("complementary", { name: "Hindsight, cups open" })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("uses the exact pre-action frame and reflects a table-dice reroll on the next step", () => {
    render(<OnlineRoundReplay story={story} open onClose={vi.fn()} initialPhase="ladder" nameOf={(id) => id === "ana" ? "Ana María" : "Min-chi Park"} />);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByLabelText("Min-chi Park retrospective hand: Chinas, Trenes; public table dice: none")).toBeInTheDocument();
    expect(screen.getByText("Acting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByLabelText("Min-chi Park retrospective hand: Dones; public table dice: Chinas")).toBeInTheDocument();
    expect(screen.getByText("On table")).toBeInTheDocument();
    expect(document.querySelectorAll(".round-replay-open-die .die--highlighted")).toHaveLength(3);
  });

  it("renders compact square-die wrappers without hiding the actual die element", () => {
    const { container } = renderReplay();
    const wrappers = container.querySelectorAll(".round-replay-open-die");
    expect(wrappers).toHaveLength(5);
    wrappers.forEach((wrapper) => expect(wrapper.querySelector(":scope > .die")).toBeInTheDocument());
  });

  it("uses singular die grammar in the result", () => {
    const oneDieStory = { ...story, diceChanges: [{ playerId: "min", delta: -1 }] };
    render(<OnlineRoundReplay story={oneDieStory} open onClose={vi.fn()} initialPhase="result" nameOf={() => "Min-chi Park"} />);
    expect(screen.getByText("-1 die")).toBeInTheDocument();
  });

  it("closes with Escape", () => {
    const { onClose } = renderReplay();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("withholds a covered bidder from narration, stage copy, colour and ladder title", () => {
    const coveredStory = { ...story, bids: [{ ...story.bids[0], attributable: false }, story.bids[1]] };
    render(<OnlineRoundReplay story={coveredStory} open onClose={vi.fn()} nameOf={(id) => id === "ana" ? "Covered Human" : "Named Bidder"} colorOf={() => "#ff0000"} />);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("A covered bid")).toBeInTheDocument();
    expect(screen.getByText("A covered bid: 2 Chinas.")).toBeInTheDocument();
    expect(document.querySelector(".round-replay-story")).not.toHaveTextContent("Covered Human");
    expect(document.querySelector(".round-replay-live")).not.toHaveTextContent("Covered Human");
    expect(screen.getByTitle("A covered bid: 2 Chinas")).toHaveStyle("--replay-player-color: #809c90");
  });

  it("uses a generic call while retaining an attributable final bidder", () => {
    const coveredCallStory = { ...story, callerAttributable: false };
    render(<OnlineRoundReplay story={coveredCallStory} open onClose={vi.fn()} initialPhase="call" nameOf={(id) => id === "ana" ? "Covered Caller" : "Named Bidder"} />);
    expect(screen.getByText("A Dudo followed Named Bidder’s final bid.")).toBeInTheDocument();
    expect(screen.getByText("A Dudo followed.")).toBeInTheDocument();
    expect(document.querySelector(".round-replay-story")).not.toHaveTextContent("Covered Caller");
    expect(document.querySelector(".round-replay-live")).not.toHaveTextContent("Covered Caller");
  });

  it("names neither side when both final bid and call are covered", () => {
    const fullyCovered = { ...story, bids: [story.bids[0], { ...story.bids[1], attributable: false }], callerAttributable: false };
    render(<OnlineRoundReplay story={fullyCovered} open onClose={vi.fn()} initialPhase="call" nameOf={(id) => id === "ana" ? "Covered Caller" : "Covered Bidder"} />);
    expect(screen.getByText("A Dudo followed the final bid.")).toBeInTheDocument();
    expect(document.querySelector(".round-replay-story")).not.toHaveTextContent("Covered Caller");
    expect(document.querySelector(".round-replay-story")).not.toHaveTextContent("Covered Bidder");
  });

  it("keeps an attributable caller while withholding a covered final bidder", () => {
    const coveredFinalBid = { ...story, bids: [story.bids[0], { ...story.bids[1], attributable: false }] };
    render(<OnlineRoundReplay story={coveredFinalBid} open onClose={vi.fn()} initialPhase="call" nameOf={(id) => id === "ana" ? "Named Caller" : "Covered Bidder"} />);
    expect(screen.getByText("Named Caller challenged the final bid.")).toBeInTheDocument();
    expect(document.querySelector(".round-replay-story")).not.toHaveTextContent("Covered Bidder");
  });

  it("degrades safely when a legacy story retained neither setup counts nor hands", () => {
    const legacyStory = { ...story, bids: story.bids.map(({ playerId, quantity, denomination, tableDice }) => ({ playerId, quantity, denomination, ...(tableDice ? { tableDice } : {}) })) } as unknown as MatchAnalysisRoundStory;
    delete (legacyStory as unknown as { startingDice?: unknown }).startingDice;
    delete (legacyStory as unknown as { revealedHands?: unknown }).revealedHands;
    delete (legacyStory as unknown as { replayFrames?: unknown }).replayFrames;
    delete (legacyStory as unknown as { callerAttributable?: unknown }).callerAttributable;
    const first = render(<OnlineRoundReplay story={legacyStory} open onClose={vi.fn()} />);
    expect(screen.getByText("Not retained")).toBeInTheDocument();
    first.unmount();
    const second = render(<OnlineRoundReplay story={legacyStory} open onClose={vi.fn()} initialPhase="ladder" nameOf={() => "Legacy Human"} />);
    expect(screen.getByText("A covered bid")).toBeInTheDocument();
    expect(screen.queryByText("Legacy Human")).not.toBeInTheDocument();
    second.unmount();
    render(<OnlineRoundReplay story={legacyStory} open onClose={vi.fn()} initialPhase="reveal" />);
    expect(screen.getByText(/open-dice history was not retained/i)).toBeInTheDocument();
  });
});
