import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { release } from "../release";
import { SetupScreen } from "./SetupScreen";

afterEach(() => cleanup());

describe("SetupScreen landing page", () => {
  it("presents the online game clearly and opens it from the primary action", () => {
    const onOpenOnline = vi.fn();
    const { container } = render(<SetupScreen onStart={vi.fn()} onOpenOnline={onOpenOnline} />);

    expect(screen.getByRole("heading", { name: "Cachito" })).toBeInTheDocument();
    expect(screen.getByText("Hidden dice. Open tells.")).toBeInTheDocument();
    expect(screen.getByText("2–8")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(release)).toBeInTheDocument();
    expect(container.querySelectorAll(".landing-seat")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Play online" }));
    expect(onOpenOnline).toHaveBeenCalledOnce();
  });

  it("keeps a useful status message when online rooms are unavailable", () => {
    render(<SetupScreen onStart={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Play online" })).not.toBeInTheDocument();
    expect(screen.getByText("Rooms are being set up.")).toBeInTheDocument();
  });
});
