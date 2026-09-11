export type Provider = "deepseek" | "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "cohere";
export type Mode = "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
export type AgentRole = "researcher" | "steelman" | "adversary" | "expert" | "synthesizer" | "judge";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface AgentMemory {
  role: AgentRole;
  round: number;
  keyInsights: string[];
  openQuestions: string[];
  positionSummary: string;
}

export interface AgentTurn {
  role: AgentRole;
  name: string;
  emoji: string;
  provider: Provider;
  modelId: string;
  output: string;
  reasoning?: string;
  searchResults?: SearchResult[];
  round: number;
  memory?: AgentMemory;
}

export interface JudgeVerdict {
  approved: boolean;
  score: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
}

export interface RoundMemory {
  round: number;
  agentMemories: AgentMemory[];
  consensusPoints: string[];
  contestedPoints: string[];
  judgeScore: number;
  judgeWeaknesses: string[];
}

export interface RoundResult {
  round: number;
  agents: AgentTurn[];
  synthesis: string;
  verdict: JudgeVerdict;
  memory: RoundMemory;
}

export interface RouterOutput {
  mode: Mode;
  confidence_score: number;
  extracted_goal: string;
  suggested_domain: string;
  reasoning?: string;
}

export interface SandboxBuild {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface SandboxRunResult {
  filesWritten: number;
  builds: SandboxBuild[];
  summary: string;
}

export type SandboxResultEvent = { round: number } & SandboxRunResult;

export type SSEEventPayload =
  | { type: "routing"; data: RouterOutput }
  | { type: "agent_thinking"; data: { role: AgentRole; name: string; emoji: string; round: number } }
  | { type: "agent_complete"; data: AgentTurn }
  | { type: "sandbox_result"; data: SandboxResultEvent }
  | { type: "round_complete"; data: RoundResult }
  | { type: "memory_update"; data: { round: number; memory: RoundMemory } }
  | { type: "complete"; data: { finalOutput: string; totalRounds: number } }
  | { type: "error"; data: { message: string } };

export interface RepoFileInfo {
  path: string;
  size: number;
}

export interface ServerConfig {
  availableProviders: Provider[];
  tavilyEnabled: boolean;
  githubConfigured: boolean;
  ttsEnabled: boolean;
  agentMeta: Record<AgentRole, { name: string; emoji: string; description: string }>;
  defaultModels: Record<AgentRole, { provider: Provider; modelId: string }>;
}

export const ROLE_ORDER: AgentRole[] = ["researcher", "steelman", "adversary", "expert", "synthesizer", "judge"];

// Keep this list limited to current endpoints that are useful for reasoning.
// Free-tier labels mean the provider offers free quota/routing; rate limits still apply.
// Legacy IDs remain temporarily so old saved/default selections render correctly;
// the server auto-remaps them to the current live endpoint before calling the provider.
export const PROVIDER_MODELS: Record<Provider, { modelId: string; label: string }[]> = {
  openrouter: [
    { modelId: "thinkingmachines/inkling-small:free",           label: "Inkling Small: Advanced Reasoning (1.0M ctx, free)" },
    { modelId: "thinkingmachines/inkling:free",                 label: "Inkling: Advanced Reasoning (1.0M ctx, free)" },
    { modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",        label: "Nemotron 3 Ultra: Expert Knowledge (1.0M ctx, free)" },
    { modelId: "nvidia/nemotron-3.5-lightning:free",            label: "Nemotron 3.5 Lightning: Fast Reasoning (1.0M ctx, free)" },
    { modelId: "nex-agi/nex-n2.5-pro:free",                     label: "Nex-N2.5 Pro: Agentic Reasoning (262K ctx, free)" },
    { modelId: "nex-agi/nex-n2.5-mini:free",                    label: "Nex-N2.5 Mini: Lightweight Reasoning (262K ctx, free)" },
    { modelId: "inclusionai/ling-3.0-flash-vl:free",            label: "Ling 3.0 Flash VL: Multimodal (262K ctx, free)" },
    { modelId: "nvidia/nemotron-3-super-120b-a12b:free",        label: "Auto-upgrade: Ling 3.0 Flash VL Reasoning" },
  ],
  deepseek: [
    { modelId: "deepseek-chat", label: "DeepSeek Chat" },
  ],
  groq: [
    { modelId: "openai/gpt-oss-120b", label: "GPT-OSS 120B Reasoning (Groq Free Plan)" },
    { modelId: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (Groq Free Plan)" },
    { modelId: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant (Groq Free Plan)" },
    { modelId: "llama-3.3-70b-versatile", label: "Auto-upgrade: GPT-OSS 120B Reasoning" },
  ],
  gemini: [
    { modelId: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite Reasoning (Free Tier)" },
    { modelId: "gemini-3-flash-preview", label: "Gemini 3 Flash (Free Tier)" },
    { modelId: "gemini-2.5-flash", label: "Auto-upgrade: Gemini 3.1 Flash-Lite Reasoning" },
  ],
  openai: [
    { modelId: "gpt-4o", label: "GPT-4o" },
    { modelId: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  anthropic: [
    { modelId: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { modelId: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  cohere: [
    { modelId: "command-a-plus-05-2026", label: "Command A+ Reasoning (Free to Rate Limit)" },
    { modelId: "command-a-reasoning-08-2025", label: "Command A Reasoning (Free to Rate Limit)" },
  ],
};

export const ROLE_COLORS: Record<AgentRole, string> = {
  researcher: "#3b82f6",
  steelman: "#6366f1",
  adversary: "#ef4444",
  expert: "#8b5cf6",
  synthesizer: "#10b981",
  judge: "#f59e0b",
};

export interface PersistedRunSummary {
  sessionId: string;
  input: string;
  mode?: string | undefined;
  status: "running" | "complete" | "error";
  startedAt: string;
  finishedAt?: string | undefined;
}

export interface PersistedRunDetail extends PersistedRunSummary {
  events: SSEEventPayload[];
  finalOutput: string;
  error?: string | undefined;
}

export interface ParsedChange {
  path: string;
  content: string;
  action: "MODIFIED" | "NEW" | "DELETE";
  originalContent?: string | undefined;
}
