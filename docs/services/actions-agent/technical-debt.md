# Actions Agent - Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** v3.3.0 documentation refresh (DashScope migration, v8 ignore test replacement INT-785)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 4     | Low      |
| SRP Violations      | 2     | Medium   |
| Code Duplicates     | 1     | Low      |
| Code Smells         | 1     | Low      |
| Deprecations        | 0     | -        |
| Console Logging     | 0     | -        |
| **Total**           | **8** | —        |

---

## Future Plans

### Reminder Handler Implementation

The `reminder` action type is defined but has no handler. Actions of this type remain in `pending` status indefinitely.

**Proposed implementation:**

1. Create `handleReminderAction.ts` use case
2. Integrate with a scheduling service (Cloud Scheduler or Cloud Tasks)
3. Send reminder notifications at scheduled time

**Priority:** Low - No user impact since reminder actions are rare.

### Linear Action Auto-Execute Support

The `linear` action type is the only remaining type (besides `reminder`) that does not support auto-execution. Adding `executeLinearAction` as a dependency to the handler would enable this.

**Priority:** Low - Linear actions are relatively infrequent and benefit from human review.

### Proposed Enhancements

1. **Bulk action execution** - Support batch execution of multiple actions
2. **Additional notification channels** - Support email or in-app notifications alongside WhatsApp
3. **Action templates** - Predefined action patterns for common tasks
4. **Action dependencies** - Support actions that depend on other actions completing
5. **Configurable auto-execution thresholds** - Allow users to set their own confidence thresholds per action type

---

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

---

## SRP Violations

### Route Files (Medium Severity)

| File                | Lines | Concern                                                |
| ------------------- | ----- | ------------------------------------------------------ |
| `publicRoutes.ts`   | ~806  | Contains 7 endpoints with extensive schema definitions |
| `internalRoutes.ts` | ~897  | Contains 6 endpoints with Pub/Sub handling             |

**Severity:** Medium - Files are at the threshold but well-organized.

**Recommendation:** Consider extracting route handlers into separate files if adding new endpoints:

- `/routes/public/actions.ts` - CRUD operations
- `/routes/public/execute.ts` - Execution endpoints
- `/routes/internal/pubsub.ts` - Pub/Sub handlers

---

## Code Duplicates

### Per-type `executeActionByType` branches (Low Severity)

In `handleApprovalReply.ts`, the `executeActionByType` function contains a `switch` with a near-identical block for
each action type (note, todo, research, link, calendar, linear, code). Each branch differs only in log message and
which `execute*Action` function is called.

**Severity:** Low - The repetition is straightforward and exhaustive matching is intentional for TypeScript
type narrowing.

**Recommendation:** Could be replaced with a handler map if a new action type is added in the future. For now,
the current pattern provides clarity.

---

## Code Smells

### OpenAPI Description Mismatch (Low Severity)

In `server.ts`, the OpenAPI info description still reads "IntexuraOS Research Agent - Processes research action events"
instead of referencing the actions-agent. This is a leftover from the rename of research-agent to actions-agent.

| File        | Issue                                              | Impact                                  |
| ----------- | -------------------------------------------------- | --------------------------------------- |
| `server.ts` | OpenAPI description references "Research Agent"    | Incorrect API documentation for `/docs` |

**Severity:** Low - Does not affect functionality.

**Recommendation:** Update the description string to match the actual service name.

---

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. The `handleApprovalReply` use case has comprehensive tests covering:

- Button-based approval flow with atomic status updates
- Button-based rejection flow
- Text reply re-sends buttons
- Cancel-task and view-task button handling
- Proceed-implementation button handling (INT-628)
- Race condition handling (status_mismatch)
- Terminal state handling (already completed/rejected)
- Deleted/expired action handling (returns 200, sends WhatsApp notification)
- User ownership validation

### Coverage Areas

| Area               | Coverage | Notes                                                                                     |
| ------------------ | -------- | ----------------------------------------------------------------------------------------- |
| Public routes      | 100%     | All endpoints tested (100% branch enforcement)                                            |
| Internal routes    | 100%     | Including approval-reply and code action handlers                                         |
| Use cases          | 100%     | All use cases including code and calendar actions                                         |
| Infrastructure     | 100%     | Firestore repos, HTTP clients, and code-agent client                                      |
| Pub/Sub publishers | 100%     | Event publishing tested                                                                   |
| Calendar utils     | 100%     | formatCalendarApprovalMessage, formatCalendarCompletionMessage, calendarMessageFormatting |

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

### v8 Ignore Block Test Replacement (INT-785)

**Issue:** Multiple production source files used v8 ignore coverage exemptions for error paths that could be tested with proper fakes and HTTP client mocking.

**Resolution:** Added real test suites for `approvalMessageRepository`, `calendarServiceHttpClient`, `codeAgentHttpClient`, `notesServiceHttpClient`, `todosServiceHttpClient`, `internalRoutes`, and `publicRoutes`. Removed v8 ignore directives from 7 production files. Remaining 8 directives in `handleApprovalReply.ts` are all `ts-type` category for `noUncheckedIndexedAccess` patterns.

**Date Resolved:** 2026-03-13

### ZAI Provider Removal (DashScope Migration)

**Issue:** `INTEXURAOS_ZAI_APP_API_KEY` environment variable referenced the retired ZAI provider.

**Resolution:** Removed as part of the platform-wide migration to Alibaba Cloud Model Studio (DashScope). The actions-agent passes `workerType` through to code-agent without directly referencing LLM providers.

**Date Resolved:** 2026-03-12

### Rich Calendar Completion Messages (INT-535)

**Issue:** Calendar action completion notifications sent a plain text message ("Calendar event created. View it here: [link]") without event details.

**Resolution:** Added `formatCalendarCompletionMessage` utility that generates rich WhatsApp messages showing event title, date/time, duration, and location. The Google Calendar URL is sent as a CTA button (`ctaUrl: { displayText: 'View in Calendar', url }`) rather than embedded in the message text. Added `formatDateTime` and `calendarMessageFormatting` shared utilities.

**Date Resolved:** 2026-03-04

### Synchronous Calendar Preview in Approval Messages (INT-535)

**Issue:** Calendar approval messages showed only the action title without event details, requiring users to open the web app to see the parsed event information.

**Resolution:** Added synchronous HTTP call to `calendarServiceClient.generatePreview` during approval message construction in `handleCalendarAction`. The handler passes current date with day of week (for relative date parsing). Added `formatCalendarApprovalMessage` utility to format rich approval messages with event title, date/time, duration, and location. Falls back to basic message if preview generation fails.

**Date Resolved:** 2026-03-04

### Proceed to Implementation Button (INT-628)

**Issue:** Two-phase code tasks required users to open the web app to proceed from design to implementation phase.

**Resolution:** Added `proceed-implementation:{taskId}` button handling in `handleApprovalReply`. The handler calls `codeAgentClient.submitToPhase2` and sends success/error WhatsApp notifications. Error handling covers `TASK_NOT_FOUND`, `INVALID_STATUS`, `NO_LINEAR_ISSUE`, `LABEL_NOT_READY`, `ALREADY_IMPLEMENTED`, `ACTIVE_TASK_EXISTS`, `WORKER_NOT_CONFIGURED`, and `NETWORK_ERROR`.

**Date Resolved:** 2026-02-25

### Additional Worker Types for Code Actions

**Issue:** Code action `workerType` only supported `opus`, `auto`, and `glm`.

**Resolution:** Added `sonnet` and `minimax` worker types to `CodeActionPayload` and `executeCodeAction` use case.

**Date Resolved:** 2026-02-24

### Calendar Preview Fetch Ordering Fix

**Issue:** Calendar completion messages could not include rich event details because calendar-agent deletes the preview from Firestore after creating the Google Calendar event.

**Resolution:** Moved `calendarServiceClient.getPreview` call to BEFORE `processAction` in `executeCalendarAction`, ensuring the preview data is available for the completion message.

**Date Resolved:** 2026-03-07

### v3.1.0 Calendar Auto-Execute and Google Calendar Linking

**Issue:** Calendar actions always required manual approval and returned only app-relative URLs, not Google Calendar links.

**Resolution:** Added `executeCalendarAction` as a dependency to `handleCalendarAction`, enabling auto-execution for
high-confidence calendar actions. Updated `executeCalendarAction` to detect absolute URLs (Google Calendar links)
returned by calendar-agent and pass them through without prepending `webAppUrl`.

**Date Resolved:** 2026-02-20

### v3.1.0 Missing userId in Code-Agent Requests

**Issue:** Code action execution did not pass `userId` to the code-agent `submitTask` call.

**Resolution:** Added `userId` to the `submitTask` payload.

**Date Resolved:** 2026-02-20

### Auto-Execute Generalized to All Action Types

**Issue:** `shouldAutoExecute()` only auto-executed link actions, requiring manual approval for high-confidence todo/research/note/code actions even when classification was near-certain.

**Resolution:** Removed the `actionType === 'link'` guard from `shouldAutoExecute()`. The function now returns `true` for any action type when `confidence >= 0.9`. Tests updated to reflect type-agnostic threshold behavior.

**Date Resolved:** 2026-02-19

### Unified Interactive Approval Buttons (INT-524)

**Issue:** LLM approval classification added latency and cost on every approval reply. Nonce-based approval
for code actions created UX friction (4-char code in button title). Per-type approval logic was duplicated
across 7 handlers, with `handleApprovalReply.ts` growing to 1450 lines.

**Resolution:** Replaced LLM classification and nonce validation with unified deterministic interactive
buttons (`buildApprovalButtons()`). All 7 action types now use `approve:{actionId}` and `reject:{actionId}`
buttons. Code actions get an extra `convert:{actionId}` button. Text replies re-send buttons instead of
calling LLM. Deleted `llmApprovalIntentClassifier.ts`, `approvalIntentClassifierFactory.ts`, `approvalNonce.ts`.
`handleApprovalReply.ts` shrank from 1450 to 757 lines.

**Date Resolved:** 2026-02-09

### Deleted Action Graceful Handling

**Issue:** When an action was deleted between the approval message being sent and the user tapping the
button, the approval-reply handler returned 500, causing Pub/Sub to retry indefinitely.

**Resolution:** When action not found, return 200 OK + send WhatsApp notification ("This action is no
longer available"). Clean up orphaned approval_messages. Pub/Sub stops retrying.

**Date Resolved:** 2026-02-16

### Cancel-task Error Code Normalization (#779)

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

### Race Condition Fix (INT-211)

**Issue:** Concurrent Pub/Sub messages could trigger multiple WhatsApp notifications for the same action.

**Resolution:** Implemented `updateStatusIf` method using Firestore transactions.

**Date Resolved:** 2026-01-24

---

## Recent Technical Decisions

The following design decisions were made recently and should be revisited if issues arise:

1. **Button-only approval, no text fallback** - Text replies re-send buttons. This is simpler and cheaper
   than LLM classification but requires WhatsApp clients that support interactive buttons.

2. **All action types unified under `buildApprovalButtons()`** - Removes per-type approval complexity but
   means all types share the same 2-button UI (Approve/Reject), with code actions getting an extra button.

3. **Cancel-task nonce retained** - The `cancel-task:{taskId}:{nonce}` button format still uses nonces
   because task cancellation is irreversible and warrants one-time-use security tokens.

## Early Technical Decisions

1. **Atomic status transitions via Firestore transactions** - Prevents race conditions but adds latency.
   Monitor for performance issues at scale.

2. **Approval message correlation via wamid or actionId** - Two lookup paths exist for backwards
   compatibility. Consider deprecating wamid lookup once all messages have correlation IDs.

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
