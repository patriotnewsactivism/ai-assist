import { useState } from "react";
import type { AgentRole, Provider, ServerConfig, RepoFileInfo } from "../types";
import { ROLE_COLORS, ROLE_ORDER, PROVIDER_MODELS } from "../types";
import type { SessionConfig } from "../App";

interface Props {
  serverConfig: ServerConfig | null;
  onStart: (cfg: SessionConfig) => void;
}

const DEFAULT_MODELS: Record<AgentRole, { provider: Provider; modelId: string }> = {
  researcher:  { provider: "gemini",    modelId: "gemini-2.0-flash-lite" },
  steelman:    { provider: "gemini",    modelId: "gemini-2.5-flash" },
  adversary:   { provider: "gemini",    modelId: "gemini-2.5-flash" },
  expert:      { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  synthesizer: { provider: "gemini",    modelId: "gemini-2.5-flash" },
  judge:       { provider: "anthropic", modelId: "claude-sonnet-4-5" },
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
    desc: "All Gemini Flash — quickest results",
    models: () => ({
      researcher:  { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
      steelman:    { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
      adversary:   { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
      expert:      { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
      synthesizer: { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
      judge:       { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
    }),
  },
  deep: {
    label: "🧠 Deep",
    desc: "Gemini 2.5 Flash for all reasoning roles",
    models: () => ({
      researcher:  { provider: "gemini",    modelId: "gemini-2.0-flash-lite" },
      steelman:    { provider: "gemini",    modelId: "gemini-2.5-flash" },
      adversary:   { provider: "gemini",    modelId: "gemini-2.5-flash" },
      expert:      { provider: "gemini",    modelId: "gemini-2.5-flash" },
      synthesizer: { provider: "gemini",    modelId: "gemini-2.5-flash" },
      judge:       { provider: "gemini",    modelId: "gemini-2.0-flash-lite" },
    }),
  },
  mixed: {
    label: "🌐 Multi-Model",
    desc: "Gemini + Claude — best model per role",
    models: (avail) => ({
      researcher:  { provider: "gemini",    modelId: "gemini-2.0-flash-lite" },
      steelman:    { provider: "gemini",    modelId: "gemini-2.5-flash" },
      adversary:   { provider: "gemini",    modelId: "gemini-2.5-flash" },
      expert:      avail.includes("anthropic") ? { provider: "anthropic", modelId: "claude-sonnet-4-5" } : { provider: "gemini", modelId: "gemini-2.5-flash" },
      synthesizer: { provider: "gemini",    modelId: "gemini-2.5-flash" },
      judge:       avail.includes("anthropic") ? { provider: "anthropic", modelId: "claude-sonnet-4-5" } : { provider: "gemini", modelId: "gemini-2.0-flash-lite" },
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

  // Repository import state
  const [repoUrl, setRepoUrl]           = useState("");
  const [repoToken, setRepoToken]       = useState("");
  const [repoFiles, setRepoFiles]       = useState<RepoFileInfo[] | null>(null);
  const [repoImporting, setRepoImporting] = useState(false);
  const [repoError, setRepoError]       = useState("");
  const [enableSteelman, setSteelman]   = useState(true);   // ON by default

  const available = serverConfig?.availableProviders ?? ["gemini"];

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

  const handleImportRepo = async () => {
    if (!repoUrl.trim()) return;
    setRepoImporting(true);
    setRepoError("");
    setRepoFiles(null);
    try {
      const res = await fetch("/api/repo/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), token: repoToken || undefined }),
      });
      const data = await res.json() as { files?: RepoFileInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setRepoFiles(data.files ?? []);
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setRepoImporting(false);
    }
  };

  const handleClearRepo = () => {
    setRepoUrl("");
    setRepoToken("");
    setRepoFiles(null);
    setRepoError("");
    setCustomCtx("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onStart({
      input: input.trim(),
      maxRounds,
      qualityThreshold: threshold,
      customContext,
      expertDomain,
      agentModels,
      enableSteelman,
      ...(repoUrl.trim() ? { repoUrl: repoUrl.trim(), ...(repoToken.trim() ? { repoToken: repoToken.trim() } : {}) } : {}),
    });
  };

  const agentMeta = serverConfig?.agentMeta;

  return (
    <div className="think-tank-input">
      {/* Hero */}
      <div className="hero-section">
        <h1 className="hero-title">The AI Think Tank</h1>
        <p className="hero-sub">
          Six specialized AI agents research, defend, attack, and refine your task through adversarial rounds until they reach the highest quality output.
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

          {/* Steelman toggle */}
          <div className="steelman-toggle-row" style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", padding: "10px 14px", borderRadius: 10, background: enableSteelman ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)", border: enableSteelman ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(255,255,255,0.08)", transition: "all 0.2s" }}>
            <button
              type="button"
              onClick={() => setSteelman(!enableSteelman)}
              style={{
                position: "relative", width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                background: enableSteelman ? "#6366f1" : "rgba(255,255,255,0.15)", transition: "background 0.2s", flexShrink: 0,
              }}
              aria-label="Toggle Steelman agent"
            >
              <span style={{
                position: "absolute", top: 3, left: enableSteelman ? 23 : 3,
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
              }} />
            </button>
            <div>
              <div style={{ fontSize: ".85rem", fontWeight: 600, color: enableSteelman ? "#a5b4fc" : "var(--text2)" }}>
                🛡️ Steelman Agent {enableSteelman ? "— ON" : "— OFF"}
              </div>
              <div style={{ fontSize: ".75rem", color: "var(--text3)", marginTop: 1 }}>
                {enableSteelman
                  ? "Builds the strongest case FOR your idea before the Adversary attacks — deeper, fairer debate"
                  : "Skip the Steelman — Adversary attacks directly without a prior defense"}
              </div>
            </div>
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

          {/* Repository import */}
          <div className="repo-section">
            <div className="repo-section-header">
              <span className="repo-section-title">📁 Import GitHub Repository</span>
              <span className="repo-section-sub">Feed the codebase to all agents — results can be pushed back as a PR</span>
            </div>

            {repoFiles ? (
              <div className="repo-imported">
                <div className="repo-imported-info">
                  <span className="repo-imported-icon">✅</span>
                  <div>
                    <div className="repo-imported-name">{repoUrl}</div>
                    <div className="repo-imported-count">{repoFiles.length} files imported · {Math.round(repoFiles.reduce((s, f) => s + f.size, 0) / 1024)}KB of context</div>
                  </div>
                </div>
                <button type="button" className="btn btn-ghost" style={{ fontSize: ".78rem", padding: "4px 10px" }} onClick={handleClearRepo}>
                  Clear
                </button>
              </div>
            ) : (
              <div className="repo-input-row">
                <input
                  type="text"
                  className="repo-url-input"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleImportRepo())}
                />
                {!serverConfig?.githubConfigured && (
                  <input
                    type="password"
                    className="repo-token-input"
                    placeholder="Token (private repos)"
                    value={repoToken}
                    onChange={(e) => setRepoToken(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="btn btn-ghost repo-import-btn"
                  disabled={!repoUrl.trim() || repoImporting}
                  onClick={handleImportRepo}
                >
                  {repoImporting ? "Importing..." : "Import"}
                </button>
              </div>
            )}

            {repoError && <div className="repo-error">{repoError}</div>}

            {repoFiles && repoFiles.length > 0 && (
              <div className="repo-file-list">
                {repoFiles.slice(0, 12).map((f) => (
                  <span key={f.path} className="repo-file-chip">{f.path}</span>
                ))}
                {repoFiles.length > 12 && (
                  <span className="repo-file-chip" style={{ opacity: .6 }}>+{repoFiles.length - 12} more</span>
                )}
              </div>
            )}
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
