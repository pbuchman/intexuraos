# Transcription Worker — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [2026-04-22 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 0     | -        |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |
| **Total**   | **0** | -        |

---

## Future Plans

- **Add alternative transcription providers:** The provider factory pattern is in place but only Speechmatics is implemented. Adding providers like Google Speech-to-Text or OpenAI Whisper would enable provider fallback and cost optimization.
- **Streaming transcription support:** The current batch-only architecture means results are delayed by polling. Real-time streaming would reduce latency for short messages.
- **Provider-specific vocabulary management:** The custom vocabulary is currently hardcoded. Moving it to configuration or user-service settings would allow per-user or per-language vocabulary customization.

---

## Code Smells

No code smells identified.

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
| `index.ts`   | `module-init` | 71–79   | Config, storage, publisher initialized at cold start          |
| `logger.ts`  | `module-init` | 25–33   | Logger initialized at module load                             |

All annotations use valid categories from the project's coverage exemption rules.

---

## Resolved Issues

| Date       | Issue                                                        | Resolution                                                |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| 2026-03-09 | v8 ignore blocks in `adapter.ts` for error extraction utils  | Replaced with real test coverage (`5a4f7131`, `1d89a24a`) |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
