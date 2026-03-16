# @intexuraos/common-core — Technical Debt

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 4     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **4** | Low      |

---

## Future Plans

- Consider extracting tracing utilities into a dedicated `common-tracing` package if tracing concerns grow beyond `X-Trace-Id`
- Evaluate whether `ServiceFeedback` should move to a dedicated contract package as the feedback system matures
- Consider adding a `Result.map()` / `Result.flatMap()` combinator API for chaining operations

---

## Code Smells

### Low Priority

| Issue                                                                                                                                                        | File                                        | Impact                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------- |
| `ErrorCode` contains domain-specific codes that belong in service packages (`NOTION_NOT_CONNECTED`, `WORKER_NOT_CONFIGURED`, `TASK_NOT_CANCELLABLE`, etc.)   | `src/errors.ts`                             | Adding service-specific codes requires modifying a shared package |
| Dual error systems — `Result<T, E>` (functional) and `IntexuraOSError` (exception-based) are both exported and both actively used, with no enforced boundary | `src/result.ts`, `src/errors.ts`            | Contributors must decide per-call-site which pattern to use       |
| `ServiceErrorCodes` and `ErrorCode` overlap on `UNAUTHORIZED` and `NOT_FOUND` but are not type-compatible                                                    | `src/serviceErrorCodes.ts`, `src/errors.ts` | May cause confusion when picking between the two                  |
| `serializeError` has multiple v8 ignore directives for branches that require unusual error object shapes (undefined stack, non-string code)                  | `src/errors.ts`                             | Annotations follow project conventions; no functional impact      |

---

## Test Coverage Gaps

None. All modules have comprehensive test coverage.

---

## TypeScript Issues

None. Zero `any` types or `@ts-ignore` directives in source files.

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
