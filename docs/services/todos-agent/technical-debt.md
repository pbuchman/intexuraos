# Todos Agent — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** Autonomous documentation refresh (service-scribe)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | —        |
| Test Coverage Gaps  | 0     | —        |
| TypeScript Issues   | 0     | —        |
| SRP Violations      | 0     | —        |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | —        |
| **Total**           | **1** | —        |

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

### Release v3.2.0 (2026-03-07)

Version bump as part of the monorepo release cycle (commit `44ea683a`).

### GitHub OAuth Mock Update (2026-03-02)

Updated cross-service mocks in test utilities to include `resolveGitHubUsername` method on the `UserServiceClient` interface (commit `99febe66`). Test-only change, no production logic affected.

### Release v3.1.0 (2026-02-22)

Version bump to v3.1.0 as part of the monorepo release cycle.

### Release v3.0.0 (2026-02-19)

Major version bump to v3.0.0 as part of the monorepo release cycle. Full documentation refresh completed.

### Dash0 OpenTelemetry Integration (2026-02-16)

Added Dash0 as an OpenTelemetry observability backend (PR #803). Provides distributed tracing alongside Sentry error reporting for full-stack visibility.

### API Key Naming Standardization (2026-02-15)

Standardized all LLM API key env vars to `APP` naming convention (PR #793):

- `INTEXURAOS_GEMINI_APP_API_KEY` — platform Gemini key (ZAI key removed in v3.3.0)

### Default LLM Switch to Gemini 2.5 Flash (2026-02-15)

Switched the default extraction model to Gemini 2.5 Flash (PR #792). Added platform Gemini as the fallback chain (ZAI fallback removed in v3.3.0). Increased title generation timeout to accommodate the new model's response characteristics.

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

| Date       | Issue                              | Resolution                                   |
| ---------- | ---------------------------------- | -------------------------------------------- |
| 2026-03-07 | Version at 3.1.0                   | Released v3.2.0 (44ea683a)                   |
| 2026-03-02 | UserServiceClient mock incomplete  | Added resolveGitHubUsername mock (99febe66)  |
| 2026-02-22 | Version at 3.0.0                   | Bumped to v3.1.0                             |
| 2026-02-16 | No distributed tracing             | Added Dash0 OpenTelemetry integration (#803) |
| 2026-02-15 | Inconsistent API key naming        | Standardized to APP convention (#793)        |
| 2026-02-15 | Gemini 2.5 Flash not default       | Switched default LLM + added fallback (#792) |
| 2026-01-31 | Branch coverage below 100%         | v8 ignore annotations + new tests (INT-427)  |
| 2026-01-30 | Direct pino() usage (no Sentry)    | Migrated to createAppLogger                  |
| 2026-01-30 | Raw reply.send() in routes         | Migrated to reply.ok()/reply.fail()          |
| 2026-01-26 | Local user client re-export barrel | Removed infra/user/index.ts (INT-301)        |
| 2026-01-24 | Manual LLM validation              | Migrated to Zod schemas (INT-218)            |
| 2026-01-24 | Inconsistent user-service clients  | Unified via internal-clients (INT-269)       |
| 2026-01-20 | Gaps in test coverage              | Additional test cases (INT-155)              |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Agent](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
