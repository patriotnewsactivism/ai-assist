import OpenAI from "openai";
import type { Provider } from "./types.js";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Current production aliases. These deliberately translate older model IDs
// still persisted in saved UI state / defaults into live 2026 endpoints.
// This lets old sessions recover without forcing users to manually re-select
// every agent model after a provider retires or renames an endpoint.
const MODEL_ALIASES: Record<string, string> = {
  // Groq free plan: 1,000 RPD / 200K TPD; strong reasoning model.
  "groq:llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "groq:mixtral-8x7b-32768": "openai/gpt-oss-120b",

  // Gemini 3.1 Flash-Lite currently has a free API tier and thinking support.
  "gemini:gemini-2.5-flash": "gemini-3.1-flash-lite",
  "gemini:gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
  "gemini:gemini-2.0-flash": "gemini-3.1-flash-lite",

  // Live-tested OpenRouter free reasoning endpoint (2026-09-10).
  "openrouter:nvidia/nemotron-3-super-120b-a12b:free": "inclusionai/ling-3.0-flash-vl:free",
  "openrouter:openai/gpt-oss-120b:free": "inclusionai/ling-3.0-flash-vl:free",

  // Command A+ is Cohere's newer reasoning/agentic model and is free until
  // its request limits are reached for trial/newer-model access.
  "cohere:command-a-reasoning-08-2025": "command-a-plus-05-2026",
};

function resolveModelId(provider: Provider, modelId: string): string {
  const resolved = MODEL_ALIASES[`${provider}:${modelId}`] ?? modelId;
  if (resolved !== modelId) {
    console.warn(`[Provider] Remapped ${provider}/${modelId} -> ${provider}/${resolved}`);
  }
  return resolved;
}

// Token limits are intentionally conservative for free-plan routes. Groq's
// free-plan TPM is the tightest constraint, so leave room for prompt tokens.
const MAX_TOKENS: Record<string, number> = {
  "gemini-3.1-flash-lite": 8192,
  "gemini-2.5-flash": 8192,
  "gpt-4o": 16384,
  "gpt-4o-mini": 8192,
  "openai/gpt-oss-120b": 2048,
  "qwen/qwen3.8-27b": 2048,
  "llama-3.1-8b-instant": 2048,
  "inclusionai/ling-3.0-flash-vl:free": 8192,
  "nex-agi/nex-n2.5-pro:free": 8192,
  "nex-agi/nex-n2.5-mini:free": 8192,
  "nvidia/nemotron-3-ultra-550b-a55b:free": 8192,
  "command-a-plus-05-2026": 8192,
  "command-a-reasoning-08-2025": 8192,
};

function getMaxTokens(modelId: string): number {
  return MAX_TOKENS[modelId] ?? 8192;
}

function buildOpenAIClient(provider: Provider): OpenAI {
  const common = { timeout: 45_000, maxRetries: 0 } as const;

  if (provider === "deepseek") {
    return new OpenAI({
      ...common,
      baseURL: "https://api.deepseek.com/v1",
      apiKey: (process.env["DEEPSEEK_API_KEY"] || "").trim(),
    });
  }
  if (provider === "gemini") {
    return new OpenAI({
      ...common,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: (process.env["GEMINI_API_KEY"] || "").trim(),
    });
  }
  if (provider === "groq") {
    return new OpenAI({
      ...common,
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: (process.env["GROQ_API_KEY"] || "").trim(),
    });
  }
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
  if (provider === "cohere") {
    return new OpenAI({
      ...common,
      baseURL: "https://api.cohere.ai/compatibility/v1",
      apiKey: (process.env["COHERE_API_KEY"] || "").trim(),
    });
  }
  return new OpenAI({
    ...common,
    apiKey: (process.env["OPENAI_API_KEY"] || "").trim(),
  });
}

function getHttpStatus(err: unknown): number | undefined {
  return (err as any)?.status ?? (err as any)?.statusCode;
}

function is429(err: unknown): boolean {
  const s = getHttpStatus(err);
  return s === 429 || (!s && String((err as any)?.message).includes("429"));
}

function isAuthError(err: unknown): boolean {
  const s = getHttpStatus(err);
  return s === 401 || s === 403;
}

// 400 "credit balance too low" — provider is configured but has no funds; don't retry
export function isOutOfCredits(err: unknown): boolean {
  const s = getHttpStatus(err);
  if (s !== 400 && s !== 402) return false;
  const body = String((err as any)?.message ?? (err as any)?.error?.message ?? "");
  return /credit balance|insufficient|billing|quota exceeded|payment required/i.test(body);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Bad credentials should not be retried by every agent in a six-agent round.
// One 401/403 opens a provider-level circuit for 15 minutes. The next fallback
// is then selected locally with no network call, eliminating failure cascades.
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

export async function callModel(
  provider: Provider,
  modelId: string,
  messages: Message[],
  { retries = 2, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ content: string; reasoning?: string }> {
  let lastErr: unknown;
  const resolvedModelId = resolveModelId(provider, modelId);

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
        messages,
        max_tokens: getMaxTokens(resolvedModelId),
      });

      const msg = response.choices[0]?.message as any;
      return {
        content: msg?.content ?? "",
        reasoning: msg?.reasoning_content ?? msg?.reasoning ?? undefined,
      };
    } catch (err) {
      lastErr = err;
      if (isAuthError(err)) {
        const status = getHttpStatus(err) ?? 401;
        providerAuthCooldown.set(provider, { until: Date.now() + AUTH_COOLDOWN_MS, status });
        console.error(`[Provider] ${provider} disabled for 15m after HTTP ${status}; fallbacks will skip network retries`);
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
  if ((process.env["GEMINI_API_KEY"]     || "").trim()) available.push("gemini");
  if ((process.env["DEEPSEEK_API_KEY"]   || "").trim()) available.push("deepseek");
  if ((process.env["GROQ_API_KEY"]       || "").trim()) available.push("groq");
  if ((process.env["OPENAI_API_KEY"]     || "").trim()) available.push("openai");
  if ((process.env["OPENROUTER_API_KEY"] || "").trim()) available.push("openrouter");
  if ((process.env["COHERE_API_KEY"]     || "").trim()) available.push("cohere");
  return available;
}
