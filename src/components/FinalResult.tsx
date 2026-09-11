import { useState, useEffect, useMemo } from "react";
import JudgeCard from "./JudgeCard";
import AgentCard from "./AgentCard";
import DiffViewer, { computeLineDiff } from "./DiffViewer";
import type { AppState } from "../App";
import type { ParsedChange } from "../types";

interface Props {
  state: AppState;
  onReset: () => void;
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

  // GitHub push & PR review state
  const [prTitle, setPrTitle] = useState(
    state.routing ? `Think Tank: ${state.routing.extracted_goal.slice(0, 60)}` : "Think Tank: AI-generated changes"
  );
  const [prBody, setPrBody] = useState("");
  const [showPrBodyEditor, setShowPrBodyEditor] = useState(false);
  const [ghToken, setGhToken] = useState("");
  const [customRepoInput, setCustomRepoInput] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ prUrl?: string; filesCommitted?: number; error?: string } | null>(null);

  // Change manifest state
  const [changes, setChanges] = useState<ParsedChange[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState("");
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [serverRepoUrl, setServerRepoUrl] = useState<string | null>(null);

  // Export loading states
  const [exportingPdf, setExportingPdf] = useState(false);

  const isCodeMode = state.routing?.mode === "CODE_MODE";
  const targetRepo = state.repoUrl || serverRepoUrl || customRepoInput.trim();
  const hasRepo = !!targetRepo;
  const sessionId = state.sessionId;

  // Load change manifest when switching to push tab
  useEffect(() => {
    if (tab === "push" && changes.length === 0 && sessionId && !loadingChanges) {
      setLoadingChanges(true);
      fetch(`/api/debate/runs/${sessionId}/export/changes`)
        .then(r => r.json())
        .then((data: { changes?: ParsedChange[]; repoUrl?: string }) => {
          const c = data.changes ?? [];
          setChanges(c);
          setSelectedFiles(new Set(c.map(f => f.path)));
          // Expand first 3 files by default
          setExpandedFiles(new Set(c.slice(0, 3).map(f => f.path)));
          if (data.repoUrl) setServerRepoUrl(data.repoUrl);

          if (c.length > 0 && !prBody) {
            const summaryList = c.map(f => `- \`${f.path}\` (${f.action})`).join("\n");
            const goal = state.routing?.extracted_goal ? `### Goal\n${state.routing.extracted_goal}\n\n` : "";
            setPrBody(`## AI Think Tank Output\n\n${goal}### Changes Summary\n${summaryList}\n\nGenerated automatically via AI Think Tank multi-agent adversarial debate.`);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingChanges(false));
    }
  }, [tab, sessionId]);

  const overallStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const c of changes) {
      const { stats } = computeLineDiff(c.originalContent, c.content, c.action);
      additions += stats.additions;
      deletions += stats.deletions;
    }
    return { additions, deletions };
  }, [changes]);

  const filteredChanges = useMemo(() => {
    if (!filterQuery.trim()) return changes;
    const q = filterQuery.toLowerCase().trim();
    return changes.filter(c => c.path.toLowerCase().includes(q));
  }, [changes, filterQuery]);

  const handlePush = async () => {
    if (!targetRepo) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/repo/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: targetRepo,
          finalOutput: state.finalOutput,
          prTitle,
          prBody: prBody.trim() || undefined,
          selectedFiles: Array.from(selectedFiles),
          token: ghToken || undefined,
        }),
      });
      const data = await res.json() as { prUrl?: string; filesCommitted?: number; error?: string };
      if (data.error) {
        setPushResult({ error: data.error });
      } else if (data.prUrl) {
        setPushResult({ prUrl: data.prUrl, filesCommitted: data.filesCommitted });
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

  const toggleFileExpanded = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedFiles(new Set(changes.map(c => c.path)));
  };

  const collapseAll = () => {
    setExpandedFiles(new Set());
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

      {/* Push to GitHub tab — full PR review screen with interactive diffs */}
      {tab === "push" && (
        <div className="pr-review-container" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!targetRepo ? (
            <div className="input-card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: "1.1rem" }}>🚀 Pull Request Review</h3>
              <p style={{ color: "var(--text2)", fontSize: ".88rem", lineHeight: 1.6, marginBottom: 16 }}>
                No repository was configured when starting this session. Enter your GitHub repository below to review changes and open a pull request directly.
              </p>

              <div style={{ display: "flex", gap: 10, maxWidth: 600 }}>
                <input
                  type="text"
                  className="repo-url-input"
                  placeholder="https://github.com/owner/repo"
                  value={customRepoInput}
                  onChange={(e) => setCustomRepoInput(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <button className="btn btn-primary" onClick={onReset}>
                  ⚡ New Session with Repository
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* PR Header & Branch Flow */}
              <div className="input-card pr-header-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: "1.2rem" }}>🐙</span>
                      <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Pull Request Review</h3>
                      <a
                        href={targetRepo}
                        target="_blank"
                        rel="noreferrer"
                        className="repo-link-pill"
                        style={{ fontSize: ".75rem", color: "var(--blue)", textDecoration: "none" }}
                      >
                        {targetRepo.replace(/^https?:\/\/github\.com\//, "")} ↗
                      </a>
                    </div>
                    <div style={{ fontSize: ".8rem", color: "var(--text3)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>base: <code style={{ color: "var(--text2)" }}>main</code></span>
                      <span>←</span>
                      <span>head: <code style={{ color: "var(--accent)" }}>think-tank/update</code></span>
                    </div>
                  </div>

                  {/* Summary Stats */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="pr-stat-badge">
                      <span style={{ fontWeight: 700 }}>{changes.length}</span> files changed
                    </div>
                    {overallStats.additions > 0 && (
                      <div className="pr-stat-badge pr-stat-add">
                        +{overallStats.additions}
                      </div>
                    )}
                    {overallStats.deletions > 0 && (
                      <div className="pr-stat-badge pr-stat-del">
                        -{overallStats.deletions}
                      </div>
                    )}
                    <div className="pr-stat-badge pr-stat-selected">
                      {selectedFiles.size}/{changes.length} included in PR
                    </div>
                  </div>
                </div>
              </div>

              {/* Changes & Diff Viewer Section */}
              <div className="input-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: ".95rem", fontWeight: 700 }}>
                      Files Changed ({filteredChanges.length}{filterQuery ? ` of ${changes.length}` : ""})
                    </h3>
                    <p style={{ margin: "2px 0 0", color: "var(--text3)", fontSize: ".78rem" }}>
                      Inspect code diffs, verify line changes, and choose which files to commit
                    </p>
                  </div>

                  {/* Toolbar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="text"
                      className="repo-url-input"
                      placeholder="Filter files..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      style={{ fontSize: ".75rem", padding: "4px 10px", width: 160 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: ".75rem", padding: "4px 10px" }}
                      onClick={() => setSelectedFiles(new Set(changes.map(c => c.path)))}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: ".75rem", padding: "4px 10px" }}
                      onClick={() => setSelectedFiles(new Set())}
                    >
                      Deselect All
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: ".75rem", padding: "4px 10px" }}
                      onClick={expandedFiles.size === changes.length ? collapseAll : expandAll}
                    >
                      {expandedFiles.size === changes.length ? "Collapse All" : "Expand All"}
                    </button>
                  </div>
                </div>

                {loadingChanges && (
                  <div style={{ padding: "30px 0", textAlign: "center", color: "var(--text3)", fontSize: ".85rem" }}>
                    ⏳ Extracting file changes and computing diffs...
                  </div>
                )}

                {!loadingChanges && changes.length === 0 && (
                  <div style={{ padding: "30px 0", textAlign: "center", color: "var(--text3)", fontSize: ".85rem" }}>
                    No file changes detected in the final synthesis. The output did not contain <code>=== FILE: path ===</code> code blocks.
                  </div>
                )}

                {!loadingChanges && filteredChanges.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {filteredChanges.map((change) => {
                      const isExpanded = expandedFiles.has(change.path);
                      const isSelected = selectedFiles.has(change.path);
                      const { stats } = computeLineDiff(change.originalContent, change.content, change.action);

                      return (
                        <div
                          key={change.path}
                          className={`pr-file-card ${isSelected ? "selected" : ""}`}
                          style={{
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 8,
                            overflow: "hidden",
                            background: isSelected ? "rgba(99,102,241,0.03)" : "rgba(255,255,255,0.01)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {/* File Card Header */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 14px",
                              cursor: "pointer",
                              background: "rgba(255,255,255,0.02)",
                              borderBottom: isExpanded ? "1px solid rgba(255,255,255,0.06)" : "none",
                            }}
                            onClick={() => toggleFileExpanded(change.path)}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFileSelection(change.path)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ accentColor: "#6366f1", cursor: "pointer" }}
                              title="Include file in PR"
                            />
                            {actionBadge(change.action)}
                            <code style={{ fontSize: ".84rem", color: "var(--text1)", flex: 1, fontFamily: "monospace" }}>
                              {change.path}
                            </code>

                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div className="diff-stats-pill" style={{ margin: 0 }}>
                                {stats.additions > 0 && <span className="diff-stat-add">+{stats.additions}</span>}
                                {stats.deletions > 0 && <span className="diff-stat-del">-{stats.deletions}</span>}
                              </div>
                              <span style={{ color: "var(--text3)", fontSize: ".75rem" }}>
                                {(change.content.length / 1024).toFixed(1)}KB
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: ".72rem", padding: "2px 8px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFileExpanded(change.path);
                                }}
                              >
                                {isExpanded ? "▲ Hide Diff" : "▼ View Diff"}
                              </button>
                            </div>
                          </div>

                          {/* Expanded Diff Viewer */}
                          {isExpanded && (
                            <div style={{ padding: "8px 12px 12px", background: "rgba(0,0,0,0.25)" }}>
                              <DiffViewer
                                path={change.path}
                                originalContent={change.originalContent}
                                newContent={change.content}
                                action={change.action}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* PR Submission Form */}
              <div className="input-card" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 4, fontSize: "1.05rem" }}>🚀 Open Pull Request</h3>
                <p style={{ color: "var(--text3)", fontSize: ".82rem", marginBottom: 16 }}>
                  Commit selected changes directly to a new feature branch and create a PR
                </p>

                {pushResult?.prUrl ? (
                  <div className="push-success" style={{ padding: 20 }}>
                    <div className="push-success-icon" style={{ fontSize: "2rem" }}>🎉</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>
                        Pull request created successfully!
                      </div>
                      <div style={{ color: "var(--text2)", fontSize: ".85rem", marginBottom: 12 }}>
                        {pushResult.filesCommitted ?? selectedFiles.size} file{(pushResult.filesCommitted ?? selectedFiles.size) !== 1 ? "s" : ""} committed to feature branch.
                      </div>
                      <a
                        href={pushResult.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: ".9rem", padding: "8px 18px" }}
                      >
                        Open Pull Request on GitHub ↗
                      </a>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div>
                        <div className="control-label" style={{ marginBottom: 6 }}>PR Title</div>
                        <input
                          type="text"
                          className="repo-url-input"
                          value={prTitle}
                          onChange={(e) => setPrTitle(e.target.value)}
                          style={{ width: "100%" }}
                        />
                      </div>

                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div className="control-label">PR Description</div>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: ".72rem", padding: "2px 8px" }}
                            onClick={() => setShowPrBodyEditor(!showPrBodyEditor)}
                          >
                            {showPrBodyEditor ? "Hide Description Editor" : "Edit PR Description"}
                          </button>
                        </div>
                        {showPrBodyEditor ? (
                          <textarea
                            className="repo-url-input"
                            value={prBody}
                            onChange={(e) => setPrBody(e.target.value)}
                            rows={6}
                            style={{ width: "100%", fontFamily: "monospace", fontSize: ".82rem", resize: "vertical" }}
                          />
                        ) : (
                          <div
                            onClick={() => setShowPrBodyEditor(true)}
                            style={{
                              padding: "10px 14px",
                              borderRadius: 6,
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.06)",
                              fontSize: ".8rem",
                              color: "var(--text3)",
                              cursor: "pointer",
                            }}
                          >
                            📝 Default summary generated ({changes.length} files). Click to edit PR body.
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="control-label" style={{ marginBottom: 6 }}>
                          GitHub Token <span style={{ color: "var(--text3)", fontWeight: 400 }}>(optional if GITHUB_TOKEN is in .env)</span>
                        </div>
                        <input
                          type="password"
                          className="repo-url-input"
                          placeholder="ghp_... (needs repository write permission)"
                          value={ghToken}
                          onChange={(e) => setGhToken(e.target.value)}
                          style={{ width: "100%" }}
                        />
                      </div>
                    </div>

                    {pushResult?.error && (
                      <div className="repo-error" style={{ marginTop: 14 }}>{pushResult.error}</div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
                      <button
                        className="btn btn-primary"
                        onClick={handlePush}
                        disabled={pushing || !prTitle.trim() || (changes.length > 0 && selectedFiles.size === 0)}
                        style={{ fontSize: ".92rem", padding: "10px 22px" }}
                      >
                        {pushing
                          ? "⏳ Creating Pull Request..."
                          : changes.length > 0
                            ? `🚀 Create PR (${selectedFiles.size} of ${changes.length} files)`
                            : "🚀 Create Pull Request"}
                      </button>

                      <span style={{ color: "var(--text3)", fontSize: ".78rem" }}>
                        Safe branch creation · Target: <code>main</code>
                      </span>
                    </div>
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
