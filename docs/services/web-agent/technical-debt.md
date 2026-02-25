# Web Agent -- Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** v3.1.0 documentation refresh

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low      |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |
| **Total**   | **2** | Low      |

---

## Future Plans

Based on code analysis and git history:

1. **Caching layer** -- No caching currently; could add Redis/GCS for frequently requested URLs
2. **Batch summarization** -- `/internal/page-summaries` only handles one URL; could add batch support
3. **Rate limiting** -- No built-in rate limiting; caller must implement throttling
4. **Retry logic** -- Crawl4AI failures could benefit from automatic retry with backoff
5. **Content type detection** -- Currently assumes HTML; could handle PDFs, docs
6. **Summary length control** -- Add token-based limits in addition to sentence/word limits

---

## Code Smells

### Low Priority

| File                                        | Issue                             | Impact                                         |
| ------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `src/infra/linkpreview/openGraphFetcher.ts` | Manual Uint8Array concatenation   | Minor performance impact on large responses    |
| `src/infra/linkpreview/openGraphFetcher.ts` | ESLint disable for `while (true)` | Necessary pattern for streaming; could extract |

### 1. Chunk concatenation in openGraphFetcher.ts

**File:** `apps/web-agent/src/infra/linkpreview/openGraphFetcher.ts`

**Issue:** Manual Uint8Array concatenation using reduce creates intermediate arrays.

```typescript
const html = new TextDecoder().decode(
  chunks.reduce((acc: Uint8Array, chunk: Uint8Array): Uint8Array => {
    const combined = new Uint8Array(acc.length + chunk.length);
    combined.set(acc);
    combined.set(chunk, acc.length);
    return combined;
  }, new Uint8Array(0))
);
```

**Impact:** Low -- only affects large responses approaching 2MB limit.

**Recommendation:** Consider using `Buffer.concat()` or collecting chunks into array and concatenating once.

### 2. ESLint disable for infinite loop

**File:** `apps/web-agent/src/infra/linkpreview/openGraphFetcher.ts`

**Issue:** `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` for `while (true)` reader loop.

**Impact:** Low -- necessary pattern for streaming reader with `done` check.

**Recommendation:** Keep as-is, but could extract to separate method for clarity.

---

## Test Coverage

No test coverage gaps identified. All major paths tested at 100% threshold with v8 ignore exemptions:

- Link preview fetching with nock mocking
- OpenGraph tag extraction
- 403 error handling (ACCESS_DENIED)
- HTTP 429 rate limiting (RATE_LIMITED)
- Page content fetching via Crawl4AI
- LLM summarization with repair mechanism
- Parse response validation (including content focus instructions)
- Empty/JSON response handling
- OAuth token support in FakeUserServiceClient

---

## TypeScript Issues

- No `any` types detected
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass

---

## TODOs/FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

---

## Deprecations

| Item                         | Location                                            | Replacement                        | Deadline |
| ---------------------------- | --------------------------------------------------- | ---------------------------------- | -------- |
| `Crawl4AIClient`             | `src/infra/pagesummary/crawl4aiClient.ts`           | PageContentFetcher + LlmSummarizer | None     |
| `buildSummaryPrompt()`       | `src/infra/pagesummary/buildSummaryRepairPrompt.ts` | `summaryPrompt.build()`            | None     |
| `buildSummaryRepairPrompt()` | `src/infra/pagesummary/buildSummaryRepairPrompt.ts` | `summaryRepairPrompt.build()`      | None     |

**Note:** The combined `Crawl4AIClient` class that used Crawl4AI's built-in LLM extraction is superseded by the separated architecture (PageContentFetcher for crawling, LlmSummarizer for user's LLM). The old client remains for reference but is not used. The convenience functions are deprecated in favor of the PromptBuilder pattern.

---

## Resolved Issues

| Date       | Issue                                               | Resolution                                               |
| ---------- | --------------------------------------------------- | -------------------------------------------------------- |
| 2026-02-22 | Release v3.1.0 (version bump only)                  | Package version updated to 3.1.0                         |
| 2026-02-19 | PromptBuilder lacked version enforcement            | Added `version: '1.0.0'` to both prompts; CI-enforced    |
| 2026-02-16 | No distributed tracing                              | Added Dash0 OpenTelemetry via transparent preload module |
| 2026-02-15 | `CRAWL4AI_API_KEY` nonstandard naming               | Renamed to `CRAWL4AI_APP_API_KEY` per APP convention     |
| 2026-02-15 | Platform ZAI model too slow (29s) for summarization | Switched default platform fallback to Gemini 2.5 Flash   |
| 2026-02-09 | No summarization fallback for users without API key | Added platform ZAI fallback (now secondary to Gemini)    |
| 2026-02-08 | INT-533 Summaries describing platforms              | Added CONTENT FOCUS section to summary prompts           |
| 2026-02-08 | Response contract violations                        | Migrated internalRoutes to reply.ok() / reply.fail()     |
| 2026-02-08 | Raw pino() logger usage                             | Migrated to createAppLogger() for Sentry integration     |
| 2026-02-08 | INT-408 Missing env var registration                | Added USER_SERVICE_URL and APP_SETTINGS_SERVICE_URL      |
| 2026-02-08 | No specific error for Crawl4AI rate limits          | Added RATE_LIMITED error code for HTTP 429               |
| 2026-02-08 | INT-427 Coverage enforcement                        | Strict 100% branch coverage with v8 ignore               |
| 2026-02-08 | INT-301 User service client consolidation           | Removed local infra/user/ re-export wrapper              |
| 2026-01-25 | Manual user-service client implementation           | Migrated to @intexuraos/internal-clients (INT-269)       |
| 2026-01-24 | AI summaries returning raw JSON                     | Added parseSummaryResponse + repair mechanism            |
| 2026-01-21 | 403 errors not distinguished from others            | Added ACCESS_DENIED error code                           |
| 2026-01-20 | Summaries losing source language                    | Added "SAME LANGUAGE" instruction to prompt              |
| 2026-01-18 | Using shared LLM infrastructure                     | Switched to user's own LLM keys via user-service         |

---

## Architecture Decisions

### Crawl/Summary Separation (INT-213)

**Decision:** Separate page crawling (PageContentFetcher) from AI summarization (LlmSummarizer).

**Rationale:**

- User's API keys used for LLM calls, not shared infrastructure
- Crawl4AI's built-in LLM extraction returned JSON format
- Gives control over prompt, including language preservation
- Enables repair mechanism for invalid responses

**Trade-off:** Slightly more complex code, but better control and user experience.

### Platform LLM Fallback Chain

**Decision:** When user has no API key, fall back to platform Gemini 2.5 Flash, then platform ZAI.

**Rationale:**

- ZAI's glm-4.7-flash took 29s for summarization, exceeding HTTP timeouts
- Gemini 2.5 Flash is faster and already supported in llm-factory
- Users without configured API keys still get summarization functionality

**Trade-off:** Platform pays API costs for users without keys; keys are optional in `createUserServiceClient()` so services that do not want this behavior keep existing semantics.

### Browser-Like Headers (INT-191)

**Decision:** OpenGraphFetcher sends Chrome-like headers including Sec-Fetch-* headers.

**Rationale:**

- Many sites return 403 to simple User-Agent strings
- Browser-like headers reduce bot detection triggers
- Sec-Fetch headers signal "navigation" behavior

**Trade-off:** May need periodic header updates as Chrome versions change.

### Dash0 OpenTelemetry Preload

**Decision:** Load OpenTelemetry instrumentation via `--import ./dist/otel-register.js` in the Dockerfile CMD.

**Rationale:**

- Transparent to application code -- no imports or setup needed in `index.ts`
- No-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is unset
- All 19 services use the same `infra-otel` package pattern

**Trade-off:** Requires `otel-register.js` to be built and copied alongside `index.js` in the Dockerfile.

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
