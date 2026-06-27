import { useState } from "react";
import "../styles/DebateInput.css";

interface Props {
  onSubmit: (input: string, maxIterations: number) => void;
}

export default function DebateInput({ onSubmit }: Props) {
  const [input, setInput] = useState("");
  const [maxIterations, setMaxIterations] = useState(4);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSubmit(input, maxIterations);
    }
  };

  return (
    <div className="debate-input">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="input">Enter your task or question:</label>
          <textarea
            id="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="E.g., Write a TypeScript REST API for managing todos with real-time updates..."
            rows={6}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="maxIterations">Max iterations: {maxIterations}</label>
          <input
            id="maxIterations"
            type="range"
            min="2"
            max="10"
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
          />
          <small>More iterations = deeper refinement, longer wait time</small>
        </div>

        <button type="submit" className="submit-btn" disabled={!input.trim()}>
          🚀 Start Debate
        </button>
      </form>

      <div className="examples">
        <h3>Examples:</h3>
        <ul>
          <li>📝 Deep research: "Summarize the latest AI safety concerns and their implications"</li>
          <li>💻 Code generation: "Build a complete TypeScript Node.js API with auth and database"</li>
          <li>🔍 Data synthesis: "Analyze the differences between React and Vue ecosystems"</li>
        </ul>
      </div>
    </div>
  );
}
