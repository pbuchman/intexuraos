# PR Comment Routed to Planning Task — Investigation & Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dispatch pipeline so PR comments on plan PRs create a new `pull_request` task instead of being routed to the completed planning task.

**Architecture:** Three cascading bugs in the code-agent dispatch pipeline allow PR comments to be sent to planning tasks. The fix adds `'planning'` to exclusion filters in the repository query, the `sendTaskMessage` guard, and adds a `planning`-specific check in the dispatch service fallback path.

**Tech Stack:** TypeScript, Firestore, Fastify (code-agent app)

---

## Investigation Findings

### Incident Timeline (2026-04-14)

| Time (UTC) | Event                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| 17:32:32   | User posts comment on PR #1807: "Verify this plan against the most recent changes..."                |
| 17:32:34   | GitHub webhook fires `issue_comment` event → code-agent receives it                                  |
| 17:32:34   | Hard rules evaluate → `needs_triage` (TRIAGE_REQUIRED)                                               |
| 17:32:41   | LLM triage calls `dispatch_to_task` with `message_template: "pr_comment"`                            |
| 17:32:43   | Dispatch service calls `findLatestExecutionTaskByPR("pbuchman/intexuraos", 1807)`                    |
| 17:32:43   | **BUG:** Returns `task_1117706d` — the **planning** task for INT-1158 (agentType: `'planning'`)      |
| 17:32:43   | `handleExistingTask` sends comment as message to the planning task                                   |
| 17:32:43   | `sendTaskMessage` forwards to orchestrator → accepted (action: `resumed`)                            |
| 17:32:43   | Orchestrator resumes planning task with `continueSession: true`, rebuilds **planning system prompt** |
| 17:33:15   | Worker starts (attempt 1, workerType: opus)                                                          |
| 17:33:17   | Worker crashes — exit code 128 (git fatal error, worktree cleaned up)                                |
| 17:33:17   | Task marked failed: `TASK_RESUMED_HARD_ERROR`, "Non-zero exit code: 128"                             |
| 17:33:17   | PR task lock deleted, post-completion drain finds nothing                                            |
| —          | **Comment lost.** No pull_request task was ever created.                                             |

### Root Cause: 3 Cascading Bugs

**Bug 1: `findLatestExecutionTaskByPR` includes planning tasks**
- **File:** `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:1215`
- The filter excludes `review`, `remediation`, and merge-conflict tasks but explicitly includes `planning`
- The interface comment confirms this: "only returns planning, execution, or canonical pull_request tasks"
- A planning task that created a plan PR should never be the recipient of user PR comments — it ran with a planning system prompt and cannot handle PR review work

**Bug 2: `sendTaskMessage` allows messages to planning tasks**
- **File:** `apps/code-agent/src/domain/usecases/sendTaskMessage.ts:72`
- Guard blocks `review` and `remediation` but not `planning`
- Planning tasks should not receive arbitrary PR comment messages

**Bug 3: No fallback after resumed task crashes**
- **File:** `apps/code-agent/src/domain/services/gitHubDispatchService.ts:171-183`
- `handleExistingTask` returned `{ success: true }` because the orchestrator accepted the resume
- The `isStaleTaskError` check only runs when `success === false`
- When the planning task crashed 30 seconds later via the `/internal/webhooks/task-complete` callback, no fallback mechanism existed to create a replacement `pull_request` task
- The comment was silently lost

### Why Exit Code 128?

The orchestrator resumed the planning task with `continueSession: true`. This reuses the existing container and session. The planning task's worktree was on branch `plan/self-healing-failure-triage`, which had already been pushed and the planning work completed. When the resumed Claude Code agent tried to run git operations, the worktree state was incompatible (exit code 128 = git fatal error).

---

## Endpoint Changes

- **Modified:** None (no HTTP endpoints change)
- **Created:** None
- **Removed:** None
- **Unchanged:** All webhook endpoints remain the same

---

## File Structure

| File                                                                                   | Action | Responsibility                                                     |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`                | Modify | Add `'planning'` to `findLatestExecutionTaskByPR` exclusion filter |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`                        | Modify | Update interface JSDoc to reflect planning exclusion               |
| `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`                               | Modify | Add `'planning'` to the agentType guard                            |
| `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts` | Modify | Add test for planning task exclusion                               |
| `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`          | Modify | Add test for planning task fallback to new task                    |
| `apps/code-agent/src/__tests__/domain/useCases/sendTaskMessage.test.ts`                | Modify | Add test for planning task message rejection                       |

---

## Task 1: Exclude Planning Tasks from `findLatestExecutionTaskByPR`

**Files:**
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:1215`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts:216-219`
- Test: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test in the `findLatestExecutionTaskByPR` describe block that verifies planning tasks are skipped:

```typescript
it('should skip planning tasks and return null when only planning tasks exist', async () => {
  // Create a planning task with prNumber
  await repo.create({
    id: 'task_planning-1',
    userId: 'user-1',
    prompt: 'Plan something',
    sanitizedPrompt: 'Plan something',
    systemPromptHash: 'planning',
    workerType: 'auto',
    workerLocation: 'worker-1',
    repository: 'owner/repo',
    baseBranch: 'development',
    traceId: 'trace-1',
    agentType: 'planning',
    prNumber: 100,
  });

  const result = await repo.findLatestExecutionTaskByPR('owner/repo', 100);
  expect(result.ok).toBe(true);
  assert(result.ok);
  expect(result.value).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "should skip planning tasks"`
Expected: FAIL — currently planning tasks are returned, not skipped.

- [ ] **Step 3: Add `'planning'` to the exclusion filter in the Firestore implementation**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, change line 1215 from:

```typescript
if (agentType !== 'review' && agentType !== 'remediation' && !isMergeConflictTaskData(data)) {
```

to:

```typescript
if (agentType !== 'review' && agentType !== 'remediation' && agentType !== 'planning' && !isMergeConflictTaskData(data)) {
```

- [ ] **Step 4: Update the interface JSDoc**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, update the comment above `findLatestExecutionTaskByPR` from:

```typescript
/**
 * Excludes review, remediation, and merge-conflict follow-up tasks — only
 * returns planning, execution, or canonical pull_request tasks. Used to route
 * generic PR comments to existing tasks.
 * Treats tasks with missing agentType as execution-eligible (backward compatibility).
 */
```

to:

```typescript
/**
 * Excludes review, remediation, planning, and merge-conflict follow-up tasks —
 * only returns execution or canonical pull_request tasks. Used to route
 * generic PR comments to existing tasks.
 * Planning tasks are excluded because they run with a planning system prompt
 * and cannot handle PR comment work (plan PRs should create new pull_request tasks).
 * Treats tasks with missing agentType as execution-eligible (backward compatibility).
 */
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "should skip planning tasks"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
git commit -m "fix: exclude planning tasks from findLatestExecutionTaskByPR

Planning tasks that created plan PRs should not receive user PR comments.
The dispatch pipeline now skips planning tasks and falls through to
create a new pull_request task instead.

Fixes INT-1372"
```

---

## Task 2: Block Messages to Planning Tasks in `sendTaskMessage`

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/sendTaskMessage.ts:72`
- Test: `apps/code-agent/src/__tests__/domain/useCases/sendTaskMessage.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that verifies sending a message to a planning task returns `invalid_agent_type` error. Find the existing test for review/remediation rejection (around the `'should reject messages to review tasks'` test) and add a sibling:

```typescript
it('should reject messages to planning tasks', async () => {
  // Create a planning task
  const taskId = 'task_planning-msg';
  await deps.codeTaskRepo.create({
    id: taskId,
    userId: 'user-1',
    prompt: 'Plan something',
    sanitizedPrompt: 'Plan something',
    systemPromptHash: 'planning',
    workerType: 'auto',
    workerLocation: 'worker-1',
    repository: 'owner/repo',
    baseBranch: 'development',
    traceId: 'trace-1',
    agentType: 'planning',
  });

  const result = await sendTaskMessage(deps, {
    taskId,
    userId: 'user-1',
    message: 'Hello planning task',
  });

  expect(result.ok).toBe(false);
  assert(!result.ok);
  expect(result.error.code).toBe('invalid_agent_type');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/sendTaskMessage.test.ts -t "should reject messages to planning tasks"`
Expected: FAIL — currently planning tasks are not blocked.

- [ ] **Step 3: Add `'planning'` to the agentType guard**

In `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`, change line 72 from:

```typescript
if (task.agentType === 'review' || task.agentType === 'remediation') {
```

to:

```typescript
if (task.agentType === 'review' || task.agentType === 'remediation' || task.agentType === 'planning') {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/sendTaskMessage.test.ts -t "should reject messages to planning tasks"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/sendTaskMessage.ts apps/code-agent/src/__tests__/domain/useCases/sendTaskMessage.test.ts
git commit -m "fix: block sendTaskMessage to planning tasks

Planning tasks run with a planning system prompt and cannot handle
PR comment messages. Add 'planning' to the agentType guard alongside
review and remediation.

Fixes INT-1372"
```

---

## Task 3: Add Integration Test for Dispatch Fallback

**Files:**
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`

This task verifies the end-to-end behavior: when the only task for a PR is a planning task, the dispatch service should fall through to `handleNewTask` and create a new `pull_request` task.

- [ ] **Step 1: Write the integration test**

Find the existing test for `'should fall back to new task when existing task is stale'` and add a sibling test:

```typescript
it('should create new task when only a planning task exists for the PR', async () => {
  // Create a completed planning task with prNumber
  await deps.codeTaskRepo.create({
    id: 'task_planning-existing',
    userId: 'user-1',
    prompt: 'Plan the feature',
    sanitizedPrompt: 'Plan the feature',
    systemPromptHash: 'planning',
    workerType: 'opus',
    workerLocation: 'worker-1',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    agentType: 'planning',
    prNumber: 1807,
  });

  const event = buildPREvent({
    eventType: 'issue_comment',
    action: 'created',
    pullRequestNumber: 1807,
    repository: 'pbuchman/intexuraos',
    senderLogin: 'pbuchman',
    body: 'Verify this plan against recent changes',
  });

  const result = await dispatchService.dispatch({
    event,
    decision: { action: 'dispatch' } as any,
    logger: deps.logger,
  });

  expect(result.success).toBe(true);
  expect(result.dispatched).toBe(true);
  // Should have created a NEW task, not reused the planning one
  expect(result.taskId).not.toBe('task_planning-existing');
});
```

Note: Adapt the test helper (`buildPREvent`) to match the existing test patterns in the file. The exact helper name and shape may differ — read the test file first.

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts -t "should create new task when only a planning task exists"`
Expected: PASS — Task 1's fix in `findLatestExecutionTaskByPR` already makes this work.

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "test: verify PR comment on plan PR creates new pull_request task

Integration test confirming that when only a planning task exists for
a PR, the dispatch service creates a new pull_request task instead of
routing the comment to the planning task.

Fixes INT-1372"
```

---

## Task 4: Run Full CI Verification

- [ ] **Step 1: Build packages**

Run: `pnpm build`

- [ ] **Step 2: Run workspace verification for code-agent**

Run: `pnpm run verify:workspace:tracked -- code-agent`

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass.

- [ ] **Step 4: Final commit if any coverage fixes needed**

If v8 ignore comments are needed for any uncoverable branches, add them with valid exemption categories per CLAUDE.md rules.
