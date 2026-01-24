# Actions Agent - Technical Debt

## Summary

| Category            | Count | Severity   |
| ------------------- | ----- | ---------- |
| TODO/FIXME Comments | 0     | -          |
| Test Coverage Gaps  | 0     | -          |
| TypeScript Issues   | 4     | Low (test) |
| SRP Violations      | 2     | Medium     |
| Code Duplicates     | 0     | -          |
| Deprecations        | 0     | -          |
| Console Logging     | 0     | -          |

Last updated: 2026-01-24

## TypeScript Issues

### `as any` in Test Files (Low Severity)

Four instances of `as any` in test files for testing unsupported action types:

| File                                             | Line | Usage                        |
| ------------------------------------------------ | ---- | ---------------------------- |
| `__tests__/usecases/retryPendingActions.test.ts` | 81   | `type: 'unsupported' as any` |
| `__tests__/usecases/retryPendingActions.test.ts` | 83   | `type: 'unknown' as any`     |
| `__tests__/usecases/retryPendingActions.test.ts` | 160  | `type: 'unsupported' as any` |
| `__tests__/retryPendingActions.test.ts`          | 133  | `type: 'unsupported' as any` |

**Severity:** Low - These are intentional for testing edge cases with invalid types.

**Recommendation:** Acceptable pattern for testing error handling. No action needed.

## SRP Violations

### Route Files (Medium Severity)

| File                | Lines | Concern                                                |
| ------------------- | ----- | ------------------------------------------------------ |
| `publicRoutes.ts`   | 800   | Contains 8 endpoints with extensive schema definitions |
| `internalRoutes.ts` | 798   | Contains 5 endpoints with complex Pub/Sub handling     |

**Severity:** Medium - Files are at the threshold but well-organized.

**Recommendation:** Consider extracting route handlers into separate files if adding new endpoints:

- `/routes/public/actions.ts` - CRUD operations
- `/routes/public/execute.ts` - Execution endpoints
- `/routes/internal/pubsub.ts` - Pub/Sub handlers

### Large Use Case File (Medium Severity)

| File                     | Lines | Concern                                   |
| ------------------------ | ----- | ----------------------------------------- |
| `handleApprovalReply.ts` | 425   | Complex workflow with multiple code paths |

**Severity:** Medium - The file handles a complex workflow with approval, rejection, and clarification paths. The complexity is inherent to the business logic.

**Recommendation:** The file is well-structured with clear code paths. Consider extracting helper functions if the file grows beyond 500 lines.

## Future Plans

### Reminder Handler Implementation

The `reminder` action type is defined but has no handler. Actions of this type remain in `pending` status indefinitely.

**Proposed implementation:**

1. Create `handleReminderAction.ts` use case
2. Integrate with a scheduling service (Cloud Scheduler or Cloud Tasks)
3. Send reminder notifications at scheduled time

**Priority:** Low - No user impact since reminder actions are rare.

### Proposed Enhancements

1. **Bulk action execution** - Support batch execution of multiple actions
2. **Additional notification channels** - Support email or in-app notifications alongside WhatsApp
3. **Action templates** - Predefined action patterns for common tasks
4. **Action dependencies** - Support actions that depend on other actions completing
5. **Configurable auto-execution thresholds** - Allow users to set their own confidence thresholds per action type

### v2.0.0 Technical Decisions

The following design decisions were made in v2.0.0 and should be revisited if issues arise:

1. **Atomic status transitions via Firestore transactions** - Prevents race conditions but adds latency. Monitor for performance issues at scale.

2. **Per-user LLM classifier creation** - Creates a new classifier for each approval reply. Consider caching if LLM initialization becomes a bottleneck.

3. **Note actions direct execution** - When approving notes, the system executes directly instead of publishing `action.created` to avoid duplicate notifications. This breaks the standard event flow but solves a real UX issue.

4. **Approval message correlation via wamid or actionId** - Two lookup paths exist for backwards compatibility. Consider deprecating wamid lookup once all messages have correlation IDs.

## Code Smells

### None Detected

No active code smells found in current codebase:

- No silent catch blocks
- No inline error pattern usage
- No module-level mutable state
- No test fallbacks in production code
- Clean separation between domain and infrastructure

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. The `handleApprovalReply` use case has comprehensive tests covering:

- Approval flow with atomic status updates
- Rejection flow with metadata recording
- Unclear intent with clarification requests
- Race condition handling (status_mismatch)
- Terminal state handling (already completed/rejected)
- LLM classifier factory errors (no API key, invalid model)
- User ownership validation

### Coverage Areas

| Area               | Coverage | Notes                                  |
| ------------------ | -------- | -------------------------------------- |
| Public routes      | 95%+     | All endpoints tested                   |
| Internal routes    | 95%+     | Including approval-reply handler       |
| Use cases          | 95%+     | handleApprovalReply extensively tested |
| Infrastructure     | 95%+     | Firestore repos and HTTP clients       |
| Pub/Sub publishers | 95%+     | Event publishing tested                |

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

## Resolved Issues

### v2.0.0 Race Condition Fix (INT-211)

**Issue:** Concurrent Pub/Sub messages could trigger multiple WhatsApp notifications for the same action.

**Resolution:** Implemented `updateStatusIf` method using Firestore transactions. The method atomically checks the current status before updating, returning `status_mismatch` if another handler already processed the action.

**Date Resolved:** 2026-01-24

### v2.0.0 Duplicate Note Notification Fix

**Issue:** Approving a note action via WhatsApp would publish `action.created`, which triggered `handleNoteAction` to send another "ready for approval" notification.

**Resolution:** Note actions approved via WhatsApp are executed directly using `executeNoteAction` instead of publishing the event.

**Date Resolved:** 2026-01-24

### v2.0.0 Approval Message Ordering Fix

**Issue:** Approval confirmation message was sent after action execution, causing confusing message ordering.

**Resolution:** Send approval confirmation immediately after status update, before executing the action.

**Date Resolved:** 2026-01-24
