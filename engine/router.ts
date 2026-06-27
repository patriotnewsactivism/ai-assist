import { callModel } from "./providers.js";
import type { RouterOutput } from "./types.js";

export async function routeInput(userInput: string): Promise<RouterOutput> {
  const { content } = await callModel("deepseek", "deepseek-chat", [
    {
      role: "system",
      content: `You are a silent input classification engine. Analyze the user's input and output ONLY a raw JSON object — no markdown, no explanation.

Schema:
{
  "mode": "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE",
  "confidence_score": 0-100,
  "extracted_goal": "clear one-sentence objective",
  "suggested_domain": "domain expertise needed, e.g. software engineering, finance, medicine, law, data science"
}

Rules:
- CODE_MODE: writing, debugging, or architecting software
- DATA_MODE: analyzing datasets, statistics, comparisons, benchmarks
- RESEARCH_MODE: everything else requiring knowledge synthesis, writing, or research`,
    },
    { role: "user", content: userInput },
  ]);

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch?.[0] ?? content) as RouterOutput;
  } catch {
    return {
      mode: "RESEARCH_MODE",
      confidence_score: 50,
      extracted_goal: userInput.slice(0, 200),
      suggested_domain: "general knowledge",
    };
  }
}
