export type Provider = "deepseek" | "openai" | "anthropic" | "gemini";
export type Mode = "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
export type AgentRole = "researcher" | "adversary" | "expert" | "synthesizer" | "judge";

export interface AgentConfig {
  role: AgentRole;
  provider: Provider;
  modelId: string;
}

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

export interface ThinkTankConfig {
  input: string;
  maxRounds: number;
  agentModels: Record<AgentRole, { provider: Provider; modelId: string }>;
  customContext?: string;
  qualityThreshold?: number;
  expertDomain?: string;
}

export type SSEEventPayload =
  | { type: "routing"; data: RouterOutput }
  | { type: "agent_thinking"; data: { role: AgentRole; name: string; emoji: string; round: number } }
  | { type: "agent_complete"; data: AgentTurn }
  | { type: "round_complete"; data: RoundResult }
  | { type: "complete"; data: { finalOutput: string; totalRounds: number } }
  | { type: "error"; data: { message: string } };

export type EmitFn = (event: SSEEventPayload) => void;
