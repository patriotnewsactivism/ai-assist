import { useState } from "react";
import "../styles/DebateResult.css";

interface RouterOutput {
  mode: "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
  confidence_score: number;
  extracted_goal: string;
}

interface Iteration {
  iteration: number;
  auditorFeedback: string;
  creatorOutput: string;
  isPerfect: boolean;
}

interface Props {
  routing: RouterOutput | null;
  iterations: Iteration[];
  finalOutput: string;
  onReset: () => void;
}

const modeEmoji: Record<string, string> = {
  CODE_MODE: "💻",
  RESEARCH_MODE: "🔍",
  DATA_MODE: "📊",
};

export default function DebateResult({ routing, iterations, finalOutput, onReset }: Props) {
  const [showSummary, setShowSummary] = useState(true);
  const perfectIteration = iterations.find((i) => i.isPerfect);

  const handleCopy = () => {
    navigator.clipboard.writeText(finalOutput);
  };

  return (
    <div className="debate-result">
      <div className="result-header">
        <h2>✨ Debate Complete</h2>
        <div className="result-stats">
          <div className="stat">
            <span className="stat-label">Iterations:</span>
            <span className="stat-value">{iterations.length}</span>
          </div>
          {perfectIteration && (
            <div className="stat perfect">
              <span className="stat-label">Status:</span>
              <span className="stat-value">✅ PERFECT (Iteration {perfectIteration.iteration})</span>
            </div>
          )}
          {routing && (
            <div className="stat">
              <span className="stat-label">Mode:</span>
              <span className="stat-value">
                {modeEmoji[routing.mode]} {routing.mode.replace("_", " ")}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="result-tabs">
        <button
          className={`tab ${showSummary ? "active" : ""}`}
          onClick={() => setShowSummary(true)}
        >
          Final Output
        </button>
        <button
          className={`tab ${!showSummary ? "active" : ""}`}
          onClick={() => setShowSummary(false)}
        >
          Full Debate History
        </button>
      </div>

      {showSummary ? (
        <div className="final-output-container">
          <div className="output-actions">
            <button onClick={handleCopy} className="copy-btn">
              📋 Copy Output
            </button>
          </div>
          <pre className="final-output">{finalOutput}</pre>
        </div>
      ) : (
        <div className="debate-history">
          {iterations.map((iter) => (
            <div key={iter.iteration} className="history-item">
              <div className="history-header">
                <h3>Iteration {iter.iteration}</h3>
                {iter.isPerfect && <span className="perfect-badge">✅ PERFECT</span>}
              </div>

              <div className="history-section">
                <h4>🤖 Auditor Critique:</h4>
                <pre>{iter.auditorFeedback}</pre>
              </div>

              <div className="history-section">
                <h4>🛠️ Creator Output:</h4>
                <pre>{iter.creatorOutput}</pre>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="result-actions">
        <button onClick={onReset} className="reset-btn">
          🔄 Start New Debate
        </button>
      </div>
    </div>
  );
}
