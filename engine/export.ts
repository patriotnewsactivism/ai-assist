import PDFDocument from "pdfkit";
import { parseFilesFromOutput } from "./fileparser.js";
import type { RoundResult, RouterOutput } from "./types.js";

// ── Types ──

export interface ExportableRun {
  sessionId: string;
  input: string;
  mode?: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "complete" | "error";
  events: any[];
  finalOutput: string;
  error?: string;
}

export interface ParsedChange {
  path: string;
  content: string;
  action: "MODIFIED" | "NEW" | "DELETE";
}

// ── Change Manifest ──

export function extractChanges(finalOutput: string): ParsedChange[] {
  const files = parseFilesFromOutput(finalOutput);
  const changes: ParsedChange[] = [];

  // Check for CHANGES SUMMARY section
  const summaryMatch = finalOutput.match(/===\s*CHANGES?\s*SUMMARY\s*===\s*\n([\s\S]*?)(?:$|===)/i);
  const summaryLines = summaryMatch ? summaryMatch[1]!.split("\n").filter(l => l.trim()) : [];

  for (const file of files) {
    // Try to match action from summary
    let action: ParsedChange["action"] = "MODIFIED";
    for (const line of summaryLines) {
      if (line.includes(file.path)) {
        if (/\[NEW\]/i.test(line)) action = "NEW";
        else if (/\[DELETE\]/i.test(line)) action = "DELETE";
        break;
      }
    }
    changes.push({ path: file.path, content: file.content, action });
  }

  // Also find DELETE entries in summary that have no file block
  for (const line of summaryLines) {
    if (/\[DELETE\]/i.test(line)) {
      const pathMatch = line.match(/\[DELETE\]\s*(\S+)/i);
      if (pathMatch && !changes.some(c => c.path === pathMatch[1])) {
        changes.push({ path: pathMatch[1]!, content: "", action: "DELETE" });
      }
    }
  }

  return changes;
}

// ── Markdown Export ──

export function buildMarkdownReport(run: ExportableRun, options: { fullHistory?: boolean } = {}): string {
  const lines: string[] = [];
  const rounds = extractRoundsFromEvents(run.events);
  const routing = extractRoutingFromEvents(run.events);

  lines.push(`# Think Tank Report`);
  lines.push(`\n*Generated: ${new Date().toISOString()}*`);
  lines.push(`*Session: ${run.sessionId}*\n`);

  if (routing) {
    lines.push(`## Session Info\n`);
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Mode** | ${routing.mode.replace("_", " ")} |`);
    lines.push(`| **Goal** | ${routing.extracted_goal} |`);
    lines.push(`| **Domain** | ${routing.suggested_domain} |`);
    lines.push(`| **Rounds** | ${rounds.length} |`);
    if (rounds.length > 0) {
      lines.push(`| **Peak Score** | ${Math.max(...rounds.map(r => r.verdict.score))}/100 |`);
      lines.push(`| **Final Score** | ${rounds[rounds.length - 1]!.verdict.score}/100 |`);
    }
    lines.push(``);
  }

  // Score progression
  if (rounds.length > 1) {
    lines.push(`## Score Progression\n`);
    lines.push(rounds.map((r, i) => `Round ${i + 1}: **${r.verdict.score}**/100`).join(" → "));
    lines.push(``);
  }

  lines.push(`## Final Output\n`);
  lines.push(run.finalOutput || "*No output produced*");

  if (options.fullHistory !== false && rounds.length > 0) {
    lines.push(`\n---\n\n## Debate History\n`);
    for (const round of rounds) {
      lines.push(`\n### Round ${round.round}\n`);
      for (const agent of round.agents) {
        if (agent.role !== "judge") {
          lines.push(`#### ${agent.emoji} ${agent.name} (${agent.provider}/${agent.modelId})\n`);
          lines.push(agent.output);
          lines.push(``);
        }
      }
      lines.push(`#### ⚖️ Judge Verdict — Score: ${round.verdict.score}/100`);
      lines.push(`> ${round.verdict.feedback}`);
      if (round.verdict.strengths.length > 0) {
        lines.push(`\n**Strengths:**`);
        round.verdict.strengths.forEach(s => lines.push(`- ${s}`));
      }
      if (round.verdict.weaknesses.length > 0) {
        lines.push(`\n**Weaknesses:**`);
        round.verdict.weaknesses.forEach(w => lines.push(`- ${w}`));
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

// ── JSON Export ──

export function buildJsonExport(run: ExportableRun): string {
  const rounds = extractRoundsFromEvents(run.events);
  const routing = extractRoutingFromEvents(run.events);
  const changes = extractChanges(run.finalOutput);

  return JSON.stringify({
    sessionId: run.sessionId,
    input: run.input,
    mode: run.mode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    routing,
    rounds: rounds.map(r => ({
      round: r.round,
      agents: r.agents.map(a => ({
        role: a.role,
        name: a.name,
        provider: a.provider,
        modelId: a.modelId,
        output: a.output,
        ...(a.reasoning ? { reasoning: a.reasoning } : {}),
      })),
      verdict: r.verdict,
    })),
    finalOutput: run.finalOutput,
    changes: changes.length > 0 ? changes : undefined,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

// ── PDF Export ──

export async function buildPdfReport(run: ExportableRun): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        info: {
          Title: "Think Tank Report",
          Author: "AI Think Tank",
          Subject: run.input.slice(0, 200),
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const rounds = extractRoundsFromEvents(run.events);
      const routing = extractRoutingFromEvents(run.events);

      // ── Cover Section ──
      doc.fontSize(28).fillColor("#6366f1").text("🧠 Think Tank Report", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#94a3b8").text(`Session: ${run.sessionId}`, { align: "center" });
      doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, { align: "center" });
      doc.moveDown(1);

      // Goal box
      doc.rect(50, doc.y, 495, 60).fill("#1e1b4b");
      doc.fillColor("#e0e7ff").fontSize(10).text("GOAL", 60, doc.y - 55, { continued: false });
      doc.fillColor("#ffffff").fontSize(12).text(
        routing?.extracted_goal ?? run.input.slice(0, 300),
        60, doc.y - 38, { width: 475 }
      );
      doc.y = doc.y + 30;

      // Stats row
      if (routing) {
        doc.moveDown(0.5);
        const stats = [
          { label: "Mode", value: routing.mode.replace("_", " ") },
          { label: "Domain", value: routing.suggested_domain },
          { label: "Rounds", value: String(rounds.length) },
        ];
        if (rounds.length > 0) {
          stats.push({ label: "Peak Score", value: `${Math.max(...rounds.map(r => r.verdict.score))}/100` });
          stats.push({ label: "Final Score", value: `${rounds[rounds.length - 1]!.verdict.score}/100` });
        }
        doc.fontSize(9).fillColor("#94a3b8");
        for (const stat of stats) {
          doc.text(`${stat.label}: `, { continued: true }).fillColor("#ffffff").text(stat.value, { continued: true }).fillColor("#94a3b8").text("   ", { continued: true });
        }
        doc.text(""); // end the continued line
      }

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#334155").lineWidth(0.5).stroke();
      doc.moveDown(1);

      // ── Final Output ──
      doc.fontSize(16).fillColor("#6366f1").text("Final Output");
      doc.moveDown(0.5);

      // Split output into chunks to avoid pdfkit overflow
      const outputText = run.finalOutput || "[No output produced]";
      const outputChunks = splitTextForPdf(outputText, 3000);
      for (const chunk of outputChunks) {
        doc.fontSize(10).fillColor("#e2e8f0").text(chunk, { lineGap: 3 });
      }

      // ── Debate History ──
      if (rounds.length > 0) {
        doc.addPage();
        doc.fontSize(16).fillColor("#6366f1").text("Debate History");
        doc.moveDown(0.5);

        for (const round of rounds) {
          // Check if we need a new page
          if (doc.y > 650) doc.addPage();

          doc.fontSize(13).fillColor("#f59e0b").text(`Round ${round.round} — Score: ${round.verdict.score}/100`);
          doc.moveDown(0.3);

          for (const agent of round.agents) {
            if (doc.y > 680) doc.addPage();

            const agentColors: Record<string, string> = {
              researcher: "#3b82f6",
              steelman: "#6366f1",
              adversary: "#ef4444",
              expert: "#8b5cf6",
              synthesizer: "#10b981",
              judge: "#f59e0b",
            };

            doc.fontSize(11).fillColor(agentColors[agent.role] ?? "#ffffff")
              .text(`${agent.emoji} ${agent.name}`);
            doc.fontSize(8).fillColor("#64748b").text(`${agent.provider}/${agent.modelId}`);

            // Truncate agent output for PDF (full output is in markdown/json exports)
            const truncatedOutput = agent.output.length > 1500
              ? agent.output.slice(0, 1500) + "\n\n[... truncated — see Markdown or JSON export for full text]"
              : agent.output;

            const agentChunks = splitTextForPdf(truncatedOutput, 2000);
            for (const chunk of agentChunks) {
              doc.fontSize(9).fillColor("#cbd5e1").text(chunk, { lineGap: 2 });
            }
            doc.moveDown(0.5);
          }

          // Judge verdict
          if (doc.y > 650) doc.addPage();
          doc.fontSize(10).fillColor("#f59e0b").text(`⚖️ Verdict: ${round.verdict.feedback}`);
          if (round.verdict.strengths.length > 0) {
            doc.fontSize(9).fillColor("#10b981");
            round.verdict.strengths.forEach(s => doc.text(`  ✓ ${s}`));
          }
          if (round.verdict.weaknesses.length > 0) {
            doc.fontSize(9).fillColor("#ef4444");
            round.verdict.weaknesses.forEach(w => doc.text(`  ✗ ${w}`));
          }
          doc.moveDown(1);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Helpers ──

function splitTextForPdf(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find a good break point
    let breakIdx = remaining.lastIndexOf("\n", maxLen);
    if (breakIdx < maxLen * 0.5) breakIdx = remaining.lastIndexOf(" ", maxLen);
    if (breakIdx < maxLen * 0.3) breakIdx = maxLen;
    chunks.push(remaining.slice(0, breakIdx));
    remaining = remaining.slice(breakIdx);
  }
  return chunks;
}

function extractRoutingFromEvents(events: any[]): RouterOutput | null {
  const ev = events.find(e => e.type === "routing");
  return ev?.data ?? null;
}

function extractRoundsFromEvents(events: any[]): RoundResult[] {
  return events
    .filter(e => e.type === "round_complete")
    .map(e => e.data as RoundResult);
}
