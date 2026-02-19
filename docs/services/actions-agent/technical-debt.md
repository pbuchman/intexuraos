# Actions Agent - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 4     | Low      |
| SRP Violations      | 2     | Medium   |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | -        |
| Console Logging     | 0     | -        |

Last updated: 2026-02-19

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

## Code Duplicates

### Per-type `executeActionByType` branches (Low Severity)

In `handleApprovalReply.ts`, the `executeActionByType` function contains a `switch` with a near-identical block for
each action type (note, todo, research, link, calendar, linear, code). Each branch differs only in log message and
which `execute*Action` function is called.

**Severity:** Low - The repetition is straightforward and exhaustive matching is intentional for TypeScript
type narrowing.

**Recommendation:** Could be replaced with a handler map if a new action type is added in the future. For now,
the current pattern provides clarity.

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

### v4.0.0 Technical Decisions

The following design decisions were made in v4.0.0 and should be revisited if issues arise:

1. **Button-only approval, no text fallback** - Text replies re-send buttons. This is simpler and cheaper
   than LLM classification but requires WhatsApp clients that support interactive buttons.

2. **All action types unified under `buildApprovalButtons()`** - Removes per-type approval complexity but
   means all types share the same 2-button UI (Approve/Reject), with code actions getting an extra button.

3. **Cancel-task nonce retained** - The `cancel-task:{taskId}:{nonce}` button format still uses nonces
   because task cancellation is irreversible and warrants one-time-use security tokens.

### v2.0.0 Technical Decisions

The following design decisions were made in v2.0.0 and should be revisited if issues arise:

1. **Atomic status transitions via Firestore transactions** - Prevents race conditions but adds latency.
   Monitor for performance issues at scale.

2. **Approval message correlation via wamid or actionId** - Two lookup paths exist for backwards
   compatibility. Consider deprecating wamid lookup once all messages have correlation IDs.

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

- Button-based approval flow with atomic status updates
- Button-based rejection flow
- Text reply re-sends buttons
- Cancel-task and view-task button handling
- Race condition handling (status_mismatch)
- Terminal state handling (already completed/rejected)
- Deleted/expired action handling (returns 200, sends WhatsApp notification)
- User ownership validation

### Coverage Areas

| Area               | Coverage | Notes                                                |
| ------------------ | -------- | ---------------------------------------------------- |
| Public routes      | 100%     | All endpoints tested (100% branch enforcement)       |
| Internal routes    | 100%     | Including approval-reply and code action handlers    |
| Use cases          | 100%     | All use cases including code actions                 |
| Infrastructure     | 100%     | Firestore repos, HTTP clients, and code-agent client |
| Pub/Sub publishers | 100%     | Event publishing tested                              |

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

## Resolved Issues

### v4.0.0 Unified Interactive Approval Buttons (INT-524)

**Issue:** LLM approval classification added latency and cost on every approval reply. Nonce-based approval
for code actions created UX friction (4-char code in button title). Per-type approval logic was duplicated
across 7 handlers, with `handleApprovalReply.ts` growing to 1450 lines.

**Resolution:** Replaced LLM classification and nonce validation with unified deterministic interactive
buttons (`buildApprovalButtons()`). All 7 action types now use `approve:{actionId}` and `reject:{actionId}`
buttons. Code actions get an extra `convert:{actionId}` button. Text replies re-send buttons instead of
calling LLM. Deleted `llmApprovalIntentClassifier.ts`, `approvalIntentClassifierFactory.ts`, `approvalNonce.ts`.
`handleApprovalReply.ts` shrank from 1450 to 757 lines.

**Date Resolved:** 2026-02-09

### v4.0.0 Deleted Action Graceful Handling

**Issue:** When an action was deleted between the approval message being sent and the user tapping the
button, the approval-reply handler returned 500, causing Pub/Sub to retry indefinitely.

**Resolution:** When action not found, return 200 OK + send WhatsApp notification ("This action is no
longer available"). Clean up orphaned approval_messages. Pub/Sub stops retrying.

**Date Resolved:** 2026-02-16

### v4.0.0 Cancel-task Error Code Normalization (#779)

**Issue:** Cancel-task domain error codes used lowercase snake_case (`invalid_nonce`, `nonce_expired`,
`not_owner`, `task_not_cancellable`), inconsistent with project ErrorCode convention.

**Resolution:** Normalized to UPPER_CASE. Changed `not_owner` HTTP status from 400 to 403. Updated
all callers and tests. Silent fallback operators replaced with explicit checks that log protocol mismatches.

**Date Resolved:** 2026-02-10

### v3.0.0 Large Use Case File SRP Violation (handleApprovalReply.ts)

**Issue:** `handleApprovalReply.ts` grew to 1450 lines with multiple large helper functions for LLM
classification, nonce validation, button handling, and text fallback patterns.

**Resolution:** Resolved organically via INT-524 — removing the LLM layer and nonces brought the file
back to 757 lines. Further splitting is not currently warranted.

**Date Resolved:** 2026-02-09

### v3.0.0 Code Action Type (INT-156)

**Issue:** No support for dispatching code tasks (Claude Code) from the action system.

**Resolution:** Added `code` action type with full lifecycle: `handleCodeAction`, `executeCodeAction`,
`CodeAgentClient` port and HTTP client, code task buttons.

**Date Resolved:** 2026-02-08

### v3.0.0 100% Branch Coverage Enforcement (INT-427)

**Issue:** Coverage was at 95% threshold, allowing some branches to go untested.

**Resolution:** Enforced 100% branch coverage with `v8 ignore` exemptions requiring valid categories.

**Date Resolved:** 2026-01-31

### v3.0.0 Response Contract Standardization

**Issue:** Internal routes used raw `reply.send()` / `reply.status().return` patterns.

**Resolution:** Migrated all internal route responses to use `reply.ok()` and `reply.fail()`.

**Date Resolved:** 2026-01-30

### v3.0.0 Duplicate Pub/Sub Events Fix

**Issue:** Action creation endpoint was publishing `action.created` events, causing duplicate processing.

**Resolution:** Removed event publishing from the create action endpoint. Caller (commands-agent) now owns publishing.

**Date Resolved:** 2026-01-30

### v3.0.0 Sentry Logger Migration

**Issue:** Direct `pino()` logger usage meant errors were not forwarded to Sentry.

**Resolution:** Migrated to `createAppLogger()` from `@intexuraos/infra-sentry`.

**Date Resolved:** 2026-01-30

### v3.0.0 Polish Date Parsing Fix (INT-422)

**Issue:** Calendar actions failed when parsing Polish date formats.

**Resolution:** Fixed date parsing to handle Polish locale formats.

**Date Resolved:** 2026-01-29

### v2.1.0 Internal Clients Migration (INT-269)

**Issue:** User service client was duplicated across multiple services.

**Resolution:** Migrated to centralized `@intexuraos/internal-clients/user-service` package.

**Date Resolved:** 2026-01-25

### v2.0.0 Race Condition Fix (INT-211)

**Issue:** Concurrent Pub/Sub messages could trigger multiple WhatsApp notifications for the same action.

**Resolution:** Implemented `updateStatusIf` method using Firestore transactions.

**Date Resolved:** 2026-01-24
