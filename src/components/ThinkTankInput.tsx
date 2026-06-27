import { useState } from "react";
import type { AgentRole, Provider, ServerConfig } from "../types";
import { ROLE_COLORS, ROLE_ORDER, PROVIDER_MODELS } from "../types";

interface Props {
  serverConfig: ServerConfig | null;
  onStart: (
    input: string,
    maxRounds: number,
    agentModels: Record<AgentRole, { provider: Provider; modelId: string }>
  ) => void;
}

const DEFAULT_MODELS: Record<AgentRole, { provider: Provider; modelId: string }> = {
  researcher: { provider: "deepseek", modelId: "deepseek-chat" },
  adversary: { provider: "deepseek", modelId: "deepseek-chat" },
  expert: { provider: "deepseek", modelId: "deepseek-reasoner" },
  synthesizer: { provider: "deepseek", modelId: "deepseek-chat" },
  judge: { provider: "deepseek", modelId: "deepseek-chat" },
};

export default function ThinkTankInput({ serverConfig, onStart }: Props) {
  const [input, setInput] = useState("");
  const [maxRounds, setMaxRounds] = useState(3);
  const [showAgentConfig, setShowAgentConfig] = useState(false);
  const [agentModels, setAgentModels] = useState<Record<AgentRole, { provider: Provider; modelId: string }>>(
    serverConfig?.defaultModels ?? DEFAULT_MODELS
  );

  const availableProviders = serverConfig?.availableProviders ?? ["deepseek"];

  const handleProviderChange = (role: AgentRole, provider: Provider) => {
    const firstModel = PROVIDER_MODELS[provider]?.[0];
    if (!firstModel) return;
    setAgentModels((prev) => ({ ...prev, [role]: { provider, modelId: firstModel.modelId } }));
  };

  const handleModelChange = (role: AgentRole, modelId: string) => {
    setAgentModels((prev) => ({ ...prev, [role]: { ...prev[role], modelId } }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) onStart(input.trim(), maxRounds, agentModels);
  };

  return (
    <div className="think-tank-input">
      <form onSubmit={handleSubmit} className="input-form">
        <div className="form-group">
          <label htmlFor="task-input">What should the Think Tank work on?</label>
          <textarea
            id="task-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="E.g., Research the pros and cons of different database architectures for a high-traffic SaaS application and recommend the best approach..."
            rows={5}
            autoFocus
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Rounds: <strong>{maxRounds}</strong></label>
            <input
              type="range"
              min={1}
              max={6}
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
            />
            <small>Each round runs all 5 agents. More rounds = deeper refinement.</small>
          </div>

          <div className="config-toggle">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowAgentConfig(!showAgentConfig)}
            >
              ⚙️ {showAgentConfig ? "Hide" : "Configure"} Agent Models
            </button>
            {serverConfig?.tavilyEnabled && (
              <span className="feature-badge">🔍 Web Search ON</span>
            )}
          </div>
        </div>

        {showAgentConfig && (
          <div className="agent-config">
            <h3>Agent Model Assignment</h3>
            <p className="agent-config-hint">
              Available providers: {availableProviders.join(", ")}. Add API keys to .env to unlock more models.
            </p>
            <div className="agent-grid">
              {ROLE_ORDER.map((role) => {
                const meta = serverConfig?.agentMeta[role];
                const current = agentModels[role];
                if (!meta) return null;

                return (
                  <div
                    key={role}
                    className="agent-config-card"
                    style={{ borderColor: ROLE_COLORS[role] }}
                  >
                    <div className="agent-config-header" style={{ color: ROLE_COLORS[role] }}>
                      <span className="agent-emoji">{meta.emoji}</span>
                      <span className="agent-name">{meta.name}</span>
                    </div>
                    <p className="agent-desc">{meta.description}</p>

                    <div className="model-selectors">
                      <select
                        value={current.provider}
                        onChange={(e) => handleProviderChange(role, e.target.value as Provider)}
                      >
                        {availableProviders.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>

                      <select
                        value={current.modelId}
                        onChange={(e) => handleModelChange(role, e.target.value)}
                      >
                        {PROVIDER_MODELS[current.provider]?.map((m) => (
                          <option key={m.modelId} value={m.modelId}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button type="submit" className="btn-launch" disabled={!input.trim()}>
          ⚡ Launch Think Tank
        </button>
      </form>

      <div className="examples-panel">
        <h3>Example tasks</h3>
        <div className="example-list">
          {[
            { emoji: "💻", text: "Build a complete authentication system in TypeScript with JWT, refresh tokens, rate limiting, and proper security hardening" },
            { emoji: "🔬", text: "Deep research on the current state of nuclear fusion energy — timeline, major players, technical barriers, and realistic commercial outlook" },
            { emoji: "📊", text: "Analyze and compare PostgreSQL vs MongoDB vs DynamoDB for a real-time multiplayer gaming backend, with benchmarks and use-case guidance" },
            { emoji: "📝", text: "Write a comprehensive technical spec for a distributed task queue system with retry logic, dead letter queues, and observability" },
          ].map((ex, i) => (
            <button
              key={i}
              type="button"
              className="example-item"
              onClick={() => setInput(ex.text)}
            >
              <span>{ex.emoji}</span>
              <span>{ex.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
