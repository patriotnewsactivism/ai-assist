import { useState } from "react";
import type { AgentTurn } from "../types";
import { ROLE_COLORS } from "../types";

interface Props {
  turn: AgentTurn;
  isThinking?: boolean;
}

export default function AgentCard({ turn, isThinking = false }: Props) {
  const [showSources, setShowSources] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const color = ROLE_COLORS[turn.role];

  return (
    <div className="agent-card" style={{ borderLeftColor: color }}>
      <div className="agent-card-header">
        <div className="agent-identity">
          <span className="agent-card-emoji">{turn.emoji}</span>
          <div>
            <span className="agent-card-name" style={{ color }}>{turn.name}</span>
            <span className="agent-card-model">{turn.provider} / {turn.modelId}</span>
          </div>
        </div>
        <div className="agent-card-badges">
          {turn.searchResults && turn.searchResults.length > 0 && (
            <button
              className="badge badge-blue"
              onClick={() => setShowSources(!showSources)}
            >
              🔗 {turn.searchResults.length} sources
            </button>
          )}
          {turn.reasoning && (
            <button
              className="badge badge-purple"
              onClick={() => setShowReasoning(!showReasoning)}
            >
              🧠 reasoning
            </button>
          )}
        </div>
      </div>

      {isThinking && (
        <div className="thinking-indicator">
          <span className="dot-pulse"></span>
          <span className="dot-pulse"></span>
          <span className="dot-pulse"></span>
          <span className="thinking-label">thinking...</span>
        </div>
      )}

      {!isThinking && (
        <>
          {showReasoning && turn.reasoning && (
            <div className="reasoning-block">
              <div className="block-label">Chain of Thought</div>
              <pre className="output-text reasoning-text">{turn.reasoning}</pre>
            </div>
          )}

          <pre className="output-text">{turn.output}</pre>

          {showSources && turn.searchResults && (
            <div className="sources-list">
              <div className="block-label">Sources</div>
              {turn.searchResults.map((s, i) => (
                <div key={i} className="source-item">
                  <a href={s.url} target="_blank" rel="noreferrer" className="source-title">
                    {s.title || s.url}
                  </a>
                  <p className="source-snippet">{s.content.slice(0, 200)}…</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
