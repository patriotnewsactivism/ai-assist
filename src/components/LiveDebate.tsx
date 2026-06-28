import { useEffect, useRef, useState } from "react";
import AgentCard from "./AgentCard";
import JudgeCard from "./JudgeCard";
import type { AppState, ThinkingAgent } from "../App";
import type { AgentRole, SandboxResultEvent } from "../types";
import { ROLE_COLORS, ROLE_ORDER } from "../types";

interface Props {
  state: AppState;
}

const AGENT_NAMES: Record<AgentRole, string> = {
  researcher:  "Scout",
  steelman:    "Steelman",
  adversary:   "Adversary",
  expert:      "Expert",
  synthesizer: "Synth",
  judge:       "Judge",
};

const AGENT_EMOJIS: Record<AgentRole, string> = {
  researcher:  "🔍",
  steelman:    "🛡️",
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

function SandboxCard({ result }: { result: SandboxResultEvent }) {
  const [expanded, setExpanded] = useState(!result.builds.every((b) => b.success));
  const ok = result.builds.every((b) => b.success) && result.builds.length > 0;

  return (
    <div className={`sandbox-card ${ok ? "sandbox-pass" : "sandbox-fail"}`}>
      <div className="sandbox-header" onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
        <span className="sandbox-icon">{ok ? "✅" : "❌"}</span>
        <span className="sandbox-title">
          Sandbox Build — Round {result.round}
          {" · "}{result.filesWritten} file{result.filesWritten !== 1 ? "s" : ""}
        </span>
        <span className="sandbox-toggle">{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div className="sandbox-body">
          {result.builds.length === 0 ? (
            <div className="sandbox-msg">{result.summary}</div>
          ) : (
            result.builds.map((b, i) => (
              <div key={i} className={`sandbox-step ${b.success ? "pass" : "fail"}`}>
                <div className="sandbox-step-cmd">
                  {b.success ? "✓" : "✗"} <code>{b.command}</code>
                  <span className="sandbox-step-ms">{b.duration}ms</span>
                </div>
                {(b.stderr || b.stdout) && !b.success && (
                  <pre className="sandbox-step-out">{(b.stderr || b.stdout).trim().slice(0, 1500)}</pre>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
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
          const sandboxResult = turn.role === "synthesizer"
            ? state.sandboxResults.find((s) => s.round === turn.round)
            : null;

          return (
            <div key={`${turn.round}-${turn.role}`}>
              {isFirstOfRound && (
                <div className="round-label">Round {turn.round}</div>
              )}
              <AgentCard turn={turn} />
              {sandboxResult && <SandboxCard result={sandboxResult} />}
              {roundData && (
                <JudgeCard verdict={roundData.verdict} round={turn.round} />
              )}
            </div>
          );
        })}

        {state.turns[state.turns.length - 1]?.role === "synthesizer" &&
          !state.sandboxResults.find((s) => s.round === state.turns[state.turns.length - 1]?.round) &&
          state.thinking === null && state.status === "running" && (
          <div className="sandbox-card sandbox-building">
            <div className="sandbox-header">
              <span className="sandbox-icon">🔨</span>
              <span className="sandbox-title">Running sandbox build...</span>
              <div className="dots" style={{ marginLeft: "auto" }}>
                <div className="dot" /><div className="dot" /><div className="dot" />
              </div>
            </div>
          </div>
        )}

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
