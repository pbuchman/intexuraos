# Todos Agent — Technical Debt

**Last Updated:** 2026-02-08
**Analysis Run:** Autonomous documentation generation

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |
| **Total**           | **0** | —        |

---

## Future Plans

### Planned Features

Features tracked from existing documentation and product roadmap:

- **Todo templates** - Pre-defined todo structures for common tasks (e.g., weekly planning, shopping lists)
- **Recurring todos** - Automatic todo regeneration on schedule (daily, weekly, monthly)
- **Todo dependencies** - Link todos with completion dependencies (blocking/blocked by relationships)

### Proposed Enhancements

1. **Bulk operations** - Archive multiple todos at once, batch status updates
2. **Full-text search** - Search todos by content with Firestore indexing
3. **Collaboration features** - Shared todos, assign to other users
4. **Reminders** - Time-based notifications for due dates
5. **Subtask nesting** - Support more than one level of subtasks

---

## Code Smells

### None Detected

No active code smells found in current codebase. Recent improvements include:

- **INT-155** (2026-01-20): Improved test coverage across use cases
- **INT-218** (2026-01-24): Migrated LLM validation to Zod schemas for type safety
- **INT-269** (2026-01-24): Standardized on `@intexuraos/internal-clients` package

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

- No `any` types found
- No `@ts-ignore` or `@ts-expect-error` directives
- Strict mode enabled with all compiler checks

---

## SRP Violations

### None Detected

All files are within reasonable size limits:

| File                           | Lines | Status                         |
| ------------------------------ | ----- | ------------------------------ |
| `todoRoutes.ts`                | ~920  | Acceptable (route definitions) |
| `processTodoCreated.ts`        | 209   | Acceptable (single use case)   |
| `todoItemExtractionService.ts` | 184   | Acceptable (single service)    |
| `firestoreTodoRepository.ts`   | ~260  | Acceptable (CRUD operations)   |

---

## Code Duplicates

### None Detected

No significant code duplication patterns identified. Recent refactoring:

- Extracted common validation schemas to `@intexuraos/http-contracts`
- Standardized error handling via `@intexuraos/common-http`
- Shared Result types via `@intexuraos/common-core`

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use. All dependencies are current:

- `fastify` v5.1.0
- `zod` v3.24.1
- `@intexuraos/internal-clients` (latest, from INT-269)

---

## Recent Improvements

### Sentry Logger Migration (2026-01-30)

Migrated from direct `pino()` to `createAppLogger()` from `@intexuraos/infra-sentry`:

**Before:**

```typescript
import pino from 'pino';
const logger = pino({ name: 'userServiceClient' });
```

**After:**

```typescript
import { createAppLogger } from '@intexuraos/infra-sentry';
const logger = createAppLogger({ name: 'userServiceClient' });
```

**Benefits:**

- Errors automatically forwarded to Sentry
- Consistent logging across all services

### Response Contract Compliance (2026-01-30)

Migrated all internal and Pub/Sub routes to use standardized `reply.ok()`/`reply.fail()` instead of raw `reply.send()`:

- Internal routes: `reply.fail('UNAUTHORIZED', ...)` instead of `reply.status(401); return { error: 'Unauthorized' }`
- Pub/Sub routes: `reply.ok({})` instead of `{ success: true }`

### INT-301: User Service Client Consolidation (2026-01-26)

Removed local `infra/user/index.ts` re-export barrel and imported `createUserServiceClient` directly from `@intexuraos/internal-clients`.

### 100% Branch Coverage Enforcement (2026-01-31)

Achieved 100% branch coverage with proper v8 ignore annotations:

- Added tests for cancelled/processing status preservation during item updates (INT-402)
- Added tests for `processTodoCreated` update failure branches (INT-401)
- Added tests for config.ts service URL fallback values (INT-400)
- Added `getOAuthToken` mock to FakeUserServiceClient

### INT-269: Internal Clients Migration (2026-01-24)

Migrated from direct `userServiceClient` implementation to `@intexuraos/internal-clients` package.

### INT-218: Zod Schema Migration (2026-01-24)

Migrated `todoItemExtractionService` from manual validation to Zod schemas with `TodoExtractionResponseSchema` from `@intexuraos/llm-prompts`.

### INT-155: Test Coverage Improvement (2026-01-20)

Improved test coverage across all use cases and routes.

---

## Resolved Issues

### Historical Issues

| Date       | Issue                               | Resolution                                  |
| ---------- | ----------------------------------- | ------------------------------------------- |
| 2026-01-31 | Branch coverage below 100%          | v8 ignore annotations + new tests (INT-427) |
| 2026-01-30 | Direct pino() usage (no Sentry)     | Migrated to createAppLogger                 |
| 2026-01-30 | Raw reply.send() in routes          | Migrated to reply.ok()/reply.fail()         |
| 2026-01-26 | Local user client re-export barrel  | Removed infra/user/index.ts (INT-301)       |
| 2026-01-24 | Manual LLM validation               | Migrated to Zod schemas (INT-218)           |
| 2026-01-24 | Inconsistent user-service clients   | Unified via internal-clients (INT-269)      |
| 2026-01-20 | Gaps in test coverage               | Additional test cases (INT-155)             |
| 2026-01-18 | Non-standard ServiceFeedback format | Standardized contract (INT-126)             |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Agent](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
