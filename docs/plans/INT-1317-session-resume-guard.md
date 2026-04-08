# Session Resume Guard — Prevent Stale Session Resumption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a preserved container has been cleaned up (or never existed), prevent the user from sending follow-up messages to a completed task — instead show a clear "session no longer available" message.

**Architecture:** The orchestrator's `sendMessage()` currently only checks `worktreeExists()` before resuming a terminal task. When the preserved container is gone (cleaned up after 3 hours), a brand-new container is created where `--continue` finds no prior Claude session and silently starts fresh — losing all conversation context. The fix adds a container-availability check (`isResumeAvailable()`) before accepting the resume, returns a new `session_expired` error type, and surfaces it in the frontend as a user-friendly banner with a "Clear & Start New" action.

**Tech Stack:** TypeScript, Fastify (orchestrator + code-agent), React (web app)

---

## Root Cause Analysis

1. Task completes at 00:38, container preserved in memory
2. `PRESERVED_MAX_AGE_MS` = 3 hours — container cleaned up by ~03:38
3. User sends message at 09:14 (~8.5h later)
4. `worktreeExists()` returns `true` (files on disk survive cleanup)
5. `isResumeAvailable()` is NOT checked — code falls through
6. A brand-new container is created with `continueSession: true`
7. New container has no Claude session history → `--continue` silently starts fresh
8. Claude responds "Hello! I'm ready to help" — zero context from previous session

## File Structure

| File                                                                    | Responsibility                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `workers/orchestrator/src/types/schemas.ts`                             | Add `session_expired` to `SendMessageError.type` union        |
| `workers/orchestrator/src/services/task-dispatcher.ts`                  | Add `isResumeAvailable()` check before accepting resume       |
| `workers/orchestrator/src/routes.ts`                                    | Map `session_expired` error to HTTP 410 Gone                  |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`            | Test: session expired when container gone but worktree exists |
| `workers/orchestrator/src/__tests__/routes.test.ts`                     | Test: 410 response for session_expired                        |
| `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`                | Map orchestrator 410 → `session_expired` error code           |
| `apps/code-agent/src/domain/services/taskDispatcher.ts`                 | Update `sendMessageToWorker` return type for session_expired  |
| `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`              | Handle HTTP 410 from orchestrator                             |
| `apps/code-agent/src/routes/codeRoutes.ts`                              | Map `session_expired` → HTTP 410 to frontend                  |
| `apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts` | Test session_expired flow                                     |
| `apps/web/src/components/code-tasks/MessageInput.tsx`                   | Show session-expired banner with "Clear & Start New" CTA      |
| `apps/web/src/hooks/useAskAgent.ts`                                     | Expose `sessionExpired` state derived from `sendError.code`   |
| `apps/web/src/pages/AskAgentPage.tsx`                                   | Show session-expired banner when detected                     |

## Endpoint Changes

**Modified:**
- `POST /tasks/:taskId/message` (orchestrator) — new 410 response for `session_expired`
- `POST /code/tasks/:taskId/messages` (code-agent) — new 410 response for `SESSION_EXPIRED`

**Created:** None
**Removed:** None
**Unchanged:** All other endpoints

---

### Task 1: Add `session_expired` Error Type to Orchestrator

**Files:**
- Modify: `workers/orchestrator/src/types/schemas.ts:93-96`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:603-616`
- Modify: `workers/orchestrator/src/routes.ts:259-271`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Test: `workers/orchestrator/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing test — dispatcher rejects resume when container is gone but worktree exists**

In `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`, add a test in the `sendMessage` describe block:

```typescript
it('returns session_expired when worktree exists but container is gone', async () => {
  // Setup: task in completed state, worktree exists, but no preserved container
  const taskId = 'task_session_expired';
  await statePersistence.save({
    tasks: {
      [taskId]: {
        taskId,
        status: 'completed',
        agentType: 'auto',
        webhookSecret: 'secret',
        // ... other required fields matching existing test patterns
      },
    },
    version: 1,
  });

  fakeWorktreeManager.setExists(taskId, true);
  vi.mocked(fakeIsolationProvider.isResumeAvailable).mockResolvedValueOnce(false);

  const result = await dispatcher.sendMessage(taskId, 'follow-up question');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('session_expired');
    expect(result.error.message).toContain('session');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm test -- --reporter=verbose -t "session_expired"`
Expected: FAIL — `session_expired` is not a valid type in `SendMessageError`

- [ ] **Step 3: Add `session_expired` to `SendMessageError` type union**

In `workers/orchestrator/src/types/schemas.ts:93-96`, change:

```typescript
export interface SendMessageError {
  type: 'not_found' | 'invalid_status' | 'service_error' | 'invalid_agent_type';
  message: string;
}
```

to:

```typescript
export interface SendMessageError {
  type: 'not_found' | 'invalid_status' | 'service_error' | 'invalid_agent_type' | 'session_expired';
  message: string;
}
```

- [ ] **Step 4: Add container availability check in `sendMessage()`**

In `workers/orchestrator/src/services/task-dispatcher.ts`, after the `worktreeExists` check (line ~616), add:

```typescript
// Check if the container (or its session) is still available for resume.
// If only the worktree survives but the container is gone, --continue will
// start a fresh session with no context — worse than rejecting outright.
// Use optional chaining + ?? true for fail-open on providers that don't implement this method.
const canResume = await this.isolation.provider.isResumeAvailable?.(taskId) ?? true;
if (!canResume) {
  return {
    ok: false,
    error: {
      type: 'session_expired',
      message: 'Session has expired — the worker container was cleaned up. Please start a new session.',
    },
  };
}
```

This goes immediately after the `if (!hasWorktree)` block and before the `teardownAttempt` call.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd workers/orchestrator && pnpm test -- --reporter=verbose -t "session_expired"`
Expected: PASS

- [ ] **Step 6: Write failing test — route returns HTTP 410 for session_expired**

In `workers/orchestrator/src/__tests__/routes.test.ts`, add:

```typescript
it('returns 410 for session_expired error', async () => {
  // Setup dispatcher to return session_expired
  fakeDispatcher.sendMessageResult = {
    ok: false,
    error: { type: 'session_expired', message: 'Session has expired' },
  };

  const response = await app.inject({
    method: 'POST',
    url: `/tasks/${taskId}/message`,
    payload: { message: 'test' },
    headers: { /* required auth headers */ },
  });

  expect(response.statusCode).toBe(410);
  expect(JSON.parse(response.body)).toEqual({ error: 'Session has expired' });
});
```

- [ ] **Step 7: Add session_expired → 410 mapping in routes**

In `workers/orchestrator/src/routes.ts`, after the `invalid_status` → 409 block (~line 267), add:

```typescript
if (error.type === 'session_expired') {
  reply.status(410).send({ error: error.message });
  return;
}
```

- [ ] **Step 8: Run tests and verify all pass**

Run: `cd workers/orchestrator && pnpm test -- --reporter=verbose`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add workers/orchestrator/src/types/schemas.ts workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/routes.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts workers/orchestrator/src/__tests__/routes.test.ts
git commit -m "feat(orchestrator): reject session resume when container is gone (session_expired)"
```

---

### Task 2: Handle `session_expired` in Code-Agent Backend

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/sendTaskMessage.ts:146-161`
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts:166-170`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts:455-468`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:4594-4611`
- Test: `apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts`

- [ ] **Step 1: Write failing test — sendTaskMessage returns session_expired when orchestrator returns 410**

In `apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts`, add:

```typescript
it('returns session_expired when worker reports session expired', async () => {
  // Setup: task exists, worker configured, orchestrator returns session_expired
  fakeTaskDispatcher.sendMessageToWorkerResult = err({
    code: 'session_expired',
    message: 'Session has expired — the worker container was cleaned up.',
  });

  const result = await sendTaskMessage(deps, {
    taskId: task.id,
    userId: task.userId,
    message: 'follow-up',
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('session_expired');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm test -- --reporter=verbose -t "session_expired"`
Expected: FAIL — `session_expired` is not in `SendTaskMessageErrorCode`

- [ ] **Step 3: Add `session_expired` to error code type**

In `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`, update the error code union:

```typescript
export type SendTaskMessageErrorCode =
  | 'task_not_found'
  | 'invalid_agent_type'
  | 'invalid_status'
  | 'worker_not_configured'
  | 'worker_unavailable'
  | 'session_expired'
  | 'worker_error'
  | 'internal_error';
```

- [ ] **Step 4: Handle session_expired in the use case error mapping**

In `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`, in the `if (!forwardResult.ok)` block (~line 154), add before the existing mapping:

```typescript
if (forwardResult.error.code === 'session_expired') {
  logger.info({ taskId }, 'Session expired — container cleaned up');
  return err({
    code: 'session_expired',
    message: forwardResult.error.message,
  });
}
```

- [ ] **Step 5: Handle HTTP 410 in taskDispatcherImpl**

In `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`, in the `sendMessageToWorker` method, inside the `if (!response.ok)` block (~line 455), add before the `isRetryableInfraStatus` check:

```typescript
if (response.status === 410) {
  const errorText = await response.text().catch(() => 'Session expired');
  const errorMessage = extractErrorMessage(errorText);
  return err({
    code: 'session_expired',
    message: errorMessage.length > 0 ? errorMessage : 'Session has expired — the worker container was cleaned up.',
  });
}
```

- [ ] **Step 6: Map session_expired → HTTP 410 in the route handler**

In `apps/code-agent/src/routes/codeRoutes.ts`, in the `sendTaskMessage` error handling block (~line 4594), add:

```typescript
if (error.code === 'session_expired') {
  return reply.fail('SESSION_EXPIRED' as ErrorCode, error.message);
}
```

Add this before the `worker_unavailable` check.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm test -- --reporter=verbose -t "session_expired"`
Expected: PASS

- [ ] **Step 8: Run full test suite**

Run: `cd apps/code-agent && pnpm test -- --reporter=verbose`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add apps/code-agent/src/domain/usecases/sendTaskMessage.ts apps/code-agent/src/domain/services/taskDispatcher.ts apps/code-agent/src/infra/services/taskDispatcherImpl.ts apps/code-agent/src/routes/codeRoutes.ts apps/code-agent/src/__tests__/domain/usecases/sendTaskMessage.test.ts
git commit -m "feat(code-agent): propagate session_expired error from orchestrator to frontend"
```

---

### Task 3: Surface Session-Expired State in the Frontend

**Files:**
- Modify: `apps/web/src/components/code-tasks/MessageInput.tsx:90-99`
- Modify: `apps/web/src/hooks/useAskAgent.ts:7-56`
- Modify: `apps/web/src/pages/AskAgentPage.tsx:62-78`

Note: Web app has no enforced test coverage — tests are optional for UI components.

- [ ] **Step 1: Add SESSION_EXPIRED handling in MessageInput**

In `apps/web/src/components/code-tasks/MessageInput.tsx`, in the `sendError` rendering section (~line 90), add a case for `SESSION_EXPIRED` before the existing `WORKER_UNAVAILABLE` check:

```tsx
{sendError !== null ? (
  sendError.code === 'SESSION_EXPIRED' ? (
    <div className="mt-2 flex items-center gap-2 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <span>Session expired — the worker was cleaned up. Clear this session and start a new one.</span>
    </div>
  ) : sendError.code === 'WORKER_UNAVAILABLE' ? (
    // ... existing WORKER_UNAVAILABLE handling
```

- [ ] **Step 2: Add `sessionExpired` derived state in useAskAgent**

In `apps/web/src/hooks/useAskAgent.ts`, add to the `AskAgentState` interface:

```typescript
/** Whether the session has expired (container cleaned up) */
sessionExpired: boolean;
```

In the hook body, derive the state from `sendError`:

```typescript
const sessionExpired = sendError !== null && sendError.code === 'SESSION_EXPIRED';
```

Return it in the state object.

- [ ] **Step 3: Show session-expired banner in AskAgentPage**

In `apps/web/src/pages/AskAgentPage.tsx`, destructure `sessionExpired` from `useAskAgent()`, then add a banner after the existing error cards (~line 78):

```tsx
{sessionExpired ? (
  <Card className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/30">
    <div className="flex items-center justify-between">
      <p className="text-sm text-amber-800 dark:text-amber-300">
        This session has expired — the worker container was cleaned up after inactivity.
        Clear this session and start a new conversation.
      </p>
      <button
        type="button"
        onClick={handleClear}
        className="ml-4 shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
      >
        Clear & Start New
      </button>
    </div>
  </Card>
) : null}
```

- [ ] **Step 4: Disable message input when session is expired**

In `apps/web/src/pages/AskAgentPage.tsx`, update the `onSendMessage` prop on `CodeTaskLogViewer` to be omitted when session is expired:

```tsx
{...(taskId !== null && !sessionExpired ? { onSendMessage: sendMessage } : {})}
```

This removes `MessageInput` entirely when the session is expired, so the `SESSION_EXPIRED` inline banner in `MessageInput` (Step 1) is only visible on `CodeTaskViewPage`. `AskAgentPage` shows the banner via Step 3 instead — choose one pattern per surface.

- [ ] **Step 5: Also show session-expired state in CodeTaskViewPage**

In `apps/web/src/pages/CodeTaskViewPage.tsx`, the `sendMessage` is already passed to the log viewer. The `MessageInput` component now handles `SESSION_EXPIRED` error codes automatically (Step 1), so the code task detail view gets the same treatment for free — when a user tries to send a message to a task with an expired session from the task detail page, they'll see the "Session expired" message in the `MessageInput` error area.

No code changes needed for this step — just verify the `MessageInput` change from Step 1 covers both surfaces.

- [ ] **Step 6: Manual verification**

1. Start an ask-agent task, let it complete
2. Wait for container cleanup (or manually remove the preserved container)
3. Try sending a follow-up message
4. Verify: session-expired banner appears, message input is disabled
5. Verify: "Clear & Start New" button works and resets to fresh state

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/code-tasks/MessageInput.tsx apps/web/src/hooks/useAskAgent.ts apps/web/src/pages/AskAgentPage.tsx
git commit -m "feat(web): show session-expired banner when container is cleaned up"
```

---

### Task 4: Final Integration Verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All workspaces pass

- [ ] **Step 2: Commit any remaining fixes**

If CI revealed issues, fix and commit.
