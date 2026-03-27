# Agent Dispatch, Container Lifecycle & Remediation Prompt Refactor

**Linear:** [INT-1130](https://linear.app/pbuchman/issue/INT-1130)
**Date:** 2026-03-27

## Problem

The `@worker` directive on PR comments routes to the `remediation` agent type, which has the wrong system prompt (mandates executing-plans skill, deprioritizes user prompt, no PR communication). The routing was introduced in `ec1942fe5` to fix session degradation and model-directive-ignore bugs, but the cure introduced worse predictability issues. Additionally, `pull_request` containers are not preserved, `CodeWorkerNitpickNukerTemplate` is dead code, and the remediation prompt doesn't leverage the nitpick-nuker skill that actually handles review comment triage.

## Decisions

| #   | Decision                                  | Choice                                            |
| --- | ----------------------------------------- | ------------------------------------------------- |
| 1   | Preserved container scoping               | One per PR number                                 |
| 2   | Pruned task fallback                      | Orchestrator calls code-agent internal API        |
| 3   | Reuse mode for non-@worker comments       | sendMessage to preserved container                |
| 4   | Bot review routing                        | Remove CodeWorkerNitpickNukerTemplate (dead code) |
| 5   | Nitpick-nuker scope in remediation        | All unprocessed comments                          |
| 6   | @worker auto alias                        | Keep                                              |
| 7   | Reuse detection location                  | Code-agent before dispatch                        |
| 8   | Lock doc handling                         | Delete lock doc when preserving container         |
| 9   | Pre-loaded findings in remediation prompt | Remove; emphasize nitpick-nuker as mandatory      |
| 10  | PR lifecycle cleanup                      | Auto-cleanup preserved containers on merge/close  |

## Changes

### 1. @worker comments dispatch to pull_request (fresh container)

**Files:** `gitHubDispatchService.ts`, `createTaskForPR.ts`, `dispatchWorkerTriage.ts`

Remove the `isRemediationDispatch` fork in `gitHubDispatchService.ts:118-120`. The `@worker` directive no longer determines agent type — it only determines `workerType`.

Flow:
1. `extractDispatchWorkerType()` extracts worker type from `@worker <type>`
2. If found: check for preserved pull_request container on this PR (see Section 3)
3. If preserved container exists: destroy it via orchestrator cancel
4. Pass `workerType` override to `createTaskForPR`
5. `createTaskForPR` creates a `pull_request` task with the specified `workerType`

`createTaskForPR.ts`:
- Add optional `workerType?: WorkerType` to `CreateTaskForPRRequest`
- When set, use it instead of the default worker type resolution

### 2. Non-@worker PR comments reuse preserved container

**Files:** `gitHubDispatchService.ts`, code-agent Firestore queries

Before calling `createTaskForPR`, code-agent checks Firestore for a preserved pull_request task matching `{repository, prNumber, agentType: 'pull_request', status: 'implemented'}`.

If found:
1. Call orchestrator `POST /tasks/:taskId/message` with the PR comment body
2. If sendMessage succeeds: return `{ dispatched: true }` — done
3. If sendMessage fails (container destroyed, task pruned): fall through to `createTaskForPR`

Query: `codeTaskRepo.findPreservedPullRequestTask(repository, prNumber)` — new repository method.

### 3. Container preservation rules

**File:** `task-dispatcher.ts` `finalizeTask()` (line 1879-1882)

Current non-preservable: `review`, `pull_request`, `remediation`
New non-preservable: `review`, `remediation`

```typescript
const isNonPreservableAgentType =
    task.agentType === 'review' ||
    task.agentType === 'remediation';
```

Only `planning`, `execution`, and `pull_request` containers are preserved after completion.

### 4. One preserved pull_request container per PR

**File:** `task-dispatcher.ts` `finalizeTask()`

Before calling `preserveWorker()` for a `pull_request` task:
1. Query `listPreservedWorkers()` for existing preserved containers
2. Match by PR number (`task.continuationPrNumber` or a new field — PR number must be stored on the Task record)
3. If found: destroy the old preserved container via `destroyWorker()`
4. Then preserve the new one

The Task type already has `continuationPrNumber` for continuation flows. For pull_request tasks created via `createTaskForPR`, the PR number is available from the dispatch request. Ensure it's set on the Task record during dispatch (in `task-dispatcher.ts:360` spread).

### 5. Lock doc cleanup on preserve

**File:** `webhookRoutes.ts` task-complete handler

When a `pull_request` task completes successfully and its container will be preserved, delete the per-PR lock doc (`buildLockDocPath(repository, prNumber)`). This allows subsequent `createTaskForPR` calls (from `@worker`) to create new tasks without hitting the duplicate guard.

The existing `cleanupLockIfPR()` helper in the task-complete handler already does this. Verify it fires for preserved pull_request tasks — currently it runs unconditionally on task completion.

### 6. No sendMessage for review/remediation tasks

**File:** `task-dispatcher.ts` `sendMessage()` (line 578-656)

Add agentType guard after loading the task:

```typescript
if (task.agentType === 'review' || task.agentType === 'remediation') {
    return {
        ok: false,
        error: { type: 'invalid_agent_type', message: 'Cannot send messages to review/remediation tasks' },
    };
}
```

**Files:** `V2MessageInput.tsx`, `ChatPanel.tsx`

Hide message input when `task.agentType` is `review` or `remediation`. Show a static label: "Messages not available for review/remediation tasks".

### 7. Fallback for pruned tasks

**File (new):** `apps/code-agent/src/routes/internalRoutes.ts` — new endpoint

`GET /internal/tasks/:taskId/dispatch-metadata`

Returns minimal metadata for task reconstruction:
```typescript
{ taskId, prompt, repository, baseBranch, agentType, workerType, linearIssueId, webhookSecret, prNumber }
```

**File:** `task-dispatcher.ts` `sendMessage()`

When task is not found in state persistence:
1. Call code-agent `GET /internal/tasks/:taskId/dispatch-metadata`
2. If found: reconstruct a minimal Task, start a fresh container with the user's message
3. If not found: return `not_found` error

### 8. PR merge/close cleanup

**File:** `webhookRoutes.ts` or `handlePrMerge.ts`

When code-agent receives a PR merge/close event:
1. Query Firestore for preserved pull_request task on the merged PR
2. If found: call orchestrator `DELETE /tasks/:taskId` to destroy the preserved container
3. Best-effort — failure logged but doesn't block

### 9. Remove @model directive

**File:** `dispatchWorkerTriage.ts`

```typescript
// Before:
export const DISPATCH_WORKER_PATTERNS = ['@worker', '@model'] as const;

// After:
export const DISPATCH_WORKER_PATTERNS = ['@worker'] as const;
```

Update regex, JSDoc, all tests referencing `@model`.

### 10. Remove CodeWorkerNitpickNukerTemplate (dead code)

**Files:** `gitHubMessageBuilder.ts`, `services.ts`, all related tests

- Delete `CodeWorkerNitpickNukerTemplate` class
- Remove `codeWorkerBots` parameter from `createWebhookMessageBuilder()`
- Remove `codeWorkerBots` wiring in `services.ts`
- Delete test cases for the template

Evidence: `CodeWorkerOutputRule` (line 82-83 of `gitHubWebhookRules.ts`) returns `{ action: 'skip', reason: 'CODE_WORKER_REVIEW_HANDLED_BY_TASK_COMPLETE' }` for all code-worker bot `pull_request_review` events. The template is unreachable.

### 11. Remediation prompt rewrite

**File:** `workers/orchestrator/src/services/system-prompt.ts` `remediationPrompt`

**Remove:**
- "Mandatory Skill Order" section (executing-plans, receiving-code-review)
- "System prompt instructions are the source of truth. The user prompt is secondary context."
- "Remediation Scope" section about fixing review findings
- "Implementation Flow" 6-step sequence

**Replace with:**

Instruction priority:
> "System prompt defines your workflow and mandatory steps. The user prompt contains task context (trigger comment, PR details). Both are required."

Core execution — mandatory nitpick-nuker:
1. Read the Linear issue and all comments (keep existing mandatory first action)
2. Call `PATCH /internal/tasks/:id/remediation-status` with re-review decision — this must happen BEFORE nitpick-nuker because the skill handles push. Base the decision on the scope of unprocessed findings (many structural changes = re-review, minor fixes = no re-review).
3. **Run `/nitpick-nuker <prNumber>`** — this is the primary and mandatory execution step. The skill fetches all unprocessed review comments, triages each (FIX/SKIP), implements fixes, runs CI, and posts a summary comment on the PR. Do NOT skip this step. Do NOT attempt to manually fix review comments instead of running the skill. Do NOT proceed to the completion block until nitpick-nuker has finished.
4. Output `REMEDIATION_AGENT_FINAL` block

Bump version to `2.0.0` (major: behavior change — new mandatory skill, removed old skills).

### 12. Remove pre-loaded findings from remediation prompt

**File:** `apps/code-agent/src/domain/usecases/createRemediationTask.ts` `buildRemediationPrompt()`

Remove:
- `reviewBody` section ("### Review Findings")
- `inlineComments` section ("### Inline Comments")
- `triggerComment` section (only for auto-triggered remediation; keep for human-triggered `@worker` — but `@worker` now routes to `pull_request`, so this is moot)

Remove from `CreateRemediationTaskRequest`:
- `reviewBody?: string`
- `inlineComments?: { path: string; line: number; body: string }[]`
- `triggerComment?: { body: string; author: string }`

Clean up callers in `webhookRoutes.ts` that pass these fields and the `enrichReviewWithComments` call.

## Endpoint Changes

| Type      | Endpoint                                        | Description                                                     |
| --------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Created   | `GET /internal/tasks/:taskId/dispatch-metadata` | Returns minimal task metadata for pruned task reconstruction    |
| Modified  | `POST /tasks/:taskId/message` (orchestrator)    | Rejects review/remediation agentType                            |
| Unchanged | `POST /tasks` (orchestrator dispatch)           | No API change, but pull_request tasks now include PR number     |
| Unchanged | `DELETE /tasks/:taskId` (orchestrator)          | Used for preserved container cleanup on merge/close and @worker |

## Out of Scope

- Changing the review agent dispatch flow (stays as-is via `createReviewTask`)
- Changing planning/execution dispatch (stays as-is)
- Modifying nitpick-nuker skill internals (unless testing reveals remediation-specific issues)
- Container resource limits or timeout changes
