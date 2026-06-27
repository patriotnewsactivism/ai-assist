# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run the engine directly with `tsx` (no compile step needed):
```
npx tsx engine.ts
```

Type-check without emitting:
```
npx tsc --noEmit
```

There is no test suite configured.

## Environment Setup

Copy `.env` and populate `DEEPSEEK_API_KEY`. The engine will exit with an error if the key is missing or empty.

## Architecture

This project is a single-file adversarial AI loop (`engine.ts`) that uses the OpenAI SDK pointed at the DeepSeek API (`baseURL: "https://api.deepseek.com/v1"`, model `deepseek-chat`).

The execution flow has three stages:

1. **Router** (`routeInput`) — sends the user's input to DeepSeek and gets back a JSON classification: one of `RESEARCH_MODE`, `DATA_MODE`, or `CODE_MODE`, plus a `confidence_score` and `extracted_goal`.

2. **Adversarial loop** (`runAdversarialLoop`) — runs up to `maxIterations` (default 4) rounds between two LLM personas:
   - **Creator** (The Architect / The Harvester) — produces or patches the output toward the extracted goal.
   - **Auditor** (The Compiler / The Validator) — critiques the creator's output. Termination condition: auditor response contains the word `PERFECT`.
   - `CODE_MODE` uses code-focused personas; all other modes use data/research personas.

3. **Main** — hard-codes a test input string, runs the router, then runs the loop. To change the task, edit the `testInput` variable in `main()`.

The auditor maintains a running conversation history across iterations; the creator is stateless (fresh context each round).
