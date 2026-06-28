import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { EventEmitter } from "events";
import path from "path";
import { fileURLToPath } from "url";
import {
  routeInput,
  runRoundtable,
  DEFAULT_AGENT_MODELS,
  getAvailableProviders,
  isTavilyEnabled,
  AGENT_META,
} from "./engine/index.js";
import type { ThinkTankConfig, SSEEventPayload, AgentRole, Provider } from "./engine/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env["PORT"] || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "dist")));

// Per-session event emitters for SSE
const sessionEmitters = new Map<string, EventEmitter>();
const sessionResults = new Map<string, { finalOutput: string; error?: string }>();

// GET /api/config — tell the frontend what providers and features are available
app.get("/api/config", (_req, res) => {
  res.json({
    availableProviders: getAvailableProviders(),
    tavilyEnabled: isTavilyEnabled(),
    agentMeta: AGENT_META,
    defaultModels: DEFAULT_AGENT_MODELS,
  });
});

// POST /api/debate — start a think tank session, returns sessionId immediately
app.post("/api/debate", (req, res) => {
  const { input, maxRounds = 3, agentModels, customContext, qualityThreshold, expertDomain } = req.body as {
    input: string;
    maxRounds?: number;
    agentModels?: Record<AgentRole, { provider: Provider; modelId: string }>;
    customContext?: string;
    qualityThreshold?: number;
    expertDomain?: string;
  };

  if (!input?.trim()) {
    return res.status(400).json({ error: "Input is required" });
  }

  const sessionId = Date.now().toString();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  sessionEmitters.set(sessionId, emitter);

  const config: ThinkTankConfig = {
    input: input.trim(),
    maxRounds: Math.min(Math.max(1, maxRounds), 8),
    agentModels: agentModels ?? DEFAULT_AGENT_MODELS,
    ...(customContext ? { customContext } : {}),
    ...(qualityThreshold !== undefined ? { qualityThreshold } : {}),
    ...(expertDomain ? { expertDomain } : {}),
  };

  // Run in background
  (async () => {
    try {
      const routing = await routeInput(config.input);
      emitter.emit("event", { type: "routing", data: routing } satisfies SSEEventPayload);

      const finalOutput = await runRoundtable(config, routing, (event) => {
        emitter.emit("event", event);
      });

      sessionResults.set(sessionId, { finalOutput });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      emitter.emit("event", { type: "error", data: { message } } satisfies SSEEventPayload);
      sessionResults.set(sessionId, { finalOutput: "", error: message });
    } finally {
      emitter.emit("done");
      setTimeout(() => {
        sessionEmitters.delete(sessionId);
        sessionResults.delete(sessionId);
      }, 120_000);
    }
  })();

  res.json({ sessionId });
});

// GET /api/debate/stream/:sessionId — SSE stream of all events
app.get("/api/debate/stream/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const emitter = sessionEmitters.get(sessionId);

  if (!emitter) {
    // Session may have already completed
    const result = sessionResults.get(sessionId);
    if (result) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "complete", data: { finalOutput: result.finalOutput, totalRounds: 0 } })}\n\n`);
      res.end();
      return;
    }
    return res.status(404).json({ error: "Session not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const onEvent = (event: SSEEventPayload) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const onDone = () => {
    res.end();
    cleanup();
  };

  const cleanup = () => {
    emitter.off("event", onEvent);
    emitter.off("done", onDone);
  };

  emitter.on("event", onEvent);
  emitter.once("done", onDone);
  req.on("close", cleanup);
});

// Fallback: serve React app
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 AI Think Tank running at http://localhost:${PORT}`);
  console.log(`📡 Providers: ${getAvailableProviders().join(", ") || "none"}`);
  console.log(`🔍 Web search: ${isTavilyEnabled() ? "enabled (Tavily)" : "disabled"}`);
});
