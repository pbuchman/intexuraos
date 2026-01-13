# Web Agent - Technical Debt

## Summary

| Category       | Count   | Severity   |
| --------------  | -------  | ----------  |
| TODO/FIXME     | 0       | -          |
| Code Smells    | 2       | Low        |
| Test Coverage  | 0       | -          |
| SRP Violations | 0       | -          |

## Future Plans

Based on code analysis:

1. **Caching layer** - Currently no caching. Could add Redis/GCS cache for frequently requested URLs
2. **JavaScript rendering** - Cheerio cannot parse client-rendered content. Could integrate with Puppeteer for SPA support
3. **Rate limiting** - No built-in rate limiting. Caller must implement throttling
4. **Priority queue** - Could add priority handling for high-value URLs
5. **WebP/AVIF support** - Image format optimization for thumbnails

## Code Smells

### 1. Chunk concatenation loop in openGraphFetcher.ts

**File:** `apps/web-agent/src/infra/linkpreview/openGraphFetcher.ts`

**Issue:** Manual Uint8Array concatenation in reduce loop creates intermediate arrays.

**Impact:** Low - only affects large responses > chunk size.

**Recommendation:** Use `Buffer.concat()` for better performance.

### 2. ESLint disable for true loop condition

**File:** `apps/web-agent/src/infra/linkpreview/openGraphFetcher.ts`

**Issue:** `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` for `while (true)` reader loop.

**Impact:** Low - necessary pattern for streaming reader with done check.

**Recommendation:** Keep as-is, but consider refactoring to extract method for clarity.

## Test Coverage

No test coverage gaps identified. Core paths tested with nock mocking.

## TypeScript Issues

- No `any` types detected
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass

## TODOs/FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

## Deprecations

No deprecated API usage detected.

## Resolved Issues

None - this is initial documentation run.
