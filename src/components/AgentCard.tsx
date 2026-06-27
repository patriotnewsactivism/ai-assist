import { useState } from "react";
import type { AgentTurn } from "../types";
import { ROLE_COLORS } from "../types";

interface Props {
  turn: AgentTurn;
}

export default function AgentCard({ turn }: Props) {
  const [showSources, setShowSources]     = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const color = ROLE_COLORS[turn.role];

  return (
    <div className="agent-card" style={{ borderLeftColor: color }}>
      <div className="ac-header">
        <div className="ac-identity">
          <div className="ac-avatar" style={{ borderColor: color, background: `${color}18` }}>
            {turn.emoji}
          </div>
          <div>
            <span className="ac-name" style={{ color }}>{turn.name}</span>
            <span className="ac-model">{turn.provider} / {turn.modelId} · Round {turn.round}</span>
          </div>
        </div>

        <div className="ac-badges">
          {turn.searchResults && turn.searchResults.length > 0 && (
            <button
              className="ac-badge ac-badge-cyan"
              onClick={() => setShowSources(!showSources)}
            >
              🔗 {turn.searchResults.length} source{turn.searchResults.length !== 1 ? "s" : ""}
            </button>
          )}
          {turn.reasoning && (
            <button
              className="ac-badge ac-badge-purple"
              onClick={() => setShowReasoning(!showReasoning)}
            >
              🧠 reasoning
            </button>
          )}
        </div>
      </div>

      {showReasoning && turn.reasoning && (
        <div style={{ marginBottom: 10 }}>
          <div className="ac-section-label">Chain of Thought</div>
          <div className="ac-reasoning">{turn.reasoning}</div>
        </div>
      )}

      <pre className="ac-output">{turn.output}</pre>

      {showSources && turn.searchResults && turn.searchResults.length > 0 && (
        <div className="ac-sources">
          <div className="ac-section-label" style={{ marginTop: 10 }}>Web Sources</div>
          {turn.searchResults.map((s, i) => (
            <div key={i} className="source-item">
              <a href={s.url} target="_blank" rel="noreferrer" className="source-title">
                {s.title || s.url}
              </a>
              <p className="source-snippet">{s.content.slice(0, 220)}…</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
