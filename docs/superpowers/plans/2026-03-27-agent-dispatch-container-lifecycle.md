# Agent Dispatch, Container Lifecycle & Remediation Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor agent dispatch so `@worker` comments route to `pull_request` (not `remediation`), preserve `pull_request` containers per-PR, rewrite the remediation prompt to mandate `/nitpick-nuker`, and remove dead code.

**Architecture:** Code-agent dispatch logic in `gitHubDispatchService.ts` removes the remediation fork. Orchestrator `task-dispatcher.ts` changes container preservation rules. Remediation system prompt in orchestrator replaces executing-plans with nitpick-nuker. Dead code (`CodeWorkerNitpickNukerTemplate`, `@model`) is removed.

**Tech Stack:** TypeScript, Fastify, Vitest, React (web app)

**Spec:** `docs/superpowers/specs/2026-03-27-agent-dispatch-container-lifecycle-design.md`

---

### Task 1: Remove @model directive

**Files:**
- Modify: `apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts`
- Modify: `apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`

- [ ] **Step 1: Update tests — remove @model, verify @worker still works**

In `dispatchWorkerTriage.test.ts`, find all test cases that use `@model`. Change them to expect `undefined` (unrecognized). Add an explicit test that `@model opus` returns `undefined`.

```typescript
it('should return undefined for @model directive (removed)', () => {
  expect(extractDispatchWorkerType('@model opus')).toBeUndefined();
  expect(extractDispatchWorkerType('fix this @model sonnet')).toBeUndefined();
});
```

Keep all `@worker` tests unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`
Expected: FAIL — `@model opus` still returns `'opus'`

- [ ] **Step 3: Remove @model from DISPATCH_WORKER_PATTERNS**

In `dispatchWorkerTriage.ts`:

```typescript
// Before:
export const DISPATCH_WORKER_PATTERNS = ['@worker', '@model'] as const;

// After:
export const DISPATCH_WORKER_PATTERNS = ['@worker'] as const;
```

Update the JSDoc on `extractDispatchWorkerType` — remove `@model` references.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/utils/dispatchWorkerTriage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/utils/dispatchWorkerTriage.ts apps/code-agent/src/__tests__/domain/utils/dispatchWorkerTriage.test.ts
git commit -m "refactor: remove @model directive, only @worker supported (INT-1130)"
```

---

### Task 2: Remove CodeWorkerNitpickNukerTemplate (dead code)

**Files:**
- Modify: `apps/code-agent/src/domain/services/gitHubMessageBuilder.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/gitHubMessageBuilder.test.ts`

- [ ] **Step 1: Delete template class and remove from builder**

In `gitHubMessageBuilder.ts`:

1. Delete the `CodeWorkerNitpickNukerTemplate` class (lines 122-133)
2. Remove `codeWorkerBots` parameter from `createWebhookMessageBuilder` signature (line 135)
3. Delete the `codeWorkerNitpickNukerTemplate` variable (line 139)
4. Delete the `if (event.eventType === 'pull_request_review' && codeWorkerBots.has(event.senderLogin))` block (lines 146-148)

The function signature becomes:
```typescript
export function createWebhookMessageBuilder(allowedBots: Set<string>): WebhookMessageBuilder {
```

- [ ] **Step 2: Update all callers of createWebhookMessageBuilder**

Search for all call sites passing `codeWorkerBots` and remove the second argument. Check:
- `apps/code-agent/src/services.ts`
- Test helpers in `__tests__/`

- [ ] **Step 3: Delete template test cases**

In `gitHubMessageBuilder.test.ts`, delete:
- The `CodeWorkerNitpickNukerTemplate` describe block (test at line 328)
- The `'routes code-worker review to nitpick-nuker template'` test (line 421-424)
- The `'does not route non-code-worker pull_request_review to nitpick-nuker template'` test (line 428)
- Update `createWebhookMessageBuilder` calls in remaining tests to remove the `codeWorkerBots` argument

- [ ] **Step 4: Run tests**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubMessageBuilder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/services/gitHubMessageBuilder.ts apps/code-agent/src/__tests__/domain/services/gitHubMessageBuilder.test.ts apps/code-agent/src/services.ts
git commit -m "refactor: remove dead CodeWorkerNitpickNukerTemplate (INT-1130)"
```

---

### Task 3: Reroute @worker from remediation to pull_request

**Files:**
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts`
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts`

- [ ] **Step 1: Add workerType to CreateTaskForPRRequest and write test**

In `createTaskForPR.test.ts`, add a test:

```typescript
it('passes workerType override to created task when provided', async () => {
  const result = await createTaskForPR(deps, {
    ...baseRequest,
    workerType: 'opus',
  });
  expect(result.ok).toBe(true);
  const createCall = (deps.codeTaskRepo.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  expect(createCall?.workerType).toBe('opus');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/useCases/createTaskForPR.test.ts -t "passes workerType"`
Expected: FAIL — `workerType` not on the request type

- [ ] **Step 3: Add workerType to CreateTaskForPRRequest**

In `createTaskForPR.ts`:

Add `workerType?: WorkerType` to `CreateTaskForPRRequest` interface.

In the task creation logic, when `request.workerType` is defined, use it instead of the default worker type resolution:

```typescript
const effectiveWorkerType = request.workerType ?? resolvedWorkerType;
```

Apply this before the `CreateTaskInput` is built.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/useCases/createTaskForPR.test.ts`
Expected: PASS

- [ ] **Step 5: Update gitHubDispatchService tests**

In `gitHubDispatchService.test.ts`:

1. Find tests that verify `@worker` routes to `createRemediationTask`. Change them to verify it routes to `createTaskForPR` with `workerType` set.
2. Add test: `@worker opus` comment creates pull_request task with `workerType: 'opus'`
3. Remove tests that assert `createRemediationTask` is called from dispatch for `@worker` comments

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: FAIL — dispatch still routes to remediation

- [ ] **Step 7: Rewrite dispatch() to remove remediation fork**

In `gitHubDispatchService.ts` `dispatch()` (around line 116-140):

Remove:
```typescript
const workerDirective = extractDispatchWorkerType(event.body ?? '');
const isRemediationDispatch = workerDirective !== undefined;

if (isRemediationDispatch) {
  // ... entire remediation dispatch block
}
```

Replace with:
```typescript
const workerDirective = extractDispatchWorkerType(event.body ?? '');
```

Then pass `workerDirective` to the `handleNewTask` / `createTaskForPR` path:

```typescript
const createResult = await createTaskForPR(
  { /* deps */ },
  {
    /* existing fields */
    ...(workerDirective !== undefined && { workerType: workerDirective }),
  }
);
```

Remove `createRemediationTask` from `DispatchDeps` interface (line 91) since dispatch no longer calls it.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/code-agent/src/domain/services/gitHubDispatchService.ts apps/code-agent/src/domain/usecases/createTaskForPR.ts apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts
git commit -m "feat: route @worker PR comments to pull_request agent type (INT-1130)"
```

---

### Task 4: Container preservation — make pull_request preservable

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Write test for pull_request container preservation**

In `task-dispatcher.test.ts`, add a test:

```typescript
it('preserves pull_request container on completion', async () => {
  // Create a pull_request task, complete it, verify preserveWorker was called
});
```

Also add a test that `review` and `remediation` are still NOT preserved.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts -t "preserves pull_request"`
Expected: FAIL — pull_request is currently non-preservable

- [ ] **Step 3: Update isNonPreservableAgentType**

In `task-dispatcher.ts` `finalizeTask()` (line 1879-1882):

```typescript
// Before:
const isNonPreservableAgentType =
    task.agentType === 'review' ||
    task.agentType === 'pull_request' ||
    task.agentType === 'remediation';

// After:
const isNonPreservableAgentType =
    task.agentType === 'review' ||
    task.agentType === 'remediation';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat: preserve pull_request containers after completion (INT-1130)"
```

---

### Task 5: One preserved pull_request container per PR

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/types/task.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Ensure prNumber is on Task type and populated during dispatch**

Check `workers/orchestrator/src/types/task.ts` — if `prNumber` is not on the `Task` interface, add it as `prNumber?: number`. The dispatch request from code-agent already sends PR number for pull_request tasks.

In `task-dispatcher.ts` `dispatch()` around line 360, ensure `prNumber` is spread from the request onto the task:

```typescript
...(request.prNumber !== undefined && { prNumber: request.prNumber }),
```

Also check `workers/orchestrator/src/types/api.ts` and `schemas.ts` — ensure `prNumber` is accepted in the dispatch request schema.

- [ ] **Step 2: Write test for one-per-PR enforcement**

```typescript
it('destroys existing preserved pull_request container for same PR before preserving new one', async () => {
  // Setup: preserved container for PR #100
  // Action: new pull_request task for PR #100 completes
  // Assert: old container destroyed, new one preserved
});

it('does not destroy preserved pull_request container for different PR', async () => {
  // Setup: preserved container for PR #100
  // Action: pull_request task for PR #200 completes
  // Assert: both containers preserved
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts -t "destroys existing preserved"`
Expected: FAIL

- [ ] **Step 4: Implement one-per-PR logic in finalizeTask**

In `task-dispatcher.ts` `finalizeTask()`, before `preserveWorker()` call (around line 1912):

```typescript
if (shouldPreserve && task.agentType === 'pull_request' && task.prNumber !== undefined) {
  const preserved = await this.isolation.provider.listPreservedWorkers?.() ?? [];
  for (const p of preserved) {
    const preservedTask = await this.statePersistence.load().then(s => s.tasks[p.taskId]);
    if (
      preservedTask !== undefined &&
      preservedTask.agentType === 'pull_request' &&
      preservedTask.prNumber === task.prNumber &&
      preservedTask.taskId !== task.taskId
    ) {
      this.logger.info(
        { oldTaskId: p.taskId, newTaskId: task.taskId, prNumber: task.prNumber },
        'Destroying previous preserved pull_request container for same PR'
      );
      await this.isolation.provider.destroyWorker(p.taskId);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/types/task.ts workers/orchestrator/src/types/api.ts workers/orchestrator/src/types/schemas.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat: enforce one preserved pull_request container per PR (INT-1130)"
```

---

### Task 6: sendMessage agentType guard

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Write tests**

```typescript
it('rejects sendMessage for review agentType', async () => {
  // Create task with agentType: 'review', status: 'completed'
  // Call sendMessage
  // Assert: error with type 'invalid_agent_type'
});

it('rejects sendMessage for remediation agentType', async () => {
  // Same pattern with agentType: 'remediation'
});

it('allows sendMessage for pull_request agentType', async () => {
  // Create task with agentType: 'pull_request', status: 'completed'
  // Call sendMessage
  // Assert: ok result
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts -t "rejects sendMessage"`
Expected: FAIL

- [ ] **Step 3: Add agentType guard in sendMessage**

In `task-dispatcher.ts` `sendMessage()`, after the `task === undefined` check (line 591), add:

```typescript
if (task.agentType === 'review' || task.agentType === 'remediation') {
  return {
    ok: false,
    error: {
      type: 'invalid_agent_type' as const,
      message: 'Cannot send messages to review/remediation tasks',
    },
  };
}
```

Update the `SendMessageError` type to include `'invalid_agent_type'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/types/task.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat: reject sendMessage for review/remediation agent types (INT-1130)"
```

---

### Task 7: Web UI — hide message input for review/remediation

**Files:**
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`

- [ ] **Step 1: Add agentType prop and guard**

The `CodeTaskLogViewer` component computes `showMessageInput` at line 238:

```typescript
// Before:
const showMessageInput = !readOnly && taskStatus !== 'cancelled' && onSendMessage !== undefined;

// After:
const isNonMessagableAgent = agentType === 'review' || agentType === 'remediation';
const showMessageInput = !readOnly && taskStatus !== 'cancelled' && onSendMessage !== undefined && !isNonMessagableAgent;
```

Add `agentType?: string` to the component's props interface. Thread it from the parent page (`CodeTaskViewPageV2.tsx`) which already has the task object.

- [ ] **Step 2: Add static label when hidden**

Below the `showMessageInput` conditional, add:

```tsx
{isNonMessagableAgent && !readOnly ? (
  <div className="rounded-b-lg border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
    Messages not available for {agentType} tasks
  </div>
) : null}
```

- [ ] **Step 3: Verify in browser (manual)**

Navigate to a review task in the web UI and confirm the message input is hidden and the label shows.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx apps/web/src/pages/CodeTaskViewPageV2.tsx
git commit -m "feat: hide message input for review/remediation tasks in web UI (INT-1130)"
```

---

### Task 8: Rewrite remediation prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

- [ ] **Step 1: Update system-prompt tests**

In `system-prompt.test.ts`, update the remediation prompt tests:

```typescript
it('does not include executing-plans or receiving-code-review in remediation prompt', () => {
  const result = remediationPrompt.build(baseParams);
  expect(result).not.toContain('superpowers:executing-plans');
  expect(result).not.toContain('superpowers:receiving-code-review');
});

it('includes mandatory nitpick-nuker instruction in remediation prompt', () => {
  const result = remediationPrompt.build(baseParams);
  expect(result).toContain('/nitpick-nuker');
  expect(result).toContain('mandatory execution step');
});

it('does not say system prompt is source of truth', () => {
  const result = remediationPrompt.build(baseParams);
  expect(result).not.toContain('source of truth');
});

it('has version 2.0.0', () => {
  expect(remediationPrompt.version).toBe('2.0.0');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter orchestrator exec vitest run src/services/__tests__/system-prompt.test.ts -t "remediation"`
Expected: FAIL

- [ ] **Step 3: Rewrite the remediation prompt**

In `system-prompt.ts`, replace the `remediationPrompt` build function body. Keep:
- The `[SYSTEM CONTEXT]` header, task ID, worktree, Linear issue
- `WORKER_INSTRUCTIONS`
- The existing PR continuation section (`existingPrSection`)
- The re-review decision section (PATCH call)
- The `REMEDIATION_AGENT_FINAL` completion block

Remove:
- "System prompt instructions are the source of truth. The user prompt is secondary context."
- The "Mandatory Skill Order" section (executing-plans, receiving-code-review)
- The "Remediation Scope (MANDATORY)" section
- The "Implementation Flow (strict order)" section
- "Read the routed Linear issue content AND all its comments, then the repository state, then address only the review findings routed into this task."

Add new sections:

```
[REMEDIATION AGENT MODE]
You are in NON-INTERACTIVE MODE. Execute the remediation autonomously.
System prompt defines your workflow and mandatory steps. The user prompt contains task context. Both are required.

Use the Linear MCP tools for all Linear operations. Do NOT use the /linear skill.

### Reading the Linear Issue (MANDATORY FIRST ACTION — NON-NEGOTIABLE)
[keep existing Linear reading instructions unchanged]

${COMMENT_DRIVEN_DECISION_LOG}

### Re-Review Decision (MANDATORY BEFORE NITPICK-NUKER)
[keep existing PATCH call instructions, update to say "before running nitpick-nuker"]

### Mandatory Execution: /nitpick-nuker (NON-NEGOTIABLE)

After reading the Linear issue and making the re-review decision, run:

/nitpick-nuker <prNumber>

This is the PRIMARY and MANDATORY execution step. The skill:
- Fetches all unprocessed review comments on the PR
- Triages each comment (FIX or SKIP)
- Implements fixes for actionable comments
- Runs CI and loops until green
- Posts a summary comment on the PR with results

Do NOT skip this step.
Do NOT attempt to manually fix review comments instead of running the skill.
Do NOT proceed to the completion block until nitpick-nuker has finished.
If nitpick-nuker reports no unprocessed comments, that is a valid outcome — proceed to completion.

${existingPrSection}
```

Bump version to `'2.0.0'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter orchestrator exec vitest run src/services/__tests__/system-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat: rewrite remediation prompt to mandate /nitpick-nuker (INT-1130)"
```

---

### Task 9: Remove pre-loaded findings from remediation prompt builder

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- Modify: `apps/code-agent/src/__tests__/usecases/createRemediationTask.test.ts`
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts`

- [ ] **Step 1: Update createRemediationTask tests**

In `createRemediationTask.test.ts`:

1. Remove tests that assert `reviewBody` appears in the prompt
2. Remove tests that assert `inlineComments` appear in the prompt
3. Remove tests that assert `triggerComment` appears in the prompt
4. Add test: prompt does NOT contain "### Review Findings" or "### Inline Comments"

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/usecases/createRemediationTask.test.ts`
Expected: FAIL

- [ ] **Step 3: Simplify buildRemediationPrompt**

In `createRemediationTask.ts`, rewrite `buildRemediationPrompt()`:

Remove the `triggerComment`, `reviewBody`, and `inlineComments` sections from the prompt builder. The prompt should only contain:
- Task header (repository, PR number, worker type)
- "Created automatically to address review feedback"
- Instructions (simplified — nitpick-nuker handles the actual work)
- Constraints (no unrelated changes, no new PRs)

Remove from `CreateRemediationTaskRequest`:
- `triggerComment?: { body: string; author: string }`
- `reviewBody?: string`
- `inlineComments?: { path: string; line: number; body: string }[]`

- [ ] **Step 4: Clean up callers in webhookRoutes.ts**

In `webhookRoutes.ts`, find the `createRemediationTaskFn` call (around line 1225). Remove:
- The `enrichReviewWithComments` call and its surrounding logic
- The `reviewBody` and `inlineComments` fields from the request object
- The `triggerComment` field

The call simplifies to:
```typescript
const remediationResult = await createRemediationTaskFn(
  remediationLogger,
  {
    repository: task.repository,
    prNumber,
    senderLogin: task.repository.split('/')[0] ?? task.userId,
    workerType: 'auto',
    eventId: taskId,
    ...(task.baseBranch !== undefined && { baseBranch: task.baseBranch }),
  },
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/usecases/createRemediationTask.test.ts`
Expected: PASS

- [ ] **Step 6: Run full webhooks test suite**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/routes/webhooks.test.ts`
Expected: PASS (some tests may need updating if they assert on the removed fields)

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/usecases/createRemediationTask.ts apps/code-agent/src/__tests__/usecases/createRemediationTask.test.ts apps/code-agent/src/routes/webhookRoutes.ts
git commit -m "refactor: remove pre-loaded findings from remediation prompt (INT-1130)"
```

---

### Task 10: Preserved container reuse for non-@worker PR comments

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` (interface)
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`

- [ ] **Step 1: Add findPreservedPullRequestTask to repository interface**

In `codeTaskRepository.ts`, add to the interface:

```typescript
findPreservedPullRequestTask(
  repository: string,
  prNumber: number,
): Promise<Result<{ id: string; workerLocation: string } | null, RepositoryError>>;
```

- [ ] **Step 2: Write Firestore repository test**

```typescript
it('finds preserved pull_request task for PR', async () => {
  // Create a task with agentType: 'pull_request', status: 'implemented', prNumber: 42
  // Call findPreservedPullRequestTask('repo', 42)
  // Assert: returns the task
});

it('returns null when no preserved pull_request task exists', async () => {
  // Call findPreservedPullRequestTask for a PR with no matching task
  // Assert: returns null
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "preserved pull_request"`
Expected: FAIL

- [ ] **Step 4: Implement in firestoreCodeTaskRepository**

Query: `code_tasks` where `repository == X`, `prNumber == Y`, `agentType == 'pull_request'`, `status == 'implemented'`, ordered by `completedAt` desc, limit 1.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "preserved pull_request"`
Expected: PASS

- [ ] **Step 6: Write dispatch service test for reuse**

```typescript
it('sends message to preserved container for non-@worker comment', async () => {
  // Setup: codeTaskRepo.findPreservedPullRequestTask returns a task
  // Setup: orchestrator sendMessage mock returns success
  // Action: dispatch a comment without @worker
  // Assert: sendMessage called, createTaskForPR NOT called
});

it('falls through to createTaskForPR when sendMessage fails', async () => {
  // Setup: findPreservedPullRequestTask returns a task
  // Setup: sendMessage returns error
  // Action: dispatch a comment without @worker
  // Assert: createTaskForPR called
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts -t "preserved container"`
Expected: FAIL

- [ ] **Step 8: Implement reuse logic in dispatch()**

In `gitHubDispatchService.ts`, in the `handleNewTask` path (before `createTaskForPR`), add:

```typescript
// Check for preserved pull_request container to reuse
if (workerDirective === undefined) {
  const preservedResult = await deps.codeTaskRepo.findPreservedPullRequestTask(
    event.repository,
    event.pullRequestNumber,
  );
  if (preservedResult.ok && preservedResult.value !== null) {
    const preserved = preservedResult.value;
    try {
      // Send message to orchestrator
      const sendResult = await sendTaskMessageToOrchestrator(
        deps, logger, preserved.id, preserved.workerLocation, comment,
      );
      if (sendResult.ok) {
        return { success: true, dispatched: true };
      }
      logger.warn({ taskId: preserved.id, error: sendResult.error }, 'Failed to send message to preserved container, falling through to new task');
    } catch (error) {
      logger.warn({ taskId: preserved.id, error }, 'Error sending to preserved container, falling through');
    }
  }
}
```

The `sendTaskMessageToOrchestrator` helper calls the orchestrator's `POST /tasks/:taskId/message` endpoint. Check if `sendTaskMessage` use case already does this — if so, reuse it.

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts apps/code-agent/src/domain/services/gitHubDispatchService.ts apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "feat: reuse preserved pull_request container for non-@worker comments (INT-1130)"
```

---

### Task 11: @worker kills preserved container before creating new task

**Files:**
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`

- [ ] **Step 1: Write test**

```typescript
it('destroys preserved container when @worker comment arrives', async () => {
  // Setup: findPreservedPullRequestTask returns task-old
  // Action: dispatch comment with @worker opus
  // Assert: orchestrator cancel/destroy called for task-old
  // Assert: createTaskForPR called with workerType: 'opus'
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts -t "destroys preserved"`
Expected: FAIL

- [ ] **Step 3: Implement in dispatch()**

In the `dispatch()` function, when `workerDirective !== undefined` (before `createTaskForPR`):

```typescript
if (workerDirective !== undefined) {
  const preservedResult = await deps.codeTaskRepo.findPreservedPullRequestTask(
    event.repository,
    event.pullRequestNumber,
  );
  if (preservedResult.ok && preservedResult.value !== null) {
    const preserved = preservedResult.value;
    logger.info({ taskId: preserved.id, prNumber: event.pullRequestNumber }, 'Destroying preserved container for @worker directive');
    try {
      await cancelTaskOnOrchestrator(deps, logger, preserved.id, preserved.workerLocation);
    } catch (error) {
      logger.warn({ taskId: preserved.id, error }, 'Failed to destroy preserved container (best-effort)');
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/services/gitHubDispatchService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/services/gitHubDispatchService.ts apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "feat: @worker directive destroys preserved pull_request container (INT-1130)"
```

---

### Task 12: PR merge/close cleanup

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/handlePrMerge.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/handlePrMerge.test.ts`

- [ ] **Step 1: Write test**

```typescript
it('destroys preserved pull_request container on PR merge', async () => {
  // Setup: findPreservedPullRequestTask returns a task
  // Action: handlePrMerge for that PR
  // Assert: orchestrator destroy called for the task
});

it('does not fail if no preserved container exists', async () => {
  // Setup: findPreservedPullRequestTask returns null
  // Action: handlePrMerge
  // Assert: completes without error
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/useCases/handlePrMerge.test.ts -t "destroys preserved"`
Expected: FAIL

- [ ] **Step 3: Add cleanup to handlePrMerge**

In `handlePrMerge.ts`, after the existing Linear issue transition logic, add:

```typescript
// Best-effort: destroy preserved pull_request container for merged PR
try {
  const preservedResult = await deps.codeTaskRepo.findPreservedPullRequestTask(input.repository, input.prNumber);
  if (preservedResult.ok && preservedResult.value !== null) {
    const preserved = preservedResult.value;
    deps.logger.info({ taskId: preserved.id, prNumber: input.prNumber }, 'Destroying preserved container for merged PR');
    await cancelTaskOnOrchestrator(deps, preserved.id, preserved.workerLocation);
  }
} catch (error) {
  deps.logger.warn({ prNumber: input.prNumber, error }, 'Failed to cleanup preserved container on PR merge (best-effort)');
}
```

Add the orchestrator HTTP client to `HandlePrMergeDeps`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/domain/useCases/handlePrMerge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/handlePrMerge.ts apps/code-agent/src/__tests__/domain/useCases/handlePrMerge.test.ts
git commit -m "feat: destroy preserved pull_request containers on PR merge (INT-1130)"
```

---

### Task 13: Internal API for pruned task fallback

**Files:**
- Modify: `apps/code-agent/src/routes/internalRoutes.ts`
- Modify: `apps/code-agent/src/__tests__/routes/internalRoutes.test.ts` (or create new test file)

- [ ] **Step 1: Write test**

```typescript
it('GET /internal/tasks/:taskId/dispatch-metadata returns task metadata', async () => {
  // Setup: create a task in Firestore
  // Action: GET /internal/tasks/task_xxx/dispatch-metadata
  // Assert: 200 with { taskId, prompt, repository, baseBranch, agentType, workerType, prNumber }
});

it('returns 404 for unknown task', async () => {
  // Action: GET /internal/tasks/task_unknown/dispatch-metadata
  // Assert: 404
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/routes/internalRoutes.test.ts -t "dispatch-metadata"`
Expected: FAIL

- [ ] **Step 3: Add endpoint**

In `internalRoutes.ts`, add:

```typescript
fastify.get<{ Params: { taskId: string } }>(
  '/internal/tasks/:taskId/dispatch-metadata',
  {
    schema: {
      params: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
    },
  },
  async (request, reply) => {
    const { codeTaskRepo } = getServices();
    const result = await codeTaskRepo.findById(request.params.taskId);
    if (!result.ok || result.value === null) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    const task = result.value;
    return reply.send({
      taskId: task.id,
      prompt: task.prompt,
      repository: task.repository,
      baseBranch: task.baseBranch,
      agentType: task.agentType,
      workerType: task.workerType,
      linearIssueId: task.linearIssueId,
      webhookSecret: task.webhookSecret,
      prNumber: task.prNumber,
    });
  },
);
```

Add `X-Internal-Auth` validation (same pattern as existing internal routes).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter code-agent exec vitest run src/__tests__/routes/internalRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Note on orchestrator-side consumer**

The orchestrator's `sendMessage()` in `task-dispatcher.ts` is inside a `v8 ignore` block (requires Docker to test). When a taskId is not found in state persistence, it should call this endpoint to reconstruct the task. This is an integration-level change that will be verified during manual testing — add a `// TODO(INT-1130): call code-agent /internal/tasks/:id/dispatch-metadata when task not in state` comment at the `task === undefined` check in `sendMessage()` (line 591-592).

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/internalRoutes.ts apps/code-agent/src/__tests__/routes/internalRoutes.test.ts
git commit -m "feat: add GET /internal/tasks/:id/dispatch-metadata endpoint (INT-1130)"
```

---

### Task 14: Full CI verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int1130.txt`
Expected: PASS

- [ ] **Step 3: Fix any failures**

If any workspace fails, analyze with `rg "error|FAIL" /tmp/ci-output-int1130.txt -C3` and fix.

- [ ] **Step 4: Final commit if needed**

Only if CI fixes were required.
