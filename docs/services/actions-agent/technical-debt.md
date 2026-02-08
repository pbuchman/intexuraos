# Actions Agent - Technical Debt

## Summary

| Category            | Count | Severity   |
| ------------------- | ----- | ---------- |
| TODO/FIXME Comments | 0     | -          |
| Test Coverage Gaps  | 0     | -          |
| TypeScript Issues   | 4     | Low (test) |
| SRP Violations      | 3     | Medium     |
| Code Duplicates     | 0     | -          |
| Deprecations        | 0     | -          |
| Console Logging     | 0     | -          |

Last updated: 2026-02-08

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
| `publicRoutes.ts`   | 806   | Contains 8 endpoints with extensive schema definitions |
| `internalRoutes.ts` | 897   | Contains 5 endpoints with complex Pub/Sub handling     |

**Severity:** Medium - Files are at the threshold but well-organized.

**Recommendation:** Consider extracting route handlers into separate files if adding new endpoints:

- `/routes/public/actions.ts` - CRUD operations
- `/routes/public/execute.ts` - Execution endpoints
- `/routes/internal/pubsub.ts` - Pub/Sub handlers

### Large Use Case File (High Severity)

| File                     | Lines | Concern                                                                       |
| ------------------------ | ----- | ----------------------------------------------------------------------------- |
| `handleApprovalReply.ts` | 1450  | Complex workflow with LLM classification, button handling, and nonce fallback |

**Severity:** High - The file has grown significantly with the addition of interactive button handling (v3.0.0), nonce-based approval validation, cancel-task and view-task button handlers, and text-based nonce fallback ("approve XXXX" pattern). It now contains multiple large helper functions.

**Recommendation:** Extract into separate modules:

- `handleButtonResponse.ts` - Interactive button handling logic
- `handleNonceTextFallback.ts` - Text-based nonce approval fallback
- `handleCancelTaskButton.ts` / `handleViewTaskButton.ts` - Code task button handlers
- `approvalExecution.ts` - Direct execution logic for different action types

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

### v3.0.0 Technical Decisions

The following design decisions were made in v3.0.0 and should be revisited if issues arise:

1. **Interactive WhatsApp buttons for code actions** - Code actions use interactive buttons (Approve with nonce, Cancel, Convert to Issue) instead of free-text replies. This bypasses LLM classification for deterministic intent but is limited to 3 buttons per message.

2. **Nonce-based approval tokens** - 4-character hex nonces with 15-minute TTL prevent accidental duplicate approvals. The short nonce format is a trade-off between security and usability (must fit in a WhatsApp button title).

3. **Text-based nonce fallback** - Users can type "approve XXXX" as a fallback when interactive buttons fail. If the nonce fails validation, the system falls through to the LLM classifier for backward compatibility.

4. **approvalEventId for idempotency** - Each code action execution generates a UUID `approvalEventId` stored in the action payload. This prevents WhatsApp retries or duplicate approval messages from spawning multiple code tasks.

5. **Direct execution of code actions after approval** - Like note actions, code actions are executed directly via `executeCodeAction` after WhatsApp approval rather than publishing `action.created` to avoid duplicate processing.

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

| Area               | Coverage | Notes                                                 |
| ------------------ | -------- | ----------------------------------------------------- |
| Public routes      | 100%     | All endpoints tested (100% branch enforcement)        |
| Internal routes    | 100%     | Including approval-reply and code action handlers     |
| Use cases          | 100%     | All use cases including code actions and nonce utils  |
| Infrastructure     | 100%     | Firestore repos, HTTP clients, and code-agent client  |
| Pub/Sub publishers | 100%     | Event publishing tested                               |

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

## Resolved Issues

### v3.0.0 Code Action Type (INT-156)

**Issue:** No support for dispatching code tasks (Claude Code) from the action system.

**Resolution:** Added `code` action type with full lifecycle: `handleCodeAction` (approval with interactive WhatsApp buttons), `executeCodeAction` (dispatch to code-agent), nonce-based approval validation, and cancel-task/view-task button handlers. Includes `CodeAgentClient` port and HTTP client, `approvalNonce` utility for generating and validating 4-char hex nonces with 15-min TTL.

**Date Resolved:** 2026-02-08

### v3.0.0 100% Branch Coverage Enforcement (INT-427)

**Issue:** Coverage was at 95% threshold, allowing some branches to go untested.

**Resolution:** Enforced 100% branch coverage with `v8 ignore` exemptions requiring valid categories. All untested branches now either have tests or documented exemptions.

**Date Resolved:** 2026-01-31

### v3.0.0 Response Contract Standardization

**Issue:** Internal routes used raw `reply.send()` / `reply.status().return` patterns instead of the standard response contract.

**Resolution:** Migrated all internal route responses to use `reply.ok()` and `reply.fail()` patterns. All error schemas updated to use `ErrorBody` reference.

**Date Resolved:** 2026-01-30

### v3.0.0 Duplicate Pub/Sub Events Fix

**Issue:** Action creation endpoint (`POST /internal/actions`) was publishing `action.created` events, causing duplicate processing when the caller (commands-agent) also published the event.

**Resolution:** Removed event publishing from the create action endpoint. Event publishing is now handled exclusively by the caller.

**Date Resolved:** 2026-01-30

### v3.0.0 Sentry Logger Migration

**Issue:** Direct `pino()` logger usage meant errors were not forwarded to Sentry.

**Resolution:** Migrated to `createAppLogger()` from `@intexuraos/infra-sentry` for all logger instances in services.ts.

**Date Resolved:** 2026-01-30

### v3.0.0 Polish Date Parsing Fix (INT-422)

**Issue:** Calendar actions failed when parsing Polish date formats.

**Resolution:** Fixed date parsing to handle Polish locale formats in calendar action processing.

**Date Resolved:** 2026-01-29

### v2.1.0 Internal Clients Migration (INT-269)

**Issue:** User service client was duplicated across multiple services, violating DRY principle and creating maintenance burden.

**Resolution:** Migrated to centralized `@intexuraos/internal-clients/user-service` package. All services now share a single, well-tested implementation for user settings and LLM client creation.

**Date Resolved:** 2026-01-25

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
