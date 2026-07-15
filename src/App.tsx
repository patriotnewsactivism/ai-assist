import { useState, useEffect, useRef } from "react";
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
  SandboxResultEvent,
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
  sandboxResults: SandboxResultEvent[];
  thinking: ThinkingAgent | null;
  finalOutput: string;
  totalRounds: number;
  enableSteelman: boolean;
  repoUrl?: string;
  error?: string;
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

// One TTS clip at a time, in strict order — each agent finishes speaking before
// the next one starts, so the debate reads like a real back-and-forth.
interface TtsItem {
  role: string;
  text: string;
}

export default function App() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [voiceOn, setVoiceOn] = useState(true);

  const ttsQueueRef = useRef<TtsItem[]>([]);
  const ttsPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ServerConfig) => setServerConfig(cfg))
      .catch(console.error);
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
        // Hard guard: never let two clips be audible at once, even if a stale
        // reference somehow survived (e.g. a slow network response racing a reset).
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
    // Strip code blocks — reading raw code aloud isn't useful, and keeps clips snappy
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

  const sessionDoneRef = useRef(false);

  const handleStart = async (cfg: SessionConfig) => {
    sessionDoneRef.current = false;
    stopVoice();
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
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to start session",
      }));
      return;
    }

    let retryCount = 0;
    const MAX_RETRIES = 6;
    let es: EventSource;

    const attachHandlers = (source: EventSource) => {
      source.onmessage = (e: MessageEvent<string>) => {
        retryCount = 0; // any real message means the connection is healthy again
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
              return { ...prev, status: "complete", thinking: null, finalOutput: event.data.finalOutput, totalRounds: event.data.totalRounds };
            case "error":
              sessionDoneRef.current = true;
              source.close();
              return { ...prev, status: "error", thinking: null, error: event.data.message };
            default:
              return prev;
          }
        });
      };

      source.onerror = () => {
        if (sessionDoneRef.current) return; // session already finished cleanly — ignore
        source.close();

        if (retryCount >= MAX_RETRIES) {
          setState((s) => s.status !== "complete" ? { ...s, status: "error", error: "Connection lost and could not be restored. Check Run History — progress up to the disconnect was saved." } : s);
          return;
        }

        retryCount += 1;
        const delayMs = Math.min(1000 * 2 ** (retryCount - 1), 10_000); // 1s,2s,4s,8s,10s,10s
        setState((s) => s.status === "running" ? { ...s, error: `Connection lost — reconnecting (attempt ${retryCount}/${MAX_RETRIES})...` } : s);
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

  const handleReset = () => {
    stopVoice();
    setState(EMPTY_STATE);
  };

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
