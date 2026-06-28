import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "./types.js";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Token limits per model — Gemini 2.5 Flash supports up to 65k output
const MAX_TOKENS: Record<string, number> = {
  "gemini-2.5-flash": 16384,
  "gemini-2.0-flash-lite": 8192,
  "gemini-2.0-flash": 8192,
  "gpt-4o": 16384,
  "gpt-4o-mini": 8192,
  "claude-opus-4-5": 16384,
  "claude-sonnet-4-5": 16384,
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
  return new OpenAI({
    apiKey: (process.env["OPENAI_API_KEY"] || "").trim(),
  });
}

export async function callModel(
  provider: Provider,
  modelId: string,
  messages: Message[]
): Promise<{ content: string; reasoning?: string }> {
  if (provider === "anthropic") {
    const client = new Anthropic({
      apiKey: (process.env["ANTHROPIC_API_KEY"] || "").trim(),
    });

    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await client.messages.create({
      model: modelId,
      max_tokens: getMaxTokens(modelId),
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: chatMessages,
    });

    const block = response.content[0];
    return { content: block?.type === "text" ? block.text : "" };
  }

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
}

export function getAvailableProviders(): Provider[] {
  const available: Provider[] = [];
  // Gemini first — preferred default
  if ((process.env["GEMINI_API_KEY"] || "").trim()) available.push("gemini");
  if ((process.env["OPENAI_API_KEY"] || "").trim()) available.push("openai");
  if ((process.env["ANTHROPIC_API_KEY"] || "").trim()) available.push("anthropic");
  if ((process.env["DEEPSEEK_API_KEY"] || "").trim()) available.push("deepseek");
  return available;
}
