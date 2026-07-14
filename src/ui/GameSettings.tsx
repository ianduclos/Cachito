import { useState } from "react";
import { getSoundLevels, setSoundLevels, type SoundLevels } from "./sound";

export function GameSettings({ reducedMotion, onReducedMotion }: { reducedMotion?: boolean; onReducedMotion?: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [levels, setLevels] = useState<SoundLevels>(getSoundLevels);
  const change = (key: keyof SoundLevels, value: number) => {
    const next = { ...levels, [key]: value };
    setLevels(next);
    setSoundLevels(next);
  };
  return <div className="settings-control"><button className="settings-button" aria-expanded={open} aria-label="Game settings" onClick={() => setOpen((value) => !value)}>⚙</button>{open && <div className="settings-popover"><strong>Settings</strong>{onReducedMotion && <label><input type="checkbox" checked={reducedMotion} onChange={(event) => onReducedMotion(event.target.checked)} /> Reduce motion</label>}<label className="sound-slider">Sound FX <input type="range" min="0" max="1" step="0.05" value={levels.effects} onChange={(event) => change("effects", Number(event.target.value))} /><output>{Math.round(levels.effects * 100)}%</output></label><label className="sound-slider">Music <input type="range" min="0" max="1" step="0.05" value={levels.music} onChange={(event) => change("music", Number(event.target.value))} /><output>{Math.round(levels.music * 100)}%</output></label></div>}</div>;
}
