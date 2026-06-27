import * as dotenv from "dotenv";
dotenv.config();

import { routeInput, runRoundtable, DEFAULT_AGENT_MODELS } from "./engine/index.js";
import type { ThinkTankConfig } from "./engine/index.js";

// CLI entry point
async function main() {
  const input = process.argv[2] ??
    "Write a high-performance TypeScript WebSocket server with connection pooling, heartbeat, and graceful shutdown.";

  console.log(`\n🚀 Think Tank — "${input.slice(0, 80)}..."\n`);

  const routing = await routeInput(input);
  console.log(`[Router] ${routing.mode} (${routing.confidence_score}%) — ${routing.extracted_goal}\n`);

  const config: ThinkTankConfig = {
    input,
    maxRounds: 3,
    agentModels: DEFAULT_AGENT_MODELS,
  };

  await runRoundtable(config, routing, (event) => {
    if (event.type === "agent_thinking") {
      console.log(`${event.data.emoji} [${event.data.name}] thinking... (Round ${event.data.round})`);
    } else if (event.type === "agent_complete") {
      console.log(`${event.data.emoji} [${event.data.name}] done.\n`);
    } else if (event.type === "round_complete") {
      console.log(`⚖️  Round ${event.data.round} verdict: ${event.data.verdict.score}/100 — ${event.data.verdict.approved ? "APPROVED" : "continue"}\n`);
    } else if (event.type === "complete") {
      console.log("====================================");
      console.log("🏁 FINAL OUTPUT:");
      console.log(event.data.finalOutput);
      console.log("====================================");
    }
  });
}

main().catch(console.error);
