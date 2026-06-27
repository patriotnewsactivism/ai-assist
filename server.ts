import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { routeInput, runAdversarialLoop } from "./engine.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "dist")));

interface DebateSession {
  id: string;
  input: string;
  routing: any;
  iterations: any[];
  status: "routing" | "debating" | "complete";
  finalOutput: string;
}

const sessions = new Map<string, DebateSession>();

// Route: Start a new debate
app.post("/api/debate", async (req, res) => {
  const { input, maxIterations = 4 } = req.body;

  if (!input || input.trim().length === 0) {
    return res.status(400).json({ error: "Input is required" });
  }

  const sessionId = Date.now().toString();
  const session: DebateSession = {
    id: sessionId,
    input,
    routing: null,
    iterations: [],
    status: "routing",
    finalOutput: "",
  };

  sessions.set(sessionId, session);

  try {
    // Route the input
    const routing = await routeInput(input);
    session.routing = routing;
    session.status = "debating";

    // Run the adversarial loop with progress callbacks
    const finalOutput = await runAdversarialLoop(routing, input, maxIterations, {
      onIteration: (data) => {
        session.iterations.push({
          iteration: data.iteration,
          auditorFeedback: data.auditorFeedback,
          creatorOutput: data.creatorOutput,
          isPerfect: data.isPerfect,
        });
      },
      onComplete: (output) => {
        session.status = "complete";
        session.finalOutput = output;
      },
    });

    session.finalOutput = finalOutput;
    session.status = "complete";

    res.json({
      sessionId,
      routing: session.routing,
      iterations: session.iterations,
      finalOutput: session.finalOutput,
    });
  } catch (error) {
    session.status = "complete";
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      sessionId,
    });
  }
});

// Route: Get session progress
app.get("/api/debate/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    sessionId: session.id,
    input: session.input,
    routing: session.routing,
    iterations: session.iterations,
    status: session.status,
    finalOutput: session.finalOutput,
  });
});

// Route: Get all sessions (for debugging)
app.get("/api/sessions", (req, res) => {
  const allSessions = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    input: s.input.substring(0, 100),
    status: s.status,
    iterations: s.iterations.length,
  }));

  res.json(allSessions);
});

// Fallback: Serve index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
