# Commands Agent — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 force refresh — v3.3.0](../../documentation-runs.md)

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

1. **Additional language support** — Currently English and Polish; German and Spanish phrases could be added to Step 1 and Step 2 of the classification prompt

2. **Confidence threshold tuning** — Low-confidence commands default to `note`; a user confirmation flow for ambiguous inputs (confidence 0.40–0.60) could reduce silent misclassifications

3. **Structured output mode** — Consider using Gemini function calling or native JSON mode instead of regex JSON extraction, eliminating the fallback-to-note path for malformed responses

4. **Circuit breaker for actions-agent** — Commands fail with `failed` status when actions-agent is unavailable; a circuit breaker pattern would improve resilience during outages

5. **Graceful degradation for startup pricing** — `initServices()` hard-fails when app-settings-service is unreachable; cached or default pricing would improve boot resilience

6. **Runtime prompt loading** — The classification prompt lives in `packages/llm-prompts`. Changes require a package rebuild and service redeploy. Runtime prompt loading would enable faster iteration on classification logic

---

## Code Smells

### 1. JSON extraction uses regex

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** `parseClassifyResponse()` uses regex `/\{[\s\S]*}/` to extract JSON from the LLM response. If the LLM returns multiple JSON objects or malformed text, extraction may fail unpredictably.

**Impact:** Low — LLMs reliably return a single JSON block; Zod validation catches malformed responses; fallback to `note` handles edge cases gracefully.

**Recommendation:** Use structured output mode when available (Gemini function calling, native JSON mode).

### 2. Log preview length is a magic number

**File:** `apps/commands-agent/src/infra/llm/classifier.ts`

**Issue:** The `.slice(0, 500)` in `rawResponsePreview` log fields uses a bare number for the log preview length. `PWA_SHARED_LINK_CONFIDENCE_BOOST` and the Zod-enforced title max (200 chars) are already named constants — this should follow the same pattern.

**Recommendation:** Extract to a named constant:

```typescript
const LOG_RESPONSE_PREVIEW_LENGTH = 500;
```

---

## Test Coverage

No test coverage gaps identified. Core paths are tested:

- Classification for all command types including `code`
- URL keyword isolation
- Explicit intent detection
- Polish language support
- PWA-shared confidence boost
- Error handling (invalid JSON, API errors, timeouts)
- Confidence clamping
- Title and reasoning truncation
- Idempotent command processing
- Pending classification retry logic
- Owner auth check on public endpoints (added INT-867)
- Status validation on delete and archive (added INT-867)
- v8 ignore blocks replaced with real tests in internalRoutes (INT-790)

---

## TypeScript Issues

- No `any` types detected in source code
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass
- Zod schema validation: Implemented for all LLM responses
- Response contract compliance: `reply.ok()` / `reply.fail()` used throughout
- Sentry-enabled logging: `createAppLogger()` used everywhere

---

## TODOs / FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

---

## Deprecations

No deprecated API usage detected. GLM-4.7 and all ZAI/DashScope models fully removed in v3.3.0.

---

## Integration Considerations

### actions-agent dependency

Commands-agent creates actions via HTTP to actions-agent at `POST /internal/actions`. If actions-agent is unavailable, the command is set to `failed` status with a `failureReason`. Consider a circuit breaker pattern or retry with exponential backoff for transient failures.

### app-settings-service startup dependency

`initServices()` calls `fetchAllPricing()` from `app-settings-service` before accepting any requests. If app-settings-service is unreachable at boot, commands-agent fails to initialize entirely. This creates a hard coupling at startup. Consider graceful degradation (e.g., cached or default pricing) to improve boot resilience.

### Prompt versioning coupling

The classification prompt lives in `packages/llm-prompts`. Any change to prompt logic requires rebuilding the package and redeploying commands-agent. The `promptVersion` field stored with each classification enables tracking which prompt version produced each result — this is valuable for auditing regressions when prompt logic changes.

### Pub/Sub push authentication

Uses `from: noreply@google.com` header to detect Pub/Sub pushes vs direct service calls. This is reliable but implicitly couples to Google's infrastructure behavior. The retry endpoint uses `Authorization: Bearer` presence to detect OIDC tokens from Cloud Scheduler.

---

## Resolved Issues

### v8 ignore blocks replaced with real tests in internalRoutes

**Resolved in:** INT-790 (bc4138e77, 2026-03-13)

**Previous issue:** Several branches in `internalRoutes.ts` were covered only by `/* v8 ignore */` directives rather than real tests.

**Solution:** Replaced all v8 ignore blocks with actual test cases covering those branches. The override entry was also removed from `v8-ignore-overrides.json`.

### commandsRoutes.ts owner auth and status validation untested

**Resolved in:** INT-867 (34fde5eeb, 2026-03-15)

**Previous issue:** Owner auth checks (returning 404 when command belongs to different user) and status validation in `DELETE /commands/:commandId` and `PATCH /commands/:commandId` were not covered by tests.

**Solution:** Added dedicated test cases for owner auth enforcement and status-based restrictions on delete and archive operations.

### Classification title limit too restrictive

**Resolved in:** cc52e50d (2026-03-07)

**Previous issue:** The Zod schema enforced a 50-character maximum on titles. When the LLM generated a longer title, the entire classification was rejected (falling back to `note` with 0.3 confidence), even when type and confidence were correct.

**Solution:** Increased the title limit from 50 to 200 characters.

### GLM-4.7-Flash latency issues and ZAI removal

**Resolved in:** v3.3.0 (93aeac4a, 2026-03-12)

**Previous issue:** GLM-4.7-Flash was the default classification model but was taking up to 29 seconds for simple tasks, exceeding HTTP timeouts. ZAI/DashScope was the provider.

**Solution:** Switched default LLM to Gemini 2.5 Flash. GLM-4.7 models and all ZAI/DashScope provider code fully removed in v3.3.0.

### Silent dispatch failures and nested transaction

**Resolved in:** INT-810 / INT-811 (e348b66e1, 2026-03-10)

**Previous issue:** Certain failure paths in command dispatch silently swallowed errors; a nested transaction issue caused data inconsistency.

**Solution:** Fixed error propagation in dispatch paths and resolved the nested transaction structure.

### URL keyword misclassification

**Resolved in:** INT-177

**Previous issue:** URLs like "https://research-world.com" triggered `research` classification due to keyword matching on URL content.

**Solution:** Added URL keyword isolation guidance to prompt (Step 4) and explicit intent detection (Step 2) that overrides URL-based signals.

### Multilingual support limited to English

**Resolved in:** INT-177

**Previous issue:** Non-English speakers had to use English command phrases for reliable classification.

**Solution:** Added Polish command phrases to Step 1 (explicit prefix) and Step 2 (explicit intent) of the classification prompt.

### LLM response validation without type safety

**Resolved in:** INT-218

**Previous issue:** LLM responses were parsed as JSON without schema validation, risking runtime errors on unexpected response shapes.

**Solution:** Migrated to Zod schema validation (`CommandClassificationSchema`) with detailed error logging for failed validations.

### User service client implementation duplication

**Resolved in:** INT-269

**Previous issue:** Each service implemented its own HTTP client for user-service, leading to duplicate code and drift.

**Solution:** Migrated to `@intexuraos/internal-clients` package for shared implementation.

### Local user service client adapter layer

**Resolved in:** INT-301

**Previous issue:** commands-agent maintained a local adapter (`domain/ports/userServiceClient.ts`) and re-export barrel (`infra/user/index.ts`) wrapping the shared package.

**Solution:** Removed the adapter entirely. Use cases import `UserServiceClient` directly from `@intexuraos/internal-clients`. The `infra/user/` directory and `domain/ports/userServiceClient.ts` were deleted.

### Raw response format inconsistency

**Resolved in:** INT-340

**Previous issue:** Internal routes returned raw objects instead of using the standardized response contract.

**Solution:** All routes now use `reply.ok(data)` and `reply.fail(code, message)`.

### Direct pino() logger usage

**Resolved in:** INT-340

**Previous issue:** `services.ts` created loggers with `pino()` directly, skipping Sentry error reporting integration.

**Solution:** All loggers now use `createAppLogger()` from `@intexuraos/infra-sentry`.

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
