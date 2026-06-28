import { callModel } from "./providers.js";
import type { RouterOutput } from "./types.js";

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

export async function routeInput(userInput: string): Promise<RouterOutput> {
  try {
    const { content } = await callModel("gemini", "gemini-2.0-flash-lite", [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      { role: "user", content: `Classify this task:\n\n${userInput}` },
    ]);

    // Extract JSON object from response, tolerating markdown fences or prose prefix
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
  } catch (err) {
    console.warn("[Router] AI classification failed, falling back to regex:", err);
    return regexClassify(userInput);
  }
}
