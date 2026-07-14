type DieProps = {
  value: number;
  hidden?: boolean;
  small?: boolean;
  highlighted?: boolean;
};

const pipPositions: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({ value, hidden = false, small = false, highlighted = false }: DieProps) {
  const pips = hidden ? [] : (pipPositions[value] ?? []);
  return (
    <span
      className={`die${small ? " die--small" : ""}${hidden ? " die--hidden" : ""}${highlighted ? " die--highlighted" : ""}`}
      role="img"
      aria-label={hidden ? "Hidden die" : `Die showing ${value}`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span className={pips.includes(index) ? "pip" : "pip pip--empty"} key={index} />
      ))}
    </span>
  );
}

export function DiceRow({ dice, hidden = false, small = false, className = "", onDieClick, highlight }: { dice: number[]; hidden?: boolean; small?: boolean; className?: string; onDieClick?: (value: number) => void; highlight?: (value: number) => boolean }) {
  return (
    <div className={`dice-row ${className}`.trim()}>
      {dice.map((value, index) => onDieClick ? <button className="die-button" type="button" key={`${value}-${index}`} onClick={() => onDieClick(value)}><Die value={value} hidden={hidden} small={small} highlighted={highlight?.(value)} /></button> : <Die key={`${value}-${index}`} value={value} hidden={hidden} small={small} highlighted={highlight?.(value)} />)}
    </div>
  );
}
