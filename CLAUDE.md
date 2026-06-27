# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development server** (runs both backend API and Vite frontend dev server):
```
npm run dev
```
The server starts on `http://localhost:5000`. Vite proxies `/api` calls to the backend.

**Build frontend** (compiles React + TypeScript to `dist/`):
```
npm run build-frontend
```

**Type-check** (no emit):
```
npx tsc --noEmit
```

There is no test suite configured.

## Environment Setup

Copy `.env` and populate `DEEPSEEK_API_KEY`. The server will exit with an error if the key is missing or empty.

## Architecture

**Backend**: `engine.ts` (adversarial AI loop) + `server.ts` (Express HTTP API).

`engine.ts` exports two functions:
- `routeInput(userInput)` — sends input to DeepSeek, returns JSON classification: `{mode, confidence_score, extracted_goal}`
- `runAdversarialLoop(routing, input, maxIterations, progress?)` — runs up to `maxIterations` rounds between two LLM personas, calling progress callbacks on each iteration.

The adversarial loop uses two stateful personas:
- **Creator** (The Architect for `CODE_MODE`, The Harvester for others) — produces/refines output.
- **Auditor** (The Compiler for `CODE_MODE`, The Validator for others) — critiques and provides feedback. Terminates when response contains "PERFECT".

The Auditor maintains conversation history across iterations; the Creator is stateless (fresh context each turn).

**Frontend**: React + Vite (`src/`) with three main components:
- `DebateInput` — form to enter task and max iterations
- `DebateProgress` — displays router classification and live iteration panels (Creator vs. Auditor side-by-side)
- `DebateResult` — final output viewer with tab for full debate history

`server.ts` exposes:
- `POST /api/debate` — start a debate session, returns session ID + full results once complete
- `GET /api/debate/:sessionId` — poll session progress (for future streaming updates)
- Static files served from `dist/` (Vite build output)
