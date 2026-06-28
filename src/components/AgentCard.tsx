import { useState } from "react";
import type { AgentTurn } from "../types";
import { ROLE_COLORS } from "../types";

interface Props {
  turn: AgentTurn;
}

export default function AgentCard({ turn }: Props) {
  const [showSources, setShowSources]     = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showMemory, setShowMemory]       = useState(false);
  const color = ROLE_COLORS[turn.role];
  const isSteelman = turn.role === "steelman";

  return (
    <div
      className="agent-card"
      style={{
        borderLeftColor: color,
        // Steelman gets a subtle purple glow to stand out from the red Adversary
        ...(isSteelman ? {
          background: "rgba(99,102,241,0.06)",
          boxShadow: "0 0 0 1px rgba(99,102,241,0.2), 0 2px 12px rgba(99,102,241,0.1)",
        } : {}),
      }}
    >
      <div className="ac-header">
        <div className="ac-identity">
          <div
            className="ac-avatar"
            style={{
              borderColor: color,
              background: `${color}18`,
              // Shield gets a stronger glow ring
              ...(isSteelman ? { boxShadow: `0 0 8px ${color}50` } : {}),
            }}
          >
            {turn.emoji}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="ac-name" style={{ color }}>{turn.name}</span>
              {isSteelman && (
                <span style={{
                  fontSize: ".65rem", fontWeight: 700, letterSpacing: ".06em",
                  padding: "1px 6px", borderRadius: 4,
                  background: "rgba(99,102,241,0.2)", color: "#a5b4fc",
                  textTransform: "uppercase",
                }}>
                  DEFENSE
                </span>
              )}
            </div>
            <span className="ac-model">{turn.provider} / {turn.modelId} · Round {turn.round}</span>
          </div>
        </div>

        <div className="ac-badges">
          {turn.memory && turn.memory.keyInsights.length > 0 && (
            <button
              className="ac-badge"
              style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}
              onClick={() => setShowMemory(!showMemory)}
            >
              🧩 memory
            </button>
          )}
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

      {showMemory && turn.memory && (
        <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <div className="ac-section-label" style={{ color: "#a5b4fc", marginBottom: 6 }}>Extracted Memory</div>
          {turn.memory.keyInsights.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: ".72rem", color: "var(--text3)", marginBottom: 3 }}>KEY INSIGHTS</div>
              {turn.memory.keyInsights.map((ins, i) => (
                <div key={i} style={{ fontSize: ".8rem", color: "var(--text2)", paddingLeft: 8, borderLeft: "2px solid rgba(99,102,241,0.4)", marginBottom: 3 }}>
                  {ins}
                </div>
              ))}
            </div>
          )}
          {turn.memory.openQuestions.length > 0 && (
            <div>
              <div style={{ fontSize: ".72rem", color: "var(--text3)", marginBottom: 3 }}>OPEN QUESTIONS</div>
              {turn.memory.openQuestions.map((q, i) => (
                <div key={i} style={{ fontSize: ".8rem", color: "#fbbf24", paddingLeft: 8, borderLeft: "2px solid rgba(251,191,36,0.4)", marginBottom: 3 }}>
                  {q}
                </div>
              ))}
            </div>
          )}
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
