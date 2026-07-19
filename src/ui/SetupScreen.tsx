import { useState } from "react";
import { MAX_PLAYERS, MIN_PLAYERS } from "../engine";
import { release } from "../release";
import { Die } from "./Dice";
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
    <main className="setup-shell landing-shell">
      <div className="landing-glow landing-glow--left" aria-hidden="true" />
      <div className="landing-glow landing-glow--right" aria-hidden="true" />
      <section className="landing-stage">
        <GameSettings />
        <div className="landing-copy">
          <div className="landing-brand"><div className="brand-mark" aria-hidden="true"><span>●</span><span>●</span></div></div>
          <h1>Cachito</h1>
          {onOpenOnline ? <button className="button button--primary landing-play-button" type="button" onClick={onOpenOnline}><span>Play online</span><i aria-hidden="true">→</i></button> : <p className="rules-note">Rooms are being set up.</p>}
          <ul className="landing-proof" aria-label="Game features"><li><strong>2–8</strong><span>players</span></li><li><strong>Private</strong><span>rooms</span></li><li><strong>Live</strong><span>spectating</span></li></ul>
        </div>
        <div className="landing-table-scene" aria-hidden="true">
          <div className="landing-table-rim">
            <div className="landing-seat landing-seat--top"><span>MP</span><div><strong>Min-chi Park</strong><small>5 dice</small></div></div>
            <div className="landing-seat landing-seat--left"><span>AN</span><div><strong>Ana</strong><small>5 dice</small></div></div>
            <div className="landing-seat landing-seat--right landing-seat--turn"><span>MA</span><div><strong>Mateo</strong><small>Thinking</small></div></div>
            <div className="landing-seat landing-seat--bottom"><span>YU</span><div><strong>Your seat</strong><small>5 dice</small></div></div>
            <div className="landing-table-center">
              <span>Mateo’s bid</span>
              <div className="landing-bid"><strong>4</strong><i>×</i><Die value={5} small /></div>
              <b>Chinas</b>
            </div>
            <div className="landing-dice-cluster"><Die value={5} /><Die value={1} /><Die value={3} /></div>
          </div>
        </div>
        <footer className="landing-footer"><span>A game of nerve, memory, and five hidden dice.</span><span className="release-stamp">{release}</span></footer>
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
        <div className="setup-heading"><div><h2>Players</h2><p>Add {MIN_PLAYERS}–{MAX_PLAYERS} players.</p></div><span className="player-count">{seats.length}/{MAX_PLAYERS}</span></div>
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
        <div className="setup-actions"><button className="button button--ghost" type="button" onClick={() => setSeats((current) => current.length < MAX_PLAYERS ? [...current, makeHumanSeat(current.length + 1)] : current)} disabled={seats.length >= MAX_PLAYERS}>+ Add player</button><button className="button button--primary" type="button" disabled={!valid} onClick={() => onStart(seats.map((seat) => ({ ...seat, name: seat.name.trim() })))}>Start game</button></div>
      </section>
      <p className="setup-note">Pass the device only when the dice are covered.</p>
    </main>
  );
}
