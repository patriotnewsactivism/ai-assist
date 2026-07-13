export type Provider = "deepseek" | "openai" | "anthropic" | "gemini" | "groq";
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

export const PROVIDER_MODELS: Record<Provider, { modelId: string; label: string }[]> = {
  deepseek: [
    { modelId: "deepseek-chat", label: "DeepSeek V3" },
  ],
  groq: [
    { modelId: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Fast)" },
    { modelId: "llama-3.1-8b-instant",    label: "Llama 3.1 8B (Instant)" },
    { modelId: "mixtral-8x7b-32768",      label: "Mixtral 8x7B" },
  ],
  openai: [
    { modelId: "gpt-4o",     label: "GPT-4o" },
    { modelId: "gpt-4o-mini",label: "GPT-4o Mini" },
  ],
  anthropic: [
    { modelId: "claude-sonnet-4-5",       label: "Claude Sonnet 4.5" },
    { modelId: "claude-haiku-4-5-20251001",label: "Claude Haiku 4.5" },
  ],
  gemini: [
    { modelId: "gemini-2.5-flash",      label: "Gemini 2.5 Flash" },
    { modelId: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { modelId: "gemini-2.0-flash",      label: "Gemini 2.0 Flash" },
  ],
};

export const ROLE_COLORS: Record<AgentRole, string> = {
  researcher: "#3b82f6",   // blue
  steelman:   "#6366f1",   // indigo/purple — defender
  adversary:  "#ef4444",   // red
  expert:     "#8b5cf6",   // violet
  synthesizer:"#10b981",   // emerald
  judge:      "#f59e0b",   // amber
};
