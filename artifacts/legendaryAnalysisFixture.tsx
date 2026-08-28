import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { buildMatchAnalysis, type MatchAnalysisAction, type MatchAnalysisResolution, type MatchAnalysisRound } from "../src/analysis";
import type { BotDecisionRecord } from "../src/analytics";
import type { GameOverState } from "../src/engine";
import { GameSummary } from "../src/online/OnlineGameAnalysis";
import "../src/styles.css";
import "../src/ui/TablePrototype.css";
import "../src/online/OnlineTable.css";

type CompletedLog = {
  actions: MatchAnalysisAction[];
  botDecisions: BotDecisionRecord[];
  history: string[];
  roundDeals: MatchAnalysisRound[];
  roundResolutions: MatchAnalysisResolution[];
  rules: GameOverState["rules"];
  seats: Array<{ id: string; name: string; controller: "human" | "bot"; personaLabel?: string }>;
  state: GameOverState;
  updatedAt: string;
};

const response = await fetch("/@fs/Users/ianduclos/Desktop/Cachito-Legendary-Match-2026-08-10-6UYEX.json");
if (!response.ok) throw new Error(`Unable to load match log (${response.status})`);
const match = await response.json() as CompletedLog;
const analysis = buildMatchAnalysis({
  rules: match.rules,
  seats: match.seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    controller: seat.controller,
    ...(seat.personaLabel ? { persona: seat.personaLabel } : {}),
  })),
  actions: match.actions,
  roundDeals: match.roundDeals,
  roundResolutions: match.roundResolutions,
  botDecisions: match.botDecisions,
  finalState: match.state,
}, match.updatedAt);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="table-prototype-shell online-live-table online-live-table--game-over">
      <section className="tp-stage" aria-label="Completed legendary match">
        <GameSummary
          view={match.state}
          analysis={analysis}
          history={match.history}
          connected
          canReturnToLobby={false}
          onReturnToLobby={() => undefined}
          onExit={() => undefined}
        />
      </section>
    </main>
  </StrictMode>,
);
