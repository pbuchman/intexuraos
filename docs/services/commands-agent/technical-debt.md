# Commands Agent - Technical Debt

## Summary

| Category       | Count | Severity |
| -------------- | ----- | -------- |
| TODO/FIXME     | 0     | -        |
| Code Smells    | 2     | Low      |
| Test Coverage  | 0     | -        |
| SRP Violations | 0     | -        |

## Future Plans

Based on code analysis and git history:

1. **Reminder handler implementation** - CommandType includes `reminder` but actions-agent handler not yet implemented
2. **Additional language support** - Currently English and Polish; German and Spanish phrases could be added
3. **Confidence threshold tuning** - Low confidence commands default to `note`; could offer user confirmation flow

## Code Smells

### 1. JSON extraction uses regex

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** `parseClassifyResponse()` uses regex `/\{[\s\S]*}/` to extract JSON from LLM response. If LLM returns multiple JSON objects or malformed text, extraction may fail unpredictably.

**Impact:** Low - LLMs reliably return single JSON block; fallback to `note` handles edge cases gracefully.

**Recommendation:** Use structured output mode when available (Gemini function calling, OpenAI JSON mode).

### 2. Magic numbers for truncation limits

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** Title sliced to 100 chars, reasoning to 500 chars without named constants.

**Recommendation:** Extract to constants:

```typescript
const MAX_TITLE_LENGTH = 100;
const MAX_REASONING_LENGTH = 500;
```

## Resolved Issues (v2.0.0)

### URL keyword misclassification

**Resolved in:** INT-177 (v2.0.0)

**Previous issue:** URLs like "https://research-world.com" would trigger `research` classification due to keyword matching.

**Solution:** Added URL keyword isolation guidance to prompt (Step 4) and explicit intent detection (Step 2) that overrides URL-based signals.

### Multilingual support limited to English

**Resolved in:** INT-177 (v2.0.0)

**Previous issue:** Non-English speakers had to use English command phrases.

**Solution:** Added Polish command phrases to Step 1 (explicit prefix) and Step 2 (explicit intent) of classification prompt.

## Test Coverage

No test coverage gaps identified. Core paths tested:

- Classification for all command types
- URL keyword isolation
- Explicit intent detection
- Polish language support
- PWA-shared confidence boost
- Error handling (invalid JSON, API errors, timeouts)
- Confidence clamping
- Title/reasoning truncation

## TypeScript Issues

- No `any` types detected
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass

## TODOs/FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

## Deprecations

No deprecated API usage detected.

## Integration Considerations

### actions-agent dependency

Commands-agent creates actions via HTTP to actions-agent. If actions-agent is unavailable, commands fail with `failed` status. Consider circuit breaker pattern for resilience.

### Prompt versioning

Classification prompt lives in `packages/llm-prompts`. Changes require package rebuild and service redeploy. Consider runtime prompt loading for faster iteration.

---

**Last updated:** 2026-01-24
