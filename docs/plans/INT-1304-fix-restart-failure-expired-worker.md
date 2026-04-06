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
|  |
| +-----------+ |
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
    +--- preservedWorkers? ---> restore
    +--- Docker orphan? ---> reuse if running, remove+recreate if stopped
    +--- Nothing? ---> create fresh container from worktree
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

| File                                                                            | Action   | Responsibility                                                           |
| ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `workers/orchestrator/src/services/task-dispatcher.ts`                          | Modify   | Replace `isResumeAvailable` check with worktree existence check          |
| `workers/orchestrator/src/services/isolation/docker-provider.ts`                | Modify   | Add `isWorktreeAvailable(taskId)` method (or expose worktree path check) |
| `workers/orchestrator/src/services/worktree-manager.ts`                         | Modify   | Add `hasWorktree(taskId)` method                                         |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`                    | Modify   | Update tests for new resume behavior                                     |
| `workers/orchestrator/src/__tests__/services/isolation/docker-provider.test.ts` | Modify   | Add test for `isWorktreeAvailable`                                       |

## Endpoint Changes

- **Modified:** None (behavior change only)
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /tasks/:id/message` — now accepts resume for tasks where worktree exists even if container is gone (returns 200 + `{ action: 'resumed' }` instead of 404)

---

### Task 1: Add `hasWorktree` method to WorktreeManager

**Files:**
- Modify: `workers/orchestrator/src/services/worktree-manager.ts`
- Modify: `workers/orchestrator/src/__tests__/services/worktree-manager.test.ts` (if exists, otherwise create)

- [ ] **Step 1: Read the WorktreeManager to understand worktree path construction**

Read `workers/orchestrator/src/services/worktree-manager.ts` and find how worktree paths are computed. The path is typically `{worktreeBasePath}/{taskId}`.

- [ ] **Step 2: Write the failing test for `hasWorktree`**

Add a test that calls `hasWorktree(taskId)` and expects `true` when the worktree directory exists, `false` when it doesn't:

```typescript
describe('hasWorktree', () => {
  it('returns true when worktree directory exists', async () => {
    // Create a fake worktree directory
    await fs.mkdir(path.join(worktreeBasePath, 'task_exists'), { recursive: true });

    const result = await worktreeManager.hasWorktree('task_exists');
    expect(result).toBe(true);
  });

  it('returns false when worktree directory does not exist', async () => {
    const result = await worktreeManager.hasWorktree('task_nonexistent');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/services/worktree-manager.test.ts`

Expected: FAIL — `hasWorktree is not a function`

- [ ] **Step 4: Implement `hasWorktree` method**

In `worktree-manager.ts`, add:

```typescript
async hasWorktree(taskId: string): Promise<boolean> {
  const worktreePath = path.join(this.worktreeBasePath, taskId);
  try {
    await fs.access(worktreePath);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/services/worktree-manager.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/worktree-manager.ts workers/orchestrator/src/__tests__/services/worktree-manager.test.ts
git commit -m "feat(orchestrator): add hasWorktree method to WorktreeManager"
```

---

### Task 2: Expose worktree check via IsolationProvider interface

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`
- Read: `workers/orchestrator/src/services/task-dispatcher.ts` (to understand isolation interface)

The `task-dispatcher.ts` accesses isolation via `this.isolation.provider` (IsolationProvider interface). We need to expose the worktree check through this interface.

- [ ] **Step 1: Read the IsolationProvider interface definition**

Search for the `IsolationProvider` type/interface in the orchestrator code to understand what methods it exposes. The `isolation` object is passed to `TaskDispatcher` and contains `provider` + other fields.

- [ ] **Step 2: Add `isResumeWorktreeAvailable` to the provider interface**

Add the method to whatever interface/type defines the provider. This method delegates to `worktreeManager.hasWorktree()`:

```typescript
isResumeWorktreeAvailable?(taskId: string): Promise<boolean>;
```

Note: Use optional method (`?`) to maintain backward compatibility with any other provider implementations.

- [ ] **Step 3: Implement `isResumeWorktreeAvailable` in DockerProvider**

```typescript
async isResumeWorktreeAvailable(taskId: string): Promise<boolean> {
  return await this.worktreeManager.hasWorktree(taskId);
}
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/services/isolation/docker-provider.test.ts`

Expected: PASS (no existing tests break)

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/docker-provider.ts
git commit -m "feat(orchestrator): expose isResumeWorktreeAvailable on DockerProvider"
```

---

### Task 3: Replace `isResumeAvailable` with worktree check in `sendMessage`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

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
  mockProvider.isResumeWorktreeAvailable.mockResolvedValue(true);

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
const hasWorktree = (await this.isolation.provider.isResumeWorktreeAvailable?.(taskId)) ?? false;
if (!hasWorktree) {
  // Also check isResumeAvailable as fallback — container might exist without worktree
  // (e.g., preserved containers that still have bind-mounted worktree)
  const hasContainer = (await this.isolation.provider.isResumeAvailable?.(taskId)) ?? false;
  if (!hasContainer) {
    return {
      ok: false,
      error: { type: 'not_found', message: 'Worker container and worktree no longer available for resume' },
    };
  }
}
```

This logic: if worktree exists → proceed (container will be created). If worktree is gone → check if container exists (preserved with bind mount). If neither → reject.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "resumes task when container is gone but worktree exists"`

Expected: PASS

- [ ] **Step 5: Update the existing not_found test**

The existing test `'returns not_found when container is no longer available for resume'` needs to also mock `isResumeWorktreeAvailable` returning `false`:

```typescript
mockProvider.isResumeAvailable.mockResolvedValue(false);
mockProvider.isResumeWorktreeAvailable.mockResolvedValue(false);
```

And update the expected error message to match the new text: `'Worker container and worktree no longer available for resume'`.

- [ ] **Step 6: Add test — resume fails when both container and worktree are gone**

```typescript
it('returns not_found when both container and worktree are gone', async () => {
  // ... setup task in terminal state ...

  mockProvider.isResumeAvailable.mockResolvedValue(false);
  mockProvider.isResumeWorktreeAvailable.mockResolvedValue(false);

  const result = await dispatcher.sendMessage('task-id', 'Resume');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('not_found');
    expect(result.error.message).toContain('no longer available for resume');
  }
});
```

- [ ] **Step 7: Run all sendMessage tests**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "fix(orchestrator): allow resume when container expired but worktree exists

The isResumeAvailable pre-check rejected resumes when the Docker container was
gone, even though createWorker(continueSession=true) can create a fresh container
from the existing worktree. Now checks for worktree existence first, falling back
to container check only when worktree is gone.

Fixes INT-1304"
```

---

### Task 4: Update mock provider in all test files

**Files:**
- Modify: Any test files that mock the `IsolationProvider` (search for `isResumeAvailable` mock)

The new `isResumeWorktreeAvailable` method needs to be added to all mock providers to avoid TypeScript errors.

- [ ] **Step 1: Search for all mock provider setups**

Run: `rg "isResumeAvailable" workers/orchestrator/src/__tests__/ --files-with-matches`

- [ ] **Step 2: Add `isResumeWorktreeAvailable` mock to each file**

For each file found, add `isResumeWorktreeAvailable: vi.fn(async () => true)` next to the existing `isResumeAvailable` mock. Default to `true` so existing tests (which assume resume is available) continue to pass.

- [ ] **Step 3: Run full orchestrator test suite**

Run: `cd /repo && pnpm vitest run workers/orchestrator/`

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/__tests__/
git commit -m "test(orchestrator): add isResumeWorktreeAvailable mock to all test providers"
```

---

### Task 5: Run full CI and verify

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
