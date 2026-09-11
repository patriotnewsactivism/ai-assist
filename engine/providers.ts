import OpenAI from "openai";
import type { Provider } from "./types.js";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Keep legacy/deprecated selections working without forcing users to reconfigure saved sessions.
// Inkling's free endpoints currently require an agentic harness, so general chat requests are
// transparently routed through OpenRouter's working free router instead of failing with HTTP 403.
const MODEL_ALIASES: Record<string, string> = {
  "groq:llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "groq:mixtral-8x7b-32768": "openai/gpt-oss-120b",
  "gemini:gemini-2.5-flash": "gemini-3.1-flash-lite",
  "gemini:gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
  "gemini:gemini-2.0-flash": "gemini-3.1-flash-lite",
  "openrouter:nvidia/nemotron-3-super-120b-a12b:free": "inclusionai/ling-3.0-flash-vl:free",
  "openrouter:openai/gpt-oss-120b:free": "inclusionai/ling-3.0-flash-vl:free",
  "openrouter:thinkingmachines/inkling-small:free": "openrouter/free",
  "openrouter:thinkingmachines/inkling:free": "openrouter/free",
  "cohere:command-a-reasoning-08-2025": "command-a-plus-05-2026",
};

function resolveModelId(provider: Provider, modelId: string): string {
  const resolved = MODEL_ALIASES[`${provider}:${modelId}`] ?? modelId;
  if (resolved !== modelId) {
    console.warn(`[Provider] Remapped ${provider}/${modelId} -> ${provider}/${resolved}`);
  }
  return resolved;
}

const MAX_TOKENS: Record<string, number> = {
  "openrouter/free": 8192,
  "thinkingmachines/inkling-small:free": 16384,
  "thinkingmachines/inkling:free": 16384,
  "nvidia/nemotron-3-ultra-550b-a55b:free": 16384,
  "nvidia/nemotron-3.5-lightning:free": 16384,
  "nex-agi/nex-n2.5-pro:free": 8192,
  "nex-agi/nex-n2.5-mini:free": 8192,
  "inclusionai/ling-3.0-flash-vl:free": 8192,
  "gemini-3.1-flash-lite": 8192,
  "gemini-2.5-flash": 8192,
  "gemini-2.0-flash-lite": 8192,
  "gemini-2.0-flash": 8192,
  "gpt-4o": 16384,
  "gpt-4o-mini": 8192,
  "openai/gpt-oss-120b": 2048,
  "qwen/qwen3.8-27b": 2048,
  "llama-3.1-8b-instant": 2048,
  "command-a-plus-05-2026": 8192,
  "command-a-reasoning-08-2025": 8192,
};

function getMaxTokens(modelId: string): number {
  return MAX_TOKENS[modelId] ?? 8192;
}

// Large repository imports can exceed 500k tokens. Every currently used free OpenRouter
// endpoint in this app is safe when we keep the request well below 262k tokens.
// 480k characters is roughly 100k-150k tokens for typical source/code text.
const MAX_INPUT_CHARS = 480_000;

function compactText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const marker = "\n\n[... middle context compacted to fit the model context window ...]\n\n";
  const usable = Math.max(0, budget - marker.length);
  const head = Math.floor(usable * 0.65);
  const tail = usable - head;
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`;
}

function compactMessages(messages: Message[]): Message[] {
  const total = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (total <= MAX_INPUT_CHARS) return messages;

  const perMessage = Math.max(16_000, Math.floor(MAX_INPUT_CHARS / Math.max(messages.length, 1)));
  const compacted = messages.map((m) => ({ ...m, content: compactText(m.content, perMessage) }));
  const compactedTotal = compacted.reduce((sum, m) => sum + m.content.length, 0);
  console.warn(`[Provider] Compacted prompt from ${total} to ${compactedTotal} characters to prevent context overflow`);
  return compacted;
}

function buildOpenAIClient(provider: Provider): OpenAI {
  const common = { timeout: 45_000, maxRetries: 0 } as const;
  if (provider === "deepseek") return new OpenAI({ ...common, baseURL: "https://api.deepseek.com/v1", apiKey: (process.env["DEEPSEEK_API_KEY"] || "").trim() });
  if (provider === "gemini") return new OpenAI({ ...common, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: (process.env["GEMINI_API_KEY"] || "").trim() });
  if (provider === "groq") return new OpenAI({ ...common, baseURL: "https://api.groq.com/openai/v1", apiKey: (process.env["GROQ_API_KEY"] || "").trim() });
  if (provider === "openrouter") {
    return new OpenAI({
      ...common,
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: (process.env["OPENROUTER_API_KEY"] || "").trim(),
      defaultHeaders: {
        "HTTP-Referer": "https://debate.donmatthews.live",
        "X-Title": "AI Think Tank",
      },
    });
  }
  if (provider === "cohere") return new OpenAI({ ...common, baseURL: "https://api.cohere.ai/compatibility/v1", apiKey: (process.env["COHERE_API_KEY"] || "").trim() });
  return new OpenAI({ ...common, apiKey: (process.env["OPENAI_API_KEY"] || "").trim() });
}

function getHttpStatus(err: unknown): number | undefined {
  return (err as any)?.status ?? (err as any)?.statusCode;
}

function getErrorDetail(err: unknown): string {
  const raw = (err as any)?.error?.message ?? (err as any)?.message ?? String(err);
  return String(raw).replace(/\s+/g, " ").slice(0, 1200);
}

function is429(err: unknown): boolean {
  const s = getHttpStatus(err);
  return s === 429 || (!s && String((err as any)?.message).includes("429"));
}

function isHardAuthError(err: unknown): boolean {
  return getHttpStatus(err) === 401;
}

export function isOutOfCredits(err: unknown): boolean {
  const s = getHttpStatus(err);
  if (s !== 400 && s !== 402) return false;
  const body = String((err as any)?.message ?? (err as any)?.error?.message ?? "");
  return /credit balance|insufficient|billing|quota exceeded|payment required/i.test(body);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const AUTH_COOLDOWN_MS = 15 * 60 * 1000;
const providerAuthCooldown = new Map<Provider, { until: number; status: number }>();

function assertProviderNotCoolingDown(provider: Provider): void {
  const state = providerAuthCooldown.get(provider);
  if (!state) return;
  if (Date.now() >= state.until) {
    providerAuthCooldown.delete(provider);
    return;
  }
  const err = new Error(`${provider} temporarily disabled after HTTP ${state.status} authentication failure`);
  (err as any).status = state.status;
  throw err;
}

async function validateOpenRouterCredential(): Promise<void> {
  const key = (process.env["OPENROUTER_API_KEY"] || "").trim();
  if (!key) return;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(`[OpenRouter] credential validation failed HTTP ${response.status}: ${body.replace(/\s+/g, " ").slice(0, 1200)}`);
      return;
    }
    console.log("[OpenRouter] credential validation OK");
  } catch (err) {
    console.error(`[OpenRouter] credential validation request failed: ${getErrorDetail(err)}`);
  }
}

async function probeOpenRouterFreeInference(): Promise<void> {
  const key = (process.env["OPENROUTER_API_KEY"] || "").trim();
  if (!key) return;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://debate.donmatthews.live",
        "X-Title": "AI Think Tank",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 8,
      }),
    });
    const body = await response.text();
    if (response.ok) console.log("[OpenRouter] free inference probe OK");
    else console.error(`[OpenRouter] free inference probe failed HTTP ${response.status}: ${body.replace(/\s+/g, " ").slice(0, 1200)}`);
  } catch (err) {
    console.error(`[OpenRouter] free inference probe request failed: ${getErrorDetail(err)}`);
  }
}

void validateOpenRouterCredential().then(() => probeOpenRouterFreeInference());

export async function callModel(
  provider: Provider,
  modelId: string,
  messages: Message[],
  { retries = 2, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ content: string; reasoning?: string }> {
  let lastErr: unknown;
  const resolvedModelId = resolveModelId(provider, modelId);
  const safeMessages = compactMessages(messages);

  assertProviderNotCoolingDown(provider);

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`[Provider] 429 on ${provider}/${resolvedModelId} — retrying in ${delay}ms (attempt ${attempt}/${retries})`);
      await sleep(delay);
    }

    try {
      const client = buildOpenAIClient(provider);
      const response = await client.chat.completions.create({
        model: resolvedModelId,
        messages: safeMessages,
        max_tokens: getMaxTokens(resolvedModelId),
      });

      const choice = response.choices?.[0];
      const msg = choice?.message as any;
      if (!msg) {
        const err = new Error(`${provider}/${resolvedModelId} returned no completion choices`);
        (err as any).status = 502;
        throw err;
      }

      return {
        content: msg.content ?? "",
        reasoning: msg.reasoning_content ?? msg.reasoning ?? undefined,
      };
    } catch (err) {
      lastErr = err;
      const status = getHttpStatus(err);
      console.error(`[Provider] ${provider}/${resolvedModelId} failed${status ? ` HTTP ${status}` : ""}: ${getErrorDetail(err)}`);

      if (isHardAuthError(err)) {
        const authStatus = status ?? 401;
        providerAuthCooldown.set(provider, { until: Date.now() + AUTH_COOLDOWN_MS, status: authStatus });
        console.error(`[Provider] ${provider} disabled for 15m after HTTP ${authStatus}; fallbacks will skip network retries`);
        throw err;
      }
      if (isOutOfCredits(err)) throw err;
      if (!is429(err)) throw err;
    }
  }

  throw lastErr;
}

export function getAvailableProviders(): Provider[] {
  const available: Provider[] = [];
  if ((process.env["GEMINI_API_KEY"] || "").trim()) available.push("gemini");
  if ((process.env["DEEPSEEK_API_KEY"] || "").trim()) available.push("deepseek");
  if ((process.env["GROQ_API_KEY"] || "").trim()) available.push("groq");
  if ((process.env["OPENAI_API_KEY"] || "").trim()) available.push("openai");
  if ((process.env["OPENROUTER_API_KEY"] || "").trim()) available.push("openrouter");
  if ((process.env["COHERE_API_KEY"] || "").trim()) available.push("cohere");
  return available;
}
