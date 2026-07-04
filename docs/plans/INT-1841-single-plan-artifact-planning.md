# Single Plan Artifact Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. The execution worker owns delivery of this entire plan in one branch and one implementation PR; it delegates consecutive plan tasks to internal subagents and integrates their output back into that same branch. Do not create Linear child issues, do not fan out execution code tasks from the plan, and do not open multiple implementation PRs.

**Goal:** Simplify PR planning so every planned outcome produces exactly one execution artifact: the original Linear issue, optionally backed by one plan document, executed by one code task and one PR.

**Architecture:** Collapse the current SIMPLE/PLAN-DOC/COMPLEX planning model into SIMPLE vs PLAN-DOC only. The planning agent may create a plan document and a planning PR, but it must never create Linear subtasks or report subtask URLs. Code-agent then normalizes the original Linear issue to `code-task`, clears planning labels, merges the plan PR, and submits one execution task for that issue. Subagents remain an execution-worker implementation technique inside the single task.

**Tech Stack:** TypeScript, Vitest, Fastify internal webhooks, Linear MCP integration, orchestrator completion verifier, code-agent task dispatch, pnpm.

## Global Constraints

- The input Linear issue remains the only issue that planning edits and execution implements.
- Planned outcomes must never create Linear child issues or rely on existing child issues.
- Planned outcomes must never set `complex-task` or produce `planning_subtask_urls` for new completions.
- Execution from a plan must create exactly one execution `CodeTask` for the original issue.
- The execution worker must delegate sequential plan tasks to subagents internally, while keeping one branch and one PR.
- Historical Firestore fields such as `planning_is_complex`, `planning_subtask_urls`, and `fanOutChildTaskIds` may remain readable for old rows unless a task proves all callers can delete them without migration.
- No endpoint paths are added or removed.

---

## Endpoint Changes

### Modified

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `workers/orchestrator` | internal callback payload | existing code-task completion callback | Planning final block no longer emits `Complex task`, `Subtask URLs`, or `Parallel breakdown proof`; webhook result mapping stops populating planning subtask fields for new completions. |
| `apps/code-agent` | internal webhook | existing task completion webhook | Planned outcomes always normalize the original issue to `code-task` and ignore legacy complex/subtask result fields. |
| `apps/code-agent` | submit execution | existing execution submission endpoint | Starting execution from a plan always enqueues one execution task for the original issue. |

### Created

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No new endpoints. |

### Removed

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No endpoint paths are removed. |

### Unchanged

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `apps/code-agent` | direct code-task dispatch | existing direct dispatch and queue-drain paths | Child fan-out for already-created direct code tasks remains out of scope unless a focused audit proves it is planning-only. |

## File Map

### Orchestrator planning contract

- Modify: `workers/orchestrator/src/services/prompts/planning-prompt.ts`
- Modify: `workers/orchestrator/src/services/prompts/execution-prompt.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/contracts.ts`
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`
- Modify: `workers/orchestrator/src/types/task.ts` only if the legacy planning fields can be marked as deprecated without breaking stored task compatibility

### Code-agent planning enforcement and execution submission

- Modify: `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/prepareSubmission.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/dispatchSubmission.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/types.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeRoutes.branches.test.ts`

### Cleanup and memory summaries

- Modify: `apps/code-agent/src/domain/usecases/executionMemory/shared.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts` if `hasComplexTaskLabel` becomes unused by code-agent after the execution-submission cleanup
- Modify: `packages/linear-domain/src/labels.ts` only if `rg "hasComplexTaskLabel"` proves no remaining package or app imports it after code-agent cleanup

## Shared Contract

New planning final block fields:

```text
PLANNING_AGENT_FINAL:
- Outcome: <planned|unclear>
- superpowers_writing_plans_used: 1
- Linear issue: <full Linear URL>
- Plan doc: <0|1>
- Plan PR: <full GitHub PR URL for planned outcomes, empty for unclear>
- Clarification message: <required for unclear outcomes; empty for planned outcomes>
- memory_ids_used: <comma-separated injected IDs, or "none">
- memory_ids_rejected: <comma-separated injected IDs, or "none">
- memory_usage_summary: <one-sentence description, or "none">
- Summary: <concise markdown bullet list>
```

Removed from the new planning contract:

```text
- Complex task: <0|1>
- Subtask URLs: <comma-separated full Linear URLs, or empty>
- Parallel breakdown proof: <...>
```

Planned issue labels after completion:

```typescript
{
  addLabels: ['code-task'],
  removeLabels: ['unclear', 'planning-task', 'complex-task'],
}
```

Execution submission behavior:

```typescript
// The original planned issue is always the implementation target.
return ok({ planningTask, userId, linearIssueId, effectiveWorkerType });
```

## Task 1: Replace The Planning Prompt Contract

**Files:**
- Modify: `workers/orchestrator/src/services/prompts/planning-prompt.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/contracts.ts`
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`

**Interfaces:**
- Consumes: existing `PLANNING_AGENT_FINAL` parser and callback result builder.
- Produces: a single-artifact planning contract with no complex/subtask fields for new planning completions.

- [ ] **Step 1: Write failing prompt tests**

Add tests to `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`:

```typescript
it('planning prompt forbids Linear subtasks and complex planning output', () => {
  const result = planningPrompt.build({ ...baseParams, linearIssueLabels: ['bug'] });

  expect(result).toContain('Single Planning Artifact');
  expect(result).toContain('Do NOT create Linear child issues');
  expect(result).toContain('delegate consecutive plan tasks to internal subagents');
  expect(result).not.toContain('**COMPLEX task');
  expect(result).not.toContain('Subtask URLs:');
  expect(result).not.toContain('Parallel breakdown proof:');
});

it('planning complexity judgment only allows SIMPLE or PLAN-DOC', () => {
  const result = planningPrompt.build({ ...baseParams, linearIssueLabels: ['bug'] });

  expect(result).toContain('- Decision: <SIMPLE|PLAN-DOC>');
  expect(result).not.toContain('- Decision: <SIMPLE|PLAN-DOC|COMPLEX>');
});
```

- [ ] **Step 2: Write failing completion contract tests**

Add or update tests in `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`:

```typescript
it('planning contract no longer requires complex or subtask fields', () => {
  const fieldNames = AGENT_CONTRACTS.planning.fields.map((field) => field.name);

  expect(fieldNames).toContain('outcome');
  expect(fieldNames).toContain('plan_doc');
  expect(fieldNames).toContain('plan_pr');
  expect(fieldNames).not.toContain('complex_task');
  expect(fieldNames).not.toContain('subtask_urls');
  expect(fieldNames).not.toContain('parallel_breakdown_proof');
});
```

Add or update tests in `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`:

```typescript
it('maps planning results without complex or subtask fields', () => {
  const result = buildResultFromVerificationData(
    {
      outcome: 'planned',
      superpowers_writing_plans_used: true,
      linear_issue: 'https://linear.app/pbuchman/issue/INT-1841/example',
      plan_doc: true,
      plan_pr: 'https://github.com/pbuchman/intexuraos/pull/1',
      clarification_message: '',
      summary: 'done',
    },
    'planning'
  );

  expect(result.planning_outcome_label).toBe('planned');
  expect(result.planning_has_plan_doc).toBe('1');
  expect(result.planning_pr_url).toBe('https://github.com/pbuchman/intexuraos/pull/1');
  expect(result.planning_is_complex).toBeUndefined();
  expect(result.planning_subtask_urls).toBeUndefined();
});
```

- [ ] **Step 3: Run the focused failing tests**

Run:

```bash
pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts src/__tests__/services/completion-verifier/contracts.test.ts src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts
```

Expected: FAIL because the prompt and contract still contain complex planning fields.

- [ ] **Step 4: Update `planning-prompt.ts`**

Change `version: '7.0.1'` to `version: '8.0.0'`.

Replace the current `### Simple vs Complex` section with:

```text
### Single Planning Artifact

Planning has only two successful shapes:

**SIMPLE task:** Edit the issue description only. No Linear subtasks and no implementation coding.
A task is SIMPLE only when the implementation is a single mechanical change (1-2 files, no design decisions, no multi-step sequence). Even SIMPLE tasks MUST create an evidence PR.

**PLAN-DOC task:** Create or update exactly one plan document in `docs/plans/`, update the original issue description with `Plan document: docs/plans/<file>.md`, and open exactly one planning PR.
Use PLAN-DOC when the implementation has 3+ steps, spans backend+frontend, involves migration/backfill, or needs explicit sequencing.

Do NOT create Linear child issues.
Do NOT classify work as complex.
Do NOT emit subtask URLs.
Do NOT plan multiple implementation PRs.
The later execution worker is responsible for delivering the whole plan and must delegate consecutive plan tasks to internal subagents inside one execution branch/PR.
```

Change the complexity judgment example to:

```text
COMPLEXITY_JUDGMENT:
- Decision: <SIMPLE|PLAN-DOC>
- Reasoning: <1-3 sentences explaining why>
```

Replace the final block fields with the shared contract listed earlier in this plan.

- [ ] **Step 5: Update completion parsing and callback mapping**

In `workers/orchestrator/src/services/completion-verifier/contracts.ts`, remove the field specs for:

```typescript
'complex_task'
'subtask_urls'
'parallel_breakdown_proof'
```

In `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`, remove the new-output assignments:

```typescript
base.planning_is_complex = boolToBoolZeroOne(data['complex_task']) ?? '0';
base.planning_subtask_urls = arrayToCsv(data['subtask_urls']);
```

Keep `planning_has_plan_doc`, `planning_pr_url`, and `planning_unclear_clarification`.

- [ ] **Step 6: Run the focused tests again**

Run:

```bash
pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts src/__tests__/services/completion-verifier/contracts.test.ts src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts
```

Expected: PASS.

## Task 2: Simplify Planning Completion Enforcement

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

**Interfaces:**
- Consumes: planning completion results with `planning_outcome_label`, `planning_has_plan_doc`, and `planning_pr_url`.
- Produces: original Linear issue state `todo`, labels `code-task` only for implementation routing, and no child issue normalization.

- [ ] **Step 1: Write failing enforcement tests**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, add a regression near the current planning completion tests:

```typescript
it('planned completion ignores legacy complex/subtask fields and stamps only the parent issue', async () => {
  const task = await createPlanningTask({ linearIssueId: 'INT-1841' });
  fakeLinearAgentClient.validateIssue.mockResolvedValueOnce(ok({
    id: 'parent-uuid',
    identifier: 'INT-1841',
    labels: ['planning-task'],
    childCount: 2,
  }));

  const payload = {
    taskId: task.id,
    status: 'completed' as const,
    result: {
      planning_outcome_label: 'planned' as const,
      planning_is_complex: '1' as const,
      planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-999/old-child',
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
    },
  };

  const response = await app.inject({
    method: 'POST',
    url: '/internal/tasks/callback',
    headers: internalAuthHeaders,
    payload,
  });

  expect(response.statusCode).toBe(200);
  expect(fakeLinearAgentClient.fetchDirectChildrenLive).not.toHaveBeenCalled();
  expect(fakeLinearAgentClient.updateIssueMetadata).toHaveBeenCalledWith(expect.objectContaining({
    issueId: 'parent-uuid',
    addLabels: ['code-task'],
    removeLabels: ['unclear', 'planning-task', 'complex-task'],
  }));
});
```

Adapt helper names to the local test fixtures already used in that file; keep the assertion shape unchanged.

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/routes/webhooks.test.ts -t "planned completion ignores legacy complex"
```

Expected: FAIL because current enforcement branches on `planning_is_complex === '1'` and touches child issues.

- [ ] **Step 3: Replace complex enforcement with one parent normalization path**

In `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`, inside `enforcePlanningOutcome` for `outcome === 'planned'`, remove:

- `const isComplex = planningResult.planning_is_complex === '1';`
- all `planning_subtask_urls` parsing
- all `fetchDirectChildrenLive` fallback logic
- all child `updateIssueState` and child `updateIssueMetadata` calls
- adding `complex-task` to the parent

Use one state update and one metadata update:

```typescript
const [markTodo, parentLabels] = await Promise.all([
  linearAgentClient.updateIssueState({
    userId: task.userId,
    issueId: originalIssueUuid,
    state: 'todo',
  }),
  linearAgentClient.updateIssueMetadata({
    userId: task.userId,
    issueId: originalIssueUuid,
    assigneeId: null,
    addLabels: ['code-task'],
    removeLabels: ['unclear', 'planning-task', 'complex-task'],
  }),
]);
```

After those succeed, add the planning PR comment for every planned outcome when `planning_pr_url` or `prUrl` is present:

```typescript
const planningPrUrl = planningResult.planning_pr_url ?? planningResult.prUrl ?? '';
if (planningPrUrl !== '') {
  const prComment = await linearAgentClient.addComment({
    userId: task.userId,
    issueId: originalIssueUuid,
    body: `Planning PR: ${planningPrUrl}`,
  });
  if (!prComment.ok) {
    return { ok: false, message: `Failed to comment planning PR: ${prComment.error.message}` };
  }
}
```

- [ ] **Step 4: Remove now-unused imports and v8 ignores**

Remove imports used only by the deleted branch, including `parseLinearIdentifierFromUrl` if no other code in `handleTaskCompletion.ts` references it. Delete the v8 ignore comments that existed only for `planning_subtask_urls` and complex-only `planning_pr_url` fallbacks.

- [ ] **Step 5: Run planning webhook tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/routes/webhooks.test.ts
```

Expected: PASS after updating old complex-planning assertions to the new parent-only behavior.

## Task 3: Make Execution Submission Create One Task

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/prepareSubmission.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/dispatchSubmission.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/types.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/__tests__/routes/codeRoutes.branches.test.ts`

**Interfaces:**
- Consumes: a planned issue with `code-task` label and optional stale `complex-task` label.
- Produces: one execution task whose `linearIssueId` is the original issue identifier.

- [ ] **Step 1: Write failing single-dispatch tests**

In `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts`, replace the complex-context expectation with:

```typescript
it('ignores complex-task label when the planned issue is ready for one execution task', async () => {
  fakeLinearAgentClient.validateIssue.mockResolvedValue(ok({
    id: 'parent-uuid',
    identifier: 'INT-1841',
    labels: ['code-task', 'complex-task'],
    childCount: 2,
  }));

  const result = await prepareSubmission(deps, {
    originalTaskId: 'task_plan',
    userId: 'user_1',
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.complex).toBeUndefined();
  expect(fakeLinearAgentClient.fetchDirectChildrenLive).not.toHaveBeenCalled();
});
```

In `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts`, add:

```typescript
it('dispatches a single execution task and does not call fanOutChildTasks', async () => {
  const result = await dispatchSubmission(deps, preparedSubmissionWithoutComplex);

  expect(result.ok).toBe(true);
  expect(mockFanOutChildTasks).not.toHaveBeenCalled();
  if (!result.ok) return;
  expect(result.value.childTaskIds).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts
```

Expected: FAIL because current code returns complex context and dispatches child tasks.

- [ ] **Step 3: Remove planning execution fan-out from `prepareSubmission.ts`**

Remove:

- `hasComplexTaskLabel` import
- `PreparedComplexContext`
- `complex?: PreparedComplexContext`
- `const isComplexTask = hasComplexTaskLabel(freshLabels);`
- the Step 10 `fetchDirectChildrenLive` block

Change the label gate to require `code-task` regardless of stale `complex-task`:

```typescript
if (hasUnclearLabel(freshLabels)) {
  return err({
    code: 'label_not_ready',
    message: 'The planning agent flagged questions that need resolution. Review the Linear issue, address open questions, then retry the planning agent.',
  });
}

if (!hasCodeTaskLabel(freshLabels)) {
  return err({
    code: 'label_not_ready',
    message: "The code-task label hasn't been added yet. The planning agent may not have completed successfully.",
  });
}
```

Return only:

```typescript
return ok({ planningTask, userId, linearIssueId, effectiveWorkerType });
```

- [ ] **Step 4: Remove complex dispatch from `dispatchSubmission.ts`**

Remove:

- `fanOutChildTasks` import
- `IssueTreeNode` import
- `hasCodeTaskLabel` import
- `dispatchComplex`
- the `if (prepared.complex !== undefined)` branch

Keep:

```typescript
export async function dispatchSubmission(
  deps: DispatchSubmissionDeps,
  prepared: PreparedSubmission,
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  return await dispatchSingle(deps, prepared);
}
```

- [ ] **Step 5: Simplify public result and route error handling**

In `apps/code-agent/src/domain/usecases/submitToExecutionAgent/types.ts`, remove `childTaskIds?: string[]` from `SubmitToExecutionAgentResult` for this use case. Remove `complex_task_no_qualifying_children` from `SubmitToExecutionAgentErrorCode` if `rg "complex_task_no_qualifying_children"` shows it is only used by submit-to-execution routes after Task 3 edits.

In `apps/code-agent/src/routes/code/task-routes.ts` and `apps/code-agent/src/__tests__/routes/codeRoutes.branches.test.ts`, remove submit-to-execution response branches that only map `complex_task_no_qualifying_children`. Keep direct code-task fan-out route behavior if those branches are shared with direct dispatch.

- [ ] **Step 6: Run submit-to-execution tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/domain/usecases/submitToExecutionAgent.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts src/__tests__/routes/codeRoutes.branches.test.ts
```

Expected: PASS with old fan-out expectations removed or rewritten to assert single execution task creation.

## Task 4: Update Execution Worker Handoff Instructions

**Files:**
- Modify: `workers/orchestrator/src/services/prompts/execution-prompt.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent/types.ts`
- Modify: focused tests that assert `EXECUTION_AGENT_PROMPT`

**Interfaces:**
- Consumes: original issue description and optional plan document pointer.
- Produces: one execution branch and one PR, with internal subagents used sequentially.

- [ ] **Step 1: Write failing prompt tests**

Add to `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`:

```typescript
it('execution prompt says the worker owns one plan delivery and delegates internally', () => {
  const result = executionPrompt.build({ ...baseParams, linearIssueLabels: ['code-task'] });

  expect(result).toContain('one execution branch and one implementation PR');
  expect(result).toContain('delegate consecutive plan tasks to internal subagents');
  expect(result).toContain('Do NOT create Linear child issues');
  expect(result).toContain('Do NOT split the plan into multiple code tasks');
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts -t "execution prompt says the worker owns one plan delivery"
```

Expected: FAIL because the current execution prompt says subagent-first, but does not explicitly forbid Linear child issues or task fan-out.

- [ ] **Step 3: Update `execution-prompt.ts`**

Add this section after `### Subagent-First Execution (MANDATORY)`:

```text
### Single Plan Delivery Ownership
The execution worker is responsible for delivering the whole linked plan in one execution branch and one implementation PR.
- Delegate consecutive plan tasks to internal subagents.
- Integrate each subagent result back into this same branch.
- Do NOT create Linear child issues.
- Do NOT split the plan into multiple code tasks.
- Do NOT open multiple implementation PRs for one planned issue.
```

Bump `executionPrompt.version` from `10.0.0` to `11.0.0` because this changes execution behavior.

- [ ] **Step 4: Update the generic execution prompt text**

In `apps/code-agent/src/domain/usecases/submitToExecutionAgent/types.ts`, change `EXECUTION_AGENT_PROMPT` to:

```typescript
export const EXECUTION_AGENT_PROMPT =
  'Implement the requirements defined in the linked Linear issue, its comments (newest first), and the referenced plan document if present. Deliver the plan in one branch and one PR. Use internal subagents for consecutive plan tasks; do not create Linear child issues or split the plan into multiple code tasks.';
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts
pnpm --filter code-agent test -- src/__tests__/domain/usecases/submitToExecutionAgent.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts
```

Expected: PASS.

## Task 5: Remove Planning Subtask Telemetry From New Summaries

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/executionMemory/shared.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts` if complex-label re-export is unused
- Modify: `packages/linear-domain/src/labels.ts` and `packages/linear-domain/src/__tests__/labels.test.ts` only if no callers remain after code-agent cleanup

**Interfaces:**
- Consumes: historical task results that may still contain complex/subtask fields.
- Produces: execution memory summaries that describe single-artifact planning without encouraging future complex planning.

- [ ] **Step 1: Write failing memory summary tests**

In `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`, update planning-memory expectations:

```typescript
expect(memory.content).toContain('Planning execution model: single issue, single execution task');
expect(memory.content).not.toContain('Planning subtask count:');
expect(memory.content).not.toContain('Complexity classification: COMPLEX');
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts -t "Planning"
```

Expected: FAIL because current summary code still calculates subtask count and reports `COMPLEX`.

- [ ] **Step 3: Update `executionMemory/shared.ts`**

Replace the current planning subtask summary lines:

```typescript
const subtaskCount = (task.result?.planning_subtask_urls ?? '').split(',').filter((u) => u.trim() !== '').length;
`Complexity classification: ${task.result?.planning_is_complex === '1' ? 'COMPLEX' : 'SIMPLE_OR_PLAN_DOC'}`,
`Planning subtask count: ${String(subtaskCount)}`,
```

with:

```typescript
`Planning execution model: single issue, single execution task`,
`Plan document present: ${task.result?.planning_has_plan_doc === '1' ? 'yes' : 'no'}`,
```

Keep reading historical fields only in places needed for old task display.

- [ ] **Step 4: Audit and remove unused complex-label exports only when safe**

Run:

```bash
rg -n "hasComplexTaskLabel|complex-task" apps/code-agent/src workers/orchestrator/src packages -g '*.ts'
```

If `hasComplexTaskLabel` is unused after Tasks 1-4, remove the code-agent re-export from `apps/code-agent/src/domain/utils/labelUtils.ts`. If `packages/linear-domain` still exposes it as public API with tests, leave it in place and add no migration.

- [ ] **Step 5: Run memory tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
```

Expected: PASS.

## Integration Verification

- [ ] Run focused orchestrator prompt and verifier tests:

```bash
pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts src/__tests__/services/completion-verifier/contracts.test.ts src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts
```

- [ ] Run focused code-agent planning and execution tests:

```bash
pnpm --filter code-agent test -- src/__tests__/routes/webhooks.test.ts src/__tests__/domain/usecases/submitToExecutionAgent.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/prepareSubmission.test.ts src/__tests__/domain/usecases/submitToExecutionAgent/dispatchSubmission.test.ts src/__tests__/routes/codeRoutes.branches.test.ts src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
```

- [ ] Run workspace verification:

```bash
pnpm run verify:workspace:tracked -- orchestrator
pnpm run verify:workspace:tracked -- code-agent
pnpm run ci:tracked
```

Expected: all commands PASS.

## Completion Criteria

- The planning prompt never instructs agents to create Linear subtasks or emit subtask URLs.
- The planning final block no longer contains complex/subtask fields.
- Planned completions always mark the original issue with `code-task` and remove `planning-task`, `unclear`, and `complex-task`.
- Submit-to-execution from a plan creates one execution task for the original issue, even if a stale `complex-task` label exists.
- The execution prompt and generic execution task prompt explicitly state that subagents are internal delegation inside one branch and one PR.
- Focused tests and `pnpm run ci:tracked` pass.
