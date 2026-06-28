import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { EventEmitter } from "events";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
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
  extractPdf,
  extractDocx,
  extractHtml,
  fetchUrl,
} from "./engine/index.js";
import type { ThinkTankConfig, SSEEventPayload, AgentRole, Provider } from "./engine/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validate at startup — fail fast with a clear message rather than a cryptic auth error on first request
const GEMINI_KEY    = (process.env["GEMINI_API_KEY"]   || "").trim();
const ANTHROPIC_KEY = (process.env["ANTHROPIC_API_KEY"] || "").trim();
const DEEPSEEK_KEY  = (process.env["DEEPSEEK_API_KEY"]  || "").trim();
const OPENAI_KEY    = (process.env["OPENAI_API_KEY"]    || "").trim();
const GROQ_KEY      = (process.env["GROQ_API_KEY"]      || "").trim();
if (!GEMINI_KEY && !ANTHROPIC_KEY && !DEEPSEEK_KEY && !OPENAI_KEY && !GROQ_KEY) {
  console.error("[Server] FATAL: No API keys configured. Set at least GEMINI_API_KEY or DEEPSEEK_API_KEY in your .env file.");
  process.exit(1);
}

const app = express();
const PORT = process.env["PORT"] || 5000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "dist")));

// Per-session event emitters for SSE
const sessionEmitters = new Map<string, EventEmitter>();
const sessionResults  = new Map<string, { finalOutput: string; error?: string }>();

// In-memory document store — keyed by docId, cleaned up after use
const uploadedDocs = new Map<string, string>();

// Multer — memory storage, 10MB limit per file, max 5 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// GET /api/config
app.get("/api/config", (_req, res) => {
  res.json({
    availableProviders: getAvailableProviders(),
    tavilyEnabled: isTavilyEnabled(),
    githubConfigured: isGitHubConfigured(),
    agentMeta: AGENT_META,
    defaultModels: DEFAULT_AGENT_MODELS,
  });
});

// POST /api/repo/import
app.post("/api/repo/import", async (req, res) => {
  const { repoUrl, token } = req.body as { repoUrl: string; token?: string };
  if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });
  const effectiveToken = token || (process.env["GITHUB_TOKEN"] ?? "").trim() || undefined;
  try {
    const files = await fetchRepoFiles(repoUrl, effectiveToken);
    res.json({ files: files.map((f) => ({ path: f.path, size: f.content.length })) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

// POST /api/repo/push
app.post("/api/repo/push", async (req, res) => {
  const { repoUrl, finalOutput, prTitle, token } = req.body as {
    repoUrl: string; finalOutput: string; prTitle: string; token?: string;
  };
  if (!repoUrl || !finalOutput) return res.status(400).json({ error: "repoUrl and finalOutput are required" });
  const effectiveToken = token || (process.env["GITHUB_TOKEN"] ?? "").trim();
  if (!effectiveToken) return res.status(400).json({ error: "GitHub token required" });
  const files = parseFilesFromOutput(finalOutput);
  if (files.length === 0) return res.status(400).json({ error: "No files detected in the output." });
  try {
    const prBody = `## AI Think Tank Output\n\nThis PR was generated automatically by the AI Think Tank.\n\n**Files changed:** ${files.length}\n\n${files.map((f) => `- \`${f.path}\``).join("\n")}`;
    const prUrl = await createPullRequest(repoUrl, files, prTitle || "Think Tank: AI-generated changes", prBody, effectiveToken);
    res.json({ prUrl, filesCommitted: files.length });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Push failed" });
  }
});

// POST /api/documents/upload — parse uploaded files and store extracted text
app.post("/api/documents/upload", upload.array("files", 5), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) return res.status(400).json({ error: "No files provided" });

  const MAX_TOTAL = 200_000;
  const parts: string[] = [];
  const meta: { name: string; size: number }[] = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    let text = "";
    try {
      if (ext === ".pdf") {
        text = await extractPdf(file.buffer);
      } else if (ext === ".docx") {
        text = await extractDocx(file.buffer);
      } else if (ext === ".html" || ext === ".htm") {
        text = extractHtml(file.buffer.toString("utf8"));
      } else {
        // .txt, .md, and anything else — plain text
        text = file.buffer.toString("utf8");
      }
    } catch (err) {
      return res.status(422).json({ error: `Could not parse ${file.originalname}: ${err instanceof Error ? err.message : err}` });
    }
    parts.push(`### ${file.originalname}\n\n${text}`);
    meta.push({ name: file.originalname, size: file.size });
  }

  let combined = parts.join("\n\n---\n\n");
  if (combined.length > MAX_TOTAL) {
    combined = combined.slice(0, MAX_TOTAL) + "\n\n[...truncated]";
  }

  const docId = `doc_${Date.now()}`;
  uploadedDocs.set(docId, combined);

  // Auto-clean after 30 minutes in case the session never starts
  setTimeout(() => uploadedDocs.delete(docId), 30 * 60 * 1000);

  res.json({ docId, files: meta, totalChars: combined.length });
});

// POST /api/documents/fetch-url — fetch and extract a URL
app.post("/api/documents/fetch-url", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url?.trim()) return res.status(400).json({ error: "url is required" });

  try {
    const { text, title, contentType } = await fetchUrl(url.trim());
    const docId = `doc_${Date.now()}`;
    uploadedDocs.set(docId, text);
    setTimeout(() => uploadedDocs.delete(docId), 30 * 60 * 1000);
    res.json({ docId, title, url: url.trim(), contentType, totalChars: text.length });
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : "Failed to fetch URL" });
  }
});

// POST /api/debate — start a think tank session
app.post("/api/debate", (req, res) => {
  const {
    input, maxRounds = 3, agentModels, customContext,
    qualityThreshold, expertDomain, repoUrl, repoToken,
    enableSteelman, docId,
  } = req.body as {
    input: string;
    maxRounds?: number;
    agentModels?: Record<AgentRole, { provider: Provider; modelId: string }>;
    customContext?: string;
    qualityThreshold?: number;
    expertDomain?: string;
    repoUrl?: string;
    repoToken?: string;
    enableSteelman?: boolean;
    docId?: string;
  };

  if (!input?.trim()) return res.status(400).json({ error: "Input is required" });

  const sessionId = Date.now().toString();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  sessionEmitters.set(sessionId, emitter);

  (async () => {
    try {
      let fullContext = customContext || "";

      // Prepend uploaded document / URL content
      if (docId) {
        const docText = uploadedDocs.get(docId);
        if (docText) {
          const docBlock = `DOCUMENT TO IMPROVE:\n\n${docText}`;
          fullContext = fullContext ? `${docBlock}\n\n${fullContext}` : docBlock;
          uploadedDocs.delete(docId); // one-time use
        }
      }

      // Append repo context
      if (repoUrl) {
        const token = repoToken || (process.env["GITHUB_TOKEN"] ?? "").trim() || undefined;
        const files = await fetchRepoFiles(repoUrl, token);
        const repoCtx = buildRepoContext(files);
        fullContext = fullContext ? `${fullContext}\n\n${repoCtx}` : repoCtx;
      }

      const config: ThinkTankConfig = {
        input: input.trim(),
        maxRounds: Math.min(Math.max(1, maxRounds), 8),
        agentModels: agentModels ?? (
          (process.env["ANTHROPIC_API_KEY"] || "").trim()
            ? DEFAULT_AGENT_MODELS
            : FALLBACK_AGENT_MODELS
        ),
        ...(fullContext ? { customContext: fullContext } : {}),
        ...(qualityThreshold !== undefined ? { qualityThreshold } : {}),
        ...(expertDomain ? { expertDomain } : {}),
        ...(enableSteelman !== undefined ? { enableSteelman } : {}),
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

// GET /api/debate/stream/:sessionId — SSE stream
app.get("/api/debate/stream/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const emitter = sessionEmitters.get(sessionId);

  if (!emitter) {
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

  const onEvent = (event: SSEEventPayload) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const onDone  = () => { res.end(); cleanup(); };
  const cleanup = () => { emitter.off("event", onEvent); emitter.off("done", onDone); };

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
