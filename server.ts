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
  FALLBACK_AGENT_MODELS,
  getAvailableProviders,
  isTavilyEnabled,
  isGitHubConfigured,
  AGENT_META,
  fetchRepoFiles,
  buildRepoContext,
  createPullRequest,
  parseFilesFromOutput,
} from "./engine/index.js";
import type { ThinkTankConfig, SSEEventPayload, AgentRole, Provider } from "./engine/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env["PORT"] || 5000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "dist")));

// Per-session event emitters for SSE
const sessionEmitters = new Map<string, EventEmitter>();
const sessionResults = new Map<string, { finalOutput: string; error?: string }>();

// GET /api/config — tell the frontend what providers and features are available
app.get("/api/config", (_req, res) => {
  res.json({
    availableProviders: getAvailableProviders(),
    tavilyEnabled: isTavilyEnabled(),
    githubConfigured: isGitHubConfigured(),
    agentMeta: AGENT_META,
    defaultModels: DEFAULT_AGENT_MODELS,
  });
});

// POST /api/repo/import — fetch a GitHub repo's files as context
app.post("/api/repo/import", async (req, res) => {
  const { repoUrl, token } = req.body as { repoUrl: string; token?: string };
  if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });
  const effectiveToken = token || (process.env["GITHUB_TOKEN"] ?? "").trim() || undefined;
  try {
    const files = await fetchRepoFiles(repoUrl, effectiveToken);
    res.json({ files: files.map((f) => ({ path: f.path, size: f.content.length })) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    res.status(400).json({ error: message });
  }
});

// POST /api/repo/push — parse file changes from output and create a GitHub PR
app.post("/api/repo/push", async (req, res) => {
  const { repoUrl, finalOutput, prTitle, token } = req.body as {
    repoUrl: string;
    finalOutput: string;
    prTitle: string;
    token?: string;
  };

  if (!repoUrl || !finalOutput) return res.status(400).json({ error: "repoUrl and finalOutput are required" });

  const effectiveToken = token || (process.env["GITHUB_TOKEN"] ?? "").trim();
  if (!effectiveToken) return res.status(400).json({ error: "GitHub token required — add GITHUB_TOKEN to .env or provide it in the request" });

  const files = parseFilesFromOutput(finalOutput);
  if (files.length === 0) {
    return res.status(400).json({
      error: "No files detected in the output. Make sure the session ran in CODE_MODE and the synthesizer produced === FILE: path === blocks.",
    });
  }

  try {
    const prBody = `## AI Think Tank Output\n\nThis PR was generated automatically by the AI Think Tank.\n\n**Files changed:** ${files.length}\n\n${files.map((f) => `- \`${f.path}\``).join("\n")}`;
    const prUrl = await createPullRequest(repoUrl, files, prTitle || "Think Tank: AI-generated changes", prBody, effectiveToken);
    res.json({ prUrl, filesCommitted: files.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Push failed";
    res.status(400).json({ error: message });
  }
});

// POST /api/debate — start a think tank session, returns sessionId immediately
app.post("/api/debate", (req, res) => {
  const { input, maxRounds = 3, agentModels, customContext, qualityThreshold, expertDomain, repoUrl, repoToken, enableSteelman } = req.body as {
    input: string;
    maxRounds?: number;
    agentModels?: Record<AgentRole, { provider: Provider; modelId: string }>;
    customContext?: string;
    qualityThreshold?: number;
    expertDomain?: string;
    repoUrl?: string;
    repoToken?: string;
    enableSteelman?: boolean;
  };

  if (!input?.trim()) {
    return res.status(400).json({ error: "Input is required" });
  }

  const sessionId = Date.now().toString();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  sessionEmitters.set(sessionId, emitter);

  // Run in background
  (async () => {
    try {
      let fullContext = customContext || "";
      if (repoUrl) {
        const token = repoToken || (process.env["GITHUB_TOKEN"] ?? "").trim() || undefined;
        const files = await fetchRepoFiles(repoUrl, token);
        const repoCtx = buildRepoContext(files);
        fullContext = fullContext ? `${fullContext}\n\n${repoCtx}` : repoCtx;
      }

      const config: ThinkTankConfig = {
        input: input.trim(),
        maxRounds: Math.min(Math.max(1, maxRounds), 8),
        // Auto-fallback: if no Anthropic key, use all-Gemini lineup
        agentModels: agentModels ?? (
          (process.env["ANTHROPIC_API_KEY"] || "").trim()
            ? DEFAULT_AGENT_MODELS
            : FALLBACK_AGENT_MODELS
        ),
        ...(fullContext ? { customContext: fullContext } : {}),
        ...(qualityThreshold !== undefined ? { qualityThreshold } : {}),
        ...(expertDomain ? { expertDomain } : {}),
      };
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
