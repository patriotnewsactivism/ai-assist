import "../styles/DebateProgress.css";

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
}

const modeEmoji: Record<string, string> = {
  CODE_MODE: "💻",
  RESEARCH_MODE: "🔍",
  DATA_MODE: "📊",
};

export default function DebateProgress({ routing, iterations }: Props) {
  return (
    <div className="debate-progress">
      {routing && (
        <div className="routing-info">
          <h2>🧠 Router Classification</h2>
          <div className="routing-grid">
            <div className="routing-item">
              <span className="label">Mode:</span>
              <span className="value">
                {modeEmoji[routing.mode]} {routing.mode.replace("_", " ")}
              </span>
            </div>
            <div className="routing-item">
              <span className="label">Confidence:</span>
              <span className="value">{routing.confidence_score}%</span>
            </div>
            <div className="routing-item full-width">
              <span className="label">Extracted Goal:</span>
              <span className="value">{routing.extracted_goal}</span>
            </div>
          </div>
        </div>
      )}

      <div className="iterations">
        <h2>⚔️ Debate Iterations</h2>
        {iterations.length === 0 ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Starting debate...</p>
          </div>
        ) : (
          <div className="iterations-list">
            {iterations.map((iter) => (
              <div
                key={iter.iteration}
                className={`iteration ${iter.isPerfect ? "perfect" : ""}`}
              >
                <div className="iteration-header">
                  <h3>Iteration {iter.iteration}</h3>
                  {iter.isPerfect && <span className="perfect-badge">✅ PERFECT</span>}
                </div>

                <div className="debate-panels">
                  <div className="panel auditor-panel">
                    <h4>🤖 Auditor Critique</h4>
                    <pre className="panel-content">{iter.auditorFeedback}</pre>
                  </div>

                  <div className="panel creator-panel">
                    <h4>🛠️ Creator Output</h4>
                    <pre className="panel-content">{iter.creatorOutput}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
