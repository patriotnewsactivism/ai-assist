import { useState, useEffect } from "react";
import ThinkTankInput from "./components/ThinkTankInput";
import LiveDebate from "./components/LiveDebate";
import FinalResult from "./components/FinalResult";
import "./App.css";
import type {
  AgentRole,
  AgentTurn,
  Provider,
  RouterOutput,
  RoundResult,
  ServerConfig,
  SSEEventPayload,
} from "./types";

export interface ThinkingAgent {
  role: AgentRole;
  name: string;
  emoji: string;
  round: number;
}

export interface AppState {
  status: "idle" | "running" | "complete" | "error";
  routing: RouterOutput | null;
  rounds: RoundResult[];
  turns: AgentTurn[];
  thinking: ThinkingAgent | null;
  finalOutput: string;
  totalRounds: number;
  error?: string;
}

export interface SessionConfig {
  input: string;
  maxRounds: number;
  qualityThreshold: number;
  customContext: string;
  expertDomain: string;
  agentModels: Record<AgentRole, { provider: Provider; modelId: string }>;
}

const EMPTY_STATE: AppState = {
  status: "idle",
  routing: null,
  rounds: [],
  turns: [],
  thinking: null,
  finalOutput: "",
  totalRounds: 0,
};

export default function App() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [state, setState] = useState<AppState>(EMPTY_STATE);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ServerConfig) => setServerConfig(cfg))
      .catch(console.error);
  }, []);

  const handleStart = async (cfg: SessionConfig) => {
    setState({ ...EMPTY_STATE, status: "running" });

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
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = (await res.json()) as { sessionId: string };
      sessionId = data.sessionId;
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to start session",
      }));
      return;
    }

    const es = new EventSource(`/api/debate/stream/${sessionId}`);

    es.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as SSEEventPayload;
      setState((prev) => {
        switch (event.type) {
          case "routing":
            return { ...prev, routing: event.data };
          case "agent_thinking":
            return { ...prev, thinking: event.data };
          case "agent_complete":
            return { ...prev, thinking: null, turns: [...prev.turns, event.data] };
          case "round_complete":
            return { ...prev, rounds: [...prev.rounds, event.data] };
          case "complete":
            es.close();
            return { ...prev, status: "complete", thinking: null, finalOutput: event.data.finalOutput, totalRounds: event.data.totalRounds };
          case "error":
            es.close();
            return { ...prev, status: "error", thinking: null, error: event.data.message };
          default:
            return prev;
        }
      });
    };

    es.onerror = () => {
      es.close();
      setState((s) => s.status !== "complete" ? { ...s, status: "error", error: "Connection lost — server may still be running" } : s);
    };
  };

  const handleReset = () => setState(EMPTY_STATE);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-logo">
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
          {state.status !== "idle" && (
            <button className="btn btn-ghost" onClick={handleReset} style={{ fontSize: ".8rem", padding: "6px 14px" }}>
              ← New Session
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {state.status === "idle" && (
          <ThinkTankInput serverConfig={serverConfig} onStart={handleStart} />
        )}
        {state.status === "running" && (
          <LiveDebate state={state} />
        )}
        {state.status === "complete" && (
          <FinalResult state={state} onReset={handleReset} />
        )}
        {state.status === "error" && (
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
    </div>
  );
}
