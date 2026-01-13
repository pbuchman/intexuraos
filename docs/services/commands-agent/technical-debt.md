# Commands Agent - Technical Debt

## Summary

| Category       | Count   | Severity   |
| --------------  | -------  | ----------  |
| TODO/FIXME     | 0       | -          |
| Code Smells    | 2       | Low        |
| Test Coverage  | 0       | -          |
| SRP Violations | 0       | -          |

## Future Plans

Based on code analysis:

1. **Calendar and reminder handlers** - CommandType includes `calendar` and `reminder` but corresponding handlers in actions-agent are not yet implemented
2. **Model selection expansion** - MODEL_KEYWORDS mapping could be extended to support more LLM providers
3. **Multi-language classification** - Classifier prompt currently optimized for English

## Code Smells

### 1. Parse function extracts JSON with regex

**File:** `apps/commands-agent/src/infra/gemini/classifier.ts`

**Issue:** `parseClassifyResponse()` uses regex `/\{[\s\S]*}/` to extract JSON from LLM response. If LLM returns text before/after JSON block, extraction may fail.

**Impact:** Low - Gemini reliably returns JSON-only responses.

**Recommendation:** Use markdown code fence parser for more robustness.

### 2. Magic number for title truncation

**File:** `apps/commands-agent/src/infra/gemini/classifier.ts`

**Issue:** Title sliced to 100 chars, reasoning to 500 chars without constants.

**Recommendation:** Extract to named constants.

## Test Coverage

No test coverage gaps identified. All core paths tested.

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
