# 1-2 Gemini Classifier

## Tier

1 (Independent)

## Context

Implement command classification using Gemini Flash directly.

## Problem

Need to classify incoming command text into categories with confidence score.

## Scope

- Direct `@google/generative-ai` SDK usage
- Gemini Flash model (gemini-2.0-flash-exp or similar)
- Classification prompt returning type + confidence
- Structured output parsing

## Non-Scope

- Fallback providers
- Retry logic
- Rate limiting

## Approach

1. Create classifier port interface
2. Implement Gemini classifier in `infra/gemini/classifier.ts`
3. Use structured output (JSON mode) for reliable parsing

## Classification Categories

- todo: task, action item, reminder to do something
- research: question, lookup request, information query
- note: observation, thought, memo
- link: URL sharing, web content
- calendar: event, meeting, date-related
- reminder: time-based notification
- unclassified: unclear intent

## Prompt Design

```
Classify this message into one category. Return JSON with type and confidence (0-1).

Categories: todo, research, note, link, calendar, reminder, unclassified

Message: {text}

Response format: {"type": "category", "confidence": 0.95}
```

## Files

- `domain/ports/classifier.ts`
- `infra/gemini/classifier.ts`
- `config.ts` - add GEMINI_API_KEY

## Checklist

- [ ] Classifier port interface
- [ ] Gemini implementation with Flash model
- [ ] Structured output parsing
- [ ] Error handling (return unclassified on failure)
- [ ] Config for API key

## Definition of Done

Classifier returns type + confidence for any text input.

## Verification

```bash
npm run typecheck --workspace=@intexuraos/commands-router
```

## Rollback

Delete classifier files.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
