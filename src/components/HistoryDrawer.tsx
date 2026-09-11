import { useState, useEffect } from "react";
import type { PersistedRunSummary, PersistedRunDetail, SSEEventPayload } from "../types";
import type { AppState } from "../App";

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRun: (state: AppState) => void;
  currentSessionId?: string | undefined;
}

export function reconstructStateFromRun(run: PersistedRunDetail): AppState {
  const state: AppState = {
    status: run.status,
    sessionId: run.sessionId,
    routing: null,
    rounds: [],
    turns: [],
    sandboxResults: [],
    thinking: null,
    finalOutput: run.finalOutput || "",
    totalRounds: 0,
    enableSteelman: true,
    error: run.error,
  };

  if (run.events && Array.isArray(run.events)) {
    for (const ev of run.events as SSEEventPayload[]) {
      switch (ev.type) {
        case "routing":
          state.routing = ev.data;
          break;
        case "agent_complete":
          state.turns.push(ev.data);
          break;
        case "sandbox_result":
          state.sandboxResults.push(ev.data);
          break;
        case "round_complete":
          state.rounds.push(ev.data);
          break;
        case "complete":
          state.finalOutput = ev.data.finalOutput;
          state.totalRounds = ev.data.totalRounds;
          state.status = "complete";
          break;
        case "error":
          state.error = ev.data.message;
          state.status = "error";
          break;
      }
    }
  }

  if (state.totalRounds === 0 && state.rounds.length > 0) {
    state.totalRounds = state.rounds.length;
  }

  return state;
}

export default function HistoryDrawer({ isOpen, onClose, onSelectRun, currentSessionId }: HistoryDrawerProps) {
  const [runs, setRuns] = useState<PersistedRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "complete" | "error">("all");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const fetchRuns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/debate/runs");
      if (!res.ok) throw new Error("Failed to load runs");
      const data = (await res.json()) as { runs: PersistedRunSummary[] };
      setRuns(data.runs || []);
    } catch (err) {
      console.warn("[HistoryDrawer] fetch runs failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRuns();
    }
  }, [isOpen]);

  const handleOpenRun = async (sessionId: string) => {
    setLoadingId(sessionId);
    try {
      const res = await fetch(`/api/debate/runs/${sessionId}`);
      if (!res.ok) throw new Error(`Failed to load run ${sessionId}`);
      const detail = (await res.json()) as PersistedRunDetail;
      const reconstructed = reconstructStateFromRun(detail);
      onSelectRun(reconstructed);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load run details");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeleteRun = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this saved session?")) return;
    try {
      const res = await fetch(`/api/debate/runs/${sessionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete session");
      setRuns((prev) => prev.filter((r) => r.sessionId !== sessionId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete run");
    }
  };

  const filteredRuns = runs.filter((r) => {
    const matchesSearch = (r.input || "").toLowerCase().includes(search.toLowerCase()) ||
                          r.sessionId.includes(search);
    const matchesFilter = filterStatus === "all" ? true : r.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-group">
            <span className="drawer-icon">📜</span>
            <h2 className="drawer-title">Debate History</h2>
            <span className="drawer-count-badge">{runs.length}</span>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close drawer">✕</button>
        </div>

        <div className="drawer-controls">
          <input
            type="search"
            className="drawer-search-input"
            placeholder="Search prompt or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="drawer-filter-pills">
            <button
              className={`filter-pill ${filterStatus === "all" ? "active" : ""}`}
              onClick={() => setFilterStatus("all")}
            >
              All
            </button>
            <button
              className={`filter-pill ${filterStatus === "complete" ? "active" : ""}`}
              onClick={() => setFilterStatus("complete")}
            >
              Completed
            </button>
            <button
              className={`filter-pill ${filterStatus === "error" ? "active" : ""}`}
              onClick={() => setFilterStatus("error")}
            >
              Errors
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {loading && runs.length === 0 && (
            <div className="drawer-empty-state">
              <div className="spinner" style={{ margin: "20px auto" }} />
              <p>Loading saved sessions...</p>
            </div>
          )}

          {!loading && filteredRuns.length === 0 && (
            <div className="drawer-empty-state">
              <span style={{ fontSize: "2rem", display: "block", marginBottom: 8 }}>📭</span>
              <p>No saved sessions found</p>
              {search && <span style={{ fontSize: ".8rem", color: "var(--text3)" }}>Try a different search term</span>}
            </div>
          )}

          {filteredRuns.map((run) => {
            const isCurrent = run.sessionId === currentSessionId;
            const formattedDate = run.startedAt ? new Date(run.startedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }) : "Unknown time";

            return (
              <div
                key={run.sessionId}
                className={`run-card ${isCurrent ? "run-card-current" : ""}`}
                onClick={() => handleOpenRun(run.sessionId)}
              >
                <div className="run-card-header">
                  <div className="run-card-badges">
                    <span className={`status-tag status-${run.status}`}>
                      {run.status === "complete" ? "✓ Complete" : run.status === "error" ? "⚠ Interrupted" : "⚡ Running"}
                    </span>
                    {run.mode && (
                      <span className="mode-tag">
                        {run.mode === "article_polish" ? "📰 Polish" : "⚔️ Debate"}
                      </span>
                    )}
                    {isCurrent && <span className="current-badge">Active</span>}
                  </div>
                  <span className="run-card-date">{formattedDate}</span>
                </div>

                <p className="run-card-prompt">{run.input || "(No input text)"}</p>

                <div className="run-card-footer">
                  <div className="run-card-actions">
                    <button
                      className="btn-link"
                      disabled={loadingId === run.sessionId}
                    >
                      {loadingId === run.sessionId ? "Loading..." : "Open Session →"}
                    </button>
                    {run.status === "complete" && (
                      <a
                        href={`/api/debate/runs/${run.sessionId}/export/pdf`}
                        download
                        className="btn-link btn-export-quick"
                        onClick={(e) => e.stopPropagation()}
                        title="Download PDF"
                      >
                        PDF
                      </a>
                    )}
                  </div>
                  <button
                    className="btn-delete-icon"
                    title="Delete saved run"
                    onClick={(e) => handleDeleteRun(run.sessionId, e)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
