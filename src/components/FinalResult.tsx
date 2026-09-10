import { useState, useEffect } from "react";
import JudgeCard from "./JudgeCard";
import AgentCard from "./AgentCard";
import type { AppState } from "../App";
import type { RepoFileInfo } from "../types";

interface Props {
  state: AppState;
  onReset: () => void;
}

interface ParsedChange {
  path: string;
  content: string;
  action: "MODIFIED" | "NEW" | "DELETE";
}

type Tab = "output" | "rounds" | "export" | "push";

function scoreColor(score: number): string {
  if (score >= 88) return "var(--green)";
  if (score >= 72) return "var(--yellow)";
  return "var(--red)";
}

export default function FinalResult({ state, onReset }: Props) {
  const [tab, setTab]     = useState<Tab>("output");
  const [copied, setCopied] = useState(false);

  // GitHub push state
  const [prTitle, setPrTitle] = useState(
    state.routing ? `Think Tank: ${state.routing.extracted_goal.slice(0, 60)}` : "Think Tank: AI-generated changes"
  );
  const [ghToken, setGhToken] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ prUrl?: string; error?: string } | null>(null);
  const [detectedFiles, setDetectedFiles] = useState<RepoFileInfo[] | null>(null);

  // Change manifest state
  const [changes, setChanges] = useState<ParsedChange[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);

  // Export loading states
  const [exportingPdf, setExportingPdf] = useState(false);

  const isCodeMode = state.routing?.mode === "CODE_MODE";
  const hasRepo = !!state.repoUrl;
  const sessionId = state.sessionId;

  // Load change manifest when switching to push tab
  useEffect(() => {
    if (tab === "push" && changes.length === 0 && sessionId && !loadingChanges) {
      setLoadingChanges(true);
      fetch(`/api/debate/runs/${sessionId}/export/changes`)
        .then(r => r.json())
        .then((data: { changes?: ParsedChange[] }) => {
          const c = data.changes ?? [];
          setChanges(c);
          setSelectedFiles(new Set(c.map(f => f.path)));
        })
        .catch(() => {})
        .finally(() => setLoadingChanges(false));
    }
  }, [tab, sessionId]);

  const handlePush = async () => {
    if (!state.repoUrl) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/repo/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: state.repoUrl,
          finalOutput: state.finalOutput,
          prTitle,
          token: ghToken || undefined,
        }),
      });
      const data = await res.json() as { prUrl?: string; filesCommitted?: number; error?: string };
      if (data.error) {
        setPushResult({ error: data.error });
      } else if (data.prUrl) {
        setPushResult({ prUrl: data.prUrl });
      }
    } catch (err) {
      setPushResult({ error: err instanceof Error ? err.message : "Push failed" });
    } finally {
      setPushing(false);
    }
  };

  const scores = state.rounds.map((r) => r.verdict.score);
  const topScore = scores.length > 0 ? Math.max(...scores) : 0;
  const lastRound = state.rounds[state.rounds.length - 1];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.finalOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export handlers — download from server endpoints
  const handleExport = async (format: "pdf" | "markdown" | "final" | "json") => {
    if (!sessionId) return;

    if (format === "pdf") setExportingPdf(true);

    try {
      const res = await fetch(`/api/debate/runs/${sessionId}/export/${format}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const exts: Record<string, string> = { pdf: ".pdf", markdown: ".md", final: ".txt", json: ".json" };
      a.download = `thinktank-${format}-${sessionId}${exts[format] ?? ".txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      if (format === "pdf") setExportingPdf(false);
    }
  };

  // Fallback client-side markdown export if no sessionId
  const handleClientDownload = () => {
    const md = buildClientMarkdown(state);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `think-tank-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFileSelection = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const actionBadge = (action: ParsedChange["action"]) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      MODIFIED: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b", label: "MODIFIED" },
      NEW:      { bg: "rgba(16,185,129,0.15)", color: "#10b981", label: "NEW" },
      DELETE:   { bg: "rgba(239,68,68,0.15)",  color: "#ef4444", label: "DELETE" },
    };
    const s = styles[action] ?? styles["MODIFIED"]!;
    return (
      <span style={{
        padding: "2px 8px", borderRadius: 4, fontSize: ".7rem", fontWeight: 700,
        background: s.bg, color: s.color, letterSpacing: "0.05em",
      }}>
        {s.label}
      </span>
    );
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
        {(["output", "rounds", "export", ...(isCodeMode || hasRepo ? ["push"] : [])] as Tab[]).map((t) => (
          <button
            key={t}
            className={`r-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "output" ? "📄 Final Output"
              : t === "rounds" ? `🔄 Debate History (${state.rounds.length} rounds)`
              : t === "push" ? "🚀 Push to GitHub"
              : "💾 Export"}
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
            <button className="btn btn-ghost" onClick={() => sessionId ? handleExport("markdown") : handleClientDownload()}>
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

      {/* Export tab — redesigned with multiple format cards */}
      {tab === "export" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* PDF Report */}
          <div className="input-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: "1.4rem" }}>📕</span>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>PDF Report</h3>
                <p style={{ color: "var(--text3)", fontSize: ".78rem", margin: 0 }}>
                  Formatted report with cover page, scores, final output, and debate history
                </p>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => handleExport("pdf")}
              disabled={!sessionId || exportingPdf}
              style={{ fontSize: ".9rem" }}
            >
              {exportingPdf ? "⏳ Generating PDF..." : "↓ Download PDF Report"}
            </button>
            {!sessionId && (
              <p style={{ color: "var(--text3)", fontSize: ".75rem", marginTop: 6 }}>
                PDF export is available after the session completes and is saved.
              </p>
            )}
          </div>

          {/* Markdown Report */}
          <div className="input-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: "1.4rem" }}>📝</span>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Full Markdown Report</h3>
                <p style={{ color: "var(--text3)", fontSize: ".78rem", margin: 0 }}>
                  Complete debate history with all agent outputs, verdicts, and scores
                </p>
              </div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => sessionId ? handleExport("markdown") : handleClientDownload()}
              style={{ fontSize: ".9rem" }}
            >
              ↓ Download Markdown
            </button>
          </div>

          {/* Final Output Only */}
          <div className="input-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: "1.4rem" }}>📋</span>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Final Output Only</h3>
                <p style={{ color: "var(--text3)", fontSize: ".78rem", margin: 0 }}>
                  Clean copy of just the synthesized result — no debate history
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={handleCopy} style={{ fontSize: ".85rem" }}>
                {copied ? "✓ Copied!" : "📋 Copy"}
              </button>
              <button className="btn btn-ghost" onClick={() => handleExport("final")} disabled={!sessionId} style={{ fontSize: ".85rem" }}>
                ↓ Download .txt
              </button>
            </div>
          </div>

          {/* JSON Export */}
          <div className="input-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: "1.4rem" }}>📊</span>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>Full Session JSON</h3>
                <p style={{ color: "var(--text3)", fontSize: ".78rem", margin: 0 }}>
                  Structured data — all rounds, agents, scores, and changes for programmatic use
                </p>
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => handleExport("json")} disabled={!sessionId} style={{ fontSize: ".9rem" }}>
              ↓ Download JSON
            </button>
          </div>

          {/* Change Manifest — only for code/repo sessions */}
          {(isCodeMode || hasRepo) && (
            <div className="input-card" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: "1.4rem" }}>🔧</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>Change Manifest</h3>
                  <p style={{ color: "var(--text3)", fontSize: ".78rem", margin: 0 }}>
                    File-by-file code changes extracted from the output — ready to push via PR
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setTab("push")} style={{ fontSize: ".9rem" }}>
                🚀 View Changes & Push to GitHub →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Push to GitHub tab — enhanced with file diff preview */}
      {tab === "push" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!state.repoUrl ? (
            <div className="input-card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>🚀 Push to GitHub</h3>
              <p style={{ color: "var(--text2)", fontSize: ".88rem", lineHeight: 1.6 }}>
                No repository was imported for this session. Start a new session and import a GitHub repository first — then the Think Tank can push its changes directly as a pull request.
              </p>
              <button className="btn btn-primary" onClick={onReset} style={{ marginTop: 16 }}>
                ⚡ New Session with Repository
              </button>
            </div>
          ) : (
            <>
              {/* File diff preview */}
              <div className="input-card" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 4, fontSize: "1rem" }}>🔍 Change Preview</h3>
                <p style={{ color: "var(--text3)", fontSize: ".82rem", marginBottom: 16 }}>
                  {changes.length > 0
                    ? `${changes.length} file${changes.length > 1 ? "s" : ""} detected in output — select which to include in the PR`
                    : loadingChanges
                      ? "Analyzing output for file changes..."
                      : "No file changes detected in the output. The output may not contain === FILE: path === blocks."}
                </p>

                {changes.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {/* Select all / none */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: ".75rem", padding: "3px 10px" }}
                        onClick={() => setSelectedFiles(new Set(changes.map(c => c.path)))}
                      >
                        Select All
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: ".75rem", padding: "3px 10px" }}
                        onClick={() => setSelectedFiles(new Set())}
                      >
                        Deselect All
                      </button>
                      <span style={{ color: "var(--text3)", fontSize: ".78rem", marginLeft: "auto" }}>
                        {selectedFiles.size}/{changes.length} selected
                      </span>
                    </div>

                    {changes.map((change) => (
                      <div
                        key={change.path}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 8,
                          overflow: "hidden",
                          background: selectedFiles.has(change.path) ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 14px", cursor: "pointer",
                          }}
                          onClick={() => toggleFileSelection(change.path)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(change.path)}
                            onChange={() => toggleFileSelection(change.path)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ accentColor: "#6366f1" }}
                          />
                          {actionBadge(change.action)}
                          <code style={{ fontSize: ".82rem", color: "var(--text1)", flex: 1 }}>
                            {change.path}
                          </code>
                          <span style={{ color: "var(--text3)", fontSize: ".75rem" }}>
                            {(change.content.length / 1024).toFixed(1)}KB
                          </span>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: ".7rem", padding: "2px 8px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedFile(expandedFile === change.path ? null : change.path);
                            }}
                          >
                            {expandedFile === change.path ? "▲ Hide" : "▼ Preview"}
                          </button>
                        </div>

                        {expandedFile === change.path && (
                          <pre style={{
                            margin: 0, padding: "12px 14px", fontSize: ".78rem",
                            borderTop: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(0,0,0,0.3)", color: "var(--text2)",
                            maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap",
                          }}>
                            {change.content.slice(0, 5000)}
                            {change.content.length > 5000 && "\n\n... [truncated in preview]"}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* PR creation form */}
              <div className="input-card" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 4, fontSize: "1rem" }}>🚀 Create Pull Request</h3>
                <p style={{ color: "var(--text3)", fontSize: ".82rem", marginBottom: 16 }}>
                  Repository: <code style={{ color: "var(--blue)" }}>{state.repoUrl}</code>
                </p>

                {pushResult?.prUrl ? (
                  <div className="push-success">
                    <div className="push-success-icon">✅</div>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Pull request created!</div>
                      <a
                        href={pushResult.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="push-pr-link"
                      >
                        {pushResult.prUrl}
                      </a>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <div className="control-label" style={{ marginBottom: 6 }}>PR title</div>
                        <input
                          type="text"
                          className="repo-url-input"
                          value={prTitle}
                          onChange={(e) => setPrTitle(e.target.value)}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div>
                        <div className="control-label" style={{ marginBottom: 6 }}>GitHub token (if not set in .env)</div>
                        <input
                          type="password"
                          className="repo-url-input"
                          placeholder="ghp_... (needs repo write access)"
                          value={ghToken}
                          onChange={(e) => setGhToken(e.target.value)}
                          style={{ width: "100%" }}
                        />
                      </div>
                    </div>

                    {pushResult?.error && (
                      <div className="repo-error" style={{ marginTop: 12 }}>{pushResult.error}</div>
                    )}

                    <button
                      className="btn btn-primary"
                      onClick={handlePush}
                      disabled={pushing || !prTitle.trim() || (changes.length > 0 && selectedFiles.size === 0)}
                      style={{ marginTop: 16, fontSize: ".9rem" }}
                    >
                      {pushing
                        ? "Creating PR..."
                        : changes.length > 0
                          ? `🚀 Create PR (${selectedFiles.size} file${selectedFiles.size !== 1 ? "s" : ""})`
                          : "🚀 Create Pull Request"}
                    </button>

                    <p style={{ color: "var(--text3)", fontSize: ".78rem", marginTop: 10, lineHeight: 1.5 }}>
                      The Think Tank's output will be parsed for <code>=== FILE: path ===</code> blocks and committed to a new branch. A PR will be opened against the default branch.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="result-actions">
        <button className="btn btn-primary" onClick={onReset}>⚡ New Think Tank Session</button>
      </div>
    </div>
  );
}

// Client-side fallback markdown builder
function buildClientMarkdown(state: AppState): string {
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
