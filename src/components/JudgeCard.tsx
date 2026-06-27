import type { JudgeVerdict } from "../types";

interface Props {
  verdict: JudgeVerdict;
  round: number;
}

function scoreColor(score: number): string {
  if (score >= 88) return "#10b981";
  if (score >= 70) return "#f59e0b";
  return "#ef4444";
}

export default function JudgeCard({ verdict, round }: Props) {
  const color = scoreColor(verdict.score);

  return (
    <div className="judge-card" style={{ borderColor: color }}>
      <div className="judge-header">
        <div className="judge-title">
          <span>⚖️</span>
          <span>Round {round} Verdict</span>
        </div>
        <div className="judge-status" style={{ color }}>
          {verdict.approved ? "✅ APPROVED" : "🔄 CONTINUE"}
        </div>
      </div>

      <div className="score-row">
        <div className="score-label">Quality Score</div>
        <div className="score-display">
          <div className="score-bar-track">
            <div
              className="score-bar-fill"
              style={{ width: `${verdict.score}%`, background: color }}
            />
          </div>
          <span className="score-number" style={{ color }}>{verdict.score}/100</span>
        </div>
      </div>

      <p className="judge-feedback">{verdict.feedback}</p>

      <div className="verdict-lists">
        {verdict.strengths.length > 0 && (
          <div className="verdict-section">
            <div className="verdict-section-label strengths-label">Strengths</div>
            <ul>
              {verdict.strengths.map((s, i) => (
                <li key={i} className="strength-item">✓ {s}</li>
              ))}
            </ul>
          </div>
        )}

        {verdict.weaknesses.length > 0 && (
          <div className="verdict-section">
            <div className="verdict-section-label weaknesses-label">Weaknesses</div>
            <ul>
              {verdict.weaknesses.map((w, i) => (
                <li key={i} className="weakness-item">✗ {w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
