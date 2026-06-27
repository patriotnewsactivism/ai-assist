import { useState, useEffect } from "react";
import ThinkTankInput from "./components/ThinkTankInput";
import LiveDebate from "./components/LiveDebate";
import FinalResult from "./components/FinalResult";
import "./App.css";
import type {
  AgentRole,
  AgentTurn,
  JudgeVerdict,
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

export default function App() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [state, setState] = useState<AppState>({
    status: "idle",
    routing: null,
    rounds: [],
    turns: [],
    thinking: null,
    finalOutput: "",
    totalRounds: 0,
  });

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ServerConfig) => setServerConfig(cfg))
      .catch(console.error);
  }, []);

  const handleStart = async (
    input: string,
    maxRounds: number,
    agentModels: Record<AgentRole, { provider: Provider; modelId: string }>
  ) => {
    setState({ status: "running", routing: null, rounds: [], turns: [], thinking: null, finalOutput: "", totalRounds: 0 });

    // Start session
    let sessionId: string;
    try {
      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, maxRounds, agentModels }),
      });
      const data = await res.json() as { sessionId: string };
      sessionId = data.sessionId;
    } catch (err) {
      setState((s) => ({ ...s, status: "error", error: "Failed to start session" }));
      return;
    }

    // Connect SSE
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
            return {
              ...prev,
              thinking: null,
              turns: [...prev.turns, event.data],
            };

          case "round_complete":
            return {
              ...prev,
              rounds: [...prev.rounds, event.data],
            };

          case "complete":
            es.close();
            return {
              ...prev,
              status: "complete",
              thinking: null,
              finalOutput: event.data.finalOutput,
              totalRounds: event.data.totalRounds,
            };

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
      setState((s) =>
        s.status !== "complete"
          ? { ...s, status: "error", error: "Connection lost" }
          : s
      );
    };
  };

  const handleReset = () => {
    setState({ status: "idle", routing: null, rounds: [], turns: [], thinking: null, finalOutput: "", totalRounds: 0 });
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <h1>⚡ AI Think Tank</h1>
          <p>A roundtable of specialized AI agents that research, challenge, and refine until perfect</p>
        </div>
      </header>

      <main className="app-main">
        {state.status === "idle" && (
          <ThinkTankInput
            serverConfig={serverConfig}
            onStart={handleStart}
          />
        )}

        {(state.status === "running") && (
          <LiveDebate state={state} />
        )}

        {state.status === "complete" && (
          <FinalResult
            state={state}
            onReset={handleReset}
          />
        )}

        {state.status === "error" && (
          <div className="error-screen">
            <div className="error-icon">❌</div>
            <h2>Something went wrong</h2>
            <p>{state.error}</p>
            <button onClick={handleReset} className="btn-primary">Try Again</button>
          </div>
        )}
      </main>
    </div>
  );
}
