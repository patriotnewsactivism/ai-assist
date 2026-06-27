import { useState } from "react";
import DebateInput from "./components/DebateInput";
import DebateProgress from "./components/DebateProgress";
import DebateResult from "./components/DebateResult";
import "./App.css";

interface RouterOutput {
  mode: "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
  confidence_score: number;
  extracted_goal: string;
}

interface Iteration {
  iteration: number;
  auditorFeedback: string;
  creatorOutput: string;
  isPerfect: boolean;
}

interface DebateSession {
  sessionId: string;
  routing: RouterOutput | null;
  iterations: Iteration[];
  status: "idle" | "routing" | "debating" | "complete" | "error";
  finalOutput: string;
  error?: string;
}

function App() {
  const [session, setSession] = useState<DebateSession>({
    sessionId: "",
    routing: null,
    iterations: [],
    status: "idle",
    finalOutput: "",
  });

  const handleStartDebate = async (input: string, maxIterations: number) => {
    setSession({
      sessionId: "",
      routing: null,
      iterations: [],
      status: "routing",
      finalOutput: "",
    });

    try {
      const response = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, maxIterations }),
      });

      if (!response.ok) {
        throw new Error("Failed to start debate");
      }

      const data = await response.json();
      setSession({
        sessionId: data.sessionId,
        routing: data.routing,
        iterations: data.iterations,
        status: "complete",
        finalOutput: data.finalOutput,
      });
    } catch (error) {
      setSession((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  };

  const handleReset = () => {
    setSession({
      sessionId: "",
      routing: null,
      iterations: [],
      status: "idle",
      finalOutput: "",
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 AI Debate Engine</h1>
        <p>Two AI agents refine ideas through adversarial discussion</p>
      </header>

      <main className="app-main">
        {session.status === "idle" && <DebateInput onSubmit={handleStartDebate} />}
        {(session.status === "routing" || session.status === "debating") && (
          <DebateProgress routing={session.routing} iterations={session.iterations} />
        )}
        {session.status === "complete" && (
          <DebateResult
            routing={session.routing}
            iterations={session.iterations}
            finalOutput={session.finalOutput}
            onReset={handleReset}
          />
        )}
        {session.status === "error" && (
          <div className="error-container">
            <div className="error-message">❌ {session.error}</div>
            <button onClick={handleReset} className="reset-btn">
              Try Again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
