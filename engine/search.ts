import type { SearchResult } from "./types.js";

export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = (process.env["TAVILY_API_KEY"] || "").trim();
  if (!apiKey) return [];

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      console.error(`[Search] Tavily ${response.status}: ${await response.text()}`);
      return [];
    }

    const data = (await response.json()) as { results?: any[] };
    return (data.results ?? []).map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      content: String(r.content ?? ""),
    }));
  } catch (err) {
    console.error("[Search] Error:", err);
    return [];
  }
}

export function isTavilyEnabled(): boolean {
  return !!(process.env["TAVILY_API_KEY"] || "").trim();
}

export function buildSearchQueries(goal: string, mode: string, weaknesses: string[]): string[] {
  const base = [goal, `${goal} best practices`];
  if (weaknesses.length > 0) {
    base.push(`${weaknesses[0]} ${goal}`);
  } else {
    base.push(`${goal} examples`);
  }
  return base.slice(0, 3);
}
