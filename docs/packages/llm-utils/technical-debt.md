# @intexuraos/llm-utils — Technical Debt

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 3     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **3** | Low      |

---

## Future Plans

- Consider adding a `redactHeaders()` helper specifically for HTTP header redaction (common pattern across infra packages)
- Evaluate adding rate-limiting to `logLlmParseError` to prevent log flooding during LLM model degradation events

---

## Code Smells

### Low Priority

| Issue                                                                                                                                                                                                         | File                | Impact                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `redactObject` performs a shallow copy only — nested objects containing sensitive fields (e.g., `{ config: { apiKey: 'secret' } }`) pass through unredacted                                                   | `src/redaction.ts`  | Current callers only pass flat objects; risk increases if callers start passing nested structures |
| `SENSITIVE_FIELDS` mixes `snake_case` (`access_token`, `client_secret`), `camelCase` (`apiKey`, `clientSecret`), and HTTP header names (`x-internal-auth`) — reflects the reality of different source systems | `src/redaction.ts`  | List is intentionally comprehensive; no functional impact                                         |
| `zod` dependency exists solely for `formatZodErrors` — adds a non-trivial dependency to what is otherwise a lightweight utility package                                                                       | `src/parseError.ts` | Zod is already used monorepo-wide; no increase in total footprint                                 |

---

## Test Coverage Gaps

None. All functions have comprehensive test coverage.

---

## TypeScript Issues

None.

---

## TODOs / FIXMEs

None found in source files.

---

## Resolved Issues

None archived yet.

---

## Related

- [README](README.md) — API reference
- [Agent Interface](agent.md)
- [Documentation Run Log](../../documentation-runs.md)
