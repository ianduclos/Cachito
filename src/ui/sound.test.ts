import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static created: FakeAudio[] = [];
  readonly src: string;
  preload = "";
  loop = false;
  paused = true;
  ended = false;
  duration = 0.4;
  currentTime = 0;
  volume = 1;
  load = vi.fn();
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
  addEventListener = vi.fn();

  constructor(src = "") {
    this.src = src;
    FakeAudio.created.push(this);
  }
}

describe("sound playback preparation", () => {
  beforeEach(() => {
    FakeAudio.created = [];
    vi.resetModules();
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("preloads one warm voice per clip and reuses it for immediate playback", async () => {
    const { playSound, preloadSounds } = await import("./sound");
    preloadSounds();

    const primedCount = FakeAudio.created.length;
    expect(primedCount).toBe(16);
    expect(FakeAudio.created.every((audio) => audio.preload === "auto" && audio.load.mock.calls.length === 1)).toBe(true);

    const suspense = playSound("suspense") as unknown as FakeAudio;
    expect(FakeAudio.created).toHaveLength(primedCount);
    expect(suspense.src).toBe("/sounds/suspense.wav");
    expect(suspense.currentTime).toBe(0);
    expect(suspense.play).toHaveBeenCalledOnce();
  });
});
