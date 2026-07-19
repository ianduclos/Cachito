import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameSettings } from "./GameSettings";

describe("GameSettings", () => {
  afterEach(cleanup);

  it("announces the popover and returns focus when Escape closes it", () => {
    render(<GameSettings />);
    const trigger = screen.getByRole("button", { name: "Game settings" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Game settings" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Game settings" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when focus moves to another part of the page", () => {
    render(<><GameSettings /><button>Elsewhere</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Game settings" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog", { name: "Game settings" })).not.toBeInTheDocument();
  });
});
