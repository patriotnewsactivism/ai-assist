export type Provider = "deepseek" | "openai" | "gemini" | "groq" | "openrouter" | "cohere";
export type Mode = "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
export type AgentRole = "researcher" | "steelman" | "adversary" | "expert" | "synthesizer" | "judge";

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

// Cross-agent memory: persists insights across ALL rounds so agents build
// on accumulated knowledge rather than starting fresh each iteration.
export interface AgentMemory {
  role: AgentRole;
  round: number;
  keyInsights: string[];     // bullet points worth carrying forward
  openQuestions: string[];   // unresolved issues flagged by this agent
  positionSummary: string;   // one-paragraph stance this agent took
}

export interface RoundMemory {
  round: number;
  agentMemories: AgentMemory[];
  consensusPoints: string[];   // things all agents agreed on this round
  contestedPoints: string[];   // things agents disagreed on this round
  judgeScore: number;
  judgeWeaknesses: string[];
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
  memory?: AgentMemory;      // extracted memory from this turn
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
  memory: RoundMemory;       // full memory snapshot for this round
}

export interface RouterOutput {
  mode: Mode;
  confidence_score: number;
  extracted_goal: string;
  suggested_domain: string;
  reasoning: string;         // AI router explains WHY it chose this mode
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface ThinkTankConfig {
  input: string;
  maxRounds: number;
  agentModels: Record<AgentRole, { provider: Provider; modelId: string }>;
  customContext?: string;
  qualityThreshold?: number;
  expertDomain?: string;
  enableSteelman?: boolean;  // opt-in steelman agent
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

export type SandboxResultEvent = SandboxRunResult & { round: number };

export type SSEEventPayload =
  | { type: "routing"; data: RouterOutput }
  | { type: "agent_thinking"; data: { role: AgentRole; name: string; emoji: string; round: number } }
  | { type: "agent_complete"; data: AgentTurn }
  | { type: "sandbox_result"; data: { round: number } & SandboxRunResult }
  | { type: "round_complete"; data: RoundResult }
  | { type: "memory_update"; data: { round: number; memory: RoundMemory } }
  | { type: "complete"; data: { finalOutput: string; totalRounds: number } }
  | { type: "error"; data: { message: string } };

export type EmitFn = (event: SSEEventPayload) => void;
