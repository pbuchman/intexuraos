# Transcription Worker — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-07 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Low      |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |
| **Total**   | **1** | Low      |

---

## Future Plans

- **Add alternative transcription providers:** The provider factory pattern is in place but only Speechmatics is implemented. Adding providers like Google Speech-to-Text or OpenAI Whisper would enable provider fallback and cost optimization.
- **Streaming transcription support:** The current batch-only architecture means results are delayed by polling. Real-time streaming would reduce latency for short messages.
- **Provider-specific vocabulary management:** The custom vocabulary is currently hardcoded. Moving it to configuration or user-service settings would allow per-user or per-language vocabulary customization.

---

## Code Smells

### Low Priority

| File                                    | Issue                                                                                          | Impact                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/providers/speechmatics/adapter.ts` | v8 ignore blocks for error extraction utilities (`extractErrorMessage`, `extractErrorContext`) | These type-narrowing functions handle unknown error shapes from the Speechmatics SDK and are legitimately hard to cover exhaustively. The v8 ignore annotations are justified but could be reduced if the SDK provided typed errors. |

---

## Test Coverage Gaps

No gaps identified. The worker has comprehensive test coverage across all modules:

| Test File                      | Coverage Area                                          |
| ------------------------------ | ------------------------------------------------------ |
| `main.test.ts`                 | Full orchestration pipeline including all error paths  |
| `polling.test.ts`              | Done, rejected, timeout, and transient error scenarios |
| `format-error.test.ts`         | All error pattern branches                             |
| `types.test.ts`                | Config loader validation                               |
| `provider-factory.test.ts`     | Known and unknown provider routing                     |
| `speechmatics-adapter.test.ts` | Submit, poll, and transcript fetch operations          |

---

## TypeScript Issues

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in the codebase.

---

## TODOs / FIXMEs

No TODO, FIXME, or HACK comments found in the codebase.

---

## SRP Violations

No files exceed 300 lines of business logic. The largest file (`adapter.ts`) includes substantial JSDoc comments, type definitions, and three method implementations, which is appropriate for a single adapter class.

---

## Code Duplicates

No significant code duplication identified. Error handling follows a consistent pattern but each case handles different error shapes appropriately.

---

## v8 Ignore Annotations

| File         | Category      | Lines   | Reason                                                        |
| ------------ | ------------- | ------- | ------------------------------------------------------------- |
| `adapter.ts` | `ts-type`     | 52–71   | `extractErrorMessage` type narrowing for unknown error shapes |
| `adapter.ts` | `ts-type`     | 76–120  | `extractErrorContext` type narrowing with optional properties |
| `adapter.ts` | `upstream`    | 310–322 | Metadata language fallback for Speechmatics API response      |
| `adapter.ts` | `upstream`    | 325–334 | Non-array results guard for malformed API response            |
| `index.ts`   | `module-init` | 71–79   | Config, storage, publisher initialized at cold start          |
| `logger.ts`  | `module-init` | 25–33   | Logger initialized at module load                             |

All annotations use valid categories from the project's coverage exemption rules.

---

## Resolved Issues

No previously identified issues (this is the first documentation run for this service).

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
