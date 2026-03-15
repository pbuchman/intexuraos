# Fresh-Start Review Dispatch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution mode:** Execute all tasks end-to-end without stopping for user approval between stages. Only stop if CI fails or a blocking error is encountered.

**Goal:** Ensure every review request starts a brand-new review task with fresh context, while generic PR comments never resume review tasks and invalid or stale review completions cannot overwrite task state.

**Architecture:** Keep review creation centralized in `createReviewTask`, but change it from dedup-and-skip to cancel-and-recreate. Keep generic PR comment routing in `createWebhookDispatchService`, but give it a dedicated non-review lookup path. Harden both ends of the review lifecycle: explicit `@review` triage fails closed in code-agent, and review output verification and cancelled-callback handling become strict across code-agent and orchestrator.

**Tech Stack:** TypeScript, Fastify, Firestore, Zod, Vitest

**Files overview:**
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts` — replace active-review reuse with cancel-and-recreate, return effective worker type
- Modify: `apps/code-agent/src/services.ts` — pass `workerSettingsRepo` into review-task creation wiring
- Modify: `apps/code-agent/src/domain/utils/prTaskNotification.ts` — add review replacement cancellation comment and show worker type on review outcomes
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts` — add a dedicated non-review PR lookup port
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` — implement non-review PR lookup with backward-compatible filtering
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts` — route generic comments only to non-review tasks
- Modify: `apps/code-agent/src/domain/services/unifiedEvaluator.ts` — fail closed for explicit `@review` triage failures and use effective worker type in triage comments
- Modify: `apps/code-agent/src/domain/usecases/githubAgent.ts` — make issue-comment review triage less brittle
- Modify: `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts` — require a short final sentence after tool calls
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts` — add worker extraction for fail-closed triage comments
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` — ignore stale callbacks for already-cancelled tasks and pass worker type to review outcome comments
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` — make review schema validation match webhook enforcement
- Modify tests: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`, `apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts`, `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`, `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`, `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`, `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`, `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`, `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`
- Create: `apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts`

**Public and internal interface changes:**
- Change `CreateReviewTaskResult` to always represent a fresh review creation:

```ts
export type CreateReviewTaskResult = {
  status: 'created';
  taskId: string;
  workerType: WorkerType;
};
```

- Extend `CreateReviewTaskDeps` with `workerSettingsRepo`
- Extend `TaskOutcomeCommentRequest` with `workerType?: string`
- Add a new repository method:

```ts
findLatestNonReviewTaskByPR(
  repository: string,
  prNumber: number
): Promise<Result<CodeTask | null, RepositoryError>>;
```

- Add a new helper:

```ts
export function extractReviewWorkerType(commentBody: string): WorkerType | undefined;
```

**Locked decisions and defaults:**
- Every review request is a fresh task. No review task is ever resumed, queued with follow-up context, or reused.
- If an active review exists, replace it: post a PR comment first, cancel the old task locally, attempt best-effort worker cancellation, then create a new review task.
- If the local cancel update fails, do not create the replacement review task.
- If the PR cancellation comment fails to post, still continue with cancel-and-replace so the fresh-start rule holds.
- Generic non-`@review` comments use the newest non-review task if one exists; otherwise they create a fresh `pull_request` task.
- Legacy tasks with missing `agentType` are treated as non-review for generic comment routing.
- Explicit `@review` LLM failures fail closed. They do not fallback-dispatch and do not resume any task.
- Any webhook callback that arrives after a task is already `cancelled` is acknowledged and ignored.

---

## Chunk 1: Replace Review Reuse with Cancel-and-Recreate

### Task 1: Add review replacement notifications and reviewer metadata

**Files:**
- Modify: `apps/code-agent/src/domain/utils/prTaskNotification.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- Review success comments include `**Reviewer:** \`<worker>\``
- Review failure comments include `**Reviewer:** \`<worker>\``
- A new replacement comment exists with heading `### Automated Code Review Cancelled`
- The replacement comment includes the cancelled task ID
- The replacement comment includes the old worker type when present

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
```

Expected: FAIL because `workerType` is not supported on review outcomes and the replacement notification helper does not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/utils/prTaskNotification.ts`:
- Add `workerType?: string` to `TaskOutcomeCommentRequest`
- For review outcomes only, render:

```ts
if (isReview && request.workerType !== undefined) {
  lines.push(`**Reviewer:** \`${request.workerType}\``);
}
```

- Add:

```ts
export interface ReviewReplacementCommentRequest {
  taskId: string;
  repository: string;
  prNumber: number;
  userId: string;
  replacedTaskId: string;
  replacedWorkerType?: string;
}
```

- Add `buildReviewReplacementComment()` and `notifyReviewReplaced()`
- Remove `notifyReviewSkipped()` only after all callers and tests have been migrated away from skip semantics

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/utils/prTaskNotification.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
git commit -m "feat(code-agent): add review replacement notifications"
```

### Task 2: Replace active review dedup with active review replacement

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Modify: `apps/code-agent/src/services.ts`
- Test: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- When `findActiveReviewForPR()` returns a queued/dispatched/running review task, the use case posts the replacement comment first, cancels the old task, and creates a new review task with a new task ID
- If the local `codeTaskRepo.update(existingTask.id, ...)` cancel step fails, the use case returns an error and does not create a new task
- If worker cancellation throws or fails, the new review still gets created after the local cancel succeeded
- The result always returns `{ status: 'created', taskId, workerType }`
- `userLookupService.resolveByGitHubUsername()` is still skipped until after active-review replacement is handled only if the existing task provides enough data for replacement-side operations

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
```

Expected: FAIL because current behavior returns `already_running` and never cancels the old review.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/usecases/createReviewTask.ts`:
- Add `workerSettingsRepo` to deps
- Resolve effective worker type before prompt building:

```ts
const effectiveWorkerType = request.workerType ?? 'auto';
```

- When an active review exists:
  - Call `notifyReviewReplaced(...)`
  - Update the old task:

```ts
await codeTaskRepo.update(existingTask.id, {
  status: 'cancelled',
  completedAt: new Date(),
  error: {
    code: 'review_replaced',
    message: 'Review task was cancelled because a fresh review was requested',
  },
});
```

  - Resolve worker credentials from `workerSettingsRepo.getSettings(existingTask.userId)` by matching `existingTask.workerLocation`
  - Call `taskDispatcher.cancelOnWorker(existingTask.id, existingTask.workerLocation, workerCreds)` best-effort
  - Continue into normal task creation
- Change the return type to always be `created`
- Return the effective worker type from the use case

In `apps/code-agent/src/services.ts`:
- Pass `workerSettingsRepo` into the `createReviewTask(...)` dependency object

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/usecases/createReviewTask.ts apps/code-agent/src/services.ts apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts apps/code-agent/src/domain/utils/prTaskNotification.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
git commit -m "feat(code-agent): replace active reviews with fresh tasks"
```

## Chunk 2: Keep Generic Comments Out of Review Tasks

### Task 3: Add a non-review PR lookup path in the repository

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- Test: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- `findLatestNonReviewTaskByPR()` returns the newest non-review task for a PR
- It ignores `agentType: 'review'`
- It treats a missing `agentType` as non-review
- It returns `null` when every matching task is a review task

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
```

Expected: FAIL because the new method does not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, add:

```ts
findLatestNonReviewTaskByPR(
  repository: string,
  prNumber: number
): Promise<Result<CodeTask | null, RepositoryError>>;
```

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`:
- Do not change `findByPR()` semantics
- Implement `findLatestNonReviewTaskByPR()` by querying the newest 10 tasks for the repo/PR and returning the first task where `task.agentType !== 'review'` or `task.agentType === undefined`
- Keep this method separate so existing PR-correlation callers are untouched

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
git commit -m "feat(code-agent): add non-review PR task lookup"
```

### Task 4: Route generic comments only to non-review tasks

**Files:**
- Modify: `apps/code-agent/src/domain/services/gitHubDispatchService.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- If the newest existing task is a review task and a non-review task also exists, the service resumes the non-review task
- If the only existing task is a review task, the service goes down the new-task path and creates a fresh `pull_request` task
- Generic PR comments never call `sendTaskMessage()` on review tasks

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
```

Expected: FAIL because the service still calls `findByPR()` and resumes the newest task regardless of agent type.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/services/gitHubDispatchService.ts`:
- Replace the initial `findByPR(...)` lookup with `findLatestNonReviewTaskByPR(...)`
- Keep the rest of the workflow intact:
  - if task exists, `handleExistingTask(...)`
  - if no compatible task exists, `handleNewTask(...)`
- Do not change review-task creation behavior in this service; review requests continue to be handled by `UnifiedEvaluator`

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/services/gitHubDispatchService.ts apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts
git commit -m "fix(code-agent): keep generic comments out of review tasks"
```

## Chunk 3: Fail Closed for Explicit Review Triage Errors

### Task 5: Add review worker extraction helper

**Files:**
- Modify: `apps/code-agent/src/domain/utils/reviewTriage.ts`
- Create: `apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- `extractReviewWorkerType('@review with minimax')` returns `minimax`
- `extractReviewWorkerType('@review architecture security qwen')` returns `qwen3.5-plus`
- `extractReviewWorkerType('@review architecture')` returns `undefined`
- Unknown worker names return `undefined`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/utils/reviewTriage.ts`, add a simple parser that:
- lowercases the comment body
- searches for any supported worker alias token
- normalizes via the existing alias table
- returns the first recognized worker type

Do not add heuristic scope parsing here. Keep it worker-only.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/utils/reviewTriage.ts apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts
git commit -m "feat(code-agent): add review worker extraction helper"
```

### Task 6: Remove fallback dispatch for explicit `@review` failures and use effective worker type

**Files:**
- Modify: `apps/code-agent/src/domain/services/unifiedEvaluator.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- When `evaluateEvent()` fails for an explicit `@review` comment, `dispatchService.dispatch()` is not called
- A triage failure comment is posted instead
- That triage failure comment includes `**Worker type:**` when `extractReviewWorkerType(...)` can determine one
- Successful review triage comments use `reviewResult.value.workerType`, not just `triage.workerType`
- Event decisions still record `dispatchParams.workerType`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts
```

Expected: FAIL because current fallback dispatch still fires for issue comments and triage comments use `already_running` and/or raw triage worker handling.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/services/unifiedEvaluator.ts`:
- Import `isReviewCommandComment` and `extractReviewWorkerType`
- In the `!llmResult.ok` branch, if `event.eventType === 'issue_comment'` and `isReviewCommandComment(event.body ?? '')`, do not call `handleFallback(...)`
- Instead:
  - build and post an error triage comment
  - include the parsed worker type if present
  - record a `skip` decision with a `review_triage_failed:` reason
- Remove the `already_running` display path from `buildTriageCommentBody(...)`
- For successful review triage comments, use `reviewResult.value.workerType`

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/services/unifiedEvaluator.ts apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts apps/code-agent/src/domain/utils/reviewTriage.ts apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts
git commit -m "fix(code-agent): fail closed for explicit review triage errors"
```

### Task 7: Make issue-comment review triage less brittle

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/githubAgent.ts`
- Modify: `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts`
- Test: `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- Issue-comment review triage uses `maxIterations: 5`
- The prompt explicitly instructs the model to return one short final sentence after tool calls
- Multi-review `@review architecture, security with qwen` still yields `workerType: 'qwen3.5-plus'`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts
```

Expected: FAIL because issue-comment review triage still uses `maxIterations: 3` and the prompt does not require a final sentence after tool calls.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/domain/usecases/githubAgent.ts`:

```ts
const agentResult = await toolCallingClient.run({
  systemPrompt,
  messages: [{ role: 'user', content: 'Evaluate this comment and decide what action to take.' }],
  tools,
  maxIterations: 5,
});
```

In `apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts`, add under review-command instructions:

```md
- After you finish all `request_review` tool calls or the `skip` tool call, return one short final sentence and stop.
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/domain/usecases/githubAgent.ts apps/code-agent/src/domain/prompts/issueCommentTriagePrompt.ts apps/code-agent/src/__tests__/usecases/githubAgent.test.ts apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts
git commit -m "fix(code-agent): harden issue comment review triage"
```

## Chunk 4: Enforce Review Output Correctly and Ignore Stale Callbacks

### Task 8: Tighten orchestrator review validation

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- `REVIEW_SCHEMA` accepts `review_comments_posted: '3'` and `review_types: 'code_quality,security'`
- `REVIEW_SCHEMA` rejects `review_comments_posted: ''`
- `REVIEW_SCHEMA` rejects `review_comments_posted: 'three'`
- `REVIEW_SCHEMA` rejects `review_types: ''`
- `REVIEW_SCHEMA` rejects `review_types: '   '`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
```

Expected: FAIL because the current schema accepts empty strings.

- [ ] **Step 3: Write minimal implementation**

In `workers/orchestrator/src/services/completion-verifier.ts`, change:

```ts
export const REVIEW_SCHEMA = z.object({
  gh_pr_url: z.string(),
  review_comments_posted: z.string().regex(/^\d+$/),
  review_types: z.string().trim().min(1),
  summary: z.string(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "fix(orchestrator): tighten review completion schema"
```

### Task 9: Ignore stale callbacks for already-cancelled review tasks

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- If a task is already `cancelled` and the webhook arrives with `status: 'completed'`, the handler returns `200` and leaves the task `cancelled`
- Same for incoming `failed`
- Same for incoming `interrupted`
- If a duplicate `cancelled` callback arrives, the handler returns `200` and leaves the task `cancelled`
- Review outcome comments now include the task worker type for review success and failure

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
```

Expected: FAIL because the current webhook handler does not short-circuit cancelled tasks and review outcome notifications still omit worker type.

- [ ] **Step 3: Write minimal implementation**

In `apps/code-agent/src/routes/webhookRoutes.ts`, after loading `task`:

```ts
if (task.status === 'cancelled') {
  if (status !== 'cancelled') {
    request.log.info({ taskId, incomingStatus: status }, 'Ignoring stale callback for cancelled task');
  } else {
    request.log.info({ taskId }, 'Ignoring duplicate cancelled callback');
  }
  return await reply.send({ received: true });
}
```

Also pass `workerType: task.workerType` anywhere `notifyTaskOutcome(...)` is called for review outcomes.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts apps/code-agent/src/domain/utils/prTaskNotification.ts apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts
git commit -m "fix(code-agent): ignore stale callbacks for cancelled tasks"
```

## Chunk 5: Final Verification

### Task 10: Run all impacted tests and repo verification

**Files:**
- Modify: none

- [ ] **Step 1: Run focused impacted suites**

Run:

```bash
pnpm vitest run \
  apps/code-agent/src/__tests__/domain/utils/prTaskNotification.test.ts \
  apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts \
  apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts \
  apps/code-agent/src/__tests__/domain/services/gitHubDispatchService.test.ts \
  apps/code-agent/src/__tests__/domain/utils/reviewTriage.test.ts \
  apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts \
  apps/code-agent/src/__tests__/usecases/githubAgent.test.ts \
  apps/code-agent/src/__tests__/domain/prompts/githubAgentPrompt.test.ts \
  apps/code-agent/src/__tests__/routes/webhooks.test.ts \
  workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run tracked CI**

Run:

```bash
pnpm ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: only the planned files are changed.

- [ ] **Step 5: Final commit**

Run:

```bash
git add -A
git commit -m "chore(review): verify fresh-start review dispatch"
```

Use this final commit only if execution work for this plan is being completed in the same branch and the team wants a final verification commit.

## Acceptance Criteria

- A new review request never resumes or messages an existing review task
- Replaced reviews are commented on in the PR before replacement begins
- Replaced reviews are marked `cancelled` locally and best-effort cancelled on the worker
- Generic PR comments never route into review tasks
- Explicit `@review` LLM failures fail closed and do not fallback-dispatch
- Review triage, dispatch, cancellation, success, and failure comments include worker type whenever it is known
- Blank review outputs are rejected by the orchestrator before completion
- Stale callbacks from cancelled tasks cannot overwrite the cancelled state

## Notes for the Implementer

- Do not change `findByPR()` behavior; other code paths still rely on its existing semantics
- Do not introduce a new generic “superseded” status; use the existing `cancelled` status with `error.code = 'review_replaced'`
- Keep worker cancellation best-effort, but keep the local Firestore cancel authoritative
- Prefer small commits exactly as described above
