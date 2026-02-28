# Add 'Review' Agent Type to Code Task Workflow

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `review` as a new `AgentType` value for code tasks, triggered when PR/issue comments require worker execution.

**Architecture:** Extend the existing `AgentType` union type from `'planning' | 'execution' | 'pull_request'` to include `'review'`. Update all type definitions, UI components, system prompts, dispatchers, and usecases. The `review` type will be used when PR reviews or issue comments trigger task creation, replacing the current `pull_request` usage in comment-triggered scenarios.

**Tech Stack:** TypeScript, React (web app), Fastify (code-agent), Pino logging

---

## Parallel Work Breakdown

This task can be parallelized into 3 independent workstreams:

| Workstream            | Services/Packages                                                     | Dependencies                   |
| --------------------- | --------------------------------------------------------------------- | ------------------------------ |
| **A: Types & Models** | `code-agent/domain/models`, `web/types`                               | None                           |
| **B: Orchestrator**   | `workers/orchestrator`                                                | Workstream A (for type import) |
| **C: Business Logic** | `code-agent/domain/usecases`, `code-agent/routes`, `code-agent/infra` | Workstream A (for type import) |

**Sequential constraint:** Workstream A must complete first. Then B and C can run in parallel.

---

## Task 1: Update AgentType in Domain Model

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:21`
- Test: `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`

**Step 1: Write the failing test**

```typescript
// In codeTask.test.ts, add test for valid AgentType values
describe('AgentType', () => {
  it('should accept review as valid agent type', () => {
    const agentType: AgentType = 'review';
    expect(['planning', 'execution', 'pull_request', 'review']).toContain(agentType);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run codeTask.test.ts`
Expected: FAIL with type error (AgentType doesn't include 'review')

**Step 3: Update the AgentType definition**

```typescript
// apps/code-agent/src/domain/models/codeTask.ts:21
export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run codeTask.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/__tests__/domain/models/codeTask.test.ts
git commit -m "feat(code-agent): add 'review' to AgentType union"
```

---

## Task 2: Update Web App Type Definition

**Files:**
- Modify: `apps/web/src/types/index.ts:1177`

**Step 1: Update the agentType field in CodeTask interface**

```typescript
// apps/web/src/types/index.ts:1177
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck to verify**

Run: `pnpm --filter web typecheck`
Expected: PASS (no breaking changes)

**Step 3: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(web): add 'review' to agentType in CodeTask type"
```

---

## Task 3: Update Repository CreateTaskInput Type

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts:41`

**Step 1: Update the agentType field**

```typescript
// apps/code-agent/src/domain/repositories/codeTaskRepository.ts:41
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck**

Run: `pnpm --filter code-agent typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts
git commit -m "feat(code-agent): add 'review' to CreateTaskInput agentType"
```

---

## Task 4: Update Task Dispatcher Service Interface

**Files:**
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts:49`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts:51`

**Step 1: Update domain service interface**

```typescript
// apps/code-agent/src/domain/services/taskDispatcher.ts:49
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Update infrastructure implementation**

```typescript
// apps/code-agent/src/infra/services/taskDispatcherImpl.ts:51
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 3: Run typecheck**

Run: `pnpm --filter code-agent typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/code-agent/src/domain/services/taskDispatcher.ts apps/code-agent/src/infra/services/taskDispatcherImpl.ts
git commit -m "feat(code-agent): add 'review' to TaskDispatcher agentType"
```

---

## Task 5: Update Route Schema Enums

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:65`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:163`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:212`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:1221`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:1365`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:1622`

**Step 1: Update all agentType enum declarations**

Search for `enum: ['planning', 'execution', 'pull_request']` and update to:

```typescript
enum: ['planning', 'execution', 'pull_request', 'review']
```

Also update TypeScript type annotations like:
```typescript
agentType: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck**

Run: `pnpm --filter code-agent typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts
git commit -m "feat(code-agent): add 'review' to route schema enums"
```

---

## Task 6: Update Orchestrator System Prompt Types

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:11`

**Step 1: Update SystemPromptParams interface**

```typescript
// workers/orchestrator/src/services/system-prompt.ts:11
agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run typecheck**

Run: `pnpm --filter orchestrator typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts
git commit -m "feat(orchestrator): add 'review' to SystemPromptParams agentType"
```

---

## Task 7: Add Review System Prompt Builder

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

**Step 1: Write the failing test**

```typescript
// Add test for review agent type
it('should build review prompt when agentType is review', () => {
  const prompt = buildSystemPrompt({
    taskId: 'task_123',
    linearIssueLabels: [],
    hasChildren: false,
    agentType: 'review',
  });

  expect(prompt).toContain('[AGENT:REVIEW]');
  expect(prompt).toContain('[REVIEW AGENT MODE]');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter orchestrator test -- --run system-prompt.test.ts`
Expected: FAIL (no review prompt implemented yet)

**Step 3: Implement buildReviewPrompt function**

Add before `buildSystemPrompt`:

```typescript
function buildReviewPrompt(params: SystemPromptParams): string {
  const { taskId, linearIssueId, linearIssueTitle, taskUrl, workerType } = params;

  /* v8 ignore start -- source-map: template conditional branches are misattributed after bundling/source-map transforms @preserve */
  return `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS running in Docker isolation.
[WORKER-MODE]
[AGENT:REVIEW]
Task ID: ${taskId}
Worktree: /repo
${linearIssueId !== undefined ? `Linear Issue: ${linearIssueId}` : ''}

[REVIEW AGENT MODE]
You are in NON-INTERACTIVE MODE. Execute the task autonomously.

This task was triggered by a PR review or issue comment. Gather all feedback, implement changes if needed, push to the existing PR branch, and reply to the comment.

### Gathering Feedback (MANDATORY)

When the user mentions reviews, comments, suggestions, or feedback, you MUST search ALL of these sources:

1. **PR reviews** — \`gh api /repos/{owner}/{repo}/pulls/{pr_number}/reviews\`
2. **PR comments** (review-level and inline) — \`gh api /repos/{owner}/{repo}/pulls/{pr_number}/comments\`
3. **Issue comments** — \`gh api /repos/{owner}/{repo}/issues/{pr_number}/comments\`

All three are MANDATORY. PR reviews and PR comments alone are NOT sufficient — issue comments often contain critical feedback that does not appear in the review thread. Skipping any source means missing feedback.

### PR Description Update
- Linear: [${linearIssueId ?? 'INT-XXX'}${linearIssueTitle !== undefined ? ` ${linearIssueTitle}` : ''}](https://linear.app/pbuchman/issue/${linearIssueId ?? 'INT-XXX'})
${taskUrl !== undefined ? `- IntexuraOS Code Task: [View task](${taskUrl})` : ''}
- Worker Type: \`${workerType ?? '<auto|opus|sonnet|minimax|glm>'}\`

### Tracking Comment (MANDATORY)

Your FIRST action must be to post a tracking comment on the PR:

gh api /repos/{owner}/{repo}/issues/{pr_number}/comments -f body="..."

The comment must contain:
- What you plan to do (1-3 bullet points summarizing the task)
${taskUrl !== undefined ? `- A link to the live task console: [View progress](${taskUrl})` : ''}

Save the comment ID from the response — you will need it to update this comment later.

Your LAST action before outputting REVIEW_AGENT_FINAL must be to UPDATE this same comment with:
- What you actually did (1-3 bullet points)
- Outcome: commits pushed / no changes needed / etc.
${taskUrl !== undefined ? `- Link to the task console: [View task](${taskUrl})` : ''}

Use: gh api -X PATCH /repos/{owner}/{repo}/issues/comments/{comment_id} -f body="..."

### Completion Criteria (MANDATORY LAST MESSAGE)

Your LAST message must include exactly this block:

\`\`\`
REVIEW_AGENT_FINAL:
- PR: <full GitHub PR URL>
- CI evidence: pnpm run ci:tracked successful
- Linear issue: <full Linear URL>
- Comment replied: <yes|no>
- Tracking comment: <updated|not_applicable>
- Summary: <3-5 sentences on one line: objective narrative of what you investigated, implemented, and delivered>
\`\`\`

After this block, stop. Do not append any other checklist or schema payload.`;
  /* v8 ignore stop @preserve */
}
```

**Step 4: Update buildSystemPrompt to handle 'review'**

Update the function to route to `buildReviewPrompt`:

```typescript
export function buildSystemPrompt(params: SystemPromptParams): string {
  const isPRComment = params.linearIssueLabels.some(
    (label) => label.trim().toLowerCase() === 'pr-comment'
  );
  if (isPRComment) {
    return buildPullRequestPrompt(params);
  }

  // Handle explicit review agent type
  if (params.agentType === 'review') {
    return buildReviewPrompt(params);
  }

  const resolvedAgentType =
    params.agentType ?? (hasCodeTaskLabel(params.linearIssueLabels) ? 'execution' : 'planning');

  const overlay = buildPRReviewOverlay(params);

  if (resolvedAgentType === 'planning') {
    return buildPlanningPrompt(params) + overlay;
  }

  return buildExecutionPrompt(params) + overlay;
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter orchestrator test -- --run system-prompt.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): add buildReviewPrompt for review agent type"
```

---

## Task 8: Update Web App UI to Display Review Badge

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx:302-310`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx:300-308`

**Step 1: Update CodeTasksPage.tsx badge rendering**

Replace the existing conditional badge rendering:

```tsx
{task.agentType === 'planning' ? (
  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
    Planning
  </span>
) : task.agentType === 'execution' ? (
  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
    Execution
  </span>
) : task.agentType === 'review' ? (
  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
    Review
  </span>
) : task.agentType === 'pull_request' ? (
  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
    PR
  </span>
) : null}
```

**Step 2: Update CodeTaskViewPage.tsx with same badge pattern**

Apply the same changes to `CodeTaskViewPage.tsx`.

**Step 3: Run build to verify**

Run: `pnpm --filter web build`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/pages/CodeTasksPage.tsx apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "feat(web): add Review and PR badges to task list and detail views"
```

---

## Task 9: Update Webhook Routes for Review Agent Completion

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

**Step 1: Write failing test**

```typescript
it('should handle review agent completion', async () => {
  // Create a task with agentType: 'review'
  const mockTask = createMockTask({ agentType: 'review', status: 'running' });
  mockCodeTaskRepo.findById.mockResolvedValue(ok(mockTask));
  mockCodeTaskRepo.update.mockResolvedValue(ok({ ...mockTask, status: 'implemented' }));

  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    headers: { 'x-webhook-signature': validSignature },
    payload: {
      taskId: mockTask.id,
      status: 'completed',
      result: { prUrl: 'https://github.com/org/repo/pull/1', comment_replied: true },
    },
  });

  expect(response.statusCode).toBe(200);
  expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
    mockTask.id,
    expect.objectContaining({ status: 'implemented' })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run webhooks.test.ts`
Expected: May PASS if existing logic handles it, or FAIL if specific handling needed

**Step 3: Update webhook route to handle 'review' agent type**

In `webhookRoutes.ts`, find the completion handling logic and ensure `'review'` is treated like `'execution'` or `'pull_request'`:

```typescript
// Around line 688, update the resolvedStatus logic
const resolvedStatus =
  result?.planning_outcome_label === 'planned'
    ? 'planned'
    : task.agentType === 'execution' || task.agentType === 'pull_request' || task.agentType === 'review'
      ? 'implemented'
      : 'planned';
```

Also update around line 708:
```typescript
if (task.agentType !== 'execution' && task.agentType !== 'pull_request' && task.agentType !== 'review' && prNumber !== undefined && task.linearIssueId !== undefined) {
```

**Step 4: Run tests to verify**

Run: `pnpm --filter code-agent test -- --run webhooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "feat(code-agent): handle 'review' agent type in webhook completion"
```

---

## Task 10: Update createTaskForPR to Use 'review' Agent Type

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createTaskForPR.ts:227`
- Test: `apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts`

**Step 1: Write failing test**

```typescript
it('should create task with review agentType for PR comments', async () => {
  // ... setup mocks ...

  const result = await createTaskForPR(deps, request);

  expect(result.ok).toBe(true);
  expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'review',
    })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run createTaskForPR.test.ts`
Expected: FAIL (currently uses 'pull_request')

**Step 3: Update agentType to 'review'**

Change line 227 in `createTaskForPR.ts`:
```typescript
// Before: agentType: 'pull_request',
agentType: 'review',
```

Also update line 320 in the dispatch call:
```typescript
// Before: agentType: 'pull_request',
agentType: 'review',
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run createTaskForPR.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/createTaskForPR.ts apps/code-agent/src/__tests__/domain/useCases/createTaskForPR.test.ts
git commit -m "feat(code-agent): use 'review' agentType for PR comment tasks"
```

---

## Task 11: Update submitTaskFeedback for Review Agent Type

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts:216-218`
- Test: `apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts`

**Step 1: Update agentType determination logic**

The current logic preserves `pull_request` for follow-ups. Update to also preserve `review`:

```typescript
const agentType: 'planning' | 'execution' | 'pull_request' | 'review' =
  originalTask.agentType === 'pull_request'
    ? 'pull_request'
    : originalTask.agentType === 'review'
      ? 'review'
      : hasCodeTaskLabel(linearIssueLabelsForDispatch) ? 'execution' : 'planning';
```

**Step 2: Update type annotations**

Update all other locations in the file that reference the agentType union:
- Line 331: `agentType: 'planning' | 'execution' | 'pull_request' | 'review';`
- Line 345: ensure it handles all types

**Step 3: Run tests**

Run: `pnpm --filter code-agent test -- --run submitTaskFeedback.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitTaskFeedback.ts apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts
git commit -m "feat(code-agent): preserve 'review' agentType in submitTaskFeedback"
```

---

## Task 12: Update retryTask for Review Agent Type

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts:282`
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts:321`
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts:335`
- Test: `apps/code-agent/src/__tests__/usecases/retryTask.test.ts`

**Step 1: Update type annotations**

Update line 321:
```typescript
agentType: 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Update retry logic to preserve review type**

The retry should preserve the original task's agentType if it was 'review':

```typescript
// Around line 282, ensure review is preserved
const agentType = originalTask.agentType === 'review'
  ? 'review' as const
  : originalTask.agentType === 'pull_request'
    ? 'pull_request' as const
    : hasCodeTaskLabel(linearIssueLabelsForDispatch)
      ? 'execution' as const
      : 'planning' as const;
```

**Step 3: Run tests**

Run: `pnpm --filter code-agent test -- --run retryTask.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/retryTask.ts apps/code-agent/src/__tests__/usecases/retryTask.test.ts
git commit -m "feat(code-agent): preserve 'review' agentType in retryTask"
```

---

## Task 13: Update processCodeAction for Review Detection

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts:206`
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts:286`
- Test: `apps/code-agent/src/__tests__/domain/useCases/processCodeAction.test.ts`

**Step 1: Update type annotations**

```typescript
// Line 206
agentType: 'planning' | 'execution' | 'review';
```

**Step 2: Run tests**

Run: `pnpm --filter code-agent test -- --run processCodeAction.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processCodeAction.ts apps/code-agent/src/__tests__/domain/useCases/processCodeAction.test.ts
git commit -m "feat(code-agent): add 'review' to processCodeAction agentType"
```

---

## Task 14: Update Migration File Types

**Files:**
- Modify: `apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts:5`
- Test: `apps/code-agent/src/__tests__/infra/migrations/agentRoutingContractMigration.test.ts`

**Step 1: Update AgentType definition in migration**

```typescript
type AgentType = 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Run tests**

Run: `pnpm --filter code-agent test -- --run agentRoutingContractMigration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts apps/code-agent/src/__tests__/infra/migrations/agentRoutingContractMigration.test.ts
git commit -m "feat(code-agent): add 'review' to migration AgentType"
```

---

## Task 15: Update Orchestrator Completion Verifier

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

**Step 1: Check and update CompletionAgentType**

Search for the `CompletionAgentType` definition and add 'review':

```typescript
export type CompletionAgentType = 'planning' | 'execution' | 'pull_request' | 'review';
```

**Step 2: Add verification logic for review agent**

Add a case for `'review'` that validates the `REVIEW_AGENT_FINAL` block similar to `pull_request`.

**Step 3: Run tests**

Run: `pnpm --filter orchestrator test -- --run completion-verifier.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat(orchestrator): add 'review' to CompletionAgentType and verification"
```

---

## Task 16: Update Firestore Repository Tests

**Files:**
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`

**Step 1: Add test for review agentType**

```typescript
it('should persist review agentType', async () => {
  const input = {
    ...baseInput,
    agentType: 'review',
  };

  const result = await repo.create(input);

  expect(result.ok).toBe(true);
  expect(result.value.agentType).toBe('review');
});
```

**Step 2: Run tests**

Run: `pnpm --filter code-agent test -- --run firestoreCodeTaskRepository.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
git commit -m "test(code-agent): add test for review agentType persistence"
```

---

## Task 17: Run Full CI Verification

**Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

**Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS

**Step 3: Verify coverage thresholds**

Ensure no coverage regressions in modified files.

---

## Task 18: Create PR

**Step 1: Create feature branch**

```bash
git checkout -b feature/int-668-add-review-agent-type
```

**Step 2: Push and create PR**

```bash
git push -u origin feature/int-668-add-review-agent-type
gh pr create --base development --title "[INT-668] Add 'review' agent type to code task workflow" --body "$(cat <<'EOF'
## Summary
- Adds `review` as a new `AgentType` value alongside `planning`, `execution`, and `pull_request`
- Updates all type definitions across code-agent, web app, and orchestrator
- Implements `buildReviewPrompt()` for review agent system prompts
- Updates UI to display Review badge (amber color scheme)
- Modifies `createTaskForPR` to use `review` instead of `pull_request` for PR comment tasks

## Test plan
- [ ] Verify `pnpm run ci:tracked` passes
- [ ] Verify new review badge appears in task list for PR-triggered tasks
- [ ] Verify review agent prompts contain correct completion block format

Fixes INT-668

Devised with love by IntexuraOS Code
EOF
)"
```

---

## Summary

This plan adds `review` as a new agent type through 18 tasks across 3 workstreams:

| Workstream     | Tasks       | Key Changes                                           |
| -------------- | ----------- | ----------------------------------------------------- |
| Types & Models | 1-5         | Add `'review'` to all AgentType unions                |
| Orchestrator   | 6-7, 15     | Add `buildReviewPrompt()`, update completion verifier |
| Business Logic | 8-14, 16-18 | Update usecases, routes, webhooks, UI, tests          |

Total estimated time: 2-3 hours with parallel execution.
