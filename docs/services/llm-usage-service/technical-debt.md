# LLM Usage Service — Technical Debt

**Last Updated:** 2026-06-12
**Analysis Run:** [2026-04-22 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 1     | Low      |
| TODOs       | 0     | —        |
| **Total**   | **3** | —        |

---

## Future Plans

- Support date-range scoped Firestore `.count()` when in-memory filters are active (currently returns `-1` sentinel)
- Add rate limiting to public endpoints
- Support pagination on the aggregate query endpoint (currently returns all matching rows up to `limit`)

---

## Code Smells

### Medium Priority

| File                                                       | Issue                                                                          | Impact                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/infra/firestore/firestoreUsageAggregateRepository.ts` | Manual field-by-field mapping from Firestore `data()` to `DailyUsageAggregate` | Brittle — adding a field requires updating the mapping in sync with the interface |
| `src/infra/firestore/firestoreUsageEventRepository.ts`     | Firestore error handling casts to `{ code?: number; message?: string }`        | Loses type safety on Firestore error codes                                        |

---

## Test Coverage Gaps

No test coverage gaps identified. The service maintains full branch coverage.

---

## TypeScript Issues

| File                                                       | Issue                         | Count |
| ---------------------------------------------------------- | ----------------------------- | ----- |
| `src/infra/firestore/firestoreUsageEventRepository.ts`     | `as` casts on Firestore data  | 2     |
| `src/infra/firestore/firestoreUsageAggregateRepository.ts` | `as` casts on Firestore data  | 12    |
| `src/infra/firestore/firestorePricingRepository.ts`        | `as` cast on Firestore data   | 1     |

These are standard Firestore adapter casts (Firestore returns `DocumentData`). Low severity — the domain types are validated at the route layer on ingestion.

---

## TODOs / FIXMEs

No TODO/FIXME comments found in the codebase.

---

## SRP Violations

No files exceed the 300-line threshold. The largest file is `publicUsageRoutes.ts` which contains three route handlers with validation, but each handler delegates to a use case immediately.

---

## Code Duplicates

| Pattern                                | Locations                                         | Suggestion                                         |
| -------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Firestore error catch + cast pattern   | All three Firestore repository files              | Extract to shared `handleFirestoreError()` utility |

---

## Deprecations

None identified.

---

## Resolved Issues

| Date       | Issue                                                      | Resolution                                             |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| 2026-04-22 | `request.promptType` groupBy returned 500                  | Rejected at validation layer (INT-1422)                |
| 2026-05-05 | `request.promptType` was unavailable in aggregate grouping | Added prompt-type aggregate dimension and query support |
| 2026-04-20 | Slash in `source.client` caused invalid Firestore doc path | SHA-256 hash on client field in aggregate key          |
| 2026-04-18 | OpenRouter cost not calculated correctly                   | Added OpenRouter to cost calculation service           |
| 2026-04-17 | SchemaVersion v1 accepted on input endpoint                | Enforced discriminated union (`schemaVersion: 2` only) |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
