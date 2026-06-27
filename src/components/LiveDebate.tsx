import { useEffect, useRef } from "react";
import AgentCard from "./AgentCard";
import JudgeCard from "./JudgeCard";
import type { AppState, ThinkingAgent } from "../App";
import type { AgentRole } from "../types";
import { ROLE_COLORS, ROLE_ORDER } from "../types";

interface Props {
  state: AppState;
}

const AGENT_NAMES: Record<AgentRole, string> = {
  researcher:  "Scout",
  adversary:   "Adversary",
  expert:      "Expert",
  synthesizer: "Synth",
  judge:       "Judge",
};

const AGENT_EMOJIS: Record<AgentRole, string> = {
  researcher:  "🔍",
  adversary:   "😈",
  expert:      "🎓",
  synthesizer: "🧠",
  judge:       "⚖️",
};

const MODE_LABELS: Record<string, string> = {
  CODE_MODE:     "💻 CODE",
  RESEARCH_MODE: "🔍 RESEARCH",
  DATA_MODE:     "📊 DATA",
};

function getAgentStatus(
  role: AgentRole,
  thinking: ThinkingAgent | null,
  completedRoles: AgentRole[]
): "pending" | "active" | "complete" {
  if (thinking?.role === role) return "active";
  if (completedRoles.includes(role)) return "complete";
  return "pending";
}

export default function LiveDebate({ state }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const currentRound = state.thinking?.round ?? (state.turns[state.turns.length - 1]?.round ?? 1);
  const completedRoles = state.turns.filter((t) => t.round === currentRound).map((t) => t.role);
  const latestScore = state.rounds[state.rounds.length - 1]?.verdict.score;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.turns.length, state.thinking]);

  return (
    <div className="live-debate">
      {/* Sticky pipeline strip */}
      <div className="progress-strip">
        <div className="progress-round-badge">Round {currentRound}</div>
        <div className="pipeline">
          {ROLE_ORDER.map((role, i) => {
            const status = getAgentStatus(role, state.thinking, completedRoles);
            return (
              <>
                {i > 0 && <div key={`arr-${role}`} className="pipeline-arrow">›</div>}
                <div key={role} className="pipeline-agent">
                  <div className={`pipeline-icon ${status}`} style={status === "active" ? { borderColor: ROLE_COLORS[role] } : {}}>
                    {status === "complete" ? "✓" : AGENT_EMOJIS[role]}
                  </div>
                  <div className={`pipeline-label ${status}`}>{AGENT_NAMES[role]}</div>
                </div>
              </>
            );
          })}
        </div>
        {latestScore !== undefined && (
          <div className="progress-score">
            Last: <span>{latestScore}</span>/100
          </div>
        )}
        {state.thinking && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className="dots">
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
            </div>
          </div>
        )}
      </div>

      {/* Routing banner */}
      {state.routing && (
        <div className="routing-banner anim-fade-up">
          <div className={`mode-badge mode-${state.routing.mode}`}>
            {MODE_LABELS[state.routing.mode] ?? state.routing.mode}
          </div>
          <div className="routing-conf">{state.routing.confidence_score}%</div>
          <div className="routing-goal">{state.routing.extracted_goal}</div>
          <div className="routing-domain">domain: {state.routing.suggested_domain}</div>
        </div>
      )}

      {!state.routing && (
        <div className="routing-banner" style={{ justifyContent: "center", color: "var(--text3)", gap: 10 }}>
          <div className="dots"><div className="dot" /><div className="dot" /><div className="dot" /></div>
          Classifying your input...
        </div>
      )}

      {/* Agent feed */}
      <div className="debate-feed">
        {state.turns.map((turn, i) => {
          const isFirstOfRound = i === 0 || state.turns[i - 1]?.round !== turn.round;
          const roundData = turn.role === "judge"
            ? state.rounds.find((r) => r.round === turn.round)
            : null;

          return (
            <div key={`${turn.round}-${turn.role}`}>
              {isFirstOfRound && (
                <div className="round-label">Round {turn.round}</div>
              )}
              <AgentCard turn={turn} />
              {roundData && (
                <JudgeCard verdict={roundData.verdict} round={turn.round} />
              )}
            </div>
          );
        })}

        {/* Thinking placeholder */}
        {state.thinking && (
          <div
            className="agent-card"
            style={{ borderLeftColor: ROLE_COLORS[state.thinking.role], opacity: .7 }}
          >
            <div className="ac-header">
              <div className="ac-identity">
                <div
                  className="ac-avatar"
                  style={{
                    borderColor: ROLE_COLORS[state.thinking.role],
                    background: `${ROLE_COLORS[state.thinking.role]}18`,
                  }}
                >
                  {state.thinking.emoji}
                </div>
                <div>
                  <span className="ac-name" style={{ color: ROLE_COLORS[state.thinking.role] }}>
                    {state.thinking.name}
                  </span>
                  <span className="ac-model">Round {state.thinking.round}</span>
                </div>
              </div>
            </div>
            <div className="ac-thinking">
              <div className="dots"><div className="dot" /><div className="dot" /><div className="dot" /></div>
              <span>Thinking deeply...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
