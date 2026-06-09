# Code Task Dispatch Failure Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every code-task pre-dispatch failure clearly visible in the task UI, task logs, WhatsApp notification path, and PR automation comment, with the real root cause preserved through timeout/retry handling.

**Architecture:** Add structured worker-health diagnostics first, then use those diagnostics to classify terminal vs recoverable dispatch blockers. Introduce a shared dispatch-failure reporting helper so queue, retry, enqueue, and terminal dispatch paths all write the same task status, task log, PR comment event, and notification ledger/outbox entry.

**Tech Stack:** TypeScript, Fastify, Firestore, Vitest, React, Vite, GitHub PR automation comments, Pub/Sub-backed WhatsApp notifications.

---

## Current State After PR #2117

PR #2117 is merged into `origin/development` at `49c80d69fd5eb55fd60472ad107ebc7bb4a53e62`.

Already present:

- `CodeTask.dispatchStatus` exists in `apps/code-agent/src/domain/models/codeTask.ts`.
- Task API responses serialize `dispatchStatus` in `apps/code-agent/src/routes/code/responseFormatters.ts`.
- Task response schemas include `dispatchStatus` in `apps/code-agent/src/routes/code/schemas.ts`.
- The task page renders a dispatch card in `apps/web/src/pages/CodeTaskViewPage.tsx`.
- Terminal/recoverable dispatch classification exists in `apps/code-agent/src/domain/services/codeTaskDispatchProblems.ts`.
- Queue full, no enabled workers, missing PR branch, permanent dispatch errors, retry expiry, and retry exhaustion have partial failure handling.
- Orchestrator current source returns `providerApiKeys` from `/health`.

Still missing:

- PR automation comments still render queued review work as `Review dispatched`.
- No production path emits a rich PR automation failure comment when a queued PR task eventually fails before a worker starts.
- `queue_timeout` overwrites the previous blocker with generic "Workers were still busy".
- Worker health errors like missing `providerApiKeys` collapse into generic `workers_unreachable`.
- Pre-dispatch failures do not produce task-visible log lines.
- The task view does not refresh when only `dispatchStatus` changes.
- Worker settings "Test" only verifies `/health` HTTP success, not dispatch-compatible health shape.
- The WhatsApp notification marker is stored in task status before publish; if publish fails, the notification is suppressed forever.
- Terminal blockers currently affect one queue candidate per drain instead of all affected queued tasks for the same user and worker type.

## Endpoint Changes

Modified:

- `GET /code/workers/status`: include structured health diagnostics.
- `POST /code/workers/refresh-status`: include structured health diagnostics.
- `POST /code/worker-settings/workers/:name/test`: use the same health probe as dispatch and return the structured test result.
- Code task response schemas: include dispatch final-cause/health details, and include `archived` in task status enum.
- Orchestrator `GET /health`: optionally include a small contract marker/version if implemented while adding diagnostics.

Created: none.

Removed: none.

Unchanged:

- Queue drain route contract.
- Worker settings config read route.
- Existing task-event webhook URL.

## File Map

Health and dispatch domain:

- Modify: `apps/code-agent/src/domain/models/workerSettings.ts`
- Modify: `apps/code-agent/src/infra/services/workerHealthProbe.ts`
- Test: `apps/code-agent/src/__tests__/infra/services/workerHealthProbe.test.ts`
- Modify: `apps/code-agent/src/domain/services/codeTaskDispatchBlockers.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchBlockers.test.ts`
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/services/codeTaskDispatchProblems.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchProblems.test.ts`

Shared dispatch reporting:

- Create: `apps/code-agent/src/domain/services/codeTaskDispatchFailureReporter.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchFailureReporter.test.ts`
- Modify: `apps/code-agent/src/domain/ports/automationLog.ts`
- Modify: `apps/code-agent/src/domain/services/automationCommentRenderer.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/automationCommentRenderer.test.ts`
- Modify: `apps/code-agent/src/infra/services/gitHubPRAutomationLog.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/firestoreCodeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/task-serializer.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`

Queue, retry, enqueue flows:

- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
- Modify: `apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts`
- Test: `apps/code-agent/src/__tests__/infra/services/taskEnqueueServiceImpl.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Test: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- Test: `apps/code-agent/src/__tests__/usecases/createRemediationTask.test.ts`
- Modify: PR task creation flow if enqueue errors are handled outside `taskEnqueueServiceImpl`:
  `apps/code-agent/src/domain/usecases/createTaskForPR.ts`
- Test: the matching `createTaskForPR` or webhook dispatch test currently covering that path.
- Modify: `apps/code-agent/src/domain/usecases/startAskAgent.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/startAskAgent.test.ts`

Routes and service wiring:

- Modify: `apps/code-agent/src/routes/code/queue-routes.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeQueue.test.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`
- Modify: `apps/code-agent/src/routes/code/schemas.ts`
- Modify: `apps/code-agent/src/routes/code/responseFormatters.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.branches.test.ts`
- Modify: `apps/code-agent/src/routes/worker-settings/worker-ops-routes.ts`
- Modify: `apps/code-agent/src/domain/usecases/workerSettings/testWorkerConnectivity.ts`
- Test: `apps/code-agent/src/__tests__/routes/worker-settings/worker-ops-routes.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/workerSettingsRoutes.test.ts`
- Modify: `apps/code-agent/src/services.ts`
- Modify: `apps/code-agent/src/services/types.ts`

Web UI:

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/hooks/useCodeTaskLogs.ts`
- Test: `apps/web/src/hooks/__tests__/useCodeTaskLogs.test.ts`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`
- Test: `apps/web/src/__tests__/CodeTaskViewPage.test.tsx`
- Modify: worker status/header UI if needed:
  `apps/web/src/components/Header.tsx`
- Modify: worker settings UI:
  `apps/web/src/pages/WorkerSettingsPage.tsx`
- Modify: worker settings API types:
  `apps/web/src/services/workerSettingsApi.types.ts`
- Test: existing worker settings/header tests if present.

Orchestrator:

- Modify: `workers/orchestrator/src/routes.ts`
- Modify: `workers/orchestrator/src/types/api.ts`
- Test: `workers/orchestrator/src/__tests__/routes.test.ts`

## Cross-Cutting Rules

- Write tests before implementation for every task.
- Do not add new HTTP endpoints.
- Do not remove existing response fields.
- Do not expose internal notification ledger fields through public task APIs.
- Keep `task_dispatched` as an internal automation event name if cheaper, but render queued wording.
- All PR-comment failure output must be generated from structured task/log state, not ad hoc prod PM2 logs.
- Final pre-worker failure comments must be idempotent by task and failure phase.
- If a publish/comment/log write fails, keep enough durable state to retry or at least make the failure observable.

---

## Chunk 1: Structured Worker Health Diagnostics

### Task 1: Add Structured Health Diagnostics

**Files:**

- Modify: `apps/code-agent/src/domain/models/workerSettings.ts`
- Modify: `apps/code-agent/src/infra/services/workerHealthProbe.ts`
- Test: `apps/code-agent/src/__tests__/infra/services/workerHealthProbe.test.ts`
- Optional modify: `workers/orchestrator/src/types/api.ts`
- Optional modify: `workers/orchestrator/src/routes.ts`
- Test: `workers/orchestrator/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing worker-health tests**

Add tests that assert:

- A legacy `/health` response missing `providerApiKeys` returns:

```typescript
{
  _tag: 'unknown',
  healthy: false,
  error: 'Health response missing worker capability details',
  contractMismatch: true,
  missingFields: ['providerApiKeys'],
}
```

- A response missing multiple fields returns all missing fields in stable order.
- Invalid JSON/shape without legacy capacity fields remains an unknown health failure with `contractMismatch: false`.
- HTTP timeout, HTTP 5xx, DNS, connection refused, and TLS errors keep their existing transient tags.

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/infra/services/workerHealthProbe.test.ts
```

Expected: FAIL because `missingFields` and `contractMismatch` do not exist yet.

- [ ] **Step 2: Extend health model**

In `workerSettings.ts`, extend `UnknownState`:

```typescript
export interface UnknownState {
  _tag: 'unknown';
  healthy: false;
  error: string;
  contractMismatch?: boolean;
  missingFields?: string[];
}
```

If useful, add a helper type:

```typescript
export interface WorkerHealthDiagnostic {
  workerName: string;
  tag: WorkerHealthState['_tag'];
  healthy: boolean;
  reason?: string;
  error?: string;
  code?: string;
  missingFields?: string[];
  contractMismatch?: boolean;
}
```

- [ ] **Step 3: Implement missing-field detection**

In `workerHealthProbe.ts`:

- Keep the existing `isValidOrchestratorHealth` behavior.
- Add a helper like `missingHealthFields(data: unknown): string[]`.
- Required fields for dispatch compatibility:
  `status`, `capacity`, `running`, `available`, `workerAuths`, `providerApiKeys`, `dockerHealthy`, `diskHealthy`.
- For legacy capacity health, return `contractMismatch: true` and exact missing fields.
- Keep the current error string for backward compatibility.

- [ ] **Step 4: Optionally add health contract marker**

If this stays small, add `healthContractVersion: 1` to orchestrator `/health`.

This is useful but not required. The required fix is structured `missingFields`/`contractMismatch`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/infra/services/workerHealthProbe.test.ts
pnpm --filter @intexuraos/orchestrator test -- src/__tests__/routes.test.ts
```

Expected: PASS.

### Checkpoint 1: Health Completeness

Before moving on:

- [ ] `rg "contractMismatch|missingFields" apps/code-agent/src/domain apps/code-agent/src/infra` shows model, probe, and tests.
- [ ] A missing `providerApiKeys` health response is distinguishable from DNS/timeout/tunnel failures.
- [ ] Existing healthy worker tests still assert `providerApiKeys` is present and parsed.
- [ ] No public route exposes secrets or provider key values; only configured booleans and missing field names are exposed.

---

## Chunk 2: Dispatch Blocker Classification

### Task 2: Add Terminal Health Contract Blocker

**Files:**

- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/services/codeTaskDispatchBlockers.ts`
- Modify: `apps/code-agent/src/domain/services/codeTaskDispatchProblems.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchBlockers.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchProblems.test.ts`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Write failing blocker tests**

Add cases:

- Enabled worker with `_tag: 'unknown', contractMismatch: true, missingFields: ['providerApiKeys']` returns terminal blocker reason `worker_health_contract_mismatch`.
- Enabled worker with `_tag: 'tunnel-down'` still returns recoverable `workers_unreachable`.
- Enabled worker with `_tag: 'orchestrator-unreachable', reason: 'timeout'` still returns recoverable `workers_unreachable`.
- Mixed health states:
  - if at least one healthy worker can run the task, dispatch remains possible;
  - if all enabled workers are contract-mismatched, terminal blocker is returned.

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/services/codeTaskDispatchBlockers.test.ts
```

Expected: FAIL until the new reason exists.

- [ ] **Step 2: Add reason type**

Add `worker_health_contract_mismatch` to:

- `CodeTaskDispatchStatusReason` in `codeTask.ts`
- `CodeTaskDispatchBlockerReason` in `codeTaskDispatchBlockers.ts`
- `CodeTaskDispatchStatusReason` in `apps/web/src/types/index.ts`

- [ ] **Step 3: Add blocker message**

Use clear text:

```text
Configured workers for <workerType> responded with an incompatible health contract.
```

Remediation:

```text
Deploy or restart the worker orchestrator so /health includes the required capability fields, then retry this task.
```

- [ ] **Step 4: Preserve terminal mapping**

In `codeTaskDispatchProblems.ts`, do not add `worker_health_contract_mismatch` to `RECOVERABLE_BLOCKER_REASONS`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/services/codeTaskDispatchBlockers.test.ts \
  src/__tests__/domain/services/codeTaskDispatchProblems.test.ts
```

Expected: PASS.

### Checkpoint 2: Classification Completeness

- [ ] Contract mismatch is terminal.
- [ ] Tunnel/DNS/timeout remains recoverable.
- [ ] At-capacity remains warning/recoverable.
- [ ] Provider auth, Claude auth, Codex auth, Docker, disk, no enabled workers, and unknown worker type remain terminal.
- [ ] Tests prove mixed-worker behavior.

---

## Chunk 3: Dispatch Status Final Cause and Health Detail

### Task 3: Enrich Dispatch Status

**Files:**

- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts`
- Modify: `apps/code-agent/src/routes/code/responseFormatters.ts`
- Modify: `apps/code-agent/src/routes/code/schemas.ts`
- Modify: `apps/web/src/types/index.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/task-serializer.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`

- [ ] **Step 1: Write failing serialization/schema tests**

Add tests that a task with dispatch status containing:

- `lastAttemptAt`
- `attemptCount`
- `expiresAt`
- `terminalCause`
- `workerHealthDetails`

round-trips through Firestore serialization and API formatting.

Expected API shape:

```typescript
interface CodeTaskDispatchStatus {
  state: 'waiting' | 'blocked' | 'terminal';
  reason: CodeTaskDispatchStatusReason;
  terminal: boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  remediation: string;
  workerNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  nextAction: 'will_retry_automatically' | 'retry_after_fix' | 'wait_until_scheduled' | 'wait_for_active_task';
  lastAttemptAt?: string;
  attemptCount?: number;
  expiresAt?: string;
  terminalCause?: {
    reason: CodeTaskDispatchStatusReason;
    message: string;
    remediation: string;
    workerNames: string[];
    lastSeenAt: string;
  };
  workerHealthDetails?: Array<{
    workerName: string;
    tag: string;
    healthy: boolean;
    reason?: string;
    error?: string;
    code?: string;
    missingFields?: string[];
    contractMismatch?: boolean;
  }>;
}
```

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/infra/firestore/task-serializer.test.ts \
  src/__tests__/routes/codeRoutes.test.ts
```

Expected: FAIL until fields are added.

- [ ] **Step 2: Add domain fields**

Extend `CodeTaskDispatchStatus` in `codeTask.ts`.

Do not include notification ledger/outbox fields in the API response.

- [ ] **Step 3: Update Firestore serializer**

Ensure optional nested fields are preserved and timestamp fields are converted consistently.

- [ ] **Step 4: Update response formatter and schema**

In `schemas.ts`, also add `archived` to `codeTaskSchema.status` enum.

- [ ] **Step 5: Update web types**

Mirror the API shape in `apps/web/src/types/index.ts`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/infra/firestore/task-serializer.test.ts \
  src/__tests__/routes/codeRoutes.test.ts
pnpm --filter @intexuraos/web typecheck
```

Expected: PASS.

### Task 4: Preserve Root Cause on Queue Timeout

**Files:**

- Modify: `apps/code-agent/src/domain/services/codeTaskDispatchProblems.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchProblems.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`

- [ ] **Step 1: Write failing timeout tests**

Add tests:

- A queued task with previous `dispatchStatus.reason = 'workers_unreachable'` expires with:
  - `dispatchStatus.reason = 'queue_timeout'`
  - `dispatchStatus.terminalCause.reason = 'workers_unreachable'`
  - message contains `expired while blocked by workers_unreachable`
  - worker names are preserved.
- A queued task without prior dispatch status still gets a clear generic timeout message.

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/services/codeTaskDispatchProblems.test.ts \
  src/__tests__/domain/usecases/drainTaskQueue.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add timeout builder**

Create or update helper in `codeTaskDispatchProblems.ts`:

```typescript
export function queueTimeoutDispatchProblemFromTask(task: CodeTask, ttlMinutes: number): DispatchProblem
```

Behavior:

- If task has a previous non-timeout `dispatchStatus`, build message from that status:
  `Task expired in queue after <ttl> minutes while blocked by <reason>: <previous message>`
- Preserve previous remediation if better than generic.
- Preserve worker names.

- [ ] **Step 3: Update drain timeout path**

In `drainTaskQueue.ts`, replace the hardcoded "Workers were still busy" message with the new helper.

- [ ] **Step 4: Run tests**

Run focused code-agent tests above.

### Checkpoint 3: Status and Timeout Completeness

- [ ] Public task API includes new dispatch detail fields.
- [ ] Internal `notifiedReasons` is still not serialized publicly.
- [ ] `queue_timeout` no longer says "Workers were still busy" when a prior blocker exists.
- [ ] `archived` is accepted in the response schema.

---

## Chunk 4: Shared Dispatch Failure Reporter

### Task 5: Create Shared Reporter

**Files:**

- Create: `apps/code-agent/src/domain/services/codeTaskDispatchFailureReporter.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskDispatchFailureReporter.test.ts`
- Modify: `apps/code-agent/src/domain/ports/automationLog.ts`
- Modify: `apps/code-agent/src/domain/services/automationCommentRenderer.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/automationCommentRenderer.test.ts`

- [ ] **Step 1: Write failing reporter tests**

Reporter responsibilities:

- Persist final/waiting `dispatchStatus` before side effects.
- Write one synthetic task log line for each state change.
- Emit PR automation event only when `task.prNumber` exists.
- Notify WhatsApp through durable ledger/outbox reservation.
- Avoid duplicate final PR comments/logs for same `taskId + phase + reason`.

Start with pure tests for event construction and log construction.

- [ ] **Step 2: Extend automation event**

Expand `task_dispatch_failed` in `automationLog.ts`:

```typescript
| {
    type: 'task_dispatch_failed';
    taskId: string;
    workerType: string;
    agentType?: AgentType;
    reason: string;
    message: string;
    remediation: string;
    workerNames: string[];
    terminal: boolean;
    errorCode?: string;
    logLines: string[];
  }
```

Also add `agentType?: AgentType` to `task_failed`.

- [ ] **Step 3: Update renderer**

In `automationCommentRenderer.ts`:

- Render `task_dispatched` as `<Agent label> queued | <workerType> | View task`.
- Render rich `task_dispatch_failed` with:
  - task link;
  - worker type;
  - reason;
  - message;
  - remediation;
  - workers;
  - compact `details` block containing log lines.
- Render runtime `task_failed` as `Review failed`, `Remediation failed`, `Pull request task failed`, etc. when `agentType` is present.

- [ ] **Step 4: Implement reporter input shape**

Suggested interface:

```typescript
export interface ReportDispatchFailureInput {
  task: CodeTask;
  problem: DispatchProblem;
  dispatchStatus: CodeTaskDispatchStatus;
  phase: 'waiting' | 'terminal' | 'timeout' | 'retry_expired' | 'retry_exhausted' | 'enqueue_failed';
  affectedTaskCount: number;
  codeTaskRepo: CodeTaskRepository;
  logLineRepo: LogLineRepository;
  automationLog: AutomationLog;
  whatsappNotifier: WhatsAppNotifier;
  logger: Logger;
  now?: Date;
}
```

Keep writes idempotent by checking a durable marker before writing final comments/log lines. Prefer an outbox/ledger collection over `dispatchStatus.notifiedReasons`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/services/codeTaskDispatchFailureReporter.test.ts \
  src/__tests__/domain/services/automationCommentRenderer.test.ts
```

Expected: PASS after implementation.

### Task 6: Durable Notification Ledger or Outbox

**Files:**

- Create or modify repository/model files for a durable ledger:
  - `apps/code-agent/src/domain/models/codeTaskDispatchNotification.ts`
  - `apps/code-agent/src/domain/repositories/codeTaskDispatchNotificationRepository.ts`
  - `apps/code-agent/src/infra/firestore/firestoreCodeTaskDispatchNotificationRepository.ts`
- Modify: `apps/code-agent/src/services/factories/repositoryFactory.ts`
- Modify: `apps/code-agent/src/services.ts`
- Test: matching repository tests.

- [ ] **Step 1: Write failing ledger tests**

Required semantics:

- `reserve(taskId, channel, reason, phase)` returns `reserved: true` only once.
- If publish/comment fails, the ledger entry records `status: failed` and can be retried.
- If publish/comment succeeds, it records `status: delivered`.
- Repeated scheduler ticks do not duplicate delivered PR comments or WhatsApps.

- [ ] **Step 2: Implement ledger**

Key:

```text
<taskId>:<channel>:<reason>:<phase>
```

Channels:

- `whatsapp`
- `pr_comment`
- `task_log`

Statuses:

- `reserved`
- `delivered`
- `failed`

- [ ] **Step 3: Wire reporter to ledger**

Reporter must:

- reserve before side effect;
- mark delivered after success;
- mark failed after failure;
- not treat a failed side effect as delivered.

### Checkpoint 4: Reporter Completeness

- [ ] Rich `task_dispatch_failed` renderer exists and has tests.
- [ ] `Review queued` wording is tested.
- [ ] Runtime `Review failed` wording is tested.
- [ ] Reporter writes task status before PR/WhatsApp side effects.
- [ ] Duplicate scheduler execution cannot append duplicate final failure comments.
- [ ] WhatsApp publish failure can be retried or is visible in durable state.

---

## Chunk 5: Queue Drain Integration

### Task 7: Integrate Reporter Into `drainTaskQueue`

**Files:**

- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Modify: `apps/code-agent/src/routes/code/queue-routes.ts`
- Modify: `apps/code-agent/src/services.ts`
- Modify: `apps/code-agent/src/services/types.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeQueue.test.ts`

- [ ] **Step 1: Write failing queue-drain tests**

Cases:

- Queue timeout records task log, WhatsApp ledger, and PR failure comment.
- No enabled workers terminal blocker fails all affected queued tasks for same `userId + workerType`.
- Worker health contract mismatch fails all affected queued tasks.
- Recoverable `workers_unreachable` marks all affected queued tasks waiting, not just the oldest.
- Missing PR branch records PR failure comment and task log.
- Permanent dispatcher error records PR failure comment and task log.
- Recoverable dispatcher error records waiting log and does not final-comment as failed.

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/drainTaskQueue.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add dependencies**

Add to `DrainTaskQueueDeps`:

- `logLineRepo`
- `automationLog`
- notification ledger/outbox repository or reporter service.

Update route/service wiring.

- [ ] **Step 3: Replace local helpers with reporter**

Replace direct calls in:

- `failTaskForDispatchProblem`
- `rollbackTaskForRecoverableDispatchProblem`
- queue timeout block
- missing PR branch block
- permanent dispatch error block.

- [ ] **Step 4: Batch affected tasks**

Use existing `findAffectedDispatchTasks(...)`.

For terminal blockers:

- claim/fail all still-queued affected tasks;
- do not fail tasks already dispatched/running;
- report each task individually.

For recoverable blockers:

- mark all affected queued tasks waiting;
- write log/notification per task through the ledger.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/usecases/drainTaskQueue.test.ts \
  src/__tests__/routes/codeQueue.test.ts
```

Expected: PASS.

### Checkpoint 5: Queue Integration Completeness

- [ ] Every terminal queue-drain failure path calls the shared reporter.
- [ ] Every recoverable blocker path records visible waiting state/logs for affected tasks.
- [ ] PR-bound terminal failures append one idempotent PR failure event.
- [ ] No new endpoints were added.
- [ ] Queue timeout preserves previous blocker.

---

## Chunk 6: Retry Queue Integration

### Task 8: Integrate Reporter Into `drainRetryQueue`

**Files:**

- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`
- Modify: `apps/code-agent/src/routes/code/queue-routes.ts`
- Modify: `apps/code-agent/src/services.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeQueue.test.ts`

- [ ] **Step 1: Write failing retry tests**

Cases:

- Retry expiry includes `lastError`, `attempts`, `ttlMinutes`, final cause, task log, WhatsApp, and PR comment.
- Retry exhaustion includes `lastError`, `attempts`, final cause, task log, WhatsApp, and PR comment.
- Retry pre-dispatch settings failure updates task-visible dispatch status/log.
- Terminal retry dispatch blocker records PR comment/log.
- Retry entry delete failure does not falsely report success.

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/drainRetryQueue.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add retry-specific problem builders**

In `codeTaskDispatchProblems.ts`, update:

- `retryExpiredDispatchProblem`
- `retryExhaustedDispatchProblem`

to include last error and attempt count in message/remediation or terminal cause.

- [ ] **Step 3: Use shared reporter**

Replace direct update/notify blocks for new-task retry expiry/exhaustion and terminal retry dispatch failures.

- [ ] **Step 4: Keep task-message retry behavior correct**

Task-message retries are not code-task dispatch starts. Do not add PR code-task failure comments to successful message retry delivery. Only use reporter when a code task's dispatch state changes.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/drainRetryQueue.test.ts
```

Expected: PASS.

### Checkpoint 6: Retry Completeness

- [ ] Retry expiry/exhaustion is task-visible.
- [ ] Retry expiry/exhaustion PR comments include task link and last error.
- [ ] Retry metadata write/delete failures are checked and tested.
- [ ] Task-message retries do not produce wrong code-task failure comments.

---

## Chunk 7: Enqueue and Creation Flow Integration

### Task 9: Report Enqueue-Time Failures

**Files:**

- Modify: `apps/code-agent/src/infra/services/taskEnqueueServiceImpl.ts`
- Modify: `apps/code-agent/src/domain/usecases/createReviewTask.ts`
- Modify: `apps/code-agent/src/domain/usecases/createRemediationTask.ts`
- Modify: PR task creation flow if present: `apps/code-agent/src/domain/usecases/createTaskForPR.ts`
- Modify: `apps/code-agent/src/domain/usecases/startAskAgent.ts`
- Test: `apps/code-agent/src/__tests__/infra/services/taskEnqueueServiceImpl.test.ts`
- Test: `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`
- Test: `apps/code-agent/src/__tests__/usecases/createRemediationTask.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/startAskAgent.test.ts`
- Test: matching PR-task creation/webhook dispatch tests.

- [ ] **Step 1: Write failing tests**

Cases:

- Queue full fails each task with `dispatchStatus.reason = 'queue_full'`.
- Queue full writes task log.
- Queue full emits PR failure comment for PR-bound tasks.
- Queue full sends per-task WhatsApp notification through ledger.
- Ask-agent no-worker failure returns enough task ID context for UI to open the failed task page.

- [ ] **Step 2: Move enqueue failure reporting into shared reporter**

`TaskEnqueueServiceImpl` already receives `whatsappNotifier`. Add the reporter dependencies or make enqueue callers report after the task update. Prefer the shared reporter so the behavior is consistent.

- [ ] **Step 3: Ensure PR-bound creation flows pass automation context**

PR-bound tasks need:

- repository;
- prNumber;
- userId for token lookup;
- agentType;
- workerType.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/infra/services/taskEnqueueServiceImpl.test.ts \
  src/__tests__/usecases/createReviewTask.test.ts \
  src/__tests__/usecases/createRemediationTask.test.ts \
  src/__tests__/domain/usecases/startAskAgent.test.ts
```

Expected: PASS.

### Checkpoint 7: Enqueue Completeness

- [ ] Queue full is visible on every affected task, not only `/submit`.
- [ ] PR-bound queue-full failure updates PR automation comment.
- [ ] Ask-agent terminal start failures expose or navigate to the failed task.
- [ ] No creation path still returns a generic enqueue error after creating a task without marking it failed.

---

## Chunk 8: Worker Status and Worker Settings Test

### Task 10: Expose Health Details in Worker APIs

**Files:**

- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/routes/worker-settings/worker-ops-routes.ts`
- Modify: `apps/code-agent/src/domain/usecases/workerSettings/testWorkerConnectivity.ts`
- Modify: `apps/code-agent/src/services.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/worker-settings/worker-ops-routes.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/workerSettingsRoutes.test.ts`

- [ ] **Step 1: Write failing route tests**

Cases:

- `/workers/status` returns health details for `_tag: unknown`, including `error`, `missingFields`, `contractMismatch`.
- `/workers/refresh-status` returns the same.
- Worker settings test fails when `/health` is HTTP 200 but missing `providerApiKeys`.
- Worker settings test success requires dispatch-compatible health.

- [ ] **Step 2: Reuse `WorkerHealthProbe` in worker settings test**

`testWorkerConnectivity.ts` currently uses raw `fetch`. Change it to depend on `WorkerHealthProbe` or a small adapter around it.

- [ ] **Step 3: Return clear messages**

For contract mismatch:

```text
Health response missing worker capability details: providerApiKeys
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/routes/codeRoutes.test.ts \
  src/__tests__/routes/worker-settings/worker-ops-routes.test.ts \
  src/__tests__/routes/workerSettingsRoutes.test.ts
```

Expected: PASS.

### Checkpoint 8: Worker API Completeness

- [ ] Worker settings "Test" fails for the exact class of issue that broke PR #2117.
- [ ] Worker status UI/API can show why a worker is unknown/unhealthy.
- [ ] HTTP 200 alone no longer means worker test success.

---

## Chunk 9: Web UI

### Task 11: Refresh Task View on Dispatch Status Changes

**Files:**

- Modify: `apps/web/src/hooks/useCodeTaskLogs.ts`
- Test: `apps/web/src/hooks/__tests__/useCodeTaskLogs.test.ts`

- [ ] **Step 1: Write failing hook test**

Simulate Firestore snapshot where:

- `status` remains `queued`;
- `updatedAt` changes, or `dispatchStatus.lastSeenAt` changes.

Expected: hook calls `refreshTask()` and updates task state.

Run:

```bash
pnpm --filter @intexuraos/web test -- src/hooks/__tests__/useCodeTaskLogs.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement refresh trigger**

Replace `lastStatusRef` with a metadata ref:

```typescript
const lastTaskRefreshKeyRef = useRef<string | null>(null);
```

Build key from snapshot data:

- `status`
- `updatedAt`
- `dispatchStatus.reason`
- `dispatchStatus.lastSeenAt`

Refresh when key changes.

- [ ] **Step 3: Run test**

Run hook test again.

### Task 12: Show Final Cause and Health Details

**Files:**

- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/Header.tsx`
- Modify: `apps/web/src/pages/WorkerSettingsPage.tsx`
- Modify: `apps/web/src/services/workerSettingsApi.types.ts`
- Test: `apps/web/src/__tests__/CodeTaskViewPage.test.tsx`
- Test: worker settings/header tests if present.

- [ ] **Step 1: Write failing UI tests**

Add tests that the dispatch card shows:

- reason;
- remediation;
- workers;
- first seen;
- last attempt/last seen;
- terminal cause;
- missing fields like `providerApiKeys`.

- [ ] **Step 2: Update dispatch card**

Keep the card compact:

- Title: `Dispatch Failed` or `Dispatch Waiting`.
- Badge: reason.
- Body: message.
- Details:
  - workers;
  - first seen;
  - last attempt;
  - final cause;
  - health diagnostics if present.

- [ ] **Step 3: Update worker status UI**

In header/worker settings UI, show contract mismatch errors without exposing secrets.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @intexuraos/web test -- \
  src/hooks/__tests__/useCodeTaskLogs.test.ts \
  src/__tests__/CodeTaskViewPage.test.tsx
pnpm --filter @intexuraos/web typecheck
```

Expected: PASS.

### Checkpoint 9: UI Completeness

- [ ] An open queued task page updates when dispatch status changes.
- [ ] The page explains terminal vs automatic retry.
- [ ] The page shows the exact worker health failure for contract mismatch.
- [ ] No text overflows compact cards on typical mobile widths.

---

## Chunk 10: Automation Lifecycle Cleanup

### Task 13: Runtime Task Failure Labels

**Files:**

- Modify: `apps/code-agent/src/domain/ports/automationLog.ts`
- Modify: `apps/code-agent/src/domain/services/automationCommentRenderer.ts`
- Modify: `apps/code-agent/src/routes/webhooks/taskEvent.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/automationCommentRenderer.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks/taskEvent.test.ts`

- [ ] **Step 1: Write failing tests**

Cases:

- Worker callback for failed review task renders `Review failed`.
- Failed remediation task renders `Remediation failed`.
- Generic task without agent type still renders `Failed`.

- [ ] **Step 2: Add agentType to task_failed event mapping**

`taskEvent.ts` has access to the task. Pass `task.agentType` to the automation event.

- [ ] **Step 3: Update renderer**

Use existing `agentTypeLabel(...)` helper.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/services/automationCommentRenderer.test.ts \
  src/__tests__/routes/webhooks/taskEvent.test.ts
```

Expected: PASS.

### Checkpoint 10: Automation Completeness

- [ ] "Review queued" is used for enqueued review tasks.
- [ ] "Review started" still comes from worker callback.
- [ ] "Review failed" is used for runtime failures.
- [ ] "Dispatch failed" is used for pre-worker failures.

---

## Chunk 11: Full Verification and Completeness Audit

### Task 14: Run Focused Workspace Verification

**Files:** none.

- [ ] **Step 1: Run code-agent tests touched by this plan**

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/infra/services/workerHealthProbe.test.ts \
  src/__tests__/domain/services/codeTaskDispatchBlockers.test.ts \
  src/__tests__/domain/services/codeTaskDispatchProblems.test.ts \
  src/__tests__/domain/services/codeTaskDispatchFailureReporter.test.ts \
  src/__tests__/domain/services/automationCommentRenderer.test.ts \
  src/__tests__/domain/usecases/drainTaskQueue.test.ts \
  src/__tests__/domain/usecases/drainRetryQueue.test.ts \
  src/__tests__/infra/services/taskEnqueueServiceImpl.test.ts \
  src/__tests__/routes/codeQueue.test.ts \
  src/__tests__/routes/codeRoutes.test.ts \
  src/__tests__/routes/worker-settings/worker-ops-routes.test.ts \
  src/__tests__/routes/workerSettingsRoutes.test.ts \
  src/__tests__/routes/webhooks/taskEvent.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run web tests touched by this plan**

```bash
pnpm --filter @intexuraos/web test -- \
  src/hooks/__tests__/useCodeTaskLogs.test.ts \
  src/__tests__/CodeTaskViewPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run orchestrator tests touched by this plan**

```bash
pnpm --filter @intexuraos/orchestrator test -- src/__tests__/routes.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run workspace verification**

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- web
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: PASS.

- [ ] **Step 5: Run full tracked CI**

```bash
pnpm run ci:tracked
```

Expected: PASS.

### Task 15: Completeness Checklist

Before marking the work complete, verify every item below manually.

Product behavior:

- [ ] If a review task is queued, PR automation comment says `Review queued`.
- [ ] If a worker accepts/starts the review, PR automation comment says `Review started`.
- [ ] If a queued PR review cannot dispatch and later fails, PR automation comment gets a `Dispatch failed` entry automatically.
- [ ] The failure entry includes task link, worker type, reason, message, remediation, workers, and log excerpt.
- [ ] The task page shows the same reason without needing prod logs.
- [ ] The task log stream includes synthetic pre-dispatch lines.
- [ ] A second task failing for the same reason gets its own WhatsApp notification.
- [ ] A WhatsApp publish failure does not permanently suppress notification.

Root-cause handling:

- [ ] Missing `providerApiKeys` is shown as a health contract mismatch, not only `workers_unreachable`.
- [ ] Health contract mismatch is terminal.
- [ ] Tunnel/DNS/timeout remains recoverable.
- [ ] Queue timeout preserves previous blocker.
- [ ] Retry expiry/exhaustion includes `lastError`.

Affected-task handling:

- [ ] Terminal user/worker-type blockers fail all affected queued tasks.
- [ ] Recoverable user/worker-type blockers mark all affected queued tasks waiting.
- [ ] Already dispatched/running tasks are not failed by batch blocker handling.

API/UI:

- [ ] Task response schema accepts `archived`.
- [ ] Task response does not expose notification ledger internals.
- [ ] Open task page refreshes when only `dispatchStatus` changes.
- [ ] Worker settings test fails for legacy `/health` missing capability fields.
- [ ] Worker status UI shows unknown health details.

Observability:

- [ ] PR automation log failures are logged with enough context to diagnose token/comment failures.
- [ ] Reporter side-effect failures are durable or retryable.
- [ ] No code path still calls stale `notifyTaskQueueExpired` with misleading wording, unless it has been updated to use the new timeout cause.

Search audits:

```bash
rg "Review dispatched|Workers were still busy|notifyTaskQueueExpired|Health response missing worker capability details" apps/code-agent/src apps/web/src workers/orchestrator/src
rg "task_dispatch_failed" apps/code-agent/src
rg "notifiedReasons" apps/code-agent/src apps/web/src
```

Expected:

- `Review dispatched` is gone from rendered PR comment text.
- `Workers were still busy` is gone or only appears in tests asserting it is no longer used.
- `notifyTaskQueueExpired` is removed or updated to non-misleading wording.
- `task_dispatch_failed` appears in renderer and real queue/retry/enqueue production paths.
- `notifiedReasons` is not used as the delivery source of truth after the durable ledger/outbox lands.

## Implementation Order Summary

1. Structured worker health diagnostics.
2. Terminal health-contract blocker classification.
3. Enriched dispatch status and queue-timeout root-cause preservation.
4. Shared dispatch-failure reporter and durable side-effect ledger/outbox.
5. Queue drain integration and affected-task batch handling.
6. Retry queue integration.
7. Enqueue and creation-flow integration.
8. Worker status/test API updates.
9. Web UI refresh and display.
10. Automation lifecycle wording cleanup.
11. Focused verification, workspace verification, and full `ci:tracked`.

## Handoff Notes

- Start each task by writing the failing test named in the task.
- Keep commits per chunk if possible.
- If a chunk reveals an existing failing test outside the chunk, stop and investigate before proceeding.
- Do not ship only backend state changes. The user-facing proof requires task UI, task logs, PR comment, and WhatsApp behavior to agree.
- Do not rely on prod logs as the user-facing evidence. Prod logs are for investigation only; the product must surface the failure itself.
