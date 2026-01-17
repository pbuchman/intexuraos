# Design: Action Feedback Mechanism

**Issue:** [INT-124](https://linear.app/pbuchman/issue/INT-124/sync-linear-issue-creation-status-and-improve-error-feedback)
**Author:** Claude Opus 4.5
**Date:** 2026-01-17
**Status:** Draft

---

## Problem Statement

Users experience misleading feedback when executing actions via WhatsApp voice commands:

1. **Silent Success Bug:** Linear issue creation shows "failed" on UI despite the issue being successfully created in Linear
2. **Missing Failure Context:** When actions fail, no specific reason is displayed to the user
3. **Inconsistent Feedback Contract:** Different action types return feedback in different formats

---

## Root Cause Analysis

### Issue 1: Silent Success for Linear Actions

**Location:** `apps/linear-agent/src/routes/internalRoutes.ts:140`

The linear-agent's `/internal/linear/process-action` endpoint uses `reply.send()` directly:

```typescript
// Current (broken)
return await reply.send({
  status: result.value.status,
  resource_url: result.value.resourceUrl,
  issue_identifier: result.value.issueIdentifier,
  error: result.value.error,
});
```

This returns:
```json
{ "status": "completed", "resource_url": "...", "issue_identifier": "INT-123" }
```

**However**, the HTTP client in actions-agent (`apps/actions-agent/src/infra/http/linearAgentHttpClient.ts:92-96`) expects the standard envelope:

```typescript
const body = (await response.json()) as ApiResponse;
if (!body.success || body.data === undefined) {
  logger.error({ body }, 'Invalid response from linear-agent');
  return err(new Error(body.error?.message ?? 'Invalid response from linear-agent'));
}
```

Expected response format:
```json
{ "success": true, "data": { "status": "completed", "resource_url": "...", "issue_identifier": "INT-123" } }
```

**Result:** When `body.success` is `undefined` (falsy), the client treats the response as an error, returning "Invalid response from linear-agent" even when the Linear issue was successfully created.

### Issue 2: Missing Failure Context

The current `ExecuteActionResult` interface includes an `error` field, but:

1. **Frontend doesn't display it:** The `ConfigurableActionButton.tsx` only handles `onError` for exceptions, not for `status: 'failed'` responses
2. **No user-facing feedback:** When `executeAction` returns `{ status: 'failed', error: '...' }`, the message is not shown to the user

### Issue 3: Inconsistent Response Format

| Service | Endpoint | Uses `reply.ok()`? | Response Format |
|---------|----------|-------------------|-----------------|
| linear-agent | `/internal/linear/process-action` | ❌ | Raw JSON (no envelope) |
| todos-agent | `/internal/todos` | ✅ | Standard envelope |
| notes-agent | `/internal/notes` | ✅ | Standard envelope |

---

## Current Architecture

### Action Execution Flow

```
┌────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────┐
│   Web UI   │───▶│   actions-agent  │───▶│  linear-agent   │───▶│  Linear API  │
│            │    │  POST /actions/  │    │  POST /internal │    │              │
│            │    │  {actionId}/     │    │  /linear/       │    │              │
│            │    │  execute         │    │  process-action │    │              │
└────────────┘    └──────────────────┘    └─────────────────┘    └──────────────┘
      │                    │                      │                      │
      │                    │                      │                      │
      ▼                    ▼                      ▼                      ▼
┌────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────┐
│  Expected: │    │  Expects:        │    │  Returns:       │    │  Returns:    │
│  resource_ │    │  { success,      │    │  { status,      │    │  Issue       │
│  url or    │    │    data: {...} } │    │    resource_url │    │  created     │
│  error msg │    │                  │    │    ... }        │    │              │
└────────────┘    └──────────────────┘    └─────────────────┘    └──────────────┘
                         ▲                       │
                         │                       │
                         └───────────────────────┘
                           MISMATCH: Missing
                           `success: true` envelope
```

### Current Feedback Data Flow

```
1. User clicks "Execute" on Linear action
2. Web → POST /actions/{id}/execute
3. actions-agent → executeLinearActionUseCase
4. linearAgentClient.processAction() → linear-agent
5. linear-agent → Creates issue in Linear ✓
6. linear-agent → reply.send({ status: 'completed', ... }) ← Bug: No envelope
7. linearAgentHttpClient → !body.success → "Invalid response" error
8. executeLinearAction → Updates action status to 'failed'
9. Web ← { status: 'failed', error: 'Invalid response from linear-agent' }
10. UI shows "failed" despite issue being created
```

---

## Proposed Solution

### Phase 1: Fix Silent Success Bug (Immediate)

**Change:** Update linear-agent to use `reply.ok()` instead of `reply.send()`

```typescript
// apps/linear-agent/src/routes/internalRoutes.ts:140
// Before:
return await reply.send({...});

// After:
return await reply.ok({
  status: result.value.status,
  resource_url: result.value.resourceUrl,
  issue_identifier: result.value.issueIdentifier,
  error: result.value.error,
});
```

**Compatibility:** The HTTP client already expects the envelope format, so this is a transparent fix.

### Phase 2: Standardize Feedback Contract (Implementation Task)

Define a unified `ActionFeedback` contract that all action executors must return:

```typescript
// packages/common-core/src/types/actionFeedback.ts

/**
 * Unified feedback contract for all action execution results.
 * Returned by all downstream services and propagated to the frontend.
 */
export interface ActionFeedback {
  /** Execution outcome */
  status: 'completed' | 'failed';

  /** URL to the created/affected resource (when successful) */
  resourceUrl?: string;

  /** Human-readable resource identifier (e.g., "INT-123", "Note: Meeting Notes") */
  resourceIdentifier?: string;

  /** Human-readable success message for user display */
  successMessage?: string;

  /** Human-readable failure reason for user display */
  failureReason?: string;

  /** Technical error code for logging/debugging */
  errorCode?: string;

  /** Additional context (e.g., retryable, partial success) */
  metadata?: Record<string, unknown>;
}
```

### Phase 3: Frontend Feedback Display (Implementation Task)

Update `ConfigurableActionButton` and `InboxPage` to:

1. Display `failureReason` in a toast/banner when `status: 'failed'`
2. Show `successMessage` when available (instead of hardcoded messages)
3. Handle partial success scenarios via `metadata`

---

## Implementation Plan

### Task 1: Fix Linear Agent Response Envelope (Bug Fix)

**Files to modify:**
- `apps/linear-agent/src/routes/internalRoutes.ts` (line 140)

**Effort:** 1 hour
**Risk:** Low (additive change, existing tests should pass)

### Task 2: Audit All Internal Service Endpoints

**Files to check:**
- All `apps/*/src/routes/internalRoutes.ts`
- Verify all use `reply.ok()` or `reply.fail()`

**Effort:** 2 hours
**Deliverable:** List of non-compliant endpoints

### Task 3: Define ActionFeedback Contract

**Files to create/modify:**
- `packages/common-core/src/types/actionFeedback.ts`
- Update all `Execute*ActionResult` interfaces

**Effort:** 4 hours
**Risk:** Medium (interface changes require cascading updates)

### Task 4: Update Downstream Services

**Services to update:**
- linear-agent
- todos-agent
- notes-agent
- links-agent
- calendar-agent
- research-agent

**For each service:**
1. Update internal endpoint to return `ActionFeedback`
2. Add `successMessage` and `failureReason` fields
3. Update tests

**Effort:** 2-3 hours per service
**Risk:** Medium (requires coordinated deployment)

### Task 5: Frontend Feedback Display

**Files to modify:**
- `apps/web/src/components/ConfigurableActionButton.tsx`
- `apps/web/src/pages/InboxPage.tsx`
- `apps/web/src/types/actionConfig.ts`

**Changes:**
1. Handle `failureReason` from result
2. Display toast/banner for failures
3. Update success notification to use `successMessage` when available

**Effort:** 4 hours
**Risk:** Low (UI changes only)

---

## Testing Strategy

### Unit Tests

1. **linearAgentHttpClient:** Verify correct parsing of envelope response
2. **executeLinearAction:** Verify proper status propagation
3. **ActionFeedback contract:** Type checking and serialization

### Integration Tests

1. **Happy path:** Create Linear issue → Verify `completed` status propagates
2. **LLM extraction failure:** Verify `failed` status with `failureReason`
3. **Network failure:** Verify timeout handling and error message

### E2E Tests

1. **Voice command flow:** WhatsApp → actions-agent → linear-agent → UI
2. **Error display:** Trigger failure, verify user sees reason

---

## Rollout Plan

### Phase 1: Hotfix (Immediate)
- Fix `reply.send()` → `reply.ok()` in linear-agent
- Deploy to dev, verify bug fixed
- Deploy to prod

### Phase 2: Feedback Contract (Planned Sprint)
- Define `ActionFeedback` interface
- Update one service (linear-agent) as pilot
- Roll out to remaining services
- Update frontend

### Phase 3: Enhanced UX (Future)
- Rich failure context (retry suggestions)
- Partial success handling
- Action history with feedback timeline

---

## Appendix: Affected Files

| File | Change Type | Priority |
|------|-------------|----------|
| `apps/linear-agent/src/routes/internalRoutes.ts` | Bug fix | P0 |
| `apps/actions-agent/src/infra/http/linearAgentHttpClient.ts` | Verification | P1 |
| `apps/actions-agent/src/domain/usecases/executeLinearAction.ts` | Enhancement | P2 |
| `packages/common-core/src/types/actionFeedback.ts` | New file | P2 |
| `apps/web/src/components/ConfigurableActionButton.tsx` | Enhancement | P2 |
| `apps/web/src/pages/InboxPage.tsx` | Enhancement | P2 |

---

## Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| Use `reply.ok()` envelope for internal routes | Consistency with public routes, existing client expectations | 2026-01-17 |
| Define unified `ActionFeedback` contract | Eliminates per-action-type variance, simplifies frontend | 2026-01-17 |
| Separate hotfix from contract refactoring | Reduce risk, fix user-facing bug immediately | 2026-01-17 |
