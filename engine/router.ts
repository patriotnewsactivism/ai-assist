import { callModel, getAvailableProviders, isOutOfCredits } from "./providers.js";
import type { Provider, RouterOutput } from "./types.js";

const ROUTER_SYSTEM_PROMPT = `You are an expert task classifier for an AI Think Tank system.
Analyze the user's input and classify it into exactly one of three modes:

RESEARCH_MODE — for questions requiring deep investigation, analysis, argumentation, policy, 
  philosophy, history, science, current events, strategy, comparisons, or any topic where 
  the goal is understanding, insight, or a comprehensive written answer.

DATA_MODE — for tasks centered on numbers, datasets, statistics, benchmarks, structured 
  analysis, charts, tables, quantitative comparisons, financial modeling, or data synthesis.

CODE_MODE — for tasks requiring code to be written, debugged, refactored, reviewed, or 
  architected. Includes software design, APIs, scripts, algorithms, and technical implementations.

You must also identify the specific domain (e.g. "constitutional law", "machine learning", 
"macroeconomics", "cybersecurity", "climate science") and extract the core goal in one crisp sentence.

Output ONLY valid JSON — no markdown, no explanation:
{
  "mode": "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE",
  "confidence_score": 0-100,
  "extracted_goal": "one crisp sentence describing the core task",
  "suggested_domain": "specific domain name",
  "reasoning": "2-3 sentences explaining why you chose this mode and domain"
}`;

// Fallback regex classifier used if Gemini is unavailable
function regexClassify(userInput: string): RouterOutput {
  const inputLower = userInput.toLowerCase();
  let mode: RouterOutput["mode"] = "RESEARCH_MODE";
  let suggested_domain = "general knowledge";

  if (/(write code|debug|repo|github|function|error|api|software|build|test|deploy|implement|refactor|script|algorithm|typescript|javascript|python)/.test(inputLower)) {
    mode = "CODE_MODE";
    suggested_domain = "software engineering";
  } else if (/(dataset|statistics|benchmark|quantitative|data analysis|chart|graph|numbers|metrics|compare.*numbers|financial model)/.test(inputLower)) {
    mode = "DATA_MODE";
    suggested_domain = "data science";
  }

  return {
    mode,
    confidence_score: 70,
    extracted_goal: userInput.slice(0, 150),
    suggested_domain,
    reasoning: "Classified via keyword matching (AI router unavailable).",
  };
}

// Provider + model candidates tried in order for routing
const ROUTER_CANDIDATES: Array<{ provider: Provider; modelId: string }> = [
  { provider: "gemini",   modelId: "gemini-2.0-flash-lite" },
  { provider: "deepseek", modelId: "deepseek-chat" },
  { provider: "gemini",   modelId: "gemini-2.5-flash" },
  { provider: "anthropic",modelId: "claude-sonnet-4-5" },
];

function parseRouterResponse(content: string, userInput: string): RouterOutput {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in router response");
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    mode: parsed.mode ?? "RESEARCH_MODE",
    confidence_score: Number(parsed.confidence_score ?? 85),
    extracted_goal: String(parsed.extracted_goal ?? userInput.slice(0, 150)),
    suggested_domain: String(parsed.suggested_domain ?? "general knowledge"),
    reasoning: String(parsed.reasoning ?? ""),
  };
}

export async function routeInput(userInput: string): Promise<RouterOutput> {
  const available = new Set(getAvailableProviders());
  const messages = [
    { role: "system" as const, content: ROUTER_SYSTEM_PROMPT },
    { role: "user"   as const, content: `Classify this task:\n\n${userInput}` },
  ];

  for (const { provider, modelId } of ROUTER_CANDIDATES) {
    if (!available.has(provider)) continue;
    try {
      const { content } = await callModel(provider, modelId, messages, { retries: 2, baseDelayMs: 500 });
      return parseRouterResponse(content, userInput);
    } catch (err) {
      const status = (err as any)?.status ?? (err as any)?.statusCode;
      const reason = isOutOfCredits(err) ? "out of credits" : status ?? String(err).slice(0, 60);
      console.warn(`[Router] ${provider}/${modelId} failed (${reason}), trying next candidate`);
    }
  }

  console.warn("[Router] All AI candidates exhausted, falling back to regex");
  return regexClassify(userInput);
}
