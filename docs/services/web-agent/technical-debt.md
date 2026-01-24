# Web Agent - Technical Debt

**Last Updated:** 2026-01-24
**Analysis Run:** v2.0.0 documentation refresh

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

1. **Caching layer** - No caching currently; could add Redis/GCS for frequently requested URLs
2. **Batch summarization** - `/internal/page-summaries` only handles one URL; could add batch support
3. **Rate limiting** - No built-in rate limiting; caller must implement throttling
4. **Retry logic** - Crawl4AI failures could benefit from automatic retry with backoff
5. **Content type detection** - Currently assumes HTML; could handle PDFs, docs
6. **Summary length control** - Add token-based limits in addition to sentence/word limits

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

**Impact:** Low - only affects large responses approaching 2MB limit.

**Recommendation:** Consider using `Buffer.concat()` or collecting chunks into array and concatenating once.

### 2. ESLint disable for infinite loop

**File:** `apps/web-agent/src/infra/linkpreview/openGraphFetcher.ts`

**Issue:** `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` for `while (true)` reader loop.

**Impact:** Low - necessary pattern for streaming reader with `done` check.

**Recommendation:** Keep as-is, but could extract to separate method for clarity.

---

## Test Coverage

No test coverage gaps identified. All major paths tested:

- Link preview fetching with nock mocking
- OpenGraph tag extraction
- 403 error handling (ACCESS_DENIED)
- Page content fetching via Crawl4AI
- LLM summarization with repair mechanism
- Parse response validation
- Empty/JSON response handling

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

| Item             | Location                                  | Replacement                        | Deadline |
| ---------------- | ----------------------------------------- | ---------------------------------- | -------- |
| `Crawl4AIClient` | `src/infra/pagesummary/crawl4aiClient.ts` | PageContentFetcher + LlmSummarizer | None     |

**Note:** The combined `Crawl4AIClient` class that used Crawl4AI's built-in LLM extraction is superseded by the separated architecture (PageContentFetcher for crawling, LlmSummarizer for user's LLM). The old client remains for reference but is not used.

---

## Resolved Issues

| Date       | Issue                                    | Resolution                                       |
| ---------- | ---------------------------------------- | ------------------------------------------------ |
| 2026-01-24 | AI summaries returning raw JSON          | Added parseSummaryResponse + repair mechanism    |
| 2026-01-21 | 403 errors not distinguished from others | Added ACCESS_DENIED error code                   |
| 2026-01-20 | Summaries losing source language         | Added "SAME LANGUAGE" instruction to prompt      |
| 2026-01-18 | Using shared LLM infrastructure          | Switched to user's own LLM keys via user-service |

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

### Browser-Like Headers (INT-191)

**Decision:** OpenGraphFetcher sends Chrome-like headers including Sec-Fetch-\* headers.

**Rationale:**

- Many sites return 403 to simple User-Agent strings
- Browser-like headers reduce bot detection triggers
- Sec-Fetch headers signal "navigation" behavior

**Trade-off:** May need periodic header updates as Chrome versions change.

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Documentation Run Log](../../documentation-runs.md)
