import type { RouterOutput } from "./types.js";

export async function routeInput(userInput: string): Promise<RouterOutput> {
  const inputLower = userInput.toLowerCase();
  let mode: RouterOutput["mode"] = "RESEARCH_MODE";
  let suggested_domain = "general knowledge";

  if (/(code|debug|repo|github|function|error|app|software|build|test|deploy)/.test(inputLower)) {
    mode = "CODE_MODE";
    suggested_domain = "software engineering";
  } else if (/(dataset|statistics|benchmark|analyze|data|chart|graph)/.test(inputLower)) {
    mode = "DATA_MODE";
    suggested_domain = "data science";
  }

  return {
    mode,
    confidence_score: 90,
    extracted_goal: userInput.slice(0, 150),
    suggested_domain,
  };
}
