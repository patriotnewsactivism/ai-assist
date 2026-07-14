import OpenAI from "openai";
import type { Provider } from "./types.js";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Token limits per model — Gemini 2.5 Flash supports up to 65k output
// Groq free tier: 12,000 TPM total (input + output). Keep output low so input fits.
const MAX_TOKENS: Record<string, number> = {
  "gemini-2.5-flash": 16384,
  "gemini-2.0-flash-lite": 8192,
  "gemini-2.0-flash": 8192,
  "gpt-4o": 16384,
  "gpt-4o-mini": 8192,
  "llama-3.3-70b-versatile": 2048,   // Groq free tier 12k TPM — leave room for input
  "llama-3.1-8b-instant": 2048,
  "mixtral-8x7b-32768": 2048,
  "openai/gpt-oss-120b": 2048,
  "nvidia/nemotron-3-super-120b-a12b:free": 8192, // OpenRouter free tier
  "openai/gpt-oss-120b:free": 8192,                // OpenRouter free tier
  "command-a-reasoning-08-2025": 8192,              // Cohere's dedicated reasoning model
};

function getMaxTokens(modelId: string): number {
  return MAX_TOKENS[modelId] ?? 8192;
}

function buildOpenAIClient(provider: Provider): OpenAI {
  if (provider === "deepseek") {
    return new OpenAI({
      baseURL: "https://api.deepseek.com/v1",
      apiKey: (process.env["DEEPSEEK_API_KEY"] || "").trim(),
    });
  }
  if (provider === "gemini") {
    return new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: (process.env["GEMINI_API_KEY"] || "").trim(),
    });
  }
  if (provider === "groq") {
    return new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: (process.env["GROQ_API_KEY"] || "").trim(),
    });
  }
  if (provider === "openrouter") {
    return new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: (process.env["OPENROUTER_API_KEY"] || "").trim(),
    });
  }
  if (provider === "cohere") {
    return new OpenAI({
      baseURL: "https://api.cohere.ai/compatibility/v1",
      apiKey: (process.env["COHERE_API_KEY"] || "").trim(),
    });
  }
  return new OpenAI({
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
  if (s !== 400) return false;
  const body = String((err as any)?.message ?? (err as any)?.error?.message ?? "");
  return /credit balance|insufficient|billing|quota exceeded/i.test(body);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callModel(
  provider: Provider,
  modelId: string,
  messages: Message[],
  { retries = 2, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ content: string; reasoning?: string }> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1); // 1s, 2s, 4s
      console.warn(`[Provider] 429 on ${provider}/${modelId} — retrying in ${delay}ms (attempt ${attempt}/${retries})`);
      await sleep(delay);
    }

    try {
      const client = buildOpenAIClient(provider);
      const response = await client.chat.completions.create({
        model: modelId,
        messages,
        max_tokens: getMaxTokens(modelId),
      });

      const msg = response.choices[0]?.message as any;
      return {
        content: msg?.content ?? "",
        reasoning: msg?.reasoning_content ?? undefined,
      };
    } catch (err) {
      lastErr = err;
      if (isAuthError(err)) throw err;   // 401/403 — won't recover
      if (isOutOfCredits(err)) throw err; // no credits — won't recover with retries
      if (!is429(err)) throw err;         // only retry on rate limits
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
