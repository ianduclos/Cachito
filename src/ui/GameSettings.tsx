import { useEffect, useId, useRef, useState } from "react";
import { getSoundLevels, setSoundLevels, type SoundLevels } from "./sound";

export function GameSettings({ reducedMotion, onReducedMotion }: { reducedMotion?: boolean; onReducedMotion?: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [levels, setLevels] = useState<SoundLevels>(getSoundLevels);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>("input")?.focus();
    const close = (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) buttonRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const change = (key: keyof SoundLevels, value: number) => {
    const next = { ...levels, [key]: value };
    setLevels(next);
    setSoundLevels(next);
  };
  return <div className="settings-control"><button ref={buttonRef} className="settings-button" aria-expanded={open} aria-controls={open ? popoverId : undefined} aria-haspopup="dialog" aria-label="Game settings" onClick={() => setOpen((value) => !value)}>⚙</button>{open && <div ref={popoverRef} id={popoverId} className="settings-popover" role="dialog" aria-label="Game settings"><strong>Settings</strong>{onReducedMotion && <label><input type="checkbox" checked={reducedMotion} onChange={(event) => onReducedMotion(event.target.checked)} /> Reduce motion</label>}<label className="sound-slider">Sound FX <input type="range" min="0" max="1" step="0.05" value={levels.effects} onChange={(event) => change("effects", Number(event.target.value))} /><output>{Math.round(levels.effects * 100)}%</output></label><label className="sound-slider">Music <input type="range" min="0" max="1" step="0.05" value={levels.music} onChange={(event) => change("music", Number(event.target.value))} /><output>{Math.round(levels.music * 100)}%</output></label></div>}</div>;
}
