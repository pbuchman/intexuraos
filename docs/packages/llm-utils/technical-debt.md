# @intexuraos/llm-utils - Technical Debt

## Code Quality

The package is small, well-tested, and focused on two concerns. Functions are pure (except `logLlmParseError` which logs as a side effect). No known test coverage gaps.

### Current Issues

#### 1. Redaction is shallow only

`redactObject` performs a shallow copy and only redacts top-level string fields. Nested objects containing sensitive fields (e.g., `{ config: { apiKey: 'secret' } }`) pass through unredacted.

**Impact:** Low. Current callers only pass flat objects. Risk increases if callers start passing nested structures.
**Suggested fix:** Add recursive redaction option or document the shallow-only limitation prominently.

#### 2. SENSITIVE_FIELDS uses mixed naming conventions

The list mixes `snake_case` (`access_token`, `client_secret`) and `camelCase` (`apiKey`, `clientSecret`) field names, plus HTTP headers (`x-internal-auth`). This reflects the reality of different source systems, but means callers must check both conventions.

**Impact:** None. The list is intentionally comprehensive across conventions.

#### 3. Zod dependency for a utility package

The package depends on `zod` solely for the `formatZodErrors` function. This adds a non-trivial dependency to what is otherwise a lightweight utility package.

**Impact:** Low. Zod is already used across the monorepo, so it does not increase the total dependency footprint.
**Suggested fix:** Consider moving `formatZodErrors` into `llm-prompts` (which already depends on Zod) if the dependency becomes a concern.

## Future Plans

- Consider adding a `redactHeaders()` helper specifically for HTTP header redaction (common pattern across infra packages)
- Evaluate adding rate-limiting to `logLlmParseError` to prevent log flooding during LLM model degradation events
