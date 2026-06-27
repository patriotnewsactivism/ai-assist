import { useEffect, useRef } from "react";
import AgentCard from "./AgentCard";
import JudgeCard from "./JudgeCard";
import type { AppState, ThinkingAgent } from "../App";
import type { AgentRole } from "../types";
import { ROLE_COLORS } from "../types";

interface Props {
  state: AppState;
}

const MODE_LABELS: Record<string, string> = {
  CODE_MODE: "💻 CODE",
  RESEARCH_MODE: "🔍 RESEARCH",
  DATA_MODE: "📊 DATA",
};

function ThinkingCard({ agent }: { agent: ThinkingAgent }) {
  const color = ROLE_COLORS[agent.role as AgentRole];
  return (
    <div className="agent-card thinking-card" style={{ borderLeftColor: color }}>
      <div className="agent-card-header">
        <div className="agent-identity">
          <span className="agent-card-emoji">{agent.emoji}</span>
          <div>
            <span className="agent-card-name" style={{ color }}>{agent.name}</span>
            <span className="agent-card-model">Round {agent.round}</span>
          </div>
        </div>
      </div>
      <div className="thinking-indicator">
        <span className="dot-pulse"></span>
        <span className="dot-pulse"></span>
        <span className="dot-pulse"></span>
        <span className="thinking-label">thinking...</span>
      </div>
    </div>
  );
}

export default function LiveDebate({ state }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.turns.length, state.thinking]);

  const completedRoundNumbers = state.rounds.map((r) => r.round);

  return (
    <div className="live-debate">
      {state.routing && (
        <div className="routing-banner">
          <div className="routing-pill">
            {MODE_LABELS[state.routing.mode] ?? state.routing.mode}
          </div>
          <div className="routing-confidence">
            {state.routing.confidence_score}% confidence
          </div>
          <div className="routing-goal">
            {state.routing.extracted_goal}
          </div>
          <div className="routing-domain">
            Domain: {state.routing.suggested_domain}
          </div>
        </div>
      )}

      {!state.routing && (
        <div className="routing-banner routing-loading">
          <div className="dot-pulse"></div>
          <div className="dot-pulse"></div>
          <div className="dot-pulse"></div>
          <span>Classifying input...</span>
        </div>
      )}

      <div className="debate-feed">
        {state.turns.map((turn, i) => {
          const isNewRound =
            i === 0 || state.turns[i - 1]?.round !== turn.round;

          return (
            <div key={`${turn.round}-${turn.role}`}>
              {isNewRound && (
                <div className="round-divider">
                  <span>Round {turn.round}</span>
                </div>
              )}
              <AgentCard turn={turn} />

              {/* Insert judge card after judge turn */}
              {turn.role === "judge" &&
                completedRoundNumbers.includes(turn.round) && (() => {
                  const roundData = state.rounds.find((r) => r.round === turn.round);
                  if (!roundData) return null;
                  return (
                    <JudgeCard
                      key={`verdict-${turn.round}`}
                      verdict={roundData.verdict}
                      round={turn.round}
                    />
                  );
                })()}
            </div>
          );
        })}

        {state.thinking && <ThinkingCard agent={state.thinking} />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
