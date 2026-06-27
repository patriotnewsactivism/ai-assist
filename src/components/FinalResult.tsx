import { useState } from "react";
import JudgeCard from "./JudgeCard";
import AgentCard from "./AgentCard";
import type { AppState } from "../App";

interface Props {
  state: AppState;
  onReset: () => void;
}

export default function FinalResult({ state, onReset }: Props) {
  const [tab, setTab] = useState<"output" | "rounds">("output");
  const [copied, setCopied] = useState(false);
  const lastRound = state.rounds[state.rounds.length - 1];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.finalOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const topScore = Math.max(...state.rounds.map((r) => r.verdict.score));

  return (
    <div className="final-result">
      <div className="result-hero">
        <h2>✨ Think Tank Complete</h2>
        <div className="result-stats-row">
          <div className="result-stat">
            <span className="stat-n">{state.totalRounds}</span>
            <span className="stat-l">rounds</span>
          </div>
          <div className="result-stat">
            <span className="stat-n">{state.turns.length}</span>
            <span className="stat-l">agent turns</span>
          </div>
          <div className="result-stat">
            <span className="stat-n" style={{ color: topScore >= 88 ? "#10b981" : "#f59e0b" }}>
              {topScore}
            </span>
            <span className="stat-l">peak score</span>
          </div>
          {lastRound?.verdict.approved && (
            <div className="result-stat approved-badge">
              <span>✅ APPROVED</span>
            </div>
          )}
        </div>

        {state.routing && (
          <div className="result-goal">
            <strong>Goal:</strong> {state.routing.extracted_goal}
          </div>
        )}
      </div>

      <div className="result-tabs">
        <button
          className={`result-tab ${tab === "output" ? "active" : ""}`}
          onClick={() => setTab("output")}
        >
          Final Output
        </button>
        <button
          className={`result-tab ${tab === "rounds" ? "active" : ""}`}
          onClick={() => setTab("rounds")}
        >
          Full Debate ({state.rounds.length} rounds)
        </button>
      </div>

      {tab === "output" && (
        <div className="output-section">
          <div className="output-toolbar">
            <button className="btn-secondary" onClick={handleCopy}>
              {copied ? "✓ Copied!" : "📋 Copy"}
            </button>
          </div>
          <pre className="final-output-text">{state.finalOutput}</pre>
        </div>
      )}

      {tab === "rounds" && (
        <div className="rounds-history">
          {state.rounds.map((round) => (
            <div key={round.round} className="history-round">
              <div className="history-round-header">
                <h3>Round {round.round}</h3>
                <span
                  className="history-score"
                  style={{ color: round.verdict.score >= 88 ? "#10b981" : "#f59e0b" }}
                >
                  Score: {round.verdict.score}/100
                </span>
              </div>

              {round.agents.map((turn) => (
                <AgentCard key={`${round.round}-${turn.role}`} turn={turn} />
              ))}

              <JudgeCard verdict={round.verdict} round={round.round} />
            </div>
          ))}
        </div>
      )}

      <div className="result-actions">
        <button className="btn-primary" onClick={onReset}>
          🔄 New Session
        </button>
      </div>
    </div>
  );
}
