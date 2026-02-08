# Calendar Agent - Technical Debt

**Last Updated:** 2026-02-08
**Analysis Run:** v2.3.0 (INT-311 failed event delete/retry, INT-422 date parsing, LLM repair)

---

## Summary

| Category      | Count | Severity |
| ------------- | ----- | -------- |
| Code Smells   | 1     | Low      |
| Test Coverage | 0     | -        |
| Type Issues   | 0     | -        |
| TODOs         | 0     | -        |
| **Total**     | **1** | Low      |

---

## Recent Improvements (v2.3.0)

### INT-311: Failed Event Delete/Retry

**Status:** Complete

Added two new public endpoints for managing failed event extractions:

- `DELETE /calendar/failed-events/:id` -- permanently remove a failed event from the review queue
- `POST /calendar/failed-events/:id/retry` -- retry creating a calendar event using stored extraction data

Both endpoints enforce user ownership (returns 404 if the event belongs to a different user). Retry requires both start and end times to be present (returns 422 if missing).

### INT-422: Polish Date Parsing Fix

**Status:** Complete

`processCalendarAction` now includes the day of week alongside the date in the currentDate context (e.g., "2026-02-08 Saturday"). This enables accurate interpretation of relative date expressions in non-English languages such as Polish ("nastepny czwartek" for "next Thursday").

### LLM Extraction Repair Mechanism

**Status:** Complete

When the initial LLM extraction produces invalid JSON or fails Zod schema validation, a repair prompt is sent with the raw response and specific error. Up to 1 repair attempt is made before marking the extraction as failed. Uses `buildCalendarExtractionRepairPrompt` from `@intexuraos/llm-prompts`.

### Date-Only Format Support

**Status:** Complete

All-day events with date-only format (YYYY-MM-DD) from LLM responses are now accepted instead of being rejected by Zod schema validation. The `CalendarEventSchema` now permits date-only strings for the `start` field.

### INT-301: Full UserServiceClient Consolidation

**Status:** Complete

Removed local `UserServiceClientImpl` and entire `infra/user/` directory. All use cases now use the shared `@intexuraos/internal-clients` `UserServiceClient` with `getOAuthToken(userId, 'google')`. A new `mapUserServiceError()` function in `domain/errors.ts` maps `UserServiceError` codes (`CONNECTION_NOT_FOUND`, `TOKEN_REFRESH_FAILED`, `OAUTH_NOT_CONFIGURED`) to `CalendarError` codes. Removed `llmUserServiceClient` from `ServiceContainer` -- the single `userServiceClient` now handles both OAuth and LLM client retrieval.

### Sentry-Enabled Logging

**Status:** Complete

Migrated from direct `pino()` to `createAppLogger()` from `@intexuraos/infra-sentry`. Errors now automatically propagate to Sentry.

### INT-427: Strict 100% Coverage Enforcement

**Status:** Complete

Enabled strict 100% branch coverage enforcement with categorized `/* v8 ignore */` comments for genuinely unreachable branches (TypeScript type narrowing, test infrastructure limitations).

### Smart singleEvents Defaults

**Status:** Complete

`GoogleCalendarClientImpl.listEvents` now auto-sets `singleEvents=true` and `orderBy=startTime` when time filters (timeMin/timeMax) are provided. Explicit values override the defaults.

### Previous Improvements

#### INT-269: Internal Clients Migration

**Status:** Complete

Migrated from local `llmUserServiceClient` to shared `@intexuraos/internal-clients` package.

#### INT-222: Zod Schema Migration

**Status:** Complete

Migrated from custom validation to `CalendarEventSchema` from `@intexuraos/llm-prompts`.

---

## Future Plans

Based on code analysis and feature gaps:

1. **Recurring events support** - Currently not exposed (Google defaults singleEvents=true)
2. **Event colors** - Color customization for visual organization
3. **Reminders** - Event reminder notifications
4. **Attachments** - File attachment support
5. **Conference data** - Google Meet conference creation
6. **Batch operations** - Multiple event operations in single request
7. **Preview TTL** - Automatic cleanup of old previews (currently only cleaned after event creation)

---

## Code Smells

### Low Priority

| File                                       | Issue                        | Impact                              |
| ------------------------------------------ | ---------------------------- | ----------------------------------- |
| `src/infra/google/googleCalendarClient.ts` | Redundant filterUndefined fn | Low - function is correct, readable |

**Details:**

The `filterUndefined()` function manually removes undefined properties. Could use:

```typescript
Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
```

**Impact:** Low - function is correct and readable.

**Recommendation:** Keep for clarity, but consider extracting to common package if used elsewhere.

---

## Test Coverage

No test coverage gaps identified. Strict 100% branch coverage enforced with v8 ignore categories.

**Coverage areas (v2.3.0):**

- generateCalendarPreview use case - fully tested
- CalendarPreviewRepository - all CRUD operations tested
- processCalendarAction - preview integration tested, minimal preview fallback tested
- Duration calculation - edge cases covered
- All-day detection - comprehensive tests
- LLM extraction repair mechanism - JSON syntax errors, Zod validation errors, max attempts
- Failed event delete - ownership check, 204 response, error handling
- Failed event retry - ownership check, missing start/end, create+delete flow, non-blocking delete failure
- mapUserServiceError - all error code mappings tested
- GoogleCalendarClient.listEvents - auto singleEvents, orderBy, maxResults, q parameter passing

---

## TypeScript Issues

- No `any` types detected
- No `@ts-ignore` or `@ts-expect-error` usage
- Strict mode compliance: Pass

---

## TODOs/FIXMEs

No TODO, FIXME, HACK, or XXX comments found in codebase.

---

## Deprecations

No deprecated API usage detected.

---

## v2.0.0 Changes Analysis

### CalendarPreview Model

**Quality:** Good

- Uses actionId as document ID for natural idempotency
- Status enum covers all states: pending, ready, failed
- Duration and isAllDay computed fields for UI convenience

### generateCalendarPreview Use Case

**Quality:** Good

- Idempotent - returns existing preview if already generated
- Non-blocking cleanup pattern applied
- Error handling saves failed extractions for review
- LLM reasoning preserved for transparency

### Preview Repository

**Quality:** Good

- O(1) lookups via actionId document ID
- Delete operation is fire-and-forget (non-blocking)
- Proper error handling with CalendarError mapping

### Non-Blocking Cleanup Pattern

**Quality:** Good

The preview cleanup after event creation uses non-blocking deletion:

```typescript
// Fire-and-forget deletion - don't block response
calendarPreviewRepo.delete(actionId).then((result) => {
  if (!result.ok) {
    logger.warn({ actionId, error: result.error }, 'Failed to cleanup preview');
  }
});
```

This ensures:

- Event creation response is not delayed by cleanup
- Cleanup failures don't break the main flow
- Warning logged for debugging orphan previews

---

## Resolved Issues

| Date       | Issue                                             | Resolution                                        |
| ---------- | ------------------------------------------------- | ------------------------------------------------- |
| 2026-01-31 | Failed extractions could not be dismissed/retried | Added DELETE and POST retry endpoints             |
| 2026-01-30 | LLM returning invalid JSON caused immediate fail  | Added repair prompt mechanism (1 retry attempt)   |
| 2026-01-30 | Date-only format rejected for all-day events      | Updated schema to accept YYYY-MM-DD format        |
| 2026-01-29 | Polish relative dates parsed incorrectly          | Added day of week to currentDate context          |
| 2026-01-28 | Missing INTEXURAOS_GCP_PROJECT_ID env var         | Added to REQUIRED_ENV array                       |
| 2026-01-26 | Dual user service clients (local + shared)        | Consolidated to single shared UserServiceClient   |
| 2026-01-26 | singleEvents not set for time-filtered queries    | Auto-set singleEvents=true with time filters      |
| 2026-01-24 | Preview cleanup blocking event response           | Changed to non-blocking deletion                  |
| 2026-01-24 | Missing duration/isAllDay in preview              | Added computed fields                             |

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Documentation Run Log](../../documentation-runs.md)
