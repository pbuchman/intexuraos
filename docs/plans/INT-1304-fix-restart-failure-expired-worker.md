# Fix Restart Failure for Expired Worker Containers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user sends a message to resume a task whose container has expired, create a fresh container instead of returning a 404 error.

**Architecture:** The fix targets the orchestrator's `sendMessage()` method in `task-dispatcher.ts`. Currently, when a task is in a terminal state (completed/failed/interrupted) and the user sends a message to resume, the code calls `isResumeAvailable()` which checks for an existing Docker container. If the container is gone (expired, crashed, cleaned up), it returns a hard 404 error to the caller. However, the downstream `createWorker(config: { continueSession: true })` path already handles missing containers by creating fresh ones from the existing worktree. The fix removes the overly-conservative `isResumeAvailable` gate and instead lets the resume flow proceed, handling failures asynchronously via the existing `failAcceptedResume` error path.

**Tech Stack:** TypeScript, Fastify, Vitest, Docker (Dockerode)

---

## Root Cause Analysis

**Error:** `Worker returned HTTP 404: Worker container no longer available for resume`

**Trace:**
1. User has a task in terminal state (completed/failed/interrupted) in Firestore
2. The Docker container for the task is gone (expired after 3h preservation, orchestrator restart lost in-memory maps, cleanup removed it)
3. User sends a message via web UI (`POST /code/tasks/:taskId/messages`)
4. Code-agent forwards to orchestrator (`POST /tasks/:id/message`)
5. Orchestrator's `sendMessage()` checks `isResumeAvailable(taskId)` - returns `false` because:
   - Not in `workers` Map (in-memory, lost on restart)
   - Not in `preservedWorkers` Map (expired or lost on restart)
   - No running Docker container named `code-worker-{taskId}`
6. Returns `{ ok: false, error: { type: 'not_found', message: 'Worker container no longer available for resume' } }`
7. Orchestrator route maps `not_found` to HTTP 404
8. Code-agent's `taskDispatcherImpl.sendMessageToWorker()` formats as: `Worker returned HTTP ${status}: ${errorMessage}`
9. Web app shows the error to the user

**Root cause:** The `isResumeAvailable` pre-check is too conservative. It rejects the resume even though the downstream `createWorker({ continueSession: true })` can create a fresh container from the worktree. The pre-check was added to prevent "silent async RESUME_ATTEMPT_FAILED" — i.e., accepting the resume (returning 200) but then failing to actually create the container. But this is fixable: if the fresh container creation also fails (e.g., worktree is gone too), `failAcceptedResume` already handles it by marking the task as failed and sending a webhook.

## Investigation: All Paths Touching Worker Preservation and Expiration

### Container Lifecycle States

```
  createWorker()         preserveWorker()       destroyWorker() or
       |                      |                  cleanup timer
       v                      v                      v
   +--------+           +-----------+           +-----------+
   | active |  -------> | preserved | --------> | destroyed |
| (workers Map) | (preservedWorkers | (removed) |
|               |
| ------------- |
| ^             |
       +---------------------------------------------+
                  destroyWorker() direct
```

### In-Memory Tracking (Lost on Restart)

| Map                | Purpose                    | Populated by       | Cleared by                                       |
| ------------------ | -------------------------- | ------------------ | ------------------------------------------------ |
| `workers`          | Active containers          | `createWorker()`   | `destroyWorker()`                                |
| `preservedWorkers` | Debug-preserved containers | `preserveWorker()` | cleanup timer, `isResumeAvailable` (stale entry) |

### Preservation Path

**File:** `workers/orchestrator/src/services/isolation/docker-provider.ts`

1. **Trigger:** Task completes/fails/is interrupted AND `preserveWorkerContainers` config is `true`
2. **`preserveWorker(taskId)`:** Moves entry from `workers` Map to `preservedWorkers` Map. Clears sensitive files (individual file deletion, not recursive rm). Container stays running.
3. **Expiration:** No automatic timer for preserved containers in current code. The `PRESERVED_MAX_AGE_MS` constant is not referenced — orphan cleanup only runs on startup for containers > 24h old.
4. **`isResumeAvailable(taskId)` stale cleanup:** If a preserved container is found in the map but `isContainerRunning()` returns false, the entry is deleted from `preservedWorkers`.

### Expiration/Cleanup Paths

| Path                     | Trigger                      | Threshold                           | Effect                                                                         |
| ------------------------ | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| **Orphan cleanup**       | Orchestrator startup         | 24h (`MAX_AGE_MS`)                  | `cleanupOrphanedContainers()` removes containers older than 24h                |
| **Task timeout**         | Activity timer               | 180 min (`TASK_TIMEOUT_KILL_MS`)    | `destroyWorker()` + task marked `interrupted`                                  |
| **Zombie detection**     | Cloud Scheduler (code-agent) | 30 min (`ZOMBIE_THRESHOLD_MINUTES`) | Task marked `interrupted` in Firestore (no container action)                   |
| **Cancellation**         | User action                  | Immediate                           | `destroyWorker()` + `cleanupTaskSession()`                                     |
| **Normal completion**    | Task exits                   | Immediate                           | `destroyWorker()` + `cleanupTaskSession()` (unless `preserveWorkerContainers`) |
| **Orchestrator restart** | Process restart              | Immediate                           | In-memory maps lost; containers may still run in Docker                        |

### Resume Flow (`sendMessage` for terminal tasks)

**File:** `workers/orchestrator/src/services/task-dispatcher.ts:603-657`

```
Terminal task (completed/failed/interrupted) + user message
    |
    v
isResumeAvailable(taskId)? --- false ---> 404 ERROR (BUG)
    |
    true
    |
    v
teardownAttempt(taskId, keepSession=true)  // keeps worktree
    |
    v
Set task.status = 'running'
Save to state persistence
    |
    v
resumeTaskWithUserMessage(task)  // async, creates fresh container
    |
    v
createWorker({ continueSession: true })
|  |  |
|  |
|  |
|  |
|  |
```

### `createWorker` Orphan Detection (handles missing containers)

**File:** `workers/orchestrator/src/services/isolation/docker-provider.ts`

When `config.continueSession === true`:
1. Check Docker for container named `code-worker-{taskId}`
2. If running → reuse
3. If stopped → remove and create fresh
4. If not found → proceed with normal creation (fresh container + worktree)

**Key insight:** `createWorker` with `continueSession=true` already handles the "no container" case gracefully. The `isResumeAvailable` pre-check is the only thing preventing this from working.

### Worktree Lifecycle

**File:** `workers/orchestrator/src/services/worktree-manager.ts`

| Event                          | Worktree                             | Container                                 |
| ------------------------------ | ------------------------------------ | ----------------------------------------- |
| Task created                   | Created                              | Created                                   |
| Task completed (no preserve)   | **Removed** via `cleanupTaskSession` | **Removed** via `destroyWorker`           |
| Task completed (preserve=true) | **Kept**                             | **Preserved** (moved to preservedWorkers) |
| Task cancelled                 | **Removed**                          | **Removed**                               |
| Task interrupted (timeout)     | **Removed**                          | **Removed**                               |
| Orchestrator restart           | **Survives** (filesystem)            | **Survives** (Docker)                     |

### Edge Case: Worktree Gone Too

If both container AND worktree are gone (fully finalized task), `createWorker` will fail because the worktree mount path doesn't exist. This is handled by `failAcceptedResume()` which:
1. Logs the error
2. Sets task status back to `failed`
3. Sends a webhook to code-agent with the error

The code-agent webhook handler updates Firestore, so the user sees the task as `failed`. This is acceptable behavior — the user should use "Retry" (creates a completely new task) instead of "Resume" for fully finalized tasks.

## Fix Strategy

### Option A (Chosen): Remove `isResumeAvailable` gate, add worktree check

Instead of checking for a running container (which may be gone), check for the **worktree** (which determines if a resume is possible). If the worktree exists, the resume can proceed — `createWorker` will create a fresh container. If the worktree is gone, return the error (user must retry with a new task).

**Why this option:**
- Minimal code change (orchestrator only)
- Leverages existing `createWorker` orphan handling
- `failAcceptedResume` already handles async failures gracefully
- No code-agent or web app changes needed

### Option B (Rejected): Code-agent fallback to retry

Have the code-agent detect the 404 and automatically create a new task. Rejected because:
- Adds complexity to code-agent dispatch logic
- User loses task continuity (new task, not resume)
- The orchestrator CAN resume if worktree exists — we should fix it there

## File Structure

| File                                                               | Action   | Responsibility                                              |
| ------------------------------------------------------------------ | -------- | ----------------------------------------------------------- |
| `workers/orchestrator/src/services/task-dispatcher.ts`             | Modify   | Replace `isResumeAvailable` check with worktree existence   |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`       | Modify   | Update tests for new resume behavior                        |

**Note:** This plan uses the existing `worktreeManager.worktreeExists(taskId)` method (already exists in `worktree-manager.ts:204`) and calls it directly via the already-injected `worktreeManager` in `TaskDispatcher`. No new methods, no interface changes, no docker-provider changes needed.

## Endpoint Changes

- **Modified:** None (behavior change only)
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /tasks/:id/message` — now accepts resume for tasks where worktree exists even if container is gone (returns 200 + `{ action: 'resumed' }` instead of 404)

---

### Task 1: Replace `isResumeAvailable` with worktree check in `sendMessage`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 0 (Prerequisite): Add `worktreeExists` to `mockWorktreeManager`**

Before writing any tests, add `worktreeExists` to the existing `mockWorktreeManager` definition in the test file (around line 189). The current mock only has `createWorktree` and `deleteWorktree`:

```typescript
const mockWorktreeManager = {
  createWorktree: vi.fn(async () => '/tmp/worktrees/test-task'),
  deleteWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
} as unknown as WorktreeManager;
```

Add `worktreeExists` to the mock:

```typescript
const mockWorktreeManager = {
  createWorktree: vi.fn(async () => '/tmp/worktrees/test-task'),
  deleteWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
  worktreeExists: vi.fn(async () => true),  // ADD THIS
} as unknown as WorktreeManager;
```

This is required — the new tests (Step 1 and Step 5) mock `mockWorktreeManager.worktreeExists` directly, and calling `.mockResolvedValue()` on `undefined` throws `TypeError: Cannot read properties of undefined (reading 'mockResolvedValue')`.

- [ ] **Step 1: Write failing test — resume succeeds when container is gone but worktree exists**

In the test file, find the existing test `'returns not_found when container is no longer available for resume'` (around line 8199). Add a new test AFTER it:

```typescript
it('resumes task when container is gone but worktree exists', async () => {
  const request: CreateTaskRequest = {
    taskId: 'msg-worktree-resume-task',
    workerType: 'auto',
    prompt: 'Test',
    webhookUrl: 'https://example.com/webhook',
    webhookSecret: 'secret',
    repository: 'owner/repo',
    baseBranch: 'main',
    linearIssueLabels: [],
    hasChildren: false,
  };

  // Create and complete the task first
  await dispatcher.createTask(request);
  // ... simulate task completion to set status to 'completed'

  // Container is gone but worktree exists
  mockProvider.isResumeAvailable.mockResolvedValue(false);
  mockWorktreeManager.worktreeExists.mockResolvedValue(true);

  const result = await dispatcher.sendMessage('msg-worktree-resume-task', 'Resume please');

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ action: 'resumed' });
  }
});
```

Note: Read the existing test setup to understand exactly how to create a task and transition it to a terminal state. The mock setup above is illustrative — adapt to the actual test patterns.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "resumes task when container is gone but worktree exists"`

Expected: FAIL — the test still hits the `isResumeAvailable` check and gets not_found

- [ ] **Step 3: Modify `sendMessage` to use worktree check**

In `task-dispatcher.ts`, replace the `isResumeAvailable` check (lines ~607-615):

```typescript
// BEFORE:
const isAvailable = (await this.isolation.provider.isResumeAvailable?.(taskId)) ?? false;
if (!isAvailable) {
  return {
    ok: false,
    error: { type: 'not_found', message: 'Worker container no longer available for resume' },
  };
}

// AFTER:
// Check if the worktree exists — a container can be recreated, but a worktree cannot.
// If the container is gone but worktree exists, createWorker(continueSession=true) will
// create a fresh container. If the worktree is also gone, reject — user must retry.
const hasWorktree = await this.worktreeManager.worktreeExists(taskId);
if (!hasWorktree) {
  return {
    ok: false,
    error: { type: 'not_found', message: 'Worker container and worktree no longer available for resume' },
  };
}
```

This logic: if worktree exists → proceed (container will be created). If worktree is gone → reject (user must retry).

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "resumes task when container is gone but worktree exists"`

Expected: PASS

- [ ] **Step 5: Update the existing not_found test and remove stale test**

**5a. Update existing test:**
The existing test `'returns not_found when container is no longer available for resume'` (line 8199) needs to mock `worktreeManager.worktreeExists` returning `false` instead of mocking `isResumeAvailable`:

```typescript
// Remove: mockIsolationProvider.isResumeAvailable.mockResolvedValueOnce(false);
mockWorktreeManager.worktreeExists.mockResolvedValueOnce(false);
```

And update the expected error message to: `'Worker container and worktree no longer available for resume'`.

**5b. Remove stale test:**
Delete the test at line 8304: `'returns not_found when isResumeAvailable is not implemented on provider'`. This test exercises the optional-chaining fallback (`isResumeAvailable = undefined → ?? false → not_found`) which no longer exists after the fix. The code now calls `worktreeManager.worktreeExists(taskId)` regardless of whether `isResumeAvailable` is defined, so this test would silently pass while testing removed behavior.

- [ ] **Step 6: Run all sendMessage tests**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "fix(orchestrator): allow resume when container expired but worktree exists

The isResumeAvailable pre-check rejected resumes when the Docker container was
gone, even though createWorker(continueSession=true) can create a fresh container
from the existing worktree. Now checks worktree existence directly via
worktreeManager.worktreeExists(taskId) — if worktree exists, proceed; otherwise
reject with not_found.

Fixes INT-1304"
```

### Task 2: Run full CI and verify

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`

- [ ] **Step 2: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`

Expected: All pass

- [ ] **Step 3: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`

Expected: All pass

- [ ] **Step 4: Final commit if any lint/coverage fixes needed**

Fix any issues found by CI and commit.
