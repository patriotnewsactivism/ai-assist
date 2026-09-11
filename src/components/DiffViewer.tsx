import { useState, useMemo } from "react";

export interface DiffLine {
  type: "add" | "delete" | "normal";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

interface Props {
  path: string;
  originalContent?: string | undefined;
  newContent: string;
  action: "MODIFIED" | "NEW" | "DELETE";
  defaultMode?: "diff" | "raw";
}

/**
 * Computes a line-by-line diff using Longest Common Subsequence (LCS).
 * Fast, lightweight, and zero external dependencies.
 */
export function computeLineDiff(
  originalStr: string | undefined,
  newStr: string,
  action: "MODIFIED" | "NEW" | "DELETE"
): { lines: DiffLine[]; stats: DiffStats } {
  // If original string is missing or action is NEW, all lines are added
  if (originalStr === undefined || action === "NEW") {
    const rawLines = newStr.split("\n");
    const lines: DiffLine[] = rawLines.map((content, idx) => ({
      type: "add",
      newLineNumber: idx + 1,
      content,
    }));
    return { lines, stats: { additions: rawLines.length, deletions: 0 } };
  }

  // If action is DELETE, all original lines are deleted
  if (action === "DELETE") {
    const rawLines = (originalStr || "").split("\n");
    const lines: DiffLine[] = rawLines.map((content, idx) => ({
      type: "delete",
      oldLineNumber: idx + 1,
      content,
    }));
    return { lines, stats: { additions: 0, deletions: rawLines.length } };
  }

  const origLines = originalStr.split("\n");
  const newLines = newStr.split("\n");

  // Fast-path: identical files
  if (originalStr === newStr) {
    const lines: DiffLine[] = origLines.map((content, idx) => ({
      type: "normal",
      oldLineNumber: idx + 1,
      newLineNumber: idx + 1,
      content,
    }));
    return { lines, stats: { additions: 0, deletions: 0 } };
  }

  // Size cap to prevent slow LCS on massive files (> 2,500 lines)
  if (origLines.length > 2500 || newLines.length > 2500) {
    // Fallback to simple split diff
    const lines: DiffLine[] = [
      ...origLines.slice(0, 100).map((content, idx) => ({
        type: "delete" as const,
        oldLineNumber: idx + 1,
        content,
      })),
      ...newLines.slice(0, 100).map((content, idx) => ({
        type: "add" as const,
        newLineNumber: idx + 1,
        content,
      })),
    ];
    return {
      lines,
      stats: { additions: newLines.length, deletions: origLines.length },
    };
  }

  // LCS Matrix computation
  const m = origLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to build diff lines
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  let additions = 0;
  let deletions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === newLines[j - 1]) {
      result.push({
        type: "normal",
        oldLineNumber: i,
        newLineNumber: j,
        content: origLines[i - 1]!,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({
        type: "add",
        newLineNumber: j,
        content: newLines[j - 1]!,
      });
      additions++;
      j--;
    } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
      result.push({
        type: "delete",
        oldLineNumber: i,
        content: origLines[i - 1]!,
      });
      deletions++;
      i--;
    }
  }

  result.reverse();
  return { lines: result, stats: { additions, deletions } };
}

export default function DiffViewer({
  path: _path,
  originalContent,
  newContent,
  action,
  defaultMode = "diff",
}: Props) {
  const [mode, setMode] = useState<"diff" | "raw">(defaultMode);
  const [copied, setCopied] = useState(false);

  const { lines, stats } = useMemo(() => {
    return computeLineDiff(originalContent, newContent, action);
  }, [originalContent, newContent, action]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(newContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const rawLines = useMemo(() => newContent.split("\n"), [newContent]);

  return (
    <div className="diff-viewer">
      {/* Viewer toolbar */}
      <div className="diff-viewer-toolbar">
        <div className="diff-stats-pill">
          {stats.additions > 0 && (
            <span className="diff-stat-add">+{stats.additions}</span>
          )}
          {stats.deletions > 0 && (
            <span className="diff-stat-del">-{stats.deletions}</span>
          )}
          {stats.additions === 0 && stats.deletions === 0 && (
            <span className="diff-stat-none">0 changes</span>
          )}
        </div>

        <div className="diff-mode-toggle">
          <button
            type="button"
            className={`diff-toggle-btn ${mode === "diff" ? "active" : ""}`}
            onClick={() => setMode("diff")}
          >
            Unified Diff
          </button>
          <button
            type="button"
            className={`diff-toggle-btn ${mode === "raw" ? "active" : ""}`}
            onClick={() => setMode("raw")}
          >
            Full File ({rawLines.length}L)
          </button>
        </div>

        <button
          type="button"
          className="btn btn-ghost diff-copy-btn"
          onClick={handleCopy}
          title="Copy file contents"
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      </div>

      {/* Content pane */}
      <div className="diff-table-container">
        {mode === "diff" ? (
          <table className="diff-table">
            <tbody>
              {lines.map((l, idx) => {
                const lineClass =
                  l.type === "add"
                    ? "diff-row-add"
                    : l.type === "delete"
                    ? "diff-row-del"
                    : "diff-row-normal";

                const marker =
                  l.type === "add" ? "+" : l.type === "delete" ? "-" : " ";

                return (
                  <tr key={idx} className={`diff-row ${lineClass}`}>
                    <td className="diff-gutter diff-gutter-old">
                      {l.oldLineNumber ?? ""}
                    </td>
                    <td className="diff-gutter diff-gutter-new">
                      {l.newLineNumber ?? ""}
                    </td>
                    <td className="diff-marker">{marker}</td>
                    <td className="diff-code">
                      <code>{l.content || " "}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="diff-table">
            <tbody>
              {rawLines.map((line, idx) => (
                <tr key={idx} className="diff-row diff-row-normal">
                  <td className="diff-gutter diff-gutter-new">{idx + 1}</td>
                  <td className="diff-marker"> </td>
                  <td className="diff-code">
                    <code>{line || " "}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
