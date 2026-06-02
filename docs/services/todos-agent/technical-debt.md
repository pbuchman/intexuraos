# Todos Agent — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** Autonomous documentation refresh (service-scribe, v3.6.0 release)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | ---      |
| Test Coverage Gaps  | 0     | ---      |
| TypeScript Issues   | 0     | ---      |
| SRP Violations      | 0     | ---      |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | ---      |
| **Total**           | **1** | ---      |

---

## Future Plans

### Planned Features

Features tracked from existing documentation and product roadmap:

- **Todo templates** — Pre-defined todo structures for common tasks (e.g., weekly planning, shopping lists)
- **Recurring todos** — Automatic todo regeneration on schedule (daily, weekly, monthly)
- **Todo dependencies** — Link todos with completion dependencies (blocking/blocked by relationships)

### Proposed Enhancements

1. **Bulk operations** — Archive multiple todos at once, batch status updates
2. **Full-text search** — Search todos by content with Firestore indexing
3. **Collaboration features** — Shared todos, assign to other users
4. **Reminders** — Time-based notifications for due dates
5. **Subtask nesting** — Support more than one level of subtasks

---

## Code Smells

### None Detected

No active code smells found in current codebase. All logging uses `createAppLogger()` from `@intexuraos/infra-sentry`. All responses use the standardized `reply.ok()`/`reply.fail()` contract.

---

## Test Coverage

### Current Status

All endpoints and use cases have test coverage meeting the 100% branch coverage threshold (strict enforcement enabled via INT-427).

### Coverage Areas

| Area            | Coverage | Notes                                    |
| --------------- | -------- | ---------------------------------------- |
| Routes          | 100%     | All public and internal tested           |
| Use Cases       | 100%     | All domain logic covered                 |
| Infrastructure  | 100%     | Tested via route integration             |
| PubSub Handlers | 100%     | Full event flow tested                   |
| Config          | 100%     | Fallback values for service URLs covered |

---

## TypeScript Issues

### None Detected

- No `any` types found in production code
- No `@ts-ignore` or `@ts-expect-error` directives
- Strict mode enabled with all compiler checks

---

## SRP Violations

### None Detected

All files are within reasonable size limits. The largest file (`todoRoutes.ts`) contains route definitions with schema declarations, which is an expected pattern for Fastify services.

---

## Code Duplicates

### Low Priority

| Pattern              | Locations                            | Suggestion                                |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| `parseDate` function | `todoRoutes.ts`, `internalRoutes.ts` | Extract to shared utility in domain layer |

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Recent Improvements

### v3.6.0 (2026-04-22)

Centralized LLM pricing removal (INT-1387). Replaced `fetchAllPricing`/`createPricingContext` startup flow (which fetched pricing from app-settings-service) with `HttpInternalAuthUsageSink` that reports usage to llm-usage-service. This eliminated the app-settings-service dependency, made `initServices` synchronous, and replaced `INTEXURAOS_APP_SETTINGS_SERVICE_URL` with `INTEXURAOS_LLM_USAGE_SERVICE_URL`. Added required `promptType: 'todo-item-extraction'` parameter to LLM generate calls (INT-1392).

### v3.5.0 (2026-04-07)

Refactored `reorderTodoItems` use case (INT-1072, commit `613ac528`) to replace a v8-ignore workaround with a cleaner implementation. The previous code used a separate validation pass followed by `.map()` with a never-throwing fallback wrapped in `v8 ignore`. The new implementation uses a single `Map`-based iteration loop that returns early on missing items, eliminating the need for coverage exemptions entirely.

Added `getUserTimezone` method to `UserServiceClient` interface (commit `287db2b6`). Test-only changes in `testUtils.ts` and `todoItemExtractionService.test.ts` to implement the new mock method.

### v3.4.0 (2026-03-22)

Standardized PENDING v8-ignore comments to permanent `ts-type` category (INT-987, commit `da00218e`). Two `ts-type` annotations in `updateTodoItem.ts` and `reorderTodoItems.ts` were reclassified from pending to permanent, confirming these TypeScript narrowing guards are structurally untestable rather than awaiting future test infrastructure.

### v3.3.0 (2026-03-15)

Removed ZAI provider and GLM-4.7 models from the LLM dependency chain (commit `93aeac4a`). The service now relies exclusively on Gemini 2.5 Flash with platform Gemini (`INTEXURAOS_GEMINI_APP_API_KEY`) as fallback.

### v8 Ignore Cleanup (2026-03-11)

Fixed v8 ignore comment category annotations for test-infra blocks (commit `4ab46156`). Added dedicated tests for remaining v8-ignore blocks (INT-796, commit `752fd017`).

### v3.2.0 (2026-03-07)

Version bump as part of the monorepo release cycle (commit `44ea683a`).

### GitHub OAuth Mock Update (2026-03-02)

Updated cross-service mocks in test utilities to include `resolveGitHubUsername` method on the `UserServiceClient` interface (commit `99febe66`). Test-only change, no production logic affected.

### v3.1.0 (2026-02-22)

Version bump to v3.1.0 as part of the monorepo release cycle.

### v3.0.0 (2026-02-19)

Major version bump to v3.0.0 as part of the monorepo release cycle. Full documentation refresh completed.

### API Key Naming Standardization (2026-02-15)

Standardized all LLM API key env vars to `APP` naming convention (PR #793):

- `INTEXURAOS_GEMINI_APP_API_KEY` — platform Gemini key

### Default LLM Switch to Gemini 2.5 Flash (2026-02-15)

Switched the default extraction model to Gemini 2.5 Flash (PR #792). Added platform Gemini as the fallback chain. Increased title generation timeout to accommodate the new model's response characteristics.

### Dev-Mode Log Formatting (2026-02-16)

Added PM2-friendly log formatting for local development. Structured JSON logs now pretty-print in `pm2 logs` output.

### Sentry Logger Migration (2026-01-30)

Migrated from direct `pino()` to `createAppLogger()` from `@intexuraos/infra-sentry`.

### Response Contract Compliance (2026-01-30)

Migrated all internal and Pub/Sub routes to use standardized `reply.ok()`/`reply.fail()` instead of raw `reply.send()`.

### 100% Branch Coverage Enforcement (2026-01-31)

Achieved 100% branch coverage with proper v8 ignore annotations (INT-427).

---

## Resolved Issues

### Historical Issues

| Date       | Issue                                     | Resolution                                                                 |
| ---------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| 2026-04-22 | app-settings-service startup dependency   | Replaced with HttpInternalAuthUsageSink to llm-usage-service (INT-1387)    |
| 2026-04-22 | LLM generate calls missing promptType     | Added required promptType parameter (INT-1392)                             |
| 2026-03-23 | v8-ignore workaround in reorderTodoItems  | Refactored to Map-based iteration, no coverage exemption needed (INT-1072) |
| 2026-03-19 | PENDING v8-ignore annotations             | Standardized to permanent ts-type (INT-987)                                |
| 2026-03-12 | ZAI/GLM-4.7 still in LLM chain            | Removed ZAI provider and GLM-4.7 (93aeac4a)                                |
| 2026-03-07 | Version at 3.1.0                          | Released v3.2.0 (44ea683a)                                                 |
| 2026-03-02 | UserServiceClient mock incomplete         | Added resolveGitHubUsername mock (99febe66)                                |
| 2026-02-22 | Version at 3.0.0                          | Bumped to v3.1.0                                                           |
| 2026-02-15 | Inconsistent API key naming               | Standardized to APP convention (#793)                                      |
| 2026-02-15 | Gemini 2.5 Flash not default              | Switched default LLM + added fallback (#792)                               |
| 2026-01-31 | Branch coverage below 100%                | v8 ignore annotations + new tests (INT-427)                                |
| 2026-01-30 | Direct pino() usage (no Sentry)           | Migrated to createAppLogger                                                |
| 2026-01-30 | Raw reply.send() in routes                | Migrated to reply.ok()/reply.fail()                                        |
| 2026-01-26 | Local user client re-export barrel        | Removed infra/user/index.ts (INT-301)                                      |
| 2026-01-24 | Manual LLM validation                     | Migrated to Zod schemas (INT-218)                                          |
| 2026-01-24 | Inconsistent user-service clients         | Unified via internal-clients (INT-269)                                     |
| 2026-01-20 | Gaps in test coverage                     | Additional test cases (INT-155)                                            |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Agent](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
