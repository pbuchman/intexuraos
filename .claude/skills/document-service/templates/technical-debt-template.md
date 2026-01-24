# Technical Debt Template

Template for `docs/services/<service-name>/technical-debt.md`.

## Purpose

Track technical debt items, code quality issues, and future development plans in an actionable format.

---

## Template

```markdown
# <Service Name> — Technical Debt

**Last Updated:** YYYY-MM-DD
**Analysis Run:** [link to documentation-runs.md entry]

---

## Summary

| Category    | Count | Severity        |
| ----------- | ----- | --------------- |
| Code Smells | N     | High/Medium/Low |
| Test Gaps   | N     | High/Medium/Low |
| Type Issues | N     | High/Medium/Low |
| TODOs       | N     | High/Medium/Low |
| **Total**   | **N** | —               |

---

## Future Plans

<From Q8: User-provided or inferred future development plans>

- <Plan 1>
- <Plan 2>
- <Plan 3>

---

## Code Smells

### High Priority

| File                    | Issue              | Impact           |
| ----------------------- | ------------------ | ---------------- |
| `src/routes/example.ts` | Silent catch block | Errors swallowed |
| `src/usecases/foo.ts`   | Module-level state | Not testable     |

### Medium Priority

| File               | Issue           | Impact            |
| ------------------ | --------------- | ----------------- |
| `src/infra/bar.ts` | Console logging | Should use logger |

### Low Priority

| File | Issue | Impact |
| ---- | ----- | ------ |
| ...  | ...   | ...    |

---

## Test Coverage Gaps

| File/Module                          | Coverage | Missing                  |
| ------------------------------------ | -------- | ------------------------ |
| `src/domain/usecases/specialCase.ts` | 0%       | Entire use case untested |
| `src/routes/internalRoutes.ts`       | 85%      | Error path untested      |

---

## TypeScript Issues

| File                  | Issue      | Count |
| --------------------- | ---------- | ----- |
| `src/models/types.ts` | `any` type | 3     |
| `src/infra/api.ts`    | @ts-ignore | 1     |

---

## TODOs / FIXMEs

| File              | Comment                 | Priority |
| ----------------- | ----------------------- | -------- |
| `src/services.ts` | TODO: Add caching       | Medium   |
| `src/routes.ts`   | FIXME: Handle edge case | High     |

---

## SRP Violations

| File                                | Lines | Issue                                         | Suggestion          |
| ----------------------------------- | ----- | --------------------------------------------- | ------------------- |
| `src/routes/compositeFeedRoutes.ts` | 450   | Handles routing + validation + business logic | Extract to use case |

---

## Code Duplicates

| Pattern                      | Locations                           | Suggestion                     |
| ---------------------------- | ----------------------------------- | ------------------------------ |
| Error handling middleware    | `routes/*.ts` (5 files)             | Extract to common-http package |
| Firestore pagination pattern | `infra/repositories/*.ts` (3 files) | Create base repository class   |

---

## Deprecations

| Item                 | Location           | Replacement   | Deadline |
| -------------------- | ------------------ | ------------- | -------- |
| `deprecatedMethod()` | `src/infra/old.ts` | `newMethod()` | Q2 2026  |

---

## Resolved Issues

<Track items that were identified and later fixed>

| Date       | Issue                     | Resolution          |
| ---------- | ------------------------- | ------------------- |
| 2025-12-01 | Silent catch in routes.ts | Added error logging |
| ...        | ...                       | ...                 |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
```

---

## Scan Categories

When generating this file, scan for these 11 categories:

1. **TODO/FIXME Comments** — grep for TODO, FIXME, HACK, XXX
2. **Console Logging** — console.log/warn/error in non-infra code
3. **Test Coverage** — Below 95% threshold
4. **ESLint Violations** — Active violations
5. **TypeScript Issues** — `any` types, @ts-ignore, @ts-expect-error
6. **Complex Functions** — Cyclomatic complexity >10
7. **Deprecated APIs** — Usage of deprecated dependencies
8. **Code Smells** — Patterns from CLAUDE.md table
9. **SRP Violations** — Files >300 lines without good reason
10. **Code Duplicates** — Similar patterns across files
11. **Previous Runs** — Issues from documentation-runs.md history

See [debt-categories.md](../reference/debt-categories.md) for detection methods.

---

## Idempotency Rules

When updating existing `technical-debt.md`:

1. **Preserve resolved issues** — Never delete from "Resolved Issues" section
2. **Archive resolved items** — Move from active sections to "Resolved Issues"
3. **Update timestamps** — Always update "Last Updated"
4. **Track progression** — If severity changes, note in documentation-runs.md

---

## Severity Guidelines

### High Priority

- Security vulnerabilities
- Data loss risks
- Breaking production
- Test coverage <70%

### Medium Priority

- Performance issues
- Code smell patterns
- Test coverage 70-90%
- Maintenance burden

### Low Priority

- Code style preferences
- Minor optimizations
- Test coverage 90-95%
- Documentation gaps
