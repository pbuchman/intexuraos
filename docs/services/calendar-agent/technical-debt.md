# Calendar Agent - Technical Debt

**Last Updated:** 2025-01-25
**Analysis Run:** v2.1.0 (INT-269 migration)

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

## Recent Improvements (v2.1.0)

### INT-269: Internal Clients Migration

**Status:** Complete

Migrated from local `llmUserServiceClient` to shared `@intexuraos/internal-clients` package:

**Before:**

```typescript
// Local implementation in infra/user/llmUserServiceClient.ts
const llmUserServiceClient = new LlmUserServiceClientImpl(url, token);
```

**After:**

```typescript
// Shared package
import { createUserServiceClient } from '@intexuraos/internal-clients';
const llmUserServiceClient = createUserServiceClient({
  baseUrl: config.userServiceUrl,
  internalAuthToken: config.internalAuthToken,
  pricingContext: config.pricingContext,
  logger: logger,
});
```

**Benefits:**

- Consistent LLM client initialization across all services
- Centralized pricing context management
- Reduced code duplication

### INT-222: Zod Schema Migration

**Status:** Complete

Migrated from custom validation to `CalendarEventSchema` from `@intexuraos/llm-prompts`:

**Benefits:**

- Consistent schema across LLM extraction services
- Better error messages with `formatZodErrors()`
- Single source of truth for event extraction shape

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

No test coverage gaps identified. Core paths tested with Google Calendar API mocking.

**Coverage areas (v2.0.0):**

- generateCalendarPreview use case - fully tested
- CalendarPreviewRepository - all CRUD operations tested
- processCalendarAction - preview integration tested
- Duration calculation - edge cases covered
- All-day detection - comprehensive tests

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

| Date       | Issue                                   | Resolution                       |
| ---------- | --------------------------------------- | -------------------------------- |
| 2026-01-24 | Preview cleanup blocking event response | Changed to non-blocking deletion |
| 2026-01-24 | Missing duration/isAllDay in preview    | Added computed fields            |

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Documentation Run Log](../../documentation-runs.md)
