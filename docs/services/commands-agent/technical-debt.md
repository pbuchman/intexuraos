# Commands Agent — Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** Service documentation generation (v3.1.0 context)

---

## Summary

| Category       | Count | Severity |
| -------------- | ----- | -------- |
| Code Smells    | 2     | Low      |
| Test Coverage  | 0     | —        |
| Type Issues    | 0     | —        |
| TODO/FIXME     | 0     | —        |
| SRP Violations | 0     | —        |
| **Total**      | **2** | Low      |

---

## Future Plans

Based on code analysis and git history:

1. **Reminder handler implementation** — CommandType includes `reminder` but actions-agent handler not yet implemented

2. **Additional language support** — Currently English and Polish; German and Spanish phrases could be added to Step 1 and Step 2 of classification prompt

3. **Confidence threshold tuning** — Low confidence commands default to `note`; could offer user confirmation flow for ambiguous inputs

4. **Structured output mode** — Consider using Gemini function calling or OpenAI JSON mode instead of regex JSON extraction

5. **Circuit breaker for actions-agent** — Commands fail with `failed` status when actions-agent is unavailable; circuit breaker pattern would improve resilience

6. **Graceful degradation for startup pricing** — `initServices()` hard-fails when app-settings-service is unreachable; cached or default pricing would improve boot resilience

---

## Code Smells

### 1. JSON extraction uses regex

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** `parseClassifyResponse()` uses regex `/\{[\s\S]*}/` to extract JSON from LLM response. If LLM returns multiple JSON objects or malformed text, extraction may fail unpredictably.

**Impact:** Low — LLMs reliably return single JSON block; Zod validation catches malformed responses; fallback to `note` handles edge cases gracefully.

**Recommendation:** Use structured output mode when available (Gemini function calling, OpenAI JSON mode).

### 2. Log preview length is a magic number

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** The `.slice(0, 500)` in `rawResponsePreview` log fields uses a bare number for the log preview length. `PWA_SHARED_LINK_CONFIDENCE_BOOST` and Zod-enforced title max (200 chars) are already named constants.

**Recommendation:** Extract to a named constant:

```typescript
const LOG_RESPONSE_PREVIEW_LENGTH = 500;
```

---

## Test Coverage

No test coverage gaps identified. Core paths tested:

- Classification for all command types (including `code`)
- URL keyword isolation
- Explicit intent detection
- Polish language support
- PWA-shared confidence boost
- Error handling (invalid JSON, API errors, timeouts)
- Confidence clamping
- Title/reasoning truncation
- Idempotent command processing
- Pending classification retry logic

---

## TypeScript Issues

- No `any` types detected in source code
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass
- Zod schema validation: Implemented
- Response contract compliance: `reply.ok()`/`reply.fail()`
- Sentry-enabled logging: `createAppLogger()`

---

## TODOs/FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

---

## Deprecations

No deprecated API usage detected.

---

## Integration Considerations

### actions-agent dependency

Commands-agent creates actions via HTTP to actions-agent. If actions-agent is unavailable, commands fail with `failed` status. Consider circuit breaker pattern for resilience.

### app-settings-service startup dependency

`initServices()` calls `fetchAllPricing()` from `app-settings-service` at startup before accepting requests. If app-settings-service is unreachable at boot, commands-agent fails to initialize entirely. This creates a hard coupling at startup. Consider graceful degradation (e.g., cached/default pricing) to improve resilience.

### Prompt versioning

Classification prompt lives in `packages/llm-prompts`. Changes require package rebuild and service redeploy. Consider runtime prompt loading for faster iteration. The `promptVersion` field stored with each classification enables tracking which prompt version produced each result.

### Pub/Sub push authentication

Uses `from: noreply@google.com` header to detect Pub/Sub pushes vs direct service calls. This is reliable but implicitly couples to Google's infrastructure behavior.

---

## Resolved Issues

### Classification title limit too restrictive

**Resolved in:** cc52e50d (2026-03-07)

**Previous issue:** The Zod schema for classification responses enforced a 50-character maximum on titles. When the LLM generated a longer title, the entire classification was rejected (including the correct type and confidence), falling back to `note` with 0.3 confidence.

**Solution:** Increased the title limit from 50 to 200 characters. This preserves valid classifications that happen to have descriptive titles.

### URL keyword misclassification

**Resolved in:** INT-177

**Previous issue:** URLs like "https://research-world.com" would trigger `research` classification due to keyword matching.

**Solution:** Added URL keyword isolation guidance to prompt (Step 4) and explicit intent detection (Step 2) that overrides URL-based signals.

### Multilingual support limited to English

**Resolved in:** INT-177

**Previous issue:** Non-English speakers had to use English command phrases.

**Solution:** Added Polish command phrases to Step 1 (explicit prefix) and Step 2 (explicit intent) of classification prompt.

### LLM response validation without type safety

**Resolved in:** INT-218

**Previous issue:** LLM responses were parsed as JSON without schema validation, risking runtime errors.

**Solution:** Migrated to Zod schema validation (`CommandClassificationSchema`) with detailed error logging for failed validations.

### User service client implementation duplication

**Resolved in:** INT-269

**Previous issue:** Each service implemented its own HTTP client for user-service.

**Solution:** Migrated to `@intexuraos/internal-clients/user-service` package for shared implementation.

### Local user service client adapter layer

**Resolved in:** INT-301

**Previous issue:** commands-agent maintained a local adapter (`domain/ports/userServiceClient.ts`) and re-export barrel (`infra/user/index.ts`) that wrapped the shared `@intexuraos/internal-clients` package with a domain-specific `UserApiKeys` type.

**Solution:** Removed the adapter entirely. Use cases now import `UserServiceClient` directly from `@intexuraos/internal-clients`. The local `infra/user/` directory and `domain/ports/userServiceClient.ts` were deleted.

### Raw response format inconsistency

**Resolved in:** INT-340

**Previous issue:** Internal routes returned raw objects (e.g., `{ error: 'Unauthorized' }`, `{ success: true, commandId: '...' }`) instead of using the standardized response contract.

**Solution:** All routes now use `reply.ok(data)` and `reply.fail(code, message)`, wrapping data under `{ success: true, data: {...} }` and errors under `{ success: false, error: { code, message } }`.

### Direct pino() logger usage

**Resolved in:** INT-340

**Previous issue:** `services.ts` created loggers with `pino()` directly, which skipped Sentry error reporting integration.

**Solution:** All loggers now use `createAppLogger()` from `@intexuraos/infra-sentry`, which automatically sends errors to Sentry.

### GLM-4.7-Flash latency issues

**Resolved in:** v3.0.0 (2026-02-15)

**Previous issue:** GLM-4.7-Flash was the default classification model but was taking 29s for simple tasks, exceeding HTTP timeouts.

**Solution:** Switched default LLM to Gemini 2.5 Flash (faster, already supported). Added platform Gemini API key as primary fallback before Zai.

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)

---

**Last updated:** 2026-03-07
