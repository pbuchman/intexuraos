# INT-1424 — Do Not Auto-Merge Plan PR on Review Pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop automatically merging a plan PR when its review passes. The plan PR must stay open until the user explicitly clicks "Code" in the dashboard, which invokes `submitToExecutionAgent` and merges the plan PR there — this preserves the existing window where a user can add follow-up comments on the plan PR before execution begins.

**Architecture:** The review-completion webhook handler in `apps/code-agent/src/routes/webhookRoutes.ts` currently detects a passing plan-phase review (origin task `agentType === 'planning'`) and best-effort merges the plan PR via the `mergePlanPr` utility. This reverses INT-1282 for the plan-PR case: we remove the auto-merge call but keep the rest of the branch (no `ready-to-merge` label, no auto-advance to execution, informative log line). The canonical plan-PR merge remains in `submitToExecutionAgent` (unchanged), so the merge still happens reliably when the user explicitly triggers execution.

**Tech Stack:** TypeScript, Fastify webhook handler, existing `mergePlanPr` utility, Vitest with `setServices`/`resetServices` fakes.

---

## Endpoint Changes

- **Modified:** `POST /webhooks/task-completion` — review-phase label handler in `webhookRoutes.ts`. For origin task `agentType === 'planning'`, the handler no longer calls `mergePlanPr`. All other review-outcome behavior (no `ready-to-merge` label on plan reviews, and the execution-advance block separately requires user action) is unchanged.
- **Created:** none.
- **Removed:** none (no route signatures change).
- **Unchanged:** `submitToExecutionAgent` still merges the plan PR inside the "Code" flow; `/internal/submit-to-execution-agent` and the merge-queue endpoints are untouched.

---

## Background: What Is Being Reversed

INT-1282 added best-effort plan-PR auto-merge inside the review-completion webhook so that an approved plan would land on `development` immediately without the user pressing "Code". In practice the user wants the opposite: the plan PR stays open after review passes so they can post additional comments on the plan. The explicit "Code" action is what should merge the plan PR (via `submitToExecutionAgent`, which has done this since INT-1146/INT-1250 and is not affected by this task).

Concretely:

- Current behavior (bug): review pass on a planning PR → webhook resolves `planning_pr_url` → calls `mergePlanPr` → PR is squash/merged into `development` before the user clicks "Code".
- Desired behavior: review pass on a planning PR → webhook logs the pass, does **not** merge, does **not** add `ready-to-merge` label, does **not** auto-advance execution. User opens the plan PR, optionally leaves comments, then clicks "Code" → `submitToExecutionAgent` runs its existing `mergePlanPr` call → plan PR merges → execution starts.

## File Inventory

| Action | File                                                       | Responsibility                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modify | `apps/code-agent/src/routes/webhookRoutes.ts`              | Remove the `mergePlanPr` call and its supporting `fetchGitHubToken`/error-handling block inside the `originResult.value.agentType === 'planning'` branch. Keep the branch (do not fall through to the `ready-to-merge` path) and keep a log line indicating the plan review passed without auto-merge.                               |
| Modify | `apps/code-agent/src/__tests__/routes/webhooks.test.ts`    | Replace the `describe('plan PR auto-merge on review pass', …)` block (five cases at lines ~5280-5490) with a single `describe('plan PR NOT merged on review pass', …)` block asserting `mergePullRequest` is never called when a plan review completes. Keep setup helpers `createPlanningTaskWithPrUrl` / `createReviewTaskWithPr`. |
| Modify | `docs/plans/INT-1282-auto-merge-plan-pr-on-review-pass.md` | Append a `## Reversed by INT-1424` section explaining the reversal and pointing at this plan file, so future readers don't treat INT-1282 as current.                                                                                                                                                                                |

No changes are needed in `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`, `apps/code-agent/src/domain/utils/mergePlanPr.ts`, or the merge-queue code — this task only removes the webhook-side auto-merge.

---

### Task 1: Remove plan-PR auto-merge in the review webhook handler

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (inside the review-completion handler, within the `if (originResult.ok && originResult.value !== null && originResult.value.linearIssueId !== undefined)` block, the `agentType === 'planning'` sub-branch around lines 422–451)

- [ ] **Step 1: Update the planning sub-branch to drop the auto-merge**

Replace the existing planning sub-branch (currently the block inside `if (originResult.value.agentType === 'planning') { … }`) with the version below. The surrounding `if/else` structure (fallback to origin-task / review-task / label logic) stays exactly as-is; only the contents of the planning branch change.

Before (current code, approximately `apps/code-agent/src/routes/webhookRoutes.ts:422-451`):

```typescript
if (originResult.value.agentType === 'planning') {
  // Plan-phase reviews do not auto-advance to execution.
  // The user must explicitly trigger execution from the UI.
  // But we DO auto-merge the plan PR so the plan docs land on development immediately.
  request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
    'Plan review passed — auto-merging plan PR (user must explicitly trigger execution)');

  const planningPrUrl = originResult.value.result?.planning_pr_url ?? originResult.value.result?.prUrl;
  if (planningPrUrl !== undefined && planningPrUrl !== '') {
    try {
      const gitHubToken = await fetchGitHubToken(userServiceClient, task.userId, request.log);
      if (gitHubToken !== null) {
        const mergeResult = await mergePlanPr(
          { logger: request.log, gitHubPRClient },
          { planningPrUrl, repository: task.repository, token: gitHubToken },
        );
        if (mergeResult.ok) {
          request.log.info({ prNumber, planningPrUrl }, 'Plan PR auto-merged on review pass');
        } else {
          request.log.warn({ prNumber, planningPrUrl, error: mergeResult.error }, 'Plan PR auto-merge failed (best-effort)');
        }
      } else {
        request.log.warn({ prNumber }, 'Skipping plan PR auto-merge — no GitHub token available');
      }
    } catch (mergeError: unknown) {
      request.log.warn({ prNumber, planningPrUrl, error: mergeError }, 'Plan PR auto-merge threw (best-effort)');
    }
  } else {
    request.log.debug({ prNumber, taskId: originResult.value.id }, 'No planning_pr_url on origin task — skipping plan PR auto-merge');
  }
}
```

After (replacement):

```typescript
if (originResult.value.agentType === 'planning') {
  // Plan-phase reviews do not auto-advance to execution and do NOT auto-merge the plan PR.
  // The user must explicitly click "Code" in the dashboard; `submitToExecutionAgent` then
  // merges the plan PR as part of the execution kickoff. Keeping the plan PR open after
  // review pass lets the user add follow-up comments on the plan before execution starts.
  // Reversal of INT-1282, per INT-1424 (docs/plans/INT-1424-no-auto-merge-plan-pr-on-review-pass.md).
  request.log.info(
    { taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
    'Plan review passed — plan PR left open; user must explicitly trigger execution',
  );
}
```

This intentionally:
- keeps the planning branch present (so we do NOT fall through to the `ready-to-merge` label path in the `else`),
- drops the call to `mergePlanPr` and the supporting `fetchGitHubToken` + try/catch,
- drops the `planningPrUrl` resolution (no longer needed in this handler),
- leaves `targetLinearIssueId`/`targetUserId`/`label`/`source` unset, which is the existing contract that makes the later `if (targetLinearIssueId === undefined) { … skipping … } else { …apply label… }` branch log and skip labelling for plan reviews.

- [ ] **Step 2: Remove now-unused imports if the build flags them**

If (and only if) `mergePlanPr` and `fetchGitHubToken` have no other usages in `webhookRoutes.ts` after Step 1, TypeScript/ESLint will flag them as unused. Per the grep audit at plan-writing time, `fetchGitHubToken` is also used at `webhookRoutes.ts:901` and `mergePlanPr` has no other call sites in this file — so only `mergePlanPr` needs to be removed from the import list. Re-verify with:

Run: `cd /repo && grep -n "mergePlanPr\|fetchGitHubToken" apps/code-agent/src/routes/webhookRoutes.ts`

Expected: `mergePlanPr` appears only on the import line after Step 1; `fetchGitHubToken` appears on the import line and at one other line (the existing ~line 901 call).

If that matches, delete the `mergePlanPr` import line:

```typescript
// DELETE this line:
import { mergePlanPr } from '../domain/utils/mergePlanPr.js';
```

Leave `fetchGitHubToken` import untouched.

- [ ] **Step 3: Typecheck the file in isolation**

Run: `cd /repo && pnpm --filter @intexuraos/code-agent exec tsc --noEmit`

Expected: no new errors. (If `mergePlanPr` was still imported, the build would fail with `'mergePlanPr' is declared but its value is never read.` once `noUnusedLocals`/linter catches it; Step 2 prevents that.)

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts
git commit -m "fix(code-agent): stop auto-merging plan PR on review pass (INT-1424)"
```

---

### Task 2: Rewrite the webhook test suite for the new behavior

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts` — replace the entire `describe('plan PR auto-merge on review pass', …)` block (approximately lines 5280–5490) with a new `describe('plan PR NOT merged on review pass', …)` block.

- [ ] **Step 1: Write the failing tests**

Replace the existing describe block verbatim with the following block. The helper functions `createPlanningTaskWithPrUrl` and `createReviewTaskWithPr` remain (same signatures and bodies as today); only the `it(...)` cases change so they assert the new contract.

```typescript
describe('plan PR NOT merged on review pass', () => {
  async function createPlanningTaskWithPrUrl(traceId: string, prUrl: string): Promise<import('../../domain/models/codeTask.js').CodeTask> {
    const result = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Plan the task',
      sanitizedPrompt: 'Plan the task',
      systemPromptHash: 'plan-auto',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId,
      prNumber: 1654,
      webhookSecret: 'test-webhook-secret',
      agentType: 'planning',
      linearIssueId: 'INT-500',
    });
    if (!result.ok) throw new Error('Failed to create planning task');
    await codeTaskRepo.update(result.value.id, { result: { planning_pr_url: prUrl } });
    const taskResult = await codeTaskRepo.findById(result.value.id);
    if (!taskResult.ok) throw new Error('Failed to refetch planning task');
    return taskResult.value;
  }

  async function createReviewTaskWithPr(traceId: string, prNumber = 1654): Promise<import('../../domain/models/codeTask.js').CodeTask> {
    const result = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Review the PR',
      sanitizedPrompt: 'Review the PR',
      systemPromptHash: 'review-auto',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId,
      prNumber,
      webhookSecret: 'test-webhook-secret',
      agentType: 'review',
      linearIssueId: 'INT-500',
    });
    if (!result.ok) throw new Error('Failed to create review task');
    return result.value;
  }

  it('does NOT merge plan PR when plan review passes (plan PR stays open for user review comments)', async () => {
    await createPlanningTaskWithPrUrl('trace_plan_no_automerge_pass', 'https://github.com/pbuchman/intexuraos/pull/1654');
    const reviewTask = await createReviewTaskWithPr('trace_plan_no_automerge_pass_review');

    const { gitHubPRClient: ghClient } = installPRNotificationServices();

    const payload = {
      taskId: reviewTask.id,
      status: 'completed' as const,
      result: {
        summary: 'Plan review passed',
        review_comments_posted: '0',
        review_types: 'plan-review',
        needs_remediation: '0',
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
      },
    };

    const response = await sendLabelPayload(payload);

    expect(response.statusCode).toBe(200);
    expect(ghClient.mergePullRequest).not.toHaveBeenCalled();
  });

  it('does NOT merge plan PR when plan review requires remediation', async () => {
    await createPlanningTaskWithPrUrl('trace_plan_no_automerge_remediation', 'https://github.com/pbuchman/intexuraos/pull/1654');
    const reviewTask = await createReviewTaskWithPr('trace_plan_no_automerge_remediation_review');

    const { gitHubPRClient: ghClient } = installPRNotificationServices();

    const payload = {
      taskId: reviewTask.id,
      status: 'completed' as const,
      result: {
        summary: 'Plan review needs remediation',
        review_comments_posted: '2',
        review_types: 'plan-review',
        needs_remediation: '1',
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
      },
    };

    const response = await sendLabelPayload(payload);

    expect(response.statusCode).toBe(200);
    expect(ghClient.mergePullRequest).not.toHaveBeenCalled();
  });

  it('does NOT add ready-to-merge label on plan review pass (plan PR is not ready to merge)', async () => {
    await createPlanningTaskWithPrUrl('trace_plan_no_label', 'https://github.com/pbuchman/intexuraos/pull/1654');
    const reviewTask = await createReviewTaskWithPr('trace_plan_no_label_review');

    installPRNotificationServices();
    const { linearAgentClient: lac } = getServices();
    const updateSpy = vi.mocked(lac.updateIssueMetadata);

    const payload = {
      taskId: reviewTask.id,
      status: 'completed' as const,
      result: {
        summary: 'Plan review passed',
        review_comments_posted: '0',
        review_types: 'plan-review',
        needs_remediation: '0',
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
      },
    };

    const response = await sendLabelPayload(payload);

    expect(response.statusCode).toBe(200);
    const readyToMergeCalls = updateSpy.mock.calls.filter(
      (call) => Array.isArray(call[0].addLabels) && call[0].addLabels.includes('ready-to-merge'),
    );
    expect(readyToMergeCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the failing tests to confirm they fail on current code**

Run: `cd /repo && pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/webhooks.test.ts -t "plan PR NOT merged on review pass"`

Expected BEFORE Task 1 is applied: the first two cases FAIL because `mergePullRequest` IS called today. (If Task 1 is already applied when you run this, they PASS — that is the post-fix expectation. The third case may pass either way since plan reviews never set `ready-to-merge` in current code.)

- [ ] **Step 3: Apply Task 1 changes (if not already applied) and re-run**

Run: `cd /repo && pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/webhooks.test.ts -t "plan PR NOT merged on review pass"`

Expected: 3 passed, 0 failed.

- [ ] **Step 4: Run the full webhooks.test.ts file**

Run: `cd /repo && pnpm --filter @intexuraos/code-agent test -- src/__tests__/routes/webhooks.test.ts`

Expected: all tests pass. (The replaced describe block is the only scenario impacted.)

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "test(code-agent): assert plan PR is not auto-merged on review pass (INT-1424)"
```

---

### Task 3: Annotate the INT-1282 plan as reversed

**Files:**
- Modify: `docs/plans/INT-1282-auto-merge-plan-pr-on-review-pass.md`

- [ ] **Step 1: Append a reversal notice at the very top of the file, immediately under the H1**

Open `docs/plans/INT-1282-auto-merge-plan-pr-on-review-pass.md`. Immediately after the existing top-level heading line (the first `# …`), insert this block before the next section so readers see it first:

```markdown
> **⚠️ Reversed by INT-1424 (2026-04-21).** The plan-PR auto-merge added by this plan has been removed from the review-completion webhook. Plan PRs now stay open after a passing review and are merged only when the user explicitly clicks "Code" in the dashboard (via `submitToExecutionAgent`). See `docs/plans/INT-1424-no-auto-merge-plan-pr-on-review-pass.md` for rationale and the reversal change set.
```

Do not delete or rewrite the rest of the INT-1282 document — it remains useful historical context.

- [ ] **Step 2: Commit**

```bash
git add docs/plans/INT-1282-auto-merge-plan-pr-on-review-pass.md
git commit -m "docs(plans): mark INT-1282 auto-merge plan as reversed by INT-1424"
```

---

### Task 4: Full verification

- [ ] **Step 1: Workspace verify**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

Expected: PASS (build, typecheck, lint, tests, coverage).

- [ ] **Step 2: Tracked CI**

Run: `cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1424.txt`

Expected: all workspaces green. If anything fails, analyze `/tmp/ci-int-1424.txt` for the first error and fix it before committing further.

- [ ] **Step 3: Push and open PR targeting `development`**

```bash
gh pr create --base development --title "[INT-1424] Stop auto-merging plan PR on review pass" --body "…see plan doc…"
```

Follow the repository's PR description conventions: include `Fixes INT-1424`, the plan doc reference, and the mandatory Worker Type / Model lines.

---

## Acceptance Criteria

1. After a plan-review webhook with `needs_remediation: '0'` completes, `gitHubPRClient.mergePullRequest` is NOT called for the plan PR.
2. The plan PR remains in `open` state on GitHub after the review pass; no `ready-to-merge` label is added in Linear for plan-phase reviews.
3. `submitToExecutionAgent` — invoked when the user clicks "Code" — still merges the plan PR before dispatching execution (unchanged from today).
4. `pnpm run ci:tracked` passes.
5. `docs/plans/INT-1282-auto-merge-plan-pr-on-review-pass.md` carries a visible reversal notice pointing at this plan.

## Out of Scope

- Changing the `submitToExecutionAgent` merge behavior or any merge-queue behavior.
- UI changes — the dashboard already gates execution behind the explicit "Code" action.
- Backfilling or reverting any plan PRs that were already auto-merged by the old behavior.
- Updating `docs/services/code-agent/features.md` / `technical.md` — those files do not describe the INT-1282 auto-merge as a user-facing feature, so no doc-update is required by this task (verified via grep for "auto-merg" / "plan PR" at plan-writing time).
