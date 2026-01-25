# Commands Agent - Technical Debt

**Last Updated:** 2025-01-25
**Analysis Run:** Service documentation generation (v2.1.0 context)

---

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

2. **Additional language support** - Currently English and Polish; German and Spanish phrases could be added to Step 1 and Step 2 of classification prompt

3. **Confidence threshold tuning** - Low confidence commands default to `note`; could offer user confirmation flow for ambiguous inputs

4. **Structured output mode** - Consider using Gemini function calling or OpenAI JSON mode instead of regex JSON extraction

## Code Smells

### 1. JSON extraction uses regex

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** `parseClassifyResponse()` uses regex `/\{[\s\S]*}/` to extract JSON from LLM response. If LLM returns multiple JSON objects or malformed text, extraction may fail unpredictably.

**Impact:** Low - LLMs reliably return single JSON block; Zod validation catches malformed responses; fallback to `note` handles edge cases gracefully.

**Recommendation:** Use structured output mode when available (Gemini function calling, OpenAI JSON mode).

### 2. Magic numbers for truncation limits

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** Title sliced to 100 chars, reasoning to 500 chars without named constants.

**Recommendation:** Extract to constants:

```typescript
const MAX_TITLE_LENGTH = 100;
const MAX_REASONING_LENGTH = 500;
const PWA_SHARED_LINK_CONFIDENCE_BOOST = 0.1;
```

## Resolved Issues (v2.0.0 - v2.1.0)

### URL keyword misclassification

**Resolved in:** INT-177 (v2.0.0)

**Previous issue:** URLs like "https://research-world.com" would trigger `research` classification due to keyword matching.

**Solution:** Added URL keyword isolation guidance to prompt (Step 4) and explicit intent detection (Step 2) that overrides URL-based signals.

### Multilingual support limited to English

**Resolved in:** INT-177 (v2.0.0)

**Previous issue:** Non-English speakers had to use English command phrases.

**Solution:** Added Polish command phrases to Step 1 (explicit prefix) and Step 2 (explicit intent) of classification prompt.

### LLM response validation without type safety

**Resolved in:** INT-218 (v2.1.0)

**Previous issue:** LLM responses were parsed as JSON without schema validation, risking runtime errors.

**Solution:** Migrated to Zod schema validation (`CommandClassificationSchema`) with detailed error logging for failed validations.

### User service client implementation duplication

**Resolved in:** INT-269 (v2.1.0)

**Previous issue:** Each service implemented its own HTTP client for user-service.

**Solution:** Migrated to `@intexuraos/internal-clients/user-service` package for shared implementation.

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
- Idempotent command processing
- Pending classification retry logic

## TypeScript Issues

- No `any` types detected
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass
- Zod schema validation: Implemented (v2.1.0)

## TODOs/FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

## Deprecations

No deprecated API usage detected.

## Integration Considerations

### actions-agent dependency

Commands-agent creates actions via HTTP to actions-agent. If actions-agent is unavailable, commands fail with `failed` status. Consider circuit breaker pattern for resilience.

### Prompt versioning

Classification prompt lives in `packages/llm-prompts`. Changes require package rebuild and service redeploy. Consider runtime prompt loading for faster iteration.

### Pub/Sub push authentication

Uses `from: noreply@google.com` header to detect Pub/Sub pushes vs direct service calls. This is reliable but implicitly couples to Google's infrastructure behavior.

---

**Last updated:** 2025-01-25
