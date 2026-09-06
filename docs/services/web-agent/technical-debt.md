# Web Agent — Technical Debt

**Last Updated:** 2026-04-07
**Analysis Run:** v3.5.0 documentation refresh

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low      |
| Test Gaps   | 0     | ---      |
| Type Issues | 0     | ---      |
| TODOs       | 0     | ---      |
| **Total**   | **2** | Low      |

---

## Future Plans

Based on code analysis and git history:

1. **Caching layer** --- No caching currently; could add Redis/GCS for frequently requested URLs
2. **Batch summarization** --- `/internal/page-summaries` only handles one URL; could add batch support
3. **Rate limiting** --- No built-in rate limiting; caller must implement throttling
4. **Content type detection** --- Currently assumes HTML; could handle PDFs, docs
5. **Summary length control** --- Add token-based limits in addition to sentence/word limits
6. **Schema alignment** --- `RATE_LIMITED` error code from Cloudflare client is not included in the page summary response schema enum (route-level schema lists only 6 codes; domain model has 7)

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

**Impact:** Low --- only affects large responses approaching the 2 MB limit.

**Recommendation:** Consider using `Buffer.concat()` or collecting chunks into an array and concatenating once.

### 2. ESLint disable for infinite loop

**File:** `apps/web-agent/src/infra/linkpreview/openGraphFetcher.ts`

**Issue:** `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` for `while (true)` reader loop.

**Impact:** Low --- necessary pattern for streaming reader with `done` check.

**Recommendation:** Keep as-is, but could extract to a separate method for clarity.

---

## Test Coverage

No test coverage gaps identified. All major paths tested at 100% threshold with v8 ignore exemptions:

- Link preview fetching with nock mocking
- OpenGraph tag extraction
- 403 error handling (ACCESS_DENIED)
- HTTP 429 rate limiting (RATE_LIMITED)
- Page content fetching via Cloudflare Browser Rendering
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
| `buildSummaryPrompt()`       | `src/infra/pagesummary/buildSummaryRepairPrompt.ts` | `summaryPrompt.build()`            | None     |
| `buildSummaryRepairPrompt()` | `src/infra/pagesummary/buildSummaryRepairPrompt.ts` | `summaryRepairPrompt.build()`      | None     |

**Note:** The convenience functions are deprecated in favour of the PromptBuilder pattern. The legacy `Crawl4AIClient` has been fully removed in v3.5.0 and replaced by the Cloudflare Browser Rendering client (`cloudflareMarkdownClient.ts`).

---

## Resolved Issues

| Date       | Issue                                                     | Resolution                                                       |
| ---------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-04-02 | Summary prompts lacked main content selection guidance    | Added MAIN CONTENT SELECTION section with hint-based focus       |
| 2026-03-29 | Crawl4AI dependency for page content fetching             | Replaced with Cloudflare Browser Rendering /markdown endpoint    |
| 2026-03-29 | Redundant logging in page content fetcher                 | Extracted constants and removed redundant log statements         |
| 2026-03-29 | Crawl4AIClient file present but unused                    | Removed legacy crawl4aiClient.ts                                 |
| 2026-03-12 | ZAI provider removed from LLM contract                    | Chinese LLMs now via Alibaba Cloud Model Studio                  |
| 2026-02-22 | Release v3.1.0 (version bump only)                        | Package version updated to 3.1.0                                 |
| 2026-02-19 | PromptBuilder lacked version enforcement                  | Added `version: '1.0.0'` to both prompts; CI-enforced            |
| 2026-02-15 | `CRAWL4AI_API_KEY` nonstandard naming                     | Renamed to `CRAWL4AI_APP_API_KEY` per APP convention             |
| 2026-02-15 | Platform ZAI model too slow (29s) for summarization       | Switched default platform fallback to Gemini 2.5 Flash           |
| 2026-02-09 | No summarization fallback for users without API key       | Added platform Gemini fallback (ZAI removed in v3.3.0)           |
| 2026-02-08 | INT-533 Summaries describing platforms                    | Added CONTENT FOCUS section to summary prompts                   |
| 2026-02-08 | Response contract violations                              | Migrated internalRoutes to reply.ok() / reply.fail()             |
| 2026-02-08 | Raw pino() logger usage                                   | Migrated to createAppLogger() for Sentry integration             |
| 2026-02-08 | INT-408 Missing env var registration                      | Added USER_SERVICE_URL and APP_SETTINGS_SERVICE_URL              |
| 2026-02-08 | No specific error for Crawl4AI rate limits                | Added RATE_LIMITED error code for HTTP 429                       |
| 2026-02-08 | INT-427 Coverage enforcement                              | Strict 100% branch coverage with v8 ignore                       |
| 2026-02-08 | INT-301 User service client consolidation                 | Removed local infra/user/ re-export wrapper                      |
| 2026-01-25 | Manual user-service client implementation                 | Migrated to @intexuraos/internal-clients (INT-269)               |
| 2026-01-24 | AI summaries returning raw JSON                           | Added parseSummaryResponse + repair mechanism                    |
| 2026-01-21 | 403 errors not distinguished from others                  | Added ACCESS_DENIED error code                                   |
| 2026-01-20 | Summaries losing source language                          | Added "SAME LANGUAGE" instruction to prompt                      |
| 2026-01-18 | Using shared LLM infrastructure                           | Switched to user's own LLM keys via user-service                 |

---

## Architecture Decisions

### Cloudflare Browser Rendering (INT-1121)

**Decision:** Replace Crawl4AI with Cloudflare Browser Rendering for page content extraction.

**Rationale:**

- Cloudflare provides a managed headless browser with a simple REST API
- The `/markdown` endpoint returns clean Markdown directly, eliminating the need for a separate extraction step
- Resource type filtering (`rejectResourceTypes`) reduces processing time
- Removes the external Crawl4AI dependency and its associated `CRAWL4AI_APP_API_KEY` env var

**Trade-off:** Requires Cloudflare account with Browser Rendering access. Cloudflare rate limits apply (HTTP 429 handled with `RATE_LIMITED` error code).

### Crawl/Summary Separation (INT-213)

**Decision:** Separate page crawling (PageContentFetcher) from AI summarization (LlmSummarizer).

**Rationale:**

- User's API keys used for LLM calls, not shared infrastructure
- Crawl4AI's built-in LLM extraction returned JSON format
- Gives control over prompt, including language preservation
- Enables repair mechanism for invalid responses

**Trade-off:** Slightly more complex code, but better control and user experience.

### Platform LLM Fallback Chain

**Decision:** When a supported user preference cannot be resolved, use the platform OpenRouter default.

**Rationale:**

- OpenRouter centralizes traffic, spend, and model observability
- Direct Google model preferences are normalized instead of using a separate platform credential
- Users without configured provider keys still get summarization functionality

**Trade-off:** Platform pays API costs for fallback traffic; OpenRouter availability is required.

### Browser-Like Headers (INT-191)

**Decision:** OpenGraphFetcher sends Chrome-like headers including Sec-Fetch-* headers.

**Rationale:**

- Many sites return 403 to simple User-Agent strings
- Browser-like headers reduce bot detection triggers
- Sec-Fetch headers signal "navigation" behaviour

**Trade-off:** May need periodic header updates as Chrome versions change.


## Related

- [Features](features.md) --- User-facing documentation
- [Technical](technical.md) --- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
