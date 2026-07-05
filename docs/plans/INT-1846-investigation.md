# Missing Mergeable Labels Evidence Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve durable merge-ready evidence for no-remediation PR review outcomes, reviewer "Remediation not required" tracking-comment decisions, and "rebase not required" pull-request tasks, so Code Tasks Battlefield can show the Violet merge action without relying only on the transient Linear `ready-to-merge` label.

**Architecture:** The fix adds a shared structured rebase-result contract, stores explicit merge-ready evidence on task results for review, skipped-review, remediation, and pull_request paths, and teaches group summaries plus live grouping to unlock merge action from that durable signal. The existing Linear label and PR automation tracking comment remain supported visibility surfaces, but neither is the only source of truth because labels are removed on PR close/merge and tracking-comment text is not currently persisted into task/group state.

**Tech Stack:** TypeScript, Fastify JSON schemas, Firestore task documents, `@intexuraos/code-task-domain`, orchestrator completion parsing, code-agent task grouping, React web task types.

## Global Constraints

- Planning output only: do not implement code in the planning task.
- Keep one implementation PR: execution worker must deliver all code changes in one branch/PR.
- Preserve current guards: no merge action after `prMergedAt` or `prClosedAt`.
- Preserve plan-review behavior from INT-1424: plan-origin review pass must not become an execution-merge action unless a later execution/pull_request/remediation task supplies merge-ready evidence for the same execution PR.
- Use test-first implementation: write failing tests before implementation code.
- Do not add Firestore indexes for investigation; simplify reads and filter locally when ad hoc evidence queries need missing composite indexes.
- Endpoint Changes section is mandatory because this plan changes internal webhook and task API result schemas.

---

## Investigation Findings

### Scope

The investigation used a broad cutoff of `2026-07-02T00:00:00.000Z` because the request said "past two days" and the current task was created on `2026-07-04`. Firestore has no explicit `archivedAt` field on `code_tasks`, so `status === "archived"` plus `updatedAt >= cutoff` was used as the archive-time proxy.

### Data Sources Checked

- Linear issue `INT-1846`: issue description plus all comments, including the archived original request and planning PR link.
- Firestore `code_tasks`: 111 recent updated docs scanned, 95 archived tasks in scope.
- Firestore `code_tasks/{taskId}/log_lines` and `code_tasks/{taskId}/logs`: all 95 archived tasks scanned for `rebase`.
- GitHub PR API via `gh`: issue comments, inline review comments, reviews, and PR state for PRs #2279 through #2298.
- PR automation tracking-comment rendering: `remediation_decision` with `required: false` renders as "Remediation not required" in the single managed PR comment, not as a separate PR comment.
- Repository code paths for review outcome labeling, skipped-review callbacks, task result schemas, rebase-result parsing, group summary derivation, and UI task group status.

Cloud Logging was not available from this worker because `gcloud` is not installed in the container. Firestore, GitHub, and retained task logs were available and sufficient for code-root-cause analysis.

### What Was Identified

Merged PRs in the archived window with `needs_remediation: "0"` review evidence:

| PR | Linear | Task evidence | Merge proof |
| --- | --- | --- | --- |
| #2298 | INT-1841 | `task_ac79c616-204b-4d2c-865a-5255c62f6657`, review, `needs_remediation: "0"` | GitHub `merged_at=2026-07-04T20:13:18Z`; task `prMergedAt=2026-07-04T20:13:18Z` |
| #2294 | INT-1837 | `task_db2eb288-afa3-4d8e-8c61-ae4bd52d6c7a`, review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-04T11:25:40Z` |
| #2293 | INT-1842 | `task_03f14192-8ef1-4771-8418-0fff71fdd4b7`, review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-04T15:47:34Z` |
| #2292 | INT-1841 | `task_83ef198b-9b3c-42ac-b5ea-202ba4eddc29`, plan review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-04T15:47:50Z` |
| #2291 | INT-1838 | `task_fb925156-1c36-4eb1-8aa0-7440aab121f2`, review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-04T08:02:23Z` |
| #2288 | INT-1834 | `task_ba067096-889d-4485-bfed-2731fb3c54db`, review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-03T23:19:31Z` |
| #2287 | INT-1837 | `task_31ce77a2-32f3-4a5b-abb6-c38c388fee1f`, plan review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-03T23:19:15Z` |
| #2285 | INT-1832 | `task_9516f0af-bf70-4a75-9df8-2ce9ab25c07a`, review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-03T23:19:49Z` |
| #2284 | INT-1831 | `task_db45225a-90c5-416b-95c5-a57413b00d59`, review, `needs_remediation: "0"`; `task_dac9633d-549b-423b-a6f5-8e4a0ea96fc9`, remediation, `requires_re_review: "0"` | GitHub/task `prMergedAt=2026-07-04T08:03:10Z` |
| #2282 | INT-1834 | `task_be80cc9b-e15c-49ef-9329-33a1aaae442c`, plan review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-03T15:57:06Z` |
| #2280 | INT-1830 | `task_b41a30b0-cd2c-4750-b82d-844dac3b2ac1`, review, `needs_remediation: "0"` | GitHub/task `prMergedAt=2026-07-01T13:33:20Z`; archived within window |
| #2279 | INT-1829 | `task_f0897639-20de-4f7b-82fd-957f71a0f27a`, remediation, `requires_re_review: "0"`, `execution_outcome_label: "already_completed"` | GitHub/task `prMergedAt=2026-07-01T13:33:54Z`; archived within window |

The exact phrase "rebase is not required" was not found in retained GitHub PR comments, reviews, inline comments, `log_lines`, or raw `logs` for archived tasks in the window. The only recent PR comments containing "rebase" were on PR #2290, and GitHub reports PR #2290 was closed without merge, so it does not meet the user's proof criterion.

Additional PR feedback clarified that the requested evidence was in PR comments, specifically the per-PR automation tracking comment updated by the reviewer decision path. The relevant message is the reviewer/orchestrator decision that a review is not required, rendered as "Remediation not required" in the managed tracking comment. It is not a separate top-level comment and it is not a remediation task result.

### Evidence Problem

There are three concrete evidence defects:

1. `rebaseResult` is incompatible across producer and consumer.
   - Orchestrator `workers/orchestrator/src/types/task.ts` defines `rebaseResult` as an object: `{ attempted: boolean; success: boolean; conflictFiles?: string[] }`.
   - Code-agent `apps/code-agent/src/domain/models/codeTask.ts`, `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`, `apps/code-agent/src/routes/webhookRouteSchemas.ts`, API schemas, and web types still model `rebaseResult` as a string enum: `"success" | "conflict" | "skipped"`.
   - Result: even when a worker has structured rebase evidence, the public task-complete schema and API model do not preserve it consistently.

2. `attempted: false` rebase evidence is dropped.
   - `workers/orchestrator/src/services/task-dispatcher/prompts.ts` only returns a rebase result when `parsed.attempted === true && typeof parsed.success === "boolean"`.
   - A "rebase not required" state is naturally represented as `{"attempted": false}` or equivalent, but that currently becomes `undefined`.
   - Result: the exact evidence the user mentioned cannot survive into Firestore, group summaries, or Battlefield.

3. Reviewer skipped-review decisions are visible only in the PR automation tracking comment and transient label state.
   - `createOnReviewSkippedCallback()` records `automationLog.record(... { type: "remediation_decision", required: false, source: "review_result", signal: "0" })`.
   - `automationCommentRenderer.ts` renders that event as "Remediation not required" in the managed PR tracking comment.
   - The same callback sets `ready-to-merge` and recomputes labels, but it does not store durable `merge_ready` evidence on the origin execution task.
   - Result: a PR can be ready in GitHub and visibly marked "Remediation not required" in its tracking comment while Battlefield has no durable evidence to reconstruct the Violet merge action if the label is absent, stale, or later removed.

There is also one design defect:

4. Merge readiness is derived from a transient Linear label instead of durable task evidence.
   - `deriveAggregateStatusFromSummary()` returns merge `needs-action` only when `hasPrUrl`, `latestReviewNeedsRemediation !== true`, and `hasMergeReadyLabel === true`.
   - `derivePipeline()` adds the merge step for normal review pass only when the hydrated Linear issue still has `ready-to-merge`.
   - `handlePrClose()` removes `ready-to-merge` on PR close/merge and recomputes the group summary with empty labels.
   - Result: after merge/archive there is no durable label history proving whether the group was or was not Violet before merge, and if the label write/hydration/recompute is delayed or skipped, Battlefield cannot infer merge readiness from the review and rebase evidence it already has.

## Key Decisions

- Store structured rebase evidence instead of converting it back to the old string enum.
- Treat `attempted: false` as clean evidence named `not_required`, not as absent evidence.
- Add a durable merge-ready evidence field to task results and summaries so Battlefield can unlock merge action from stored task state.
- Treat reviewer "Remediation not required" tracking-comment decisions as skipped-review merge-ready evidence (`merge_ready_reason: "review_skipped"`) stored on the origin execution task.
- Keep Linear `ready-to-merge` as an external label and display hint, but stop making it the only merge-ready source of truth.
- Keep plan-origin review PR behavior unchanged unless an execution, pull_request, or remediation task later supplies merge-ready evidence for the execution PR.

## Endpoint Changes

### Modified

- `POST /internal/webhooks/task-complete`: accept object-shaped `result.rebaseResult` and new result merge-ready fields.
- `PATCH /internal/code-tasks/:taskId` (publicly routed as `/api/code/internal/code-tasks/:taskId`): accept object-shaped `result.rebaseResult` for the legacy worker callback path if still exercised.
- `GET /code/tasks`, `GET /code/tasks/:id`, `GET /code/issue-groups`: return object-shaped `result.rebaseResult` and merge-ready evidence fields.

### Created

- None.

### Removed

- None. Keep backward compatibility for existing string `rebaseResult` values if any old task documents contain them.

### Unchanged

- GitHub PR close/merge webhook behavior remains responsible for setting `prMergedAt`/`prClosedAt` and removing the Linear `ready-to-merge` label.
- Plan-review pass behavior remains non-mergeable for plan-origin PRs.

---

## File Structure

- Create `packages/code-task-domain/src/rebaseResult.ts`: shared `CodeTaskRebaseResult` type, parser, and clean/not-required helpers.
- Modify `packages/code-task-domain/src/index.ts`: export the new shared type and helpers.
- Modify `packages/code-task-domain/src/__tests__/rebaseResult.test.ts`: unit coverage for attempted, conflict, and not-required rebase evidence.
- Modify `workers/orchestrator/src/types/task.ts`: import and use `CodeTaskRebaseResult`.
- Modify `workers/orchestrator/src/services/task-dispatcher/prompts.ts`: use shared parser and preserve `attempted: false`.
- Modify `workers/orchestrator/src/__tests__/services/task-dispatcher/prompts.test.ts`: failing tests for not-required preservation.
- Modify `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`: callback result includes `{ attempted: false, reason: "not_required" }`.
- Modify `apps/code-agent/src/domain/models/codeTask.ts`: replace string rebase result, add durable merge-ready result fields.
- Modify `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`: persist merge-ready evidence from review/remediation/pull_request completion.
- Modify `apps/code-agent/src/infra/firestore/codeTaskRepositoryWithGroupUpdates.ts`: refresh cached group summaries on result-only merge-ready evidence updates.
- Modify `apps/code-agent/src/routes/webhookRouteSchemas.ts`, `apps/code-agent/src/routes/code/schemas.ts`, `apps/code-agent/src/routes/code/task-routes.ts`, `apps/code-agent/src/routes/code/issueGroupRoutes.ts`, `apps/code-agent/src/routes/code/responseFormatters.ts`: update schemas/types/serialization.
- Modify `apps/code-agent/src/infra/firestore/taskGroupSummary/serializer.ts`: summarize latest durable merge-ready evidence and representative terminal PR state.
- Modify `apps/code-agent/src/domain/models/taskGroupSummary.ts`: add merge-ready evidence fields and representative `prMergedAt`/`prClosedAt` fields.
- Modify `apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts`: unlock `needs-action` from durable merge-ready evidence while preserving terminal PR guards.
- Modify `apps/code-agent/src/domain/issueGrouping/types.ts` and `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`: expose and use merge-ready evidence in live grouping.
- Modify matching tests under `apps/code-agent/src/__tests__/domain/issueGrouping/`, `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/`, and `apps/code-agent/src/__tests__/routes/webhooks.test.ts`.
- Modify `apps/code-agent/src/__tests__/domain/useCases/handlePrClose.test.ts`: assert terminal PR updates cannot leave cached summaries mergeable from durable evidence.
- Modify `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts`: regression coverage for result-only merge-ready evidence refreshing cached summaries.
- Modify `apps/web/src/types/index.ts` and `apps/web/src/types/issueGroups.ts`: align frontend types to object rebase result and merge-ready fields.

---

### Task 1: Add Shared Rebase Evidence Contract

**Files:**
- Create: `packages/code-task-domain/src/rebaseResult.ts`
- Create: `packages/code-task-domain/src/__tests__/rebaseResult.test.ts`
- Modify: `packages/code-task-domain/src/index.ts`

**Interfaces:**
- Produces: `CodeTaskRebaseResult`, `parseCodeTaskRebaseResult(value: unknown): CodeTaskRebaseResult | undefined`, `isRebaseClean(result: CodeTaskRebaseResult | undefined): boolean`
- Consumes: existing orchestrator rebase JSON file content and code-agent task result payloads

- [ ] **Step 1: Write failing shared-package tests**

Add `packages/code-task-domain/src/__tests__/rebaseResult.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  isRebaseClean,
  parseCodeTaskRebaseResult,
} from '../rebaseResult.js';

describe('parseCodeTaskRebaseResult', () => {
  it('preserves not-required evidence when no rebase was attempted', () => {
    expect(parseCodeTaskRebaseResult({ attempted: false })).toEqual({
      attempted: false,
      reason: 'not_required',
    });
  });

  it('preserves successful rebase evidence', () => {
    expect(parseCodeTaskRebaseResult({ attempted: true, success: true })).toEqual({
      attempted: true,
      success: true,
      conflictFiles: [],
    });
  });

  it('preserves conflict files for failed rebase evidence', () => {
    expect(
      parseCodeTaskRebaseResult({
        attempted: true,
        success: false,
        conflictFiles: ['apps/web/src/App.tsx'],
      }),
    ).toEqual({
      attempted: true,
      success: false,
      conflictFiles: ['apps/web/src/App.tsx'],
    });
  });

  it('maps legacy string values for backward compatibility', () => {
    expect(parseCodeTaskRebaseResult('skipped')).toEqual({
      attempted: false,
      reason: 'not_required',
    });
    expect(parseCodeTaskRebaseResult('success')).toEqual({
      attempted: true,
      success: true,
      conflictFiles: [],
    });
    expect(parseCodeTaskRebaseResult('conflict')).toEqual({
      attempted: true,
      success: false,
      conflictFiles: [],
    });
  });

  it('rejects malformed rebase evidence', () => {
    expect(parseCodeTaskRebaseResult({ attempted: true })).toBeUndefined();
    expect(parseCodeTaskRebaseResult({ attempted: true, success: 'yes' })).toBeUndefined();
    expect(parseCodeTaskRebaseResult({ attempted: false, success: true })).toBeUndefined();
  });
});

describe('isRebaseClean', () => {
  it('treats not-required and successful rebase as clean', () => {
    expect(isRebaseClean({ attempted: false, reason: 'not_required' })).toBe(true);
    expect(isRebaseClean({ attempted: true, success: true, conflictFiles: [] })).toBe(true);
  });

  it('does not treat conflicts or absent evidence as clean', () => {
    expect(isRebaseClean({ attempted: true, success: false, conflictFiles: ['x.ts'] })).toBe(false);
    expect(isRebaseClean(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter @intexuraos/code-task-domain exec vitest run src/__tests__/rebaseResult.test.ts
```

Expected: FAIL with missing `../rebaseResult.js`.

- [ ] **Step 3: Implement the shared type and parser**

Create `packages/code-task-domain/src/rebaseResult.ts`:

```typescript
export type CodeTaskRebaseResult =
  | { attempted: false; reason: 'not_required' }
  | { attempted: true; success: true; conflictFiles: string[] }
  | { attempted: true; success: false; conflictFiles: string[] };

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === 'string') ? value : undefined;
}

export function parseCodeTaskRebaseResult(value: unknown): CodeTaskRebaseResult | undefined {
  if (value === 'skipped') return { attempted: false, reason: 'not_required' };
  if (value === 'success') return { attempted: true, success: true, conflictFiles: [] };
  if (value === 'conflict') return { attempted: true, success: false, conflictFiles: [] };

  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;

  if (record['attempted'] === false) {
    if (record['success'] !== undefined) return undefined;
    return { attempted: false, reason: 'not_required' };
  }

  if (record['attempted'] !== true || typeof record['success'] !== 'boolean') {
    return undefined;
  }

  const conflictFiles = stringArray(record['conflictFiles']);
  if (conflictFiles === undefined) return undefined;

  return record['success'] === true
    ? { attempted: true, success: true, conflictFiles }
    : { attempted: true, success: false, conflictFiles };
}

export function isRebaseClean(result: CodeTaskRebaseResult | undefined): boolean {
  if (result === undefined) return false;
  if (result.attempted === false) return true;
  return result.success;
}
```

Modify `packages/code-task-domain/src/index.ts`:

```typescript
export {
  isRebaseClean,
  parseCodeTaskRebaseResult,
  type CodeTaskRebaseResult,
} from './rebaseResult.js';
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @intexuraos/code-task-domain exec vitest run src/__tests__/rebaseResult.test.ts
```

Expected: PASS.

### Task 2: Preserve Not-Required Rebase Evidence in Orchestrator

**Files:**
- Modify: `workers/orchestrator/src/types/task.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/prompts.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/prompts.test.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Interfaces:**
- Consumes: `parseCodeTaskRebaseResult()` from Task 1
- Produces: webhook `result.rebaseResult` object, including `{ attempted: false, reason: "not_required" }`

- [ ] **Step 1: Write failing orchestrator parser tests**

In `workers/orchestrator/src/__tests__/services/task-dispatcher/prompts.test.ts`, extend `describe('parseRebaseResultOutput')`:

```typescript
it('returns not-required rebase evidence for attempted=false', () => {
  const output = JSON.stringify({ attempted: false });
  const result = parseRebaseResultOutput(output, 'task-1', mockLogger as never);
  expect(result).toEqual({ attempted: false, reason: 'not_required' });
});
```

In `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`, extend the legacy class-wrapper `parseRebaseResultOutput` block:

```typescript
it('returns parsed rebase result for valid JSON with attempted: false', () => {
  const output = JSON.stringify({ attempted: false });
  const result = getInternal().parseRebaseResultOutput(output, 'task-not-required');
  expect(result).toEqual({ attempted: false, reason: 'not_required' });
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test src/__tests__/services/task-dispatcher/prompts.test.ts src/__tests__/task-dispatcher.test.ts -- --run -t "parseRebaseResultOutput"
```

Expected: FAIL because `attempted:false` returns `undefined`.

- [ ] **Step 3: Update orchestrator types and parser**

In `workers/orchestrator/src/types/task.ts`, import and use the shared type:

```typescript
import type { CodeTaskRebaseResult } from '@intexuraos/code-task-domain';
```

Replace the inline `rebaseResult` object type with:

```typescript
  rebaseResult?: CodeTaskRebaseResult;
```

In `workers/orchestrator/src/services/task-dispatcher/prompts.ts`, import and delegate:

```typescript
import { parseCodeTaskRebaseResult } from '@intexuraos/code-task-domain';
```

Replace `parseRebaseResultOutput()` body with:

```typescript
export function parseRebaseResultOutput(
  output: string,
  taskId: string,
  logger: Logger
): TaskResult['rebaseResult'] | undefined {
  try {
    return parseCodeTaskRebaseResult(JSON.parse(output));
  } catch (parseError) {
    logger.warn({ taskId, error: parseError }, 'Failed to parse rebase result');
    return undefined;
  }
}
```

- [ ] **Step 4: Update callback test expectations**

In `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`, add a test next to the existing continuation PR result tests:

```typescript
it('includes not-required rebase evidence in continuation PR task result', async () => {
  const task = makeTask({ continuationPrNumber: 42 });
  const exec = makeExec([
    [
      isGhPrView(42),
      {
        stdout: JSON.stringify({
          url: 'https://github.com/pr/42',
          number: 42,
          headRefName: 'feature/int-1846',
          title: 'No rebase needed',
          state: 'OPEN',
          mergedAt: null,
        }),
      },
    ],
  ]);
  const read = makeRead('{"attempted":false}');

  const result = await checkForResult(mockLogger as never, task, exec, read);

  expect(result).toEqual({
    branch: 'feature/int-1846',
    prUrl: 'https://github.com/pr/42',
    summary: 'No rebase needed',
    rebaseResult: { attempted: false, reason: 'not_required' },
  });
});
```

- [ ] **Step 5: Run orchestrator focused tests**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test src/__tests__/services/task-dispatcher/prompts.test.ts src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts src/__tests__/task-dispatcher.test.ts -- --run -t "rebase"
```

Expected: PASS.

### Task 3: Accept and Expose Structured Rebase Evidence in Code-Agent and Web

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`
- Modify: `apps/code-agent/src/routes/webhookRouteSchemas.ts`
- Modify: `apps/code-agent/src/routes/code/schemas.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts`
- Modify: `apps/code-agent/src/routes/code/responseFormatters.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/types/issueGroups.ts`

**Interfaces:**
- Consumes: `CodeTaskRebaseResult`
- Produces: API-visible `result.rebaseResult?: CodeTaskRebaseResult`

- [ ] **Step 1: Write failing code-agent webhook schema test**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, add near task-complete schema tests:

```typescript
it('accepts structured rebaseResult object in task-complete result', async () => {
  const task = await createTask({ agentType: 'pull_request', prNumber: 42 });
  const payload = {
    taskId: task.id,
    status: 'completed' as const,
    result: {
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      summary: 'No changes needed',
      comment_replied: true,
      rebaseResult: { attempted: false, reason: 'not_required' },
    },
  };

  const response = await sendSignedTaskComplete(payload);

  expect(response.statusCode).toBe(200);
  const stored = await codeTaskRepo.findById(task.id);
  expect(stored.ok ? stored.value.result?.rebaseResult : undefined).toEqual({
    attempted: false,
    reason: 'not_required',
  });
});
```

Use the existing helper names in `webhooks.test.ts`; if `createTask` or `sendSignedTaskComplete` is named differently in that file, use the existing local helper rather than adding another fake framework.

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/routes/webhooks.test.ts -- --run -t "structured rebaseResult"
```

Expected: FAIL because schema/model expects a string.

- [ ] **Step 3: Update TypeScript models**

In `apps/code-agent/src/domain/models/codeTask.ts`:

```typescript
import type { CodeTaskRebaseResult } from '@intexuraos/code-task-domain';
```

Replace:

```typescript
  rebaseResult?: 'success' | 'conflict' | 'skipped';
```

with:

```typescript
  rebaseResult?: CodeTaskRebaseResult;
```

Apply the same replacement in `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`, `apps/code-agent/src/routes/code/task-routes.ts`, `apps/code-agent/src/routes/code/issueGroupRoutes.ts`, `apps/code-agent/src/routes/code/responseFormatters.ts`, `apps/web/src/types/index.ts`, and `apps/web/src/types/issueGroups.ts`.

- [ ] **Step 4: Update JSON schemas**

Add the reusable schema in `apps/code-agent/src/routes/code/schemas.ts` or the nearest existing schema module:

```typescript
export const rebaseResultSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        attempted: { type: 'boolean', const: false },
        reason: { type: 'string', enum: ['not_required'] },
      },
      required: ['attempted', 'reason'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        attempted: { type: 'boolean', const: true },
        success: { type: 'boolean' },
        conflictFiles: { type: 'array', items: { type: 'string' } },
      },
      required: ['attempted', 'success'],
      additionalProperties: false,
    },
    {
      type: 'string',
      enum: ['success', 'conflict', 'skipped'],
    },
  ],
} as const;
```

Use this schema for every `result.rebaseResult` occurrence in:

- `apps/code-agent/src/routes/webhookRouteSchemas.ts`
- `apps/code-agent/src/routes/code/schemas.ts`
- `apps/code-agent/src/routes/code/task-routes.ts`

The attempted-object branch must keep `conflictFiles` optional because current orchestrator output already omits it when no files are present; the parser normalizes absent `conflictFiles` to `[]`. The legacy string branch keeps old documents/API clients from breaking while new writes use the object.

Add route/schema compatibility tests for all attempted object shapes:

```typescript
{ attempted: true, success: true }
{ attempted: true, success: false }
{ attempted: true, success: false, conflictFiles: ['apps/web/src/App.tsx'] }
```

- [ ] **Step 5: Run focused code-agent tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/routes/webhooks.test.ts src/__tests__/routes/code/task-routes.test.ts src/__tests__/routes/code/issueGroups.test.ts -- --run -t "rebaseResult|structured rebaseResult|issue groups"
```

Expected: PASS after updating affected fixtures.

### Task 4: Store Durable Merge-Ready Evidence

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`
- Modify: `apps/code-agent/src/domain/services/onReviewSkippedCallback.ts`
- Modify: `apps/code-agent/src/infra/firestore/codeTaskRepositoryWithGroupUpdates.ts`
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/services/onReviewSkippedCallback.test.ts` if this file exists; otherwise add coverage in the existing service test file.
- Modify: `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts`

**Interfaces:**
- Produces on task result:

```typescript
merge_ready?: '1';
merge_ready_reason?: 'review_no_remediation' | 'pull_request_no_changes_rebase_clean' | 'remediation_already_completed' | 'review_skipped';
```

- [ ] **Step 1: Write failing label-path tests**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, add after the existing "adds ready-to-merge label when origin task is an execution task" test:

```typescript
it('persists merge-ready evidence when an execution-origin review passes', async () => {
  await createOriginTask({ traceId: 'trace_merge_ready_review', agentType: 'execution' });
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_merge_ready_review_task' });

  const response = await sendLabelPayload(makeLabelPayload(reviewTask.id));

  expect(response.statusCode).toBe(200);
  const stored = await codeTaskRepo.findById(reviewTask.id);
  expect(stored.ok ? stored.value.result?.merge_ready : undefined).toBe('1');
  expect(stored.ok ? stored.value.result?.merge_ready_reason : undefined).toBe('review_no_remediation');
});
```

Add a pull_request test:

```typescript
it('persists merge-ready evidence for pull_request no-change completion with clean rebase evidence', async () => {
  const task = await createTask({
    agentType: 'pull_request',
    prNumber: 42,
    result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
  });
  const payload = {
    taskId: task.id,
    status: 'completed' as const,
    result: {
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      summary: 'No changes needed',
      comment_replied: true,
      pull_request_outcome_label: 'no_changes_needed',
      rebaseResult: { attempted: false, reason: 'not_required' },
    },
  };

  const response = await sendSignedTaskComplete(payload);

  expect(response.statusCode).toBe(200);
  const stored = await codeTaskRepo.findById(task.id);
  expect(stored.ok ? stored.value.result?.merge_ready : undefined).toBe('1');
  expect(stored.ok ? stored.value.result?.merge_ready_reason : undefined).toBe('pull_request_no_changes_rebase_clean');
});
```

Add a cached-summary propagation regression test for the repository decorator:

```typescript
it('refreshes group summaries when merge-ready evidence changes without a status change', async () => {
  const oldTask = makeTask({
    id: 'task-review',
    status: 'reviewed',
    agentType: 'review',
    result: { needs_remediation: '0' },
  });
  const newTask = {
    ...oldTask,
    result: {
      ...oldTask.result,
      merge_ready: '1',
      merge_ready_reason: 'review_no_remediation',
    },
  };
  const inner = makeRepository({
    findById: async () => ok(oldTask),
    update: async () => ok(newTask),
  });
  const groupSummaryRepo = makeGroupSummaryRepo();
  const repo = withGroupUpdates(inner, groupSummaryRepo, mockLogger as never);

  await repo.update(oldTask.id, { result: newTask.result });

  expect(groupSummaryRepo.updateAfterStatusChange).toHaveBeenCalledWith(oldTask, newTask);
});
```

This test must fail before the decorator change because `withGroupUpdates()` currently only refreshes summaries when `input.status !== undefined`, which leaves cached `latestMergeReadyEvidence` stale after result-only `merge_ready` writes.

- [ ] **Step 2: Add `pull_request_outcome_label` to the completion contract**

In `workers/orchestrator/src/services/completion-verifier/contracts.ts`, add a required enum field to `pull_request.fields` before `comment_replied`:

```typescript
{
  name: 'pull_request_outcome',
  alias: ['Pull request outcome', 'Outcome'],
  kind: 'enum',
  required: true,
  enumValues: ['commits_pushed', 'no_changes_needed'],
},
```

In `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`, map it:

```typescript
const pullRequestOutcome = toStringOr(data['pull_request_outcome']);
if (pullRequestOutcome === 'commits_pushed' || pullRequestOutcome === 'no_changes_needed') {
  base.pull_request_outcome_label = pullRequestOutcome;
}
```

In `workers/orchestrator/src/types/task.ts`, add the producer-side field before mapping it in `webhook-callbacks.ts`:

```typescript
pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
```

Add a focused `buildResultFromVerification` or webhook-callbacks test proving the parsed pull-request final block sets `pull_request_outcome_label` on the outbound webhook result without a type escape.

In both pull request prompts, add the final block line:

```markdown
- Pull request outcome: <commits_pushed|no_changes_needed>
```

Place it before `Comment replied`.

- [ ] **Step 3: Update code-agent result model**

Add to the `TaskResult` interface and all local `result` type blocks that enumerate result properties:

```typescript
  pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
  merge_ready?: '1';
  merge_ready_reason?: 'review_no_remediation' | 'pull_request_no_changes_rebase_clean' | 'remediation_already_completed' | 'review_skipped';
```

- [ ] **Step 4: Implement merge-ready evidence persistence**

First update the group-summary write-through decorator so result-only durable evidence writes refresh cached summaries:

```typescript
function hasMergeReadyEvidenceChange(input: UpdateTaskInput): boolean {
  return input.result?.merge_ready !== undefined || input.result?.merge_ready_reason !== undefined;
}
```

In `withGroupUpdates().update()`, make the refresh decision include result-only merge-ready changes:

```typescript
const shouldUpdateGroupSummary =
  options?.transaction === undefined &&
  (input.status !== undefined || hasMergeReadyEvidenceChange(input));
```

Keep the existing `findById()` before update and `updateAfterStatusChange(oldTask, newTask)` path for this case. The method name is status-oriented, but the behavior already recomputes the summary from old/new task state; using it for merge-ready result changes keeps cached `latestMergeReadyEvidence` synchronized after review, remediation, pull_request, and skipped-review evidence writes.

In `handleTaskCompletion.ts`, make `applyReadyToMergeLabel()` return the computed source:

```typescript
type MergeReadyReason = NonNullable<NonNullable<TaskCompleteWebhookBody['result']>['merge_ready_reason']>;

async function markTaskMergeReady(reason: MergeReadyReason): Promise<void> {
  await codeTaskRepo.update(taskId, {
    result: {
      ...(result ?? {}),
      merge_ready: '1',
      merge_ready_reason: reason,
    },
  });
}
```

After a review task with `needs_remediation === '0'` and non-planning origin succeeds through the existing PR-open guard, call:

```typescript
await markTaskMergeReady('review_no_remediation');
```

After remediation already-completed path:

```typescript
await markTaskMergeReady('remediation_already_completed');
```

For pull_request completion:

```typescript
if (
  task.agentType === 'pull_request' &&
  result?.pull_request_outcome_label === 'no_changes_needed' &&
  isRebaseClean(parseCodeTaskRebaseResult(result.rebaseResult))
) {
  await markTaskMergeReady('pull_request_no_changes_rebase_clean');
}
```

Import `isRebaseClean` and `parseCodeTaskRebaseResult` from `@intexuraos/code-task-domain`.

- [ ] **Step 5: Preserve reviewer tracking-comment skipped-review evidence**

This is the path clarified by the PR feedback: the reviewer/orchestrator decides no review is required, records a `remediation_decision` event with `required: false`, and the managed PR automation tracking comment renders "Remediation not required". Persist that reviewer decision as durable task evidence; do not search for or create a separate comment.

In `onReviewSkippedCallback.ts`, after successful label write and before recompute, update the origin task:

```typescript
await codeTaskRepo.update(origin.id, {
  result: {
    ...(origin.result ?? {}),
    merge_ready: '1',
    merge_ready_reason: 'review_skipped',
  },
});
```

Keep this update deterministic: do not call `recomputeWithLabels` until the origin task update has completed, or explicitly recompute from task documents after the write. The current cached-summary path updates label flags on the existing summary, so a fire-and-forget write can leave `latestMergeReadyEvidence` without the `review_skipped` evidence. Add a focused skipped-review callback test that asserts the origin task stores `merge_ready_reason: 'review_skipped'` before the summary recomputation path reads merge-ready evidence.

Because `withGroupUpdates()` now refreshes summaries on result-only merge-ready changes, this skipped-review path can rely on the awaited origin-task update to refresh cached `latestMergeReadyEvidence` before `recomputeWithLabels()` applies label flags. If the implementation instead chooses an explicit recompute-from-tasks call, add an equivalent test proving `latestMergeReadyEvidence` is true after the skipped-review callback completes.

Keep the existing automation log behavior and add/extend a test that proves the same callback still records:

```typescript
expect(mockAutomationLog.record).toHaveBeenCalledWith(
  { repository: 'pbuchman/intexuraos', prNumber: 42 },
  expect.objectContaining({
    type: 'remediation_decision',
    required: false,
    source: 'review_result',
    signal: '0',
  }),
);
```

This preserves the tracking-comment message for users while adding the durable `merge_ready` state Battlefield needs.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test src/services/__tests__/system-prompt.test.ts src/__tests__/services/completion-verifier/block-parser.test.ts -- --run -t "PULL_REQUEST_AGENT_FINAL|pull_request"
pnpm --filter @intexuraos/code-agent test src/__tests__/routes/webhooks.test.ts -- --run -t "merge-ready evidence|ready-to-merge label|pull_request no-change"
pnpm --filter @intexuraos/code-agent test src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts -- --run -t "merge-ready evidence"
```

Expected: PASS.

### Task 5: Derive Battlefield Mergeability from Durable Evidence

**Files:**
- Modify: `apps/code-agent/src/domain/models/taskGroupSummary.ts`
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummary/serializer.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/types.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`
- Modify: `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`
- Modify: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts`
- Modify: `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/handlePrClose.test.ts`

**Interfaces:**
- Consumes: task result `merge_ready === "1"` and `merge_ready_reason`
- Produces: `TaskGroupSummary.latestMergeReadyEvidence: boolean`, optional `latestMergeReadyReason`, and representative `prMergedAt`/`prClosedAt` terminal guards

- [ ] **Step 1: Write failing aggregate-status tests**

In `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`:

```typescript
it('returns needs-action when durable merge-ready evidence exists without ready-to-merge label', () => {
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: false,
      hasMergeReadyLabel: false,
      latestMergeReadyEvidence: true,
    }),
  ).toBe('needs-action');
});

it('does not return needs-action from durable merge-ready evidence when remediation is required', () => {
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: true,
      hasMergeReadyLabel: false,
      latestMergeReadyEvidence: true,
    }),
  ).not.toBe('needs-action');
});

it('returns needs-action for skipped-review evidence with no review result yet', () => {
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecutionAgent: true,
      hasCompletedExecution: true,
      hasPrUrl: true,
      hasMergeReadyLabel: false,
      latestReviewNeedsRemediation: null,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_skipped',
    }),
  ).toBe('needs-action');
});

it('does not return needs-action from durable merge-ready evidence after PR merge', () => {
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: null,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_skipped',
      prMergedAt: '2026-07-04T12:00:00.000Z',
    }),
  ).not.toBe('needs-action');
});

it('does not return needs-action from durable merge-ready evidence after PR close without merge', () => {
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: false,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
      prClosedAt: '2026-07-04T12:00:00.000Z',
    }),
  ).not.toBe('needs-action');
});
```

- [ ] **Step 2: Write failing live grouping tests**

In `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`:

```typescript
it('shows actionable merge step from durable review merge-ready evidence when Linear label is absent', () => {
  const issueWithoutMergeLabel = {
    identifier: 'INT-1846',
    title: 'Test',
    state: { name: 'In Review', type: 'started' },
    priority: 2,
    assignee: null,
    labels: [{ name: 'code-task' }],
    url: 'https://linear.app/INT-1846',
    commentCount: 0,
    lastCommentAt: null,
  };
  const tasks: SerializedTask[] = [
    makeTask({
      id: 'task-exec',
      linearIssueId: 'INT-1846',
      agentType: 'execution',
      status: 'implemented',
      createdAt: '2026-07-04T10:00:00.000Z',
      updatedAt: '2026-07-04T10:10:00.000Z',
      result: { prUrl: 'https://github.com/owner/repo/pull/1846' },
      linearIssue: issueWithoutMergeLabel,
    }),
    makeTask({
      id: 'task-review',
      linearIssueId: 'INT-1846',
      agentType: 'review',
      status: 'reviewed',
      createdAt: '2026-07-04T10:20:00.000Z',
      updatedAt: '2026-07-04T10:30:00.000Z',
      prNumber: 1846,
      result: {
        prUrl: 'https://github.com/owner/repo/pull/1846',
        needs_remediation: '0',
        merge_ready: '1',
        merge_ready_reason: 'review_no_remediation',
      },
      linearIssue: issueWithoutMergeLabel,
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups[0]?.pipeline.steps.find((s) => s.agentType === 'merge')?.state).toBe('actionable');
  expect(groups[0]?.pipeline.pr?.status).toBe('mergeable');
});

it('shows actionable merge step from pull_request no-changes clean-rebase evidence', () => {
  const tasks: SerializedTask[] = [
    makeTask({
      id: 'task-pr',
      linearIssueId: 'INT-1846',
      agentType: 'pull_request',
      status: 'implemented',
      createdAt: '2026-07-04T10:00:00.000Z',
      updatedAt: '2026-07-04T10:10:00.000Z',
      prNumber: 1846,
      result: {
        prUrl: 'https://github.com/owner/repo/pull/1846',
        pull_request_outcome_label: 'no_changes_needed',
        rebaseResult: { attempted: false, reason: 'not_required' },
        merge_ready: '1',
        merge_ready_reason: 'pull_request_no_changes_rebase_clean',
      },
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups[0]?.pipeline.steps.find((s) => s.agentType === 'merge')?.state).toBe('actionable');
  expect(groups[0]?.pipeline.pr?.status).toBe('mergeable');
});

it('shows actionable merge step from skipped-review evidence stored on the origin execution task', () => {
  const tasks: SerializedTask[] = [
    makeTask({
      id: 'task-exec',
      linearIssueId: 'INT-1846',
      agentType: 'execution',
      status: 'implemented',
      createdAt: '2026-07-04T10:00:00.000Z',
      updatedAt: '2026-07-04T10:10:00.000Z',
      prNumber: 1846,
      result: {
        prUrl: 'https://github.com/owner/repo/pull/1846',
        merge_ready: '1',
        merge_ready_reason: 'review_skipped',
      },
      linearIssue: {
        identifier: 'INT-1846',
        title: 'Test',
        state: { name: 'In Review', type: 'started' },
        priority: 2,
        assignee: null,
        labels: [{ name: 'code-task' }],
        url: 'https://linear.app/INT-1846',
        commentCount: 0,
        lastCommentAt: null,
      },
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups[0]?.pipeline.steps.find((s) => s.agentType === 'merge')?.state).toBe('actionable');
  expect(groups[0]?.pipeline.pr?.status).toBe('mergeable');
});

it('does not show merge step from skipped-review durable evidence after the PR merged', () => {
  const tasks: SerializedTask[] = [
    makeTask({
      id: 'task-exec',
      linearIssueId: 'INT-1846',
      agentType: 'execution',
      status: 'implemented',
      createdAt: '2026-07-04T10:00:00.000Z',
      updatedAt: '2026-07-04T10:10:00.000Z',
      prNumber: 1846,
      prMergedAt: '2026-07-04T12:00:00.000Z',
      result: {
        prUrl: 'https://github.com/owner/repo/pull/1846',
        merge_ready: '1',
        merge_ready_reason: 'review_skipped',
      },
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups[0]?.pipeline.steps.find((s) => s.agentType === 'merge')).toBeUndefined();
  expect(groups[0]?.pipeline.pr?.status).toBe('merged');
});

it('does not show merge step from durable review evidence after the PR closed without merge', () => {
  const tasks: SerializedTask[] = [
    makeTask({
      id: 'task-review',
      linearIssueId: 'INT-1846',
      agentType: 'review',
      status: 'reviewed',
      createdAt: '2026-07-04T10:00:00.000Z',
      updatedAt: '2026-07-04T10:10:00.000Z',
      prNumber: 1846,
      prClosedAt: '2026-07-04T12:00:00.000Z',
      result: {
        prUrl: 'https://github.com/owner/repo/pull/1846',
        needs_remediation: '0',
        merge_ready: '1',
        merge_ready_reason: 'review_no_remediation',
      },
    }),
  ];

  const groups = groupByLinearIssue(tasks);

  expect(groups[0]?.pipeline.steps.find((s) => s.agentType === 'merge')).toBeUndefined();
  expect(groups[0]?.pipeline.pr?.status).toBe('closed');
});
```

- [ ] **Step 3: Update summary model and serializer**

In `TaskGroupSummary`, add:

```typescript
  latestMergeReadyEvidence: boolean;
  latestMergeReadyReason: string | null;
  prMergedAt: Timestamp | null;
  prClosedAt: Timestamp | null;
```

In `docToSummary()`, default legacy docs:

```typescript
latestMergeReadyEvidence: data['latestMergeReadyEvidence'] === true,
latestMergeReadyReason: data['latestMergeReadyReason'] !== undefined && data['latestMergeReadyReason'] !== null
  ? String(data['latestMergeReadyReason'])
  : null,
prMergedAt: data['prMergedAt'] !== undefined && data['prMergedAt'] !== null
  ? toTimestamp(data['prMergedAt'])
  : null,
prClosedAt: data['prClosedAt'] !== undefined && data['prClosedAt'] !== null
  ? toTimestamp(data['prClosedAt'])
  : null,
```

Add helper in serializer:

```typescript
function isPrTerminal(task: CodeTask): boolean {
  return task.prMergedAt !== undefined || task.prClosedAt !== undefined;
}

function getMergeReadyReason(task: CodeTask): string | null {
  return task.status !== 'archived' &&
    !isPrTerminal(task) &&
    task.result?.merge_ready === '1' &&
    task.result.merge_ready_reason !== undefined
    ? task.result.merge_ready_reason
    : null;
}
```

When creating, status-changing, or recomputing summaries, track the latest non-archived, non-terminal task with `merge_ready === "1"` across review, pull_request, remediation, and execution tasks. The execution-task path is required for `merge_ready_reason: "review_skipped"` because skipped-review evidence is persisted on the origin execution task. Set:

```typescript
latestMergeReadyEvidence = latestMergeReadyReason !== null;
```

Also track representative PR terminal state in the summary from the same non-archived PR owner used for `prNumber`. Select that owner with the same rule as live grouping: newest non-archived task with `result.prUrl` by `updatedAt` descending, so a merged plan PR does not suppress an open execution PR for the same Linear issue.

```typescript
prMergedAt = prOwnerTask?.prMergedAt !== undefined ? toTimestamp(prOwnerTask.prMergedAt) : null;
prClosedAt = prOwnerTask?.prClosedAt !== undefined ? toTimestamp(prOwnerTask.prClosedAt) : null;
```

Update `withGroupUpdates().update()` so cached summaries refresh when either durable merge-ready evidence or representative PR terminal state changes:

```typescript
function hasGroupSummaryRelevantResultChange(input: UpdateTaskInput): boolean {
  return input.result?.merge_ready !== undefined || input.result?.merge_ready_reason !== undefined;
}

function hasGroupSummaryRelevantPrTerminalChange(input: UpdateTaskInput): boolean {
  return input.prMergedAt !== undefined || input.prClosedAt !== undefined;
}

const shouldUpdateGroupSummary =
  options?.transaction === undefined &&
  (
    input.status !== undefined ||
    hasGroupSummaryRelevantResultChange(input) ||
    hasGroupSummaryRelevantPrTerminalChange(input)
  );
```

Add regression tests proving:

- result-only `merge_ready` updates refresh cached `latestMergeReadyEvidence`;
- `prMergedAt` updates refresh cached summaries and suppress merge-ready `needs-action`;
- `prClosedAt` updates refresh cached summaries and suppress merge-ready `needs-action`.
- sibling plan/execution PR summaries keep the open execution PR as representative even when the older plan PR is merged.

- [ ] **Step 4: Update aggregate derivation**

In `GroupSummaryFields`, add:

```typescript
latestMergeReadyEvidence?: boolean;
latestMergeReadyReason?: string | null;
prMergedAt?: unknown;
prClosedAt?: unknown;
```

Replace the existing execution-agent active gate and merge case with:

```typescript
const hasDurableMergeReady = fields.latestMergeReadyEvidence === true;
const hasMergeReadiness = (fields.hasMergeReadyLabel ?? false) || fields.latestMergeReadyEvidence === true;
const isPrTerminal = fields.prMergedAt !== undefined && fields.prMergedAt !== null
  || fields.prClosedAt !== undefined && fields.prClosedAt !== null;

// Active gate exception: skipped-review evidence has no review task, so
// latestReviewNeedsRemediation is null. Durable merge-ready evidence must bypass
// the same active gate as the ready-to-merge label.
if (
  fields.hasCompletedExecutionAgent &&
  fields.latestReviewNeedsRemediation !== false &&
  !hasMergeReadiness
) {
  return 'active';
}

if (
  fields.hasCompletedExecution &&
  fields.hasPrUrl &&
  hasDurableMergeReady &&
  !isPrTerminal &&
  fields.latestReviewNeedsRemediation !== true
) {
  return 'needs-action';
}

if (
  fields.hasPrUrl &&
  !isPrTerminal &&
  fields.latestReviewNeedsRemediation !== true &&
  hasMergeReadiness
) {
  return 'needs-action';
}
```

- [ ] **Step 5: Update live pipeline derivation**

In `SerializedTask['result']`, add the new fields and object `rebaseResult`.

In `derivePipeline()`, add:

```typescript
function hasDurableMergeReadyEvidence(task: SerializedTask | undefined): boolean {
  return task !== undefined &&
    task.result?.merge_ready === '1' &&
    task.prMergedAt === undefined &&
    task.prClosedAt === undefined;
}
```

Then add a merge step before PR badge derivation when:

```typescript
if (
  !hasActiveTask &&
  !isPrClosedOrMerged &&
  !steps.some((s) => s.agentType === 'merge') &&
  (
    hasDurableMergeReadyEvidence(reviewEntry?.task) ||
    hasDurableMergeReadyEvidence(stepMap.get('execution')?.task) ||
    hasDurableMergeReadyEvidence(stepMap.get('pull_request')?.task) ||
    hasDurableMergeReadyEvidence(stepMap.get('remediation')?.task)
  )
) {
  steps.push({
    agentType: 'merge',
    state: 'actionable',
    label: 'Merge',
  });
}
```

Keep this after the existing label and remediation paths so existing tests continue to document current behavior. Treat durable merge-ready evidence as the same exception as `ready-to-merge` in any completed-execution active gate; otherwise summary-derived `review_skipped` evidence can be preempted before the merge-ready branch.

- [ ] **Step 6: Run focused grouping tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts src/__tests__/domain/useCases/handlePrClose.test.ts -- --run
```

Expected: PASS.

### Task 6: Verification and Migration Safety

**Files:**
- Modify tests only if required by type/schema changes.
- Do not add a Firestore migration unless tests prove existing documents cannot deserialize with defaulted fields.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified implementation PR.

- [ ] **Step 1: Run workspace verifies for touched workspaces**

Run:

```bash
pnpm run verify:workspace:tracked -- code-task-domain
pnpm run verify:workspace:tracked -- orchestrator
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- web
```

Expected: all pass.

- [ ] **Step 2: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: all phases pass.

- [ ] **Step 3: Manual data verification after deploy**

After the PR is deployed, create or use a PR-review/pull_request task where no changes are needed and the rebase file reports:

```json
{"attempted":false}
```

Verify the task document stores:

```json
{
  "result": {
    "rebaseResult": { "attempted": false, "reason": "not_required" },
    "merge_ready": "1",
    "merge_ready_reason": "pull_request_no_changes_rebase_clean"
  }
}
```

Verify the issue group API returns `pipeline.pr.status === "mergeable"` and a merge action while the PR is open, then returns `merged` after PR merge and `handlePrClose` sets `prMergedAt`.

Also create or use a reviewer skipped-review case where the managed PR automation tracking comment contains "Remediation not required". Verify the origin execution task stores:

```json
{
  "result": {
    "merge_ready": "1",
    "merge_ready_reason": "review_skipped"
  }
}
```

Verify the issue group API returns the Violet merge action while the PR is open without requiring a separate PR comment, then suppresses the action after either `prMergedAt` or `prClosedAt` is populated.

---

## Self-Review

- Spec coverage: The plan covers identifying recent archived tasks, incorporates the clarified reviewer tracking-comment evidence path, states that exact rebase wording was not found, explains the evidence failure, and prepares a fix plan with concrete files/tests.
- Placeholder scan: No `TBD`, `TODO`, or open-ended "add tests" steps remain.
- Type consistency: `CodeTaskRebaseResult`, `merge_ready`, `merge_ready_reason`, and `pull_request_outcome_label` are named consistently across tasks.
