import { useState, useEffect, useRef } from "react";
import ThinkTankInput from "./components/ThinkTankInput";
import LiveDebate from "./components/LiveDebate";
import FinalResult from "./components/FinalResult";
import HistoryDrawer, { reconstructStateFromRun } from "./components/HistoryDrawer";
import "./App.css";
import type {
  AgentRole,
  AgentTurn,
  Provider,
  RouterOutput,
  RoundResult,
  SandboxResultEvent,
  ServerConfig,
  SSEEventPayload,
  PersistedRunDetail,
} from "./types";

export interface ThinkingAgent {
  role: AgentRole;
  name: string;
  emoji: string;
  round: number;
}

export interface AppState {
  status: "idle" | "running" | "complete" | "error";
  sessionId?: string | undefined;
  routing: RouterOutput | null;
  rounds: RoundResult[];
  turns: AgentTurn[];
  sandboxResults: SandboxResultEvent[];
  thinking: ThinkingAgent | null;
  finalOutput: string;
  totalRounds: number;
  enableSteelman: boolean;
  repoUrl?: string | undefined;
  error?: string | undefined;
}

export interface SessionConfig {
  input: string;
  maxRounds: number;
  qualityThreshold: number;
  customContext: string;
  expertDomain: string;
  agentModels: Record<AgentRole, { provider: Provider; modelId: string }>;
  enableSteelman?: boolean;
  repoUrl?: string;
  repoToken?: string;
  docId?: string;
}

const EMPTY_STATE: AppState = {
  status: "idle",
  routing: null,
  rounds: [],
  turns: [],
  sandboxResults: [],
  thinking: null,
  finalOutput: "",
  totalRounds: 0,
  enableSteelman: true,
};

// One TTS clip at a time, in strict order
interface TtsItem {
  role: string;
  text: string;
}

export default function App() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [voiceOn, setVoiceOn] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedRunCount, setSavedRunCount] = useState<number>(0);
  const [resumableSession, setResumableSession] = useState<{ id: string; prompt: string } | null>(null);

  const ttsQueueRef = useRef<TtsItem[]>([]);
  const ttsPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const sessionDoneRef = useRef(false);

  const refreshRunCount = () => {
    fetch("/api/debate/runs")
      .then((r) => r.json())
      .then((data: { runs: Array<{ sessionId: string; input: string }> }) => {
        setSavedRunCount(data.runs?.length || 0);
        const lastId = localStorage.getItem("thinktank_active_session");
        if (lastId) {
          const match = data.runs?.find((r) => r.sessionId === lastId);
          if (match) {
            setResumableSession({ id: match.sessionId, prompt: match.input });
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ServerConfig) => setServerConfig(cfg))
      .catch(console.error);

    refreshRunCount();
  }, []);

  const processTtsQueue = () => {
    if (ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;
    ttsPlayingRef.current = true;

    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: next.text, role: next.role }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`TTS ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        currentAudioRef.current?.pause();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        const advance = () => {
          URL.revokeObjectURL(url);
          ttsPlayingRef.current = false;
          currentAudioRef.current = null;
          processTtsQueue();
        };
        audio.onended = advance;
        audio.onerror = advance;
        audio.play().catch(advance);
      })
      .catch((err) => {
        console.warn("[TTS] failed, skipping clip:", err);
        ttsPlayingRef.current = false;
        processTtsQueue();
      });
  };

  const enqueueTts = (role: string, text: string) => {
    if (!voiceOn || !serverConfig?.ttsEnabled) return;
    const clean = text.replace(/```[\s\S]*?```/g, " code omitted. ").trim();
    if (!clean) return;
    ttsQueueRef.current.push({ role, text: clean });
    processTtsQueue();
  };

  const stopVoice = () => {
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
  };

  const connectToStream = (sessionId: string) => {
    let retryCount = 0;
    const MAX_RETRIES = 6;
    let es: EventSource;

    const attachHandlers = (source: EventSource) => {
      source.onmessage = (e: MessageEvent<string>) => {
        retryCount = 0;
        const event = JSON.parse(e.data) as SSEEventPayload;
        setState((prev) => {
          switch (event.type) {
            case "routing":
              return { ...prev, routing: event.data };
            case "agent_thinking":
              return { ...prev, thinking: event.data };
            case "agent_complete":
              enqueueTts(event.data.role, event.data.output);
              return { ...prev, thinking: null, turns: [...prev.turns, event.data] };
            case "sandbox_result":
              return { ...prev, sandboxResults: [...prev.sandboxResults, event.data] };
            case "round_complete":
              return { ...prev, rounds: [...prev.rounds, event.data] };
            case "complete":
              sessionDoneRef.current = true;
              source.close();
              refreshRunCount();
              return { ...prev, status: "complete", thinking: null, finalOutput: event.data.finalOutput, totalRounds: event.data.totalRounds };
            case "error":
              sessionDoneRef.current = true;
              source.close();
              refreshRunCount();
              return { ...prev, status: "error", thinking: null, error: event.data.message };
            default:
              return prev;
          }
        });
      };

      source.onerror = () => {
        if (sessionDoneRef.current) return;
        source.close();

        if (retryCount >= MAX_RETRIES) {
          setState((s) => s.status !== "complete" ? { ...s, status: "error", error: "Connection lost and could not be restored. Progress has been saved to Debate History." } : s);
          return;
        }

        retryCount += 1;
        const delayMs = Math.min(1000 * 2 ** (retryCount - 1), 10_000);
        setState((s) => s.status === "running" ? { ...s, error: `Connection lost — reconnecting (${retryCount}/${MAX_RETRIES})...` } : s);
        setTimeout(() => {
          if (sessionDoneRef.current) return;
          es = new EventSource(`/api/debate/stream/${sessionId}`);
          attachHandlers(es);
        }, delayMs);
      };
    };

    es = new EventSource(`/api/debate/stream/${sessionId}`);
    attachHandlers(es);
  };

  const handleStart = async (cfg: SessionConfig) => {
    sessionDoneRef.current = false;
    stopVoice();
    setResumableSession(null);
    setState({ ...EMPTY_STATE, status: "running", enableSteelman: cfg.enableSteelman ?? true, ...(cfg.repoUrl ? { repoUrl: cfg.repoUrl } : {}) });

    let sessionId: string;
    try {
      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: cfg.input,
          maxRounds: cfg.maxRounds,
          agentModels: cfg.agentModels,
          customContext: cfg.customContext || undefined,
          qualityThreshold: cfg.qualityThreshold,
          expertDomain: cfg.expertDomain || undefined,
          enableSteelman: cfg.enableSteelman,
          repoUrl: cfg.repoUrl || undefined,
          repoToken: cfg.repoToken || undefined,
          docId: cfg.docId || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = (await res.json()) as { sessionId: string };
      sessionId = data.sessionId;
      localStorage.setItem("thinktank_active_session", sessionId);
      setState((s) => ({ ...s, sessionId }));
      refreshRunCount();
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to start session",
      }));
      return;
    }

    connectToStream(sessionId);
  };

  const handleResumeSavedSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/debate/runs/${sessionId}`);
      if (!res.ok) throw new Error("Could not load session");
      const detail = (await res.json()) as PersistedRunDetail;
      const reconstructed = reconstructStateFromRun(detail);
      setState(reconstructed);
      setResumableSession(null);

      // If still running, reconnect to stream
      if (detail.status === "running") {
        sessionDoneRef.current = false;
        connectToStream(sessionId);
      }
    } catch (err) {
      alert("Failed to restore session");
      localStorage.removeItem("thinktank_active_session");
      setResumableSession(null);
    }
  };

  const handleReset = () => {
    stopVoice();
    localStorage.removeItem("thinktank_active_session");
    setResumableSession(null);
    setState(EMPTY_STATE);
  };

  const hasPartialProgress = state.turns.length > 0 || state.rounds.length > 0;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-logo" onClick={handleReset} style={{ cursor: "pointer" }}>
          <div className="header-logo-icon">⚡</div>
          <span className="header-logo-text">Think Tank</span>
        </div>
        <div className="header-actions">
          {serverConfig?.tavilyEnabled && (
            <span className="header-tag">🔍 Live Search</span>
          )}
          {serverConfig && (
            <span className="header-tag">
              {serverConfig.availableProviders.length} provider{serverConfig.availableProviders.length !== 1 ? "s" : ""}
            </span>
          )}
          {serverConfig?.ttsEnabled && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setVoiceOn((v) => {
                  if (v) stopVoice();
                  return !v;
                });
              }}
              style={{ fontSize: ".8rem", padding: "6px 14px" }}
            >
              {voiceOn ? "🔊 Voice On" : "🔇 Voice Off"}
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => setHistoryOpen(true)}
            style={{ fontSize: ".8rem", padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
            title="View saved debate sessions"
          >
            <span>📜 Sessions</span>
            {savedRunCount > 0 && <span className="header-counter-badge">{savedRunCount}</span>}
          </button>
          {state.status !== "idle" && (
            <button className="btn btn-ghost" onClick={handleReset} style={{ fontSize: ".8rem", padding: "6px 14px" }}>
              ← New Session
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {state.status === "idle" && (
          <>
            {resumableSession && (
              <div className="resume-banner">
                <div className="resume-banner-info">
                  <span className="resume-icon">↺</span>
                  <div className="resume-text">
                    <strong>Recent Session Available:</strong>
                    <span className="resume-prompt-preview">
                      {resumableSession.prompt ? `"${resumableSession.prompt.slice(0, 100)}..."` : `Session ${resumableSession.id}`}
                    </span>
                  </div>
                </div>
                <div className="resume-banner-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleResumeSavedSession(resumableSession.id)}
                  >
                    Resume
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      localStorage.removeItem("thinktank_active_session");
                      setResumableSession(null);
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <ThinkTankInput serverConfig={serverConfig} onStart={handleStart} />
          </>
        )}

        {state.status === "running" && (
          <LiveDebate state={state} />
        )}

        {state.status === "complete" && (
          <FinalResult state={state} onReset={handleReset} />
        )}

        {state.status === "error" && hasPartialProgress && (
          <div className="partial-error-container">
            <div className="partial-error-banner">
              <div className="partial-error-content">
                <span className="partial-error-icon">⚠️</span>
                <div>
                  <strong>Session Interrupted:</strong> {state.error || "An error occurred during debate."}
                  <div className="partial-error-sub">
                    Progress up to this point is preserved: {state.turns.length} agent turns, {state.rounds.length} rounds.
                  </div>
                </div>
              </div>
              <div className="partial-error-actions">
                {state.sessionId && (
                  <a
                    href={`/api/debate/runs/${state.sessionId}/export/markdown`}
                    download
                    className="btn btn-secondary btn-sm"
                  >
                    Export What Was Generated
                  </a>
                )}
                <button className="btn btn-primary btn-sm" onClick={handleReset}>
                  New Debate
                </button>
              </div>
            </div>
            <LiveDebate state={state} />
          </div>
        )}

        {state.status === "error" && !hasPartialProgress && (
          <div className="error-screen">
            <div className="error-icon">❌</div>
            <h2>Session Error</h2>
            <p>{state.error}</p>
            <p style={{ color: "var(--text3)", fontSize: ".82rem", marginTop: -16, marginBottom: 24 }}>
              Make sure the server is running: <code style={{ color: "var(--blue)" }}>npm run dev</code>
            </p>
            <button className="btn btn-primary" onClick={handleReset}>Try Again</button>
          </div>
        )}
      </main>

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectRun={(loadedState) => {
          setState(loadedState);
        }}
        currentSessionId={state.sessionId}
      />
    </div>
  );
}
