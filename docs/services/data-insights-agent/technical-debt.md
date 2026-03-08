# Data Insights Agent — Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** Autonomous service-scribe (development branch)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **1** | Low      |

---

## Future Plans

1. **Stale code comments referencing scheduler** — Three code comments still reference "scheduler" after the scheduled snapshot refresh was removed in `f1e27f57`. The `CompositeFeedRepository.listAll()` JSDoc says "Used by scheduler for batch refresh operations", `SNAPSHOT_TTL_MINUTES` comment says "matches scheduler interval", and `computeVisualization.ts` says "Called fire-and-forget after creation, or for manual/scheduled refresh". These should be updated to reflect the current on-demand-only refresh model.

2. **refreshFeedVisualizations use case** — The `refreshFeedVisualizations` use case exists in domain code and is exported and tested, but is not wired into any route or service after the scheduled refresh removal. It could be useful for a future bulk refresh endpoint or could be removed as dead code.

3. **CompositeFeedRepository.listAll()** — This method exists in the repository port but is no longer called by any active code path after the scheduled refresh was removed. It was used by the now-deleted `refreshAllSnapshots` use case.

---

## Code Smells

### High Priority

None detected.

### Medium Priority

None detected.

### Low Priority

| File                                                    | Issue                                | Impact                               |
| ------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| `domain/compositeFeed/ports/index.ts`                   | `listAll()` port has no consumer     | Dead code after scheduler removal    |
| `domain/snapshot/models/index.ts`                       | Comment references scheduler         | Misleading documentation             |
| `domain/visualization/usecases/computeVisualization.ts` | Comment references scheduled refresh | Misleading documentation             |

---

## Test Coverage Gaps

None detected — all code paths covered at 100% threshold with v8 ignore exemptions for false positives.

---

## TypeScript Issues

None detected — no `any` types, `@ts-ignore`, or unsafe casts.

---

## TODOs / FIXMEs

None detected in codebase scan.

---

## SRP Violations

| File                            | Issue                                              | Suggestion                         |
| ------------------------------- | -------------------------------------------------- | ---------------------------------- |
| `routes/compositeFeedRoutes.ts` | Handles CRUD + schema + data + snapshot + refresh  | Consider splitting snapshot routes |

---

## Code Duplicates

None detected — unique implementations per service.

---

## Deprecations

None.

---

## Resolved Issues

| Date       | Issue                                                      | Resolution                                             |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| 2026-03-02 | GitHub OAuth mock updates across 18 services               | Added resolveGitHubUsername to UserServiceClient mocks |
| 2026-02-23 | INT-595 TransformedDataSchema rejected valid empty arrays  | Removed `.min(1)` from schema to match prompt contract |
| 2026-02-20 | Scheduled snapshot refresh (6.5M tok/day)                  | Removed Cloud Scheduler job; on-demand refresh only    |
| 2026-02-17 | Visualization service as placeholder                       | Full CRUD + async compute + on-demand refresh          |
| 2026-02-15 | Default LLM model not specified                            | Switched to Gemini 2.5 Flash with Gemini fallback      |
| 2026-02-08 | Response contract violations                               | Migrated all routes to reply.ok() / reply.fail()       |
| 2026-02-08 | Raw pino() logger usage                                    | Migrated to createAppLogger() for Sentry integration   |
| 2026-02-08 | INT-408 Missing env var registration                       | Added 4 required env vars to REQUIRED_ENV              |
| 2026-02-08 | INT-427 Coverage enforcement                               | Strict 100% branch coverage with v8 ignore             |
| 2026-02-08 | INT-301 User service client consolidation                  | Removed local infra/user/ re-export wrapper            |
| 2025-01-25 | INT-218 LLM response validation                            | Migrated 3 services to Zod schemas                     |
| 2025-01-25 | INT-269 Internal client consolidation                      | Migrated to @intexuraos/internal-clients               |
| 2025-01-19 | INT-160 Empty chart definitions                            | Fixed empty chart bug                                  |
| 2025-01-17 | INT-137 Strict sentence count validation                   | Relaxed validation                                     |
| 2025-01-15 | INT-79 Parse failures                                      | Added LLM repair pattern                               |
| 2025-01-15 | INT-77 Empty insights as errors                            | Return success with reason                             |
| 2025-01-15 | Clean Architecture violations                              | Enforced domain->infra boundary                        |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Agent](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
