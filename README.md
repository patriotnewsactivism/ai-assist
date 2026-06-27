# AI Debate Engine

A web-based system where two AI agents debate and refine ideas through an adversarial loop until they reach perfection. Built for deep research, code generation, and data synthesis.

## Features

- **Adversarial AI Loop**: Creator and Auditor LLMs challenge each other iteratively
- **Multi-Mode Classification**: Automatically routes tasks to RESEARCH_MODE, DATA_MODE, or CODE_MODE
- **Real-time Visualization**: Watch the debate unfold side-by-side with Creator vs. Auditor panels
- **Web Interface**: Modern React UI with Vite, responsive design
- **Fast Refinement**: Get better results quicker through iterative self-improvement

## Getting Started

### Prerequisites

- Node.js 18+
- DeepSeek API key

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file in the root directory:

```
DEEPSEEK_API_KEY=your_key_here
```

### Development

Start the development server (runs both backend API and frontend):

```bash
npm run dev
```

Open `http://localhost:5000` in your browser.

### Building

Build the frontend for production:

```bash
npm run build-frontend
```

The server will serve the production build from the `dist/` directory.

## How It Works

### 1. Input Classification (Router)
You submit a task or question. The router analyzes it and classifies it into one of three modes:
- **RESEARCH_MODE** 🔍 — Deep research and data synthesis
- **DATA_MODE** 📊 — Data analysis and structuring
- **CODE_MODE** 💻 — Code generation and refinement

### 2. Adversarial Loop
Two AI personas engage in a debate:
- **Creator** (The Architect / The Harvester) — Produces or refines the output
- **Auditor** (The Compiler / The Validator) — Critiques and provides feedback

The loop continues until:
- The Auditor responds with "PERFECT" (quality threshold met)
- Max iterations reached (default: 4, configurable up to 10)

### 3. Result
View the final refined output and explore the complete debate history showing how the agents challenged and improved each other's work.

## Architecture

- **Backend**: Express.js + TypeScript
- **Frontend**: React + Vite + TypeScript
- **AI Engine**: DeepSeek API (via OpenAI SDK)
- **State Management**: React hooks

See `CLAUDE.md` for detailed technical architecture.

## API Endpoints

### POST /api/debate
Start a new debate session.

**Request:**
```json
{
  "input": "Your task or question",
  "maxIterations": 4
}
```

**Response:**
```json
{
  "sessionId": "timestamp",
  "routing": {
    "mode": "CODE_MODE",
    "confidence_score": 95,
    "extracted_goal": "..."
  },
  "iterations": [
    {
      "iteration": 1,
      "auditorFeedback": "...",
      "creatorOutput": "...",
      "isPerfect": false
    }
  ],
  "finalOutput": "..."
}
```

### GET /api/debate/:sessionId
Get the status of an ongoing or completed debate session.

## Examples

### Code Generation
```
Write a complete TypeScript REST API with authentication, database integration, and rate limiting
```

### Research
```
Deep research on the latest advances in AI safety and their implications for the industry
```

### Data Synthesis
```
Compare and contrast React, Vue, and Svelte ecosystems with pros/cons for 2024
```

## Development Notes

- The engine uses stateless Creator contexts (fresh each iteration) and stateful Auditor history
- Personas adapt based on detected mode (CODE_MODE uses compiler/security focus; others use research focus)
- CSS imports in React components are handled by Vite
- TypeScript is strict (`strict: true`) with index access and optional property checking

## License

ISC
