import * as dotenv from "dotenv";
dotenv.config();

import { OpenAI } from "openai";

// 1. Explicitly grab the key and strip any hidden spaces/newlines
const deepseekKey = (process.env.DEEPSEEK_API_KEY || "").trim();

// 2. Fallback check to prevent the SDK from throwing a construction error
if (!deepseekKey) {
  console.error("❌ ERROR: DEEPSEEK_API_KEY is empty or missing in your environment variables.");
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: "https://api.deepseek.com/v1", 
  apiKey: deepseekKey, // The SDK is now guaranteed a non-empty string
});
interface RouterOutput {
  mode: "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE";
  confidence_score: number;
  extracted_goal: string;
}

// STEP 1: The Silent Classification Router
async function routeInput(userInput: string): Promise<RouterOutput> {
  const response = await openai.chat.completions.create({
    model: "deepseek-chat", // DeepSeek-V3 or R1 equivalent chat model
    messages: [
      {
        role: "system",
        content: `You are the silent classification layer for Assistant. Analyze the input, route it, and extract the primary objective. Output ONLY a raw JSON object matching this schema:
        { "mode": "RESEARCH_MODE" | "DATA_MODE" | "CODE_MODE", "confidence_score": 0-100, "extracted_goal": "string" }`
      },
      { role: "user", content: userInput }
    ],
    response_format: { type: "json_object" }
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

// STEP 2: The Adversarial Loop Execution
async function runAdversarialLoop(routing: RouterOutput, originalInput: string, maxIterations: number = 4) {
  console.log(`\n[Router] Selected Mode: ${routing.mode} (Confidence: ${routing.confidence_score}%)`);
  console.log(`[Target Goal]: ${routing.extracted_goal}\n`);

  // Dynamically set system personas based on the routing mode
  let creatorPersona = "";
  let auditorPersona = "";

  if (routing.mode === "CODE_MODE") {
    creatorPersona = `You are The Architect. Your goal is to write clean, high-performance code to accomplish: "${routing.extracted_goal}". Provide ONLY code blocks and necessary context. No fluff.`;
    auditorPersona = `You are The Compiler and Security Auditor. Your sole job is to ruthlessly attack the code provided by The Architect. Look for memory leaks, optimization flaws, and security edge cases. Do not be polite. Demand fixes. If the code is absolutely flawless, respond with exactly one word: 'PERFECT'.`;
  } else {
    // Fallback/Default for DATA_MODE and RESEARCH_MODE
    creatorPersona = `You are The Harvester. Synthesize, organize, and structure data to achieve: "${routing.extracted_goal}".`;
    auditorPersona = `You are The Validator. Find contradictions, logical fallacies, or missing citations in The Harvester's output. If the data is fully accurate, pristine, and perfectly structured, respond with exactly one word: 'PERFECT'.`;
  }

  let currentTurn = 0;
  let lastCreatorOutput = `Initial request based on user input: ${originalInput}`;
  let conversationHistoryForAuditor: any[] = [{ role: "system", content: auditorPersona }];

  while (currentTurn < maxIterations) {
    currentTurn++;
    console.log(`--- ITERATION ${currentTurn} ---`);

    // 1. Auditor reviews the last output
    conversationHistoryForAuditor.push({ role: "user", content: `Review this latest iteration:\n\n${lastCreatorOutput}` });
    
    console.log("🤖 [Auditor] Reviewing...");
    const auditorResponse = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: conversationHistoryForAuditor,
    });

    const auditFeedback = auditorResponse.choices[0].message.content || "";
    console.log(`🤖 [Auditor Sent Feedback]:\n${auditFeedback}\n`);

    // Check for termination criteria
    if (auditFeedback.trim().toUpperCase().includes("PERFECT")) {
      console.log("✅ Success! The Auditor has deemed the payload perfect.");
      break;
    }

    // Keep auditor's memory clean
    conversationHistoryForAuditor.push({ role: "assistant", content: auditFeedback });

    // 2. Creator processes the audit feedback and rebuilds/patches the work
    console.log("🛠️ [Creator] Re-building and patching errors...");
    const creatorResponse = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: creatorPersona },
        { role: "user", content: `The Auditor found these flaws in your work:\n${auditFeedback}\n\nFix these issues completely and provide the updated version.` }
      ],
    });

    lastCreatorOutput = creatorResponse.choices[0].message.content || "";
    console.log(`🛠️ [Creator Sent Patched Version]:\n${lastCreatorOutput}\n`);
  }

  console.log("====================================");
  console.log("🏁 LOOP TERMINATED. FINAL PAYLOAD:");
  console.log(lastCreatorOutput);
  console.log("====================================");
}

// Main execution block
async function main() {
  // Test code mode input
  const testInput = "Write a high-performance TypeScript script to handle heavy WebSockets connections and optimize it for a cloud server framework.";
  
  const classification = await routeInput(testInput);
  await runAdversarialLoop(classification, testInput);
}

main();