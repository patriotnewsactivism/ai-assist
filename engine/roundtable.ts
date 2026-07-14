import { callModel, isOutOfCredits } from "./providers.js";
import { webSearch, buildSearchQueries } from "./search.js";
import { AGENT_META, getSystemPrompt, buildMemoryBlock, extractMemory } from "./agents.js";
import { parseFilesFromOutput } from "./fileparser.js";
import { runSandbox, cleanupSandbox } from "./sandbox.js";
import type {
  AgentRole,
  AgentTurn,
  EmitFn,
  JudgeVerdict,
  RoundMemory,
  RoundResult,
  RouterOutput,
  SandboxRunResult,
  ThinkTankConfig,
} from "./types.js";

// Base role order — steelman is injected between researcher and adversary when enabled
const BASE_ROLES: AgentRole[] = ["researcher", "adversary", "expert", "synthesizer", "judge"];
const ROLES_WITH_STEELMAN: AgentRole[] = ["researcher", "steelman", "adversary", "expert", "synthesizer", "judge"];

async function runAgent(
  role: AgentRole,
  config: ThinkTankConfig,
  routing: RouterOutput,
  round: number,
  context: {
    previousSynthesis: string;
    previousWeaknesses: string[];
    researchOutput: string;
    steelmanOutput: string;
    adversaryOutput: string;
    expertOutput: string;
    searchResults: import("./types.js").SearchResult[];
    scores: number[];
    roundMemories: RoundMemory[];
    extraJudgeContext?: string;
  },
  emit: EmitFn
): Promise<AgentTurn> {
  const { provider, modelId } = config.agentModels[role];
  const { name, emoji } = AGENT_META[role];

  // Groq free tier has 12k TPM — cap document context so input fits alongside 2k output
  const ctxCharLimit = provider === "groq" ? 8_000 : undefined;
  const trimmedContext = ctxCharLimit && config.customContext && config.customContext.length > ctxCharLimit
    ? config.customContext.slice(0, ctxCharLimit) + "\n\n[...context trimmed for token limit]"
    : config.customContext;

  const systemPrompt = getSystemPrompt(
    role,
    routing.mode,
    routing.extracted_goal,
    routing.suggested_domain,
    trimmedContext,
    config.expertDomain
  );

  // Build accumulated memory block for this agent
  const memoryBlock = buildMemoryBlock(context.roundMemories);

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
ROUTER ANALYSIS: ${routing.reasoning}

CURRENT BEST OUTPUT (from previous round):
${context.previousSynthesis || "[None yet — this is round 1]"}

PREVIOUS JUDGE WEAKNESSES TO ADDRESS:
${context.previousWeaknesses.length > 0 ? context.previousWeaknesses.join("\n") : "[None]"}
${searchContext}${memoryBlock}

Provide your research findings.`;

  } else if (role === "steelman") {
    userContent = `GOAL: ${routing.extracted_goal}

CURRENT OUTPUT TO DEFEND:
${context.previousSynthesis || "[Round 1 — build the strongest case from first principles]"}

RESEARCHER FINDINGS (use this evidence to support your defense):
${context.researchOutput}
${memoryBlock}

Construct the strongest possible case FOR this approach. Make the Adversary earn every point.`;

  } else if (role === "adversary") {
    const steelmanSection = context.steelmanOutput
      ? `\nSTEELMAN DEFENSE (you must dismantle this):\n${context.steelmanOutput}`
      : "";

    userContent = `GOAL: ${routing.extracted_goal}

CURRENT OUTPUT TO ATTACK:
${context.previousSynthesis || "[Round 1 — no prior synthesis yet]"}

RESEARCHER FINDINGS:
${context.researchOutput}
${steelmanSection}
${memoryBlock}

Provide your critique. If Steelman is present, specifically refute their strongest points.`;

  } else if (role === "expert") {
    const steelmanSection = context.steelmanOutput
      ? `\nSTEELMAN DEFENSE:\n${context.steelmanOutput.slice(0, 600)}...`
      : "";

    userContent = `GOAL: ${routing.extracted_goal}

CURRENT OUTPUT:
${context.previousSynthesis || "[Round 1 — no prior synthesis yet]"}

RESEARCHER FINDINGS:
${context.researchOutput}
${steelmanSection}
ADVERSARY CRITIQUE:
${context.adversaryOutput}
${memoryBlock}

Provide your expert analysis. Adjudicate where Steelman and Adversary disagree.`;

  } else if (role === "synthesizer") {
    const steelmanSection = context.steelmanOutput
      ? `\nSTEELMAN (genuine strengths to preserve):\n${context.steelmanOutput}`
      : "";

    userContent = `GOAL: ${routing.extracted_goal}

PREVIOUS BEST OUTPUT:
${context.previousSynthesis || "[None — this is round 1, start from scratch]"}

RESEARCHER FINDINGS:
${context.researchOutput}
${steelmanSection}
ADVERSARY CRITIQUE (all must be addressed):
${context.adversaryOutput}

EXPERT ANALYSIS (all must be integrated):
${context.expertOutput}
${memoryBlock}

Produce the complete, refined output now.`;

  } else if (role === "judge") {
    const scoreHistory = context.scores.length > 0
      ? `Previous scores: ${context.scores.join(" → ")}`
      : "This is round 1.";

    userContent = `GOAL: ${routing.extracted_goal}
${scoreHistory}${context.extraJudgeContext ?? ""}
${memoryBlock}

OUTPUT TO EVALUATE:
${context.previousSynthesis}

Output ONLY the JSON verdict.`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user"   as const, content: userContent },
  ];

  // Fallback chain tried in order when primary is rate-limited or out of credits
  const AGENT_FALLBACKS: Array<{ provider: import("./types.js").Provider; modelId: string; envKey: string }> = [
    { provider: "deepseek",   modelId: "deepseek-chat",                          envKey: "DEEPSEEK_API_KEY" },
    { provider: "groq",       modelId: "llama-3.3-70b-versatile",                envKey: "GROQ_API_KEY" },
    { provider: "gemini",     modelId: "gemini-2.5-flash",                       envKey: "GEMINI_API_KEY" },
    { provider: "openrouter", modelId: "openai/gpt-oss-120b:free",               envKey: "OPENROUTER_API_KEY" },
    { provider: "openrouter", modelId: "nvidia/nemotron-3-super-120b-a12b:free", envKey: "OPENROUTER_API_KEY" },
    { provider: "cohere",     modelId: "command-a-reasoning-08-2025",            envKey: "COHERE_API_KEY" },
  ];

  let callResult: { content: string; reasoning?: string };
  try {
    callResult = await callModel(provider, modelId, messages);
  } catch (primaryErr) {
    const status = (primaryErr as any)?.status ?? (primaryErr as any)?.statusCode;
    const isRateLimit = status === 429 || String((primaryErr as any)?.message).includes("429");
    const noCredits = isOutOfCredits(primaryErr);

    if (!isRateLimit && !noCredits) throw primaryErr;

    const reason = noCredits ? "out of credits" : "rate-limited";
    console.warn(`[Agent:${role}] Primary ${provider}/${modelId} ${reason} — trying fallback chain`);

    let lastFallbackErr: unknown = primaryErr;
    callResult = await (async () => {
      for (const fb of AGENT_FALLBACKS) {
        if (fb.provider === provider && fb.modelId === modelId) continue; // skip primary
        if (!(process.env[fb.envKey] || "").trim()) continue;             // skip unconfigured
        try {
          console.warn(`[Agent:${role}] Trying ${fb.provider}/${fb.modelId}`);
          return await callModel(fb.provider, fb.modelId, messages);
        } catch (fbErr) {
          lastFallbackErr = fbErr;
          console.warn(`[Agent:${role}] ${fb.provider}/${fb.modelId} also failed:`, (fbErr as any)?.status ?? fbErr);
        }
      }
      throw lastFallbackErr;
    })();
  }

  const { content, reasoning } = callResult;

  // Extract memory from this agent's output for future rounds
  const memory = extractMemory(role, round, content);

  const turn: AgentTurn = {
    role,
    name,
    emoji,
    provider,
    modelId,
    output: content,
    round,
    memory,
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

// Build a RoundMemory snapshot from all agent turns in a round
function buildRoundMemory(
  round: number,
  agents: AgentTurn[],
  verdict: JudgeVerdict
): RoundMemory {
  const agentMemories = agents
    .filter(a => a.memory)
    .map(a => a.memory!);

  // Simple consensus/contested detection: look at what adversary attacked vs what steelman defended
  const steelmanInsights = agents.find(a => a.role === "steelman")?.memory?.keyInsights ?? [];
  const adversaryQuestions = agents.find(a => a.role === "adversary")?.memory?.openQuestions ?? [];

  return {
    round,
    agentMemories,
    consensusPoints: steelmanInsights.slice(0, 3),
    contestedPoints: adversaryQuestions.slice(0, 3),
    judgeScore: verdict.score,
    judgeWeaknesses: verdict.weaknesses,
  };
}

export async function runRoundtable(
  config: ThinkTankConfig,
  routing: RouterOutput,
  emit: EmitFn
): Promise<string> {
  const isCode = routing.mode === "CODE_MODE";
  const useSteelman = config.enableSteelman !== false; // default ON; only OFF when explicitly false
  const rolesInOrder = useSteelman ? ROLES_WITH_STEELMAN : BASE_ROLES;

  let lastSynthesis = "";
  let lastWeaknesses: string[] = [];
  let lastSandboxSummary = "";
  const scoreHistory: number[] = [];
  const sandboxDirs: string[] = [];
  const roundMemories: RoundMemory[] = [];  // cross-round memory accumulator

  for (let round = 1; round <= config.maxRounds; round++) {
    console.log(`\n=== ROUND ${round}${useSteelman ? " [Steelman ON]" : ""} ===`);

    const roundAgents: AgentTurn[] = [];
    let researchOutput = "";
    let steelmanOutput = "";
    let adversaryOutput = "";
    let expertOutput = "";

    const effectiveWeaknesses = lastSandboxSummary
      ? [`Build result from last round: ${lastSandboxSummary}`, ...lastWeaknesses]
      : lastWeaknesses;

    for (const role of rolesInOrder) {
      const sandboxNote = (role === "judge" && lastSandboxSummary && round > 1)
        ? `\n\nBUILD SANDBOX RESULT (this round): ${lastSandboxSummary}`
        : "";

      const turn = await runAgent(role, config, routing, round, {
        previousSynthesis: lastSynthesis,
        previousWeaknesses: effectiveWeaknesses,
        researchOutput,
        steelmanOutput,
        adversaryOutput,
        expertOutput,
        searchResults: [],
        scores: scoreHistory,
        roundMemories,          // ← full cross-round memory passed to every agent
        extraJudgeContext: sandboxNote,
      }, emit);

      roundAgents.push(turn);

      if (role === "researcher") researchOutput = turn.output;
      if (role === "steelman")  steelmanOutput = turn.output;
      if (role === "adversary") adversaryOutput = turn.output;
      if (role === "expert")    expertOutput = turn.output;
      if (role === "synthesizer") {
        lastSynthesis = turn.output;

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
          } else {
            lastSandboxSummary = "No file blocks found in synthesizer output — cannot build.";
          }
        }
      }
    }

    const judgeRaw = roundAgents.find(a => a.role === "judge")?.output ?? "";
    const verdict = parseJudgeVerdict(judgeRaw);
    scoreHistory.push(verdict.score);
    lastWeaknesses = verdict.weaknesses;

    // Build and store this round's memory for future agents to read
    const roundMemory = buildRoundMemory(round, roundAgents, verdict);
    roundMemories.push(roundMemory);

    const roundResult: RoundResult = {
      round,
      agents: roundAgents,
      synthesis: lastSynthesis,
      verdict,
      memory: roundMemory,
    };

    emit({ type: "round_complete", data: roundResult });
    emit({ type: "memory_update", data: { round, memory: roundMemory } });
    console.log(`Round ${round} complete — score: ${verdict.score}, approved: ${verdict.approved}`);

    const threshold = config.qualityThreshold ?? 88;
    if (verdict.approved || verdict.score >= threshold) break;
  }

  for (const dir of sandboxDirs) {
    await cleanupSandbox(dir).catch((e) => console.warn("[Roundtable] Sandbox cleanup failed:", e));
  }

  emit({ type: "complete", data: { finalOutput: lastSynthesis, totalRounds: scoreHistory.length } });
  return lastSynthesis;
}

// DEFAULT: four genuinely distinct model families so agents actually reason
// differently instead of one model role-playing six personas:
//   - Steelman   -> Groq/Llama 3.3 70B          (Meta)
//   - Adversary  -> Groq/DeepSeek-R1-distill    (DeepSeek reasoning lineage)
//   - Expert     -> OpenRouter/gpt-oss-120b     (OpenAI open-weight reasoning)
//   - Judge      -> OpenRouter/Nemotron 3 Super (NVIDIA, benchmarked on AIME/SWE-Bench)
//   - Researcher/Synthesizer -> Gemini (Google) for a fifth distinct voice
// If any one provider's free quota is exhausted, the other three keep the debate running.
export const DEFAULT_AGENT_MODELS: Record<AgentRole, { provider: import("./types.js").Provider; modelId: string }> = {
  researcher:  { provider: "cohere",     modelId: "command-a-reasoning-08-2025" },
  steelman:    { provider: "groq",       modelId: "llama-3.3-70b-versatile" },
  adversary:   { provider: "groq",       modelId: "openai/gpt-oss-120b" },
  expert:      { provider: "openrouter", modelId: "openai/gpt-oss-120b:free" },
  synthesizer: { provider: "gemini",     modelId: "gemini-2.5-flash" },
  judge:       { provider: "openrouter", modelId: "nvidia/nemotron-3-super-120b-a12b:free" },
};

// FALLBACK: all-Groq when Gemini is not set/unavailable — still gives two
// distinct reasoning styles (Llama vs DeepSeek-R1-distill) instead of one model.
export const FALLBACK_AGENT_MODELS: Record<AgentRole, { provider: import("./types.js").Provider; modelId: string }> = {
  researcher:  { provider: "groq", modelId: "llama-3.3-70b-versatile" },
  steelman:    { provider: "groq", modelId: "llama-3.3-70b-versatile" },
  adversary:   { provider: "groq", modelId: "openai/gpt-oss-120b" },
  expert:      { provider: "groq", modelId: "openai/gpt-oss-120b" },
  synthesizer: { provider: "groq", modelId: "llama-3.3-70b-versatile" },
  judge:       { provider: "groq", modelId: "llama-3.3-70b-versatile" },
};

