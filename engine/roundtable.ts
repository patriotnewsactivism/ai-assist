import { callModel } from "./providers.js";
import { webSearch, buildSearchQueries } from "./search.js";
import { AGENT_META, getSystemPrompt } from "./agents.js";
import { parseFilesFromOutput } from "./fileparser.js";
import { runSandbox, cleanupSandbox } from "./sandbox.js";
import type {
  AgentRole,
  AgentTurn,
  EmitFn,
  JudgeVerdict,
  RoundResult,
  RouterOutput,
  SandboxRunResult,
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
    extraJudgeContext?: string;
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
${scoreHistory}${context.extraJudgeContext ?? ""}

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
  const isCode = routing.mode === "CODE_MODE";
  let lastSynthesis = "";
  let lastWeaknesses: string[] = [];
  let lastSandboxSummary = "";
  const scoreHistory: number[] = [];
  const sandboxDirs: string[] = [];

  for (let round = 1; round <= config.maxRounds; round++) {
    console.log(`\n=== ROUND ${round} ===`);

    const roundAgents: AgentTurn[] = [];
    let researchOutput = "";
    let adversaryOutput = "";
    let expertOutput = "";

    // Append previous sandbox result to weaknesses context for researcher
    const effectiveWeaknesses = lastSandboxSummary
      ? [`Build result from last round: ${lastSandboxSummary}`, ...lastWeaknesses]
      : lastWeaknesses;

    for (const role of ROLES_IN_ORDER) {
      // For the judge in CODE_MODE, append sandbox result to judge context
      const sandboxNote = (role === "judge" && lastSandboxSummary && round > 1)
        ? `\n\nBUILD SANDBOX RESULT (this round): ${lastSandboxSummary}`
        : "";

      const turn = await runAgent(role, config, routing, round, {
        previousSynthesis: lastSynthesis,
        previousWeaknesses: effectiveWeaknesses,
        researchOutput,
        adversaryOutput,
        expertOutput,
        searchResults: [],
        scores: scoreHistory,
        extraJudgeContext: sandboxNote,
      }, emit);

      roundAgents.push(turn);

      if (role === "researcher") researchOutput = turn.output;
      if (role === "adversary") adversaryOutput = turn.output;
      if (role === "expert") expertOutput = turn.output;
      if (role === "synthesizer") {
        lastSynthesis = turn.output;

        // In CODE_MODE, run the sandbox after each synthesis
        if (isCode) {
          const files = parseFilesFromOutput(lastSynthesis);
          if (files.length > 0) {
            console.log(`[Sandbox] Running build for round ${round} (${files.length} files)...`);
            const sandboxResult = await runSandbox(files);
            sandboxDirs.push(sandboxResult.dir);
            lastSandboxSummary = sandboxResult.summary;

            const sbPayload: SandboxRunResult = {
              filesWritten: sandboxResult.filesWritten,
              builds: sandboxResult.builds,
              summary: sandboxResult.summary,
            };
            emit({ type: "sandbox_result", data: { round, ...sbPayload } });
            console.log(`[Sandbox] Round ${round}: ${sandboxResult.summary.slice(0, 80)}`);
          } else {
            lastSandboxSummary = "No file blocks found in synthesizer output — cannot build.";
          }
        }
      }
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

  // Clean up sandbox directories
  for (const dir of sandboxDirs) {
    await cleanupSandbox(dir);
  }

  emit({ type: "complete", data: { finalOutput: lastSynthesis, totalRounds: scoreHistory.length } });
  return lastSynthesis;
}

// DEFAULT_AGENT_MODELS — each role assigned to the provider/model that best
// fits its personality. Mix providers intentionally: different training data
// and RLHF philosophies mean genuine disagreement, not just paraphrasing.
//
// Role logic:
//   researcher  → Gemini 2.0 Flash Lite  — fast, broad web-trained retrieval
//   adversary   → Gemini 2.5 Flash        — deep reasoning finds the real holes
//   expert      → Anthropic Claude Sonnet — nuanced, calibrated domain depth
//   synthesizer → Gemini 2.5 Flash        — best long-form structured output
//   judge       → Anthropic Claude Sonnet — careful, principled scoring
//
// If Anthropic key is not set, expert + judge fall back to gemini-2.5-flash.
export const DEFAULT_AGENT_MODELS: Record<AgentRole, { provider: import("./types.js").Provider; modelId: string }> = {
  researcher:  { provider: "gemini",    modelId: "gemini-2.0-flash-lite" },
  adversary:   { provider: "gemini",    modelId: "gemini-2.5-flash" },
  expert:      { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  synthesizer: { provider: "gemini",    modelId: "gemini-2.5-flash" },
  judge:       { provider: "anthropic", modelId: "claude-sonnet-4-5" },
};

// FALLBACK_AGENT_MODELS — all Gemini, used when only GEMINI_API_KEY is set
export const FALLBACK_AGENT_MODELS: Record<AgentRole, { provider: import("./types.js").Provider; modelId: string }> = {
  researcher:  { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
  adversary:   { provider: "gemini", modelId: "gemini-2.5-flash" },
  expert:      { provider: "gemini", modelId: "gemini-2.5-flash" },
  synthesizer: { provider: "gemini", modelId: "gemini-2.5-flash" },
  judge:       { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
};
