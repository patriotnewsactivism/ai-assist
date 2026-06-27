import { callModel } from "./providers.js";
import { webSearch, buildSearchQueries } from "./search.js";
import { AGENT_META, getSystemPrompt } from "./agents.js";
import type {
  AgentRole,
  AgentTurn,
  EmitFn,
  JudgeVerdict,
  RoundResult,
  RouterOutput,
  ThinkTankConfig,
} from "./types.js";

const ROLES_IN_ORDER: AgentRole[] = ["researcher", "adversary", "expert", "synthesizer", "judge"];

async function runAgent(
  role: AgentRole,
  config: ThinkTankConfig,
  routing: RouterOutput,
  round: number,
  context: {
    previousSynthesis: string;
    previousWeaknesses: string[];
    researchOutput: string;
    adversaryOutput: string;
    expertOutput: string;
    searchResults: import("./types.js").SearchResult[];
    scores: number[];
  },
  emit: EmitFn
): Promise<AgentTurn> {
  const { provider, modelId } = config.agentModels[role];
  const { name, emoji } = AGENT_META[role];
  const systemPrompt = getSystemPrompt(
    role,
    routing.mode,
    routing.extracted_goal,
    routing.suggested_domain,
    config.customContext,
    config.expertDomain
  );

  emit({ type: "agent_thinking", data: { role, name, emoji, round } });

  let userContent = "";
  let agentSearchResults: import("./types.js").SearchResult[] = [];

  if (role === "researcher") {
    const queries = buildSearchQueries(routing.extracted_goal, routing.mode, context.previousWeaknesses);
    const allResults: import("./types.js").SearchResult[] = [];

    for (const query of queries) {
      const results = await webSearch(query, 4);
      allResults.push(...results);
    }

    agentSearchResults = allResults;

    const searchContext = allResults.length > 0
      ? `\n\nWEB SEARCH RESULTS:\n${allResults.map((r, i) =>
          `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`
        ).join("\n\n")}`
      : "\n\n[No web search results available — use your training knowledge]";

    userContent = `GOAL: ${routing.extracted_goal}

CURRENT BEST OUTPUT (from previous round):
${context.previousSynthesis || "[None yet — this is round 1]"}

PREVIOUS JUDGE WEAKNESSES TO ADDRESS:
${context.previousWeaknesses.length > 0 ? context.previousWeaknesses.join("\n") : "[None]"}
${searchContext}

Provide your research findings.`;

  } else if (role === "adversary") {
    userContent = `GOAL: ${routing.extracted_goal}

CURRENT OUTPUT TO ATTACK:
${context.previousSynthesis || "[Round 1 — no prior synthesis yet]"}

RESEARCHER FINDINGS:
${context.researchOutput}

Provide your critique.`;

  } else if (role === "expert") {
    userContent = `GOAL: ${routing.extracted_goal}

CURRENT OUTPUT:
${context.previousSynthesis || "[Round 1 — no prior synthesis yet]"}

RESEARCHER FINDINGS:
${context.researchOutput}

ADVERSARY CRITIQUE:
${context.adversaryOutput}

Provide your expert analysis.`;

  } else if (role === "synthesizer") {
    userContent = `GOAL: ${routing.extracted_goal}

PREVIOUS BEST OUTPUT:
${context.previousSynthesis || "[None — this is round 1, start from scratch]"}

RESEARCHER FINDINGS:
${context.researchOutput}

ADVERSARY CRITIQUE (all must be addressed):
${context.adversaryOutput}

EXPERT ANALYSIS (all must be integrated):
${context.expertOutput}

Produce the complete, refined output now.`;

  } else if (role === "judge") {
    const scoreHistory = context.scores.length > 0
      ? `Previous scores: ${context.scores.join(" → ")}`
      : "This is round 1.";

    userContent = `GOAL: ${routing.extracted_goal}
${scoreHistory}

OUTPUT TO EVALUATE:
${context.previousSynthesis}

Output ONLY the JSON verdict.`;
  }

  const { content, reasoning } = await callModel(provider, modelId, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]);

  const turn: AgentTurn = {
    role,
    name,
    emoji,
    provider,
    modelId,
    output: content,
    round,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(agentSearchResults.length > 0 ? { searchResults: agentSearchResults } : {}),
  };

  emit({ type: "agent_complete", data: turn });
  return turn;
}

function parseJudgeVerdict(raw: string): JudgeVerdict {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? raw);
    return {
      approved: Boolean(parsed.approved),
      score: Number(parsed.score ?? 0),
      feedback: String(parsed.feedback ?? ""),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String) : [],
    };
  } catch {
    return {
      approved: false,
      score: 50,
      feedback: raw.slice(0, 300),
      strengths: [],
      weaknesses: ["Could not parse judge verdict — continuing"],
    };
  }
}

export async function runRoundtable(
  config: ThinkTankConfig,
  routing: RouterOutput,
  emit: EmitFn
): Promise<string> {
  let lastSynthesis = "";
  let lastWeaknesses: string[] = [];
  const scoreHistory: number[] = [];

  for (let round = 1; round <= config.maxRounds; round++) {
    console.log(`\n=== ROUND ${round} ===`);

    const roundAgents: AgentTurn[] = [];
    let researchOutput = "";
    let adversaryOutput = "";
    let expertOutput = "";

    for (const role of ROLES_IN_ORDER) {
      const turn = await runAgent(role, config, routing, round, {
        previousSynthesis: lastSynthesis,
        previousWeaknesses: lastWeaknesses,
        researchOutput,
        adversaryOutput,
        expertOutput,
        searchResults: [],
        scores: scoreHistory,
      }, emit);

      roundAgents.push(turn);

      if (role === "researcher") researchOutput = turn.output;
      if (role === "adversary") adversaryOutput = turn.output;
      if (role === "expert") expertOutput = turn.output;
      if (role === "synthesizer") lastSynthesis = turn.output;
    }

    const judgeRaw = roundAgents.find((a) => a.role === "judge")?.output ?? "";
    const verdict = parseJudgeVerdict(judgeRaw);
    scoreHistory.push(verdict.score);
    lastWeaknesses = verdict.weaknesses;

    const roundResult: RoundResult = {
      round,
      agents: roundAgents,
      synthesis: lastSynthesis,
      verdict,
    };

    emit({ type: "round_complete", data: roundResult });
    console.log(`Round ${round} complete — score: ${verdict.score}, approved: ${verdict.approved}`);

    const threshold = config.qualityThreshold ?? 88;
    if (verdict.approved || verdict.score >= threshold) {
      break;
    }
  }

  emit({ type: "complete", data: { finalOutput: lastSynthesis, totalRounds: scoreHistory.length } });
  return lastSynthesis;
}

export const DEFAULT_AGENT_MODELS: Record<AgentRole, { provider: import("./types.js").Provider; modelId: string }> = {
  researcher: { provider: "deepseek", modelId: "deepseek-chat" },
  adversary: { provider: "deepseek", modelId: "deepseek-chat" },
  expert: { provider: "deepseek", modelId: "deepseek-reasoner" },
  synthesizer: { provider: "deepseek", modelId: "deepseek-chat" },
  judge: { provider: "deepseek", modelId: "deepseek-chat" },
};
