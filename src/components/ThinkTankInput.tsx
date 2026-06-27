import { useState } from "react";
import type { AgentRole, Provider, ServerConfig } from "../types";
import { ROLE_COLORS, ROLE_ORDER, PROVIDER_MODELS } from "../types";
import type { SessionConfig } from "../App";

interface Props {
  serverConfig: ServerConfig | null;
  onStart: (cfg: SessionConfig) => void;
}

const DEFAULT_MODELS: Record<AgentRole, { provider: Provider; modelId: string }> = {
  researcher:  { provider: "deepseek", modelId: "deepseek-chat" },
  adversary:   { provider: "deepseek", modelId: "deepseek-chat" },
  expert:      { provider: "deepseek", modelId: "deepseek-reasoner" },
  synthesizer: { provider: "deepseek", modelId: "deepseek-chat" },
  judge:       { provider: "deepseek", modelId: "deepseek-chat" },
};

const PRESETS = [
  { emoji: "💻", label: "Code",     text: "Build a complete TypeScript REST API with JWT authentication, role-based access control, PostgreSQL integration, and comprehensive error handling" },
  { emoji: "🔬", label: "Research", text: "Deep research on the current state of nuclear fusion energy — timeline, major players, technical barriers, and realistic commercial outlook for 2025-2030" },
  { emoji: "📊", label: "Analysis", text: "Compare PostgreSQL vs MongoDB vs DynamoDB for a high-traffic real-time gaming backend — benchmarks, trade-offs, and a final recommendation" },
  { emoji: "📝", label: "Strategy", text: "Create a comprehensive go-to-market strategy for a B2B SaaS product targeting mid-size logistics companies" },
];

type ModelPack = "fast" | "deep" | "mixed";

const PACKS: Record<ModelPack, { label: string; desc: string; models: (avail: Provider[]) => Record<AgentRole, { provider: Provider; modelId: string }> }> = {
  fast: {
    label: "⚡ Fast",
    desc: "All DeepSeek V3 — quickest results",
    models: () => ({
      researcher:  { provider: "deepseek", modelId: "deepseek-chat" },
      adversary:   { provider: "deepseek", modelId: "deepseek-chat" },
      expert:      { provider: "deepseek", modelId: "deepseek-chat" },
      synthesizer: { provider: "deepseek", modelId: "deepseek-chat" },
      judge:       { provider: "deepseek", modelId: "deepseek-chat" },
    }),
  },
  deep: {
    label: "🧠 Deep",
    desc: "R1 reasoning for Expert + Judge",
    models: () => ({
      researcher:  { provider: "deepseek", modelId: "deepseek-chat" },
      adversary:   { provider: "deepseek", modelId: "deepseek-chat" },
      expert:      { provider: "deepseek", modelId: "deepseek-reasoner" },
      synthesizer: { provider: "deepseek", modelId: "deepseek-chat" },
      judge:       { provider: "deepseek", modelId: "deepseek-reasoner" },
    }),
  },
  mixed: {
    label: "🌐 Multi-Model",
    desc: "Best model per role across providers",
    models: (avail) => ({
      researcher:  avail.includes("openai")     ? { provider: "openai",     modelId: "gpt-4o" }               : DEFAULT_MODELS.researcher,
      adversary:   avail.includes("anthropic")  ? { provider: "anthropic",  modelId: "claude-sonnet-4-6" }    : DEFAULT_MODELS.adversary,
      expert:      { provider: "deepseek", modelId: "deepseek-reasoner" },
      synthesizer: avail.includes("anthropic")  ? { provider: "anthropic",  modelId: "claude-sonnet-4-6" }    : DEFAULT_MODELS.synthesizer,
      judge:       avail.includes("anthropic")  ? { provider: "anthropic",  modelId: "claude-sonnet-4-6" }    : DEFAULT_MODELS.judge,
    }),
  },
};

const DOMAINS = ["Software Engineering", "Law", "Medicine", "Finance", "Science", "Marketing", "Security", "Data Science"];

export default function ThinkTankInput({ serverConfig, onStart }: Props) {
  const [input, setInput]               = useState("");
  const [maxRounds, setMaxRounds]       = useState(3);
  const [threshold, setThreshold]       = useState(88);
  const [customContext, setCustomCtx]   = useState("");
  const [expertDomain, setExpertDomain] = useState("");
  const [showAdvanced, setShowAdv]      = useState(false);
  const [activePack, setActivePack]     = useState<ModelPack>("deep");
  const [agentModels, setAgentModels]   = useState<Record<AgentRole, { provider: Provider; modelId: string }>>(DEFAULT_MODELS);

  const available = serverConfig?.availableProviders ?? ["deepseek"];

  const applyPack = (pack: ModelPack) => {
    setActivePack(pack);
    setAgentModels(PACKS[pack].models(available));
  };

  const handleAgentModel = (role: AgentRole, field: "provider" | "modelId", val: string) => {
    setActivePack("fast"); // custom
    if (field === "provider") {
      const first = PROVIDER_MODELS[val as Provider]?.[0];
      if (!first) return;
      setAgentModels((p) => ({ ...p, [role]: { provider: val as Provider, modelId: first.modelId } }));
    } else {
      setAgentModels((p) => ({ ...p, [role]: { ...p[role], modelId: val } }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onStart({ input: input.trim(), maxRounds, qualityThreshold: threshold, customContext, expertDomain, agentModels });
  };

  const agentMeta = serverConfig?.agentMeta;

  return (
    <div className="think-tank-input">
      {/* Hero */}
      <div className="hero-section">
        <h1 className="hero-title">The AI Think Tank</h1>
        <p className="hero-sub">
          Five specialized AI agents debate, research, and refine your task through adversarial rounds until they reach the highest quality output.
        </p>
        {agentMeta && (
          <div className="agent-row">
            {ROLE_ORDER.map((role) => (
              <div key={role} className="agent-pill">
                <div className="agent-pill-dot" style={{ background: ROLE_COLORS[role] }} />
                <span>{agentMeta[role].emoji} {agentMeta[role].name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main input */}
      <div className="input-card">
        <form onSubmit={handleSubmit}>
          <label className="input-label" htmlFor="task-input">Your task or question</label>
          <textarea
            id="task-input"
            className="main-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what the Think Tank should work on in detail. The more specific, the better the output..."
            rows={5}
            autoFocus
          />

          {/* Preset chips */}
          <div className="presets-row">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="preset-chip"
                onClick={() => setInput(p.text)}
              >
                {p.emoji} {p.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="controls-row">
            <div className="control-block">
              <div className="control-label">Rounds: {maxRounds}</div>
              <input
                type="range"
                className="control-slider"
                min={1} max={6} value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value))}
              />
              <div className="control-hint">Each round runs all 5 agents. More = deeper refinement.</div>
            </div>

            <div className="control-block">
              <div className="control-label">Quality threshold</div>
              <div className="threshold-pills">
                {([80, 88, 92, 95] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`threshold-pill ${threshold === t ? "active" : ""}`}
                    onClick={() => setThreshold(t)}
                  >{t}</button>
                ))}
              </div>
              <div className="control-hint">Judge approves when score reaches this number.</div>
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
            onClick={() => setShowAdv(!showAdvanced)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
            Advanced configuration
            {showAdvanced ? "" : " — model packs, context, domain expert"}
          </button>

          {showAdvanced && (
            <div className="advanced-panel">
              {/* Model packs */}
              <div>
                <div className="control-label" style={{ marginBottom: 10 }}>Model packs</div>
                <div className="preset-packs">
                  {(Object.entries(PACKS) as [ModelPack, typeof PACKS[ModelPack]][]).map(([key, pack]) => (
                    <button
                      key={key}
                      type="button"
                      className={`preset-pack ${activePack === key ? "active" : ""}`}
                      onClick={() => applyPack(key)}
                    >
                      <span className="preset-pack-name">{pack.label}</span>
                      <span className="preset-pack-desc">{pack.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Per-agent config */}
              <div>
                <div className="control-label" style={{ marginBottom: 10 }}>Per-agent models</div>
                <div className="agent-config-grid">
                  {agentMeta && ROLE_ORDER.map((role) => {
                    const meta = agentMeta[role];
                    const current = agentModels[role];
                    if (!meta || !current) return null;
                    return (
                      <div key={role} className="agent-cfg-card" style={{ borderLeftColor: ROLE_COLORS[role] }}>
                        <div className="agent-cfg-header" style={{ color: ROLE_COLORS[role] }}>
                          <span>{meta.emoji}</span>
                          <span>{meta.name}</span>
                        </div>
                        <div className="agent-cfg-desc">{meta.description}</div>
                        <select
                          className="agent-cfg-select"
                          value={current.provider}
                          onChange={(e) => handleAgentModel(role, "provider", e.target.value)}
                        >
                          {available.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select
                          className="agent-cfg-select"
                          value={current.modelId}
                          onChange={(e) => handleAgentModel(role, "modelId", e.target.value)}
                        >
                          {PROVIDER_MODELS[current.provider]?.map((m) => (
                            <option key={m.modelId} value={m.modelId}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Domain expert pin */}
              <div>
                <div className="control-label" style={{ marginBottom: 8 }}>🎓 Pin Expert Domain</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {DOMAINS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`preset-chip ${expertDomain === d ? "active" : ""}`}
                      style={expertDomain === d ? { borderColor: "var(--purple)", color: "var(--purple)", background: "rgba(188,140,255,.08)" } : {}}
                      onClick={() => setExpertDomain(expertDomain === d ? "" : d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  className="domain-input"
                  placeholder="Or type a custom domain..."
                  value={expertDomain}
                  onChange={(e) => setExpertDomain(e.target.value)}
                />
              </div>

              {/* Custom context */}
              <div>
                <div className="control-label" style={{ marginBottom: 8 }}>Additional context for all agents</div>
                <textarea
                  className="context-textarea"
                  placeholder="E.g., 'This is for a fintech startup targeting SMBs. We use React + Node.js + PostgreSQL. Budget is constrained.'"
                  value={customContext}
                  onChange={(e) => setCustomCtx(e.target.value)}
                  rows={3}
                />
              </div>

              {/* Features */}
              {serverConfig && (
                <div>
                  <div className="control-label" style={{ marginBottom: 8 }}>Features</div>
                  <div className="feature-toggles">
                    <div className={`feature-toggle ${serverConfig.tavilyEnabled ? "enabled" : ""}`}>
                      <div className="feature-toggle-dot" />
                      🔍 Web Search {serverConfig.tavilyEnabled ? "enabled" : "(add TAVILY_API_KEY to enable)"}
                    </div>
                    <div className="feature-toggle enabled">
                      <div className="feature-toggle-dot" />
                      ⚡ Live streaming
                    </div>
                    <div className="feature-toggle enabled">
                      <div className="feature-toggle-dot" />
                      🧠 Reasoning traces (R1/o1)
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <button type="submit" className="btn-launch" disabled={!input.trim()}>
            ⚡ Launch Think Tank — {maxRounds} round{maxRounds !== 1 ? "s" : ""}, {threshold}+ quality
          </button>
        </form>
      </div>
    </div>
  );
}
