import { useState } from "react";
import { release } from "../release";
import { GameSettings } from "./GameSettings";

type Props = {
  onStart: (seats: LocalSeatSetup[]) => void;
  onOpenOnline?: () => void;
};

export type LocalSeatSetup = { name: string; isBot: boolean };
const makeHumanSeat = (number: number): LocalSeatSetup => ({ name: `Player ${number}`, isBot: false });

export function SetupScreen({ onStart, onOpenOnline }: Props) {
  const [screen, setScreen] = useState<"home" | "local">("home");
  const [seats, setSeats] = useState<LocalSeatSetup[]>([makeHumanSeat(1), makeHumanSeat(2), makeHumanSeat(3)]);
  const valid = seats.every((seat) => seat.name.trim().length > 0) && new Set(seats.map((seat) => seat.name.trim().toLocaleLowerCase())).size === seats.length;
  const updateSeat = (index: number, update: Partial<LocalSeatSetup>) => setSeats((current) => current.map((seat, i) => i === index ? { ...seat, ...update } : seat));

  if (screen === "home") return (
    <main className="setup-shell">
      <section className="setup-card start-card">
        <GameSettings />
        <div className="brand-mark" aria-hidden="true"><span>●</span><span>●</span></div>
        <h1>Cachito</h1>
        {onOpenOnline ? <button className="button button--primary start-online-button" type="button" onClick={onOpenOnline}>Play online</button> : <p className="rules-note">Rooms are being set up.</p>}
        <span className="release-stamp">{release}</span>
      </section>
    </main>
  );

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <GameSettings />
        <button className="button button--ghost back-button" type="button" onClick={() => setScreen("home")}>← Back</button>
        <h1>Local game</h1>
        <p className="intro">Set up the people and bots sharing this device.</p>
        <div className="setup-heading"><div><h2>Players</h2><p>Add 2–6 players.</p></div><span className="player-count">{seats.length}/6</span></div>
        <div className="name-list">
          {seats.map((seat, index) => <div className="name-field" key={index}>
            <span className="seat-number">{index + 1}</span>
            <label className="sr-only" htmlFor={`player-${index}`}>Player {index + 1} name</label>
            <input id={`player-${index}`} value={seat.name} maxLength={24} onChange={(event) => updateSeat(index, { name: event.target.value })} />
            <div className="seat-type-toggle" role="group" aria-label={`${seat.name || `Player ${index + 1}`} controller`}>
              <button type="button" aria-pressed={!seat.isBot} onClick={() => updateSeat(index, { isBot: false })}>Human</button>
              <button type="button" aria-pressed={seat.isBot} onClick={() => updateSeat(index, { isBot: true })}>Bot</button>
            </div>
            <button className="icon-button" type="button" onClick={() => setSeats((current) => current.filter((_, i) => i !== index))} disabled={seats.length <= 2} aria-label={`Remove ${seat.name || `player ${index + 1}`}`}>×</button>
          </div>)}
        </div>
        {!valid && <p className="form-error" role="alert">Every player needs a unique name.</p>}
        <div className="setup-actions"><button className="button button--ghost" type="button" onClick={() => setSeats((current) => current.length < 6 ? [...current, makeHumanSeat(current.length + 1)] : current)} disabled={seats.length >= 6}>+ Add player</button><button className="button button--primary" type="button" disabled={!valid} onClick={() => onStart(seats.map((seat) => ({ ...seat, name: seat.name.trim() })))}>Start game</button></div>
      </section>
      <p className="setup-note">Pass the device only when the dice are covered.</p>
    </main>
  );
}
