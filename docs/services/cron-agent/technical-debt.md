# Cron Agent — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [2026-04-22 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Medium   |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |
| **Total**   | **1** | -        |

---

## Future Plans

- **Web UI for schedule management:** The plan document (docs/plans/2026-03-17-cron-agent-service.md) defines a Subtask 2 for a web app frontend with schedule CRUD pages and execution log views. The backend API is complete; the UI is not yet built.
- **Application-level OIDC validation:** The `/internal/cron/tick` endpoint currently relies on Cloud Run infrastructure for OIDC token validation. If ingress settings change, explicit validation would be needed (documented in the code comment).

---

## Code Smells

### Medium Priority

| File                                 | Issue                                        | Impact                                                          |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------- |
| `src/infra/openapi-tool-registry.ts` | Untyped OpenAPI spec parsing with `as` casts | Malformed specs could cause runtime errors; no validation layer |

---

## Test Coverage Gaps

No test coverage gaps identified. The service has comprehensive test coverage across all use cases, routes, and infrastructure adapters.

---

## TypeScript Issues

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in the codebase.

---

## TODOs / FIXMEs

No TODO, FIXME, or HACK comments found in the codebase.

---

## SRP Violations

No files exceed 300 lines without justification. The largest files are the route handlers and repositories, all within reasonable bounds.

---

## Code Duplicates

| Pattern                       | Locations                                                                     | Suggestion                            |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| Firestore pagination logic    | `firestore-schedule-repository.ts`, `firestore-execution-repository.ts`       | Extract shared paginated query helper |
| Error mapping in routes       | `schedule-routes.ts` (`mapErrorCode`), `execution-routes.ts` (inline mapping) | Unify error code mapping              |

---

## Deprecations

None identified.

---

## Resolved Issues

| Date       | Issue                                                | Resolution                                                                                                  |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 2026-04-05 | `description` field naming ambiguity                 | Replaced with `schedule` (input) and `scheduleSummary` (stored), removing confusion with action instruction |
| 2026-04-05 | No operation-level access control on target services | Added per-service `allowedOperations` in service catalog; empty services filtered from discovery            |
| 2026-04-05 | Tool calls not scoped to schedule owner              | `userId` now injected into all tool calls via `X-Cron-User-Id` header and prompt enforcement                |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
