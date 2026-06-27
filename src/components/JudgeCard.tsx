import type { JudgeVerdict } from "../types";

interface Props {
  verdict: JudgeVerdict;
  round: number;
}

function scoreToColor(score: number): string {
  if (score >= 88) return "var(--green)";
  if (score >= 72) return "var(--yellow)";
  return "var(--red)";
}

function scoreToGradient(score: number): string {
  if (score >= 88) return "linear-gradient(90deg, #3fb950, #56d364)";
  if (score >= 72) return "linear-gradient(90deg, #e3b341, #f0c855)";
  return "linear-gradient(90deg, #f85149, #ff6b6b)";
}

export default function JudgeCard({ verdict, round }: Props) {
  const color = scoreToColor(verdict.score);

  return (
    <div
      className={`judge-card ${verdict.approved ? "approved" : "rejected"}`}
      style={{ borderColor: color }}
    >
      <div className="jc-header">
        <div className="jc-title">
          <span>⚖️</span>
          <span>Round {round} — Judge Verdict</span>
        </div>
        <div className={`jc-verdict ${verdict.approved ? "approved" : "rejected"}`}>
          {verdict.approved ? "✅ APPROVED" : "🔄 REFINING"}
        </div>
      </div>

      <div className="jc-score-row">
        <div className="jc-score-nums">
          <span className="jc-score-big" style={{ color }}>{verdict.score}</span>
          <span className="jc-score-max">/100</span>
        </div>
        <div className="jc-bar-track">
          <div
            className="jc-bar-fill"
            style={{
              width: `${verdict.score}%`,
              background: scoreToGradient(verdict.score),
            }}
          />
        </div>
      </div>

      <p className="jc-feedback">{verdict.feedback}</p>

      {(verdict.strengths.length > 0 || verdict.weaknesses.length > 0) && (
        <div className="jc-lists">
          {verdict.strengths.length > 0 && (
            <div className="jc-list s">
              <div className="jc-list-label s">Strengths</div>
              <ul>
                {verdict.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {verdict.weaknesses.length > 0 && (
            <div className="jc-list w">
              <div className="jc-list-label w">To Improve</div>
              <ul>
                {verdict.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
