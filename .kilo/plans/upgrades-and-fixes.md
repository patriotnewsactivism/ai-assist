# Next Big Upgrades and Fixes Plan

## Critical Issues (Immediate Fixes)

### 1. Groq API Token Limit Exceeded
**Problem:** Users hitting 413 Request EventSizeTooLarge errors when using llama-3.3-70b-versatile on Groq's free tier (12k TPM limit exceeded with 12,397 tokens).

**Solution:**
- Add proactive token counting and truncation before API calls
- Improve fallback chain to detect over-limit before failing
- Add warning in UI about token limits with large context

### 2. Server Fails Without API Keys
**Problem:** Server exits with fatal error if no API keys configured, preventing any frontend interaction.

**Solution:**
- Add frontend-only mode for documentation/UI preview
- Improve error message to show exactly which keys are missing and how to obtain them
- Add health check endpoint that returns configuration status

## Major Upgrades

### 3. Enhanced Sandbox Security
**Current:** Basic temp directory isolation, build commands executed directly

**Upgrades:**
- Container-based sandboxing (if Docker available) or stricter process isolation
- Configurable resource limits (memory, CPU, time) per sandbox
- Pre-build validation of generated code (syntax checking before execution)
- Sandboxed network access disabled by default

### 4. Improved Streaming & UX
**Current:** SSE with basic connection management

**Upgrades:**
- Better backpressure handling for large outputs
- Connection resume/reconnect capability
- Progress indicators with estimated time remaining
- Dark/light mode toggle

### 5. Agent Memory Enhancement
**Current:** Cross-round memory with key insights and open questions

**Upgrades:**
- Summarization of accumulated memory when it grows too large
- Memory relevance scoring (weight recent rounds more heavily)
- Manual memory injection for user guidance
- Memory export for debugging/analysis

### 6. Testing Infrastructure
**Problem:** No test suite configured

**Solution:**
- Add Jest/Vitest for unit tests
- Integration tests for roundtable flow
- Mock providers for testing without API keys
- Snapshot tests for agent output formats

### 7. Rate Limiting & Cost Management
**Current:** Basic retry on 429, credit detection

**Upgrades:**
- Per-provider cost tracking and budget limits
- User-configurable rate limit backoff strategy
- Estimated cost display before starting sessions
- Usage statistics endpoint

### 8. GitHub Integration Enhancements
**Current:** Basic repo import and PR creation

**Upgrades:**
- Support for GitHub Enterprise
- Better handling of large repositories (pagination, selective file import)
- PR templates with change summaries
- Branch naming customization

## Medium Priority Improvements

### 9. Frontend Component Organization
- Split ThinkTankInput into smaller, reusable components
- Add loading skeletons and better empty states
- Improve accessibility (keyboard navigation, screen reader labels)

### 10. Configuration Management
- Per-session configuration presets
- Saved model pack configurations
- Environment variable validation with clear error messages
- Configuration migration system for updates

### 11. Error Recovery
- Resume interrupted sessions from last successful round
- Save intermediate results to disk for crash recovery
- Graceful degradation when providers are unavailable

### 12. Performance Optimizations
- Cache web search results within a session
- Lazy loading for large document contexts
- Streaming response handling for large model outputs

## Implementation Order

1. **Critical Issues** (Issues #1-2) - Must fix before wider adoption
2. **Testing** (#6) - Foundation for safe refactoring
3. **Sandbox Security** (#3) - Important for production safety
4. **Rate Limiting** (#7) - Prevents cost overruns
5. **Streaming & UX** (#4) - Improves user experience
6. **Agent Memory** (#5) - Enhances output quality
7. **GitHub Integration** (#8) - Completes toolchain integration
8. **Medium Priority** (#9-12) - Nice-to-have enhancements