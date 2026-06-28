export type Provider = "deepseek" | "openai" | "anthropic" | "gemini";
export type Mode = "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
export type AgentRole = "researcher" | "adversary" | "expert" | "synthesizer" | "judge";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
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
}

export interface JudgeVerdict {
  approved: boolean;
  score: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
}

export interface RoundResult {
  round: number;
  agents: AgentTurn[];
  synthesis: string;
  verdict: JudgeVerdict;
}

export interface RouterOutput {
  mode: Mode;
  confidence_score: number;
  extracted_goal: string;
  suggested_domain: string;
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
  agentMeta: Record<AgentRole, { name: string; emoji: string; description: string }>;
  defaultModels: Record<AgentRole, { provider: Provider; modelId: string }>;
}

export const ROLE_ORDER: AgentRole[] = ["researcher", "adversary", "expert", "synthesizer", "judge"];

export const PROVIDER_MODELS: Record<Provider, { modelId: string; label: string }[]> = {
  deepseek: [
    { modelId: "deepseek-chat", label: "DeepSeek V3" },
    { modelId: "deepseek-reasoner", label: "DeepSeek R1 (Reasoning)" },
  ],
  openai: [
    { modelId: "gpt-4o", label: "GPT-4o" },
    { modelId: "gpt-4o-mini", label: "GPT-4o Mini" },
    { modelId: "o1-mini", label: "o1 Mini (Reasoning)" },
  ],
  anthropic: [
    { modelId: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { modelId: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  gemini: [
    { modelId: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { modelId: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
};

export const ROLE_COLORS: Record<AgentRole, string> = {
  researcher: "#3b82f6",
  adversary: "#ef4444",
  expert: "#8b5cf6",
  synthesizer: "#10b981",
  judge: "#f59e0b",
};
