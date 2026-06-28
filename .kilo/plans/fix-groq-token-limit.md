# Fix Groq Token Limit Issue

## Problem
Users are encountering "413 Request too large" errors when using Groq's llama-3.3-70b-versatile model. The error shows:
- Limit: 12,000 TPM (tokens per minute)
- Requested: 12,397 tokens
- Exceeded by: 397 tokens

## Root Cause
In `engine/roundtable.ts`, the code correctly limits `customContext` for Groq models to 8,000 characters (line 45-48) but does NOT apply the same limit to the `memoryBlock` (cross-agent memory that accumulates over rounds).

As conversations progress through multiple rounds, the memoryBlock grows larger and larger, eventually causing the total token count to exceed Groq's limits.

## Solution
Apply the same character limit to `memoryBlock` that is already applied to `customContext` for Groq providers.

## Changes Made

### File: `engine/roundtable.ts`

Modified the `runAgent` function to add memoryBlock truncation for Groq models:

```typescript
// Groq free tier has 12k TPM — cap document context so input fits alongside 2k output
const ctxCharLimit = provider === "groq" ? 8_000 : undefined;
const trimmedContext = ctxCharLimit && config.customContext && config.customContext.length > ctxCharLimit
  ? config.customContext.slice(0, ctxCharLimit) + "\n\n[...context trimmed for token limit]"
  : config.customContext;

// Also limit memoryBlock for Groq to prevent token limit exceeded errors
const trimmedMemoryBlock = ctxCharLimit && memoryBlock && memoryBlock.length > ctxCharLimit
  ? memoryBlock.slice(0, ctxCharLimit) + "\n\n[...memory truncated for token limit]"
  : memoryBlock;

// ... rest of function ...

// Use trimmedMemoryBlock instead of memoryBlock in all userContent constructions
```

Applied this change to all agent types (researcher, steelman, adversary, expert, synthesizer, judge) where memoryBlock is included in the userContent.

## Testing
The fix ensures that both customContext and memoryBlock are limited to 8,000 characters for Groq models, providing ample headroom for the rest of the prompt and the expected 2,048 token output.

This should prevent the 413 errors while preserving as much context as possible within the model's limits.