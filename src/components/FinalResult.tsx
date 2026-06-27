import { useState } from "react";
import JudgeCard from "./JudgeCard";
import AgentCard from "./AgentCard";
import type { AppState } from "../App";

interface Props {
  state: AppState;
  onReset: () => void;
}

type Tab = "output" | "rounds" | "export";

function scoreColor(score: number): string {
  if (score >= 88) return "var(--green)";
  if (score >= 72) return "var(--yellow)";
  return "var(--red)";
}

function buildMarkdownExport(state: AppState): string {
  const lines: string[] = [];
  lines.push(`# Think Tank Result`);
  if (state.routing) {
    lines.push(`\n**Mode:** ${state.routing.mode.replace("_", " ")}`);
    lines.push(`**Goal:** ${state.routing.extracted_goal}`);
    lines.push(`**Domain:** ${state.routing.suggested_domain}`);
  }
  lines.push(`**Rounds:** ${state.totalRounds}`);
  lines.push(`**Peak Score:** ${Math.max(...state.rounds.map((r) => r.verdict.score))}/100`);
  lines.push(`\n---\n\n## Final Output\n`);
  lines.push(state.finalOutput);
  lines.push(`\n---\n\n## Debate History\n`);

  state.rounds.forEach((round) => {
    lines.push(`\n### Round ${round.round}\n`);
    round.agents.forEach((agent) => {
      if (agent.role !== "judge") {
        lines.push(`#### ${agent.emoji} ${agent.name} (${agent.provider}/${agent.modelId})\n`);
        lines.push(agent.output);
        lines.push("");
      }
    });
    lines.push(`#### ⚖️ Judge Verdict — Score: ${round.verdict.score}/100`);
    lines.push(`> ${round.verdict.feedback}`);
    if (round.verdict.strengths.length > 0) {
      lines.push(`\n**Strengths:** ${round.verdict.strengths.map((s) => `- ${s}`).join("\n")}`);
    }
    if (round.verdict.weaknesses.length > 0) {
      lines.push(`\n**Weaknesses:** ${round.verdict.weaknesses.map((w) => `- ${w}`).join("\n")}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

export default function FinalResult({ state, onReset }: Props) {
  const [tab, setTab]     = useState<Tab>("output");
  const [copied, setCopied] = useState(false);

  const scores = state.rounds.map((r) => r.verdict.score);
  const topScore = scores.length > 0 ? Math.max(...scores) : 0;
  const lastRound = state.rounds[state.rounds.length - 1];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.finalOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const md = buildMarkdownExport(state);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `think-tank-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="final-result">
      {/* Hero */}
      <div className="result-hero">
        <h2>✨ Think Tank Complete</h2>

        {lastRound?.verdict.approved && (
          <div className="approved-pill">
            <span>✅</span> Approved — Quality Standard Met
          </div>
        )}

        <div className="result-stats">
          <div className="r-stat">
            <span className="r-stat-n">{state.totalRounds}</span>
            <span className="r-stat-l">Rounds</span>
          </div>
          <div className="r-stat">
            <span className="r-stat-n">{state.turns.length}</span>
            <span className="r-stat-l">Agent Turns</span>
          </div>
          <div className="r-stat">
            <span className="r-stat-n" style={{ color: scoreColor(topScore) }}>{topScore}</span>
            <span className="r-stat-l">Peak Score</span>
          </div>
          {scores.length > 1 && (
            <div className="r-stat">
              <span className="r-stat-n" style={{ color: "var(--green)", fontSize: "1.5rem" }}>
                +{topScore - (scores[0] ?? 0)}
              </span>
              <span className="r-stat-l">Score Gain</span>
            </div>
          )}
        </div>

        {/* Score progression chart */}
        {scores.length > 0 && (
          <div className="score-chart">
            {scores.map((score, i) => (
              <div key={i} className="score-bar-col">
                <div
                  className="score-bar-visual"
                  style={{
                    height: `${Math.max(4, (score / 100) * 40)}px`,
                    background: scoreColor(score),
                  }}
                />
                <span className="score-bar-n" style={{ color: scoreColor(score) }}>{score}</span>
              </div>
            ))}
          </div>
        )}

        {state.routing && (
          <p className="result-goal">
            <strong>Goal:</strong> {state.routing.extracted_goal}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="result-tabs">
        {(["output", "rounds", "export"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`r-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "output" ? "📄 Final Output" : t === "rounds" ? `🔄 Debate History (${state.rounds.length} rounds)` : "💾 Export"}
          </button>
        ))}
      </div>

      {/* Output tab */}
      {tab === "output" && (
        <div className="output-section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="output-toolbar">
            <button className="btn btn-ghost" onClick={handleCopy}>
              {copied ? "✓ Copied!" : "📋 Copy to Clipboard"}
            </button>
            <button className="btn btn-ghost" onClick={handleDownload}>
              💾 Download Markdown
            </button>
          </div>
          <pre className="final-out">{state.finalOutput}</pre>
        </div>
      )}

      {/* Rounds tab */}
      {tab === "rounds" && (
        <div className="rounds-history">
          {state.rounds.map((round) => (
            <div key={round.round} className="history-round">
              <div className="history-rnd-header">
                <span className="history-rnd-title">Round {round.round}</span>
                <span className="history-rnd-score" style={{ color: scoreColor(round.verdict.score) }}>
                  {round.verdict.score}/100
                </span>
              </div>
              {round.agents.filter((a) => a.role !== "judge").map((turn) => (
                <AgentCard key={`${round.round}-${turn.role}`} turn={turn} />
              ))}
              <JudgeCard verdict={round.verdict} round={round.round} />
            </div>
          ))}
        </div>
      )}

      {/* Export tab */}
      {tab === "export" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="input-card" style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>💾 Download Full Report</h3>
            <p style={{ color: "var(--text2)", fontSize: ".88rem", marginBottom: 16, lineHeight: 1.55 }}>
              Exports the final output and complete debate history as a Markdown file — including all agent outputs, judge verdicts, sources, and scores.
            </p>
            <button className="btn btn-primary" onClick={handleDownload} style={{ fontSize: ".9rem" }}>
              ↓ Download think-tank-report.md
            </button>
          </div>
          <div className="input-card" style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>📋 Copy Final Output</h3>
            <p style={{ color: "var(--text2)", fontSize: ".88rem", marginBottom: 16 }}>
              Copy just the final synthesized output to clipboard.
            </p>
            <button className="btn btn-ghost" onClick={handleCopy}>
              {copied ? "✓ Copied!" : "Copy to Clipboard"}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="result-actions">
        <button className="btn btn-primary" onClick={onReset}>⚡ New Think Tank Session</button>
      </div>
    </div>
  );
}
