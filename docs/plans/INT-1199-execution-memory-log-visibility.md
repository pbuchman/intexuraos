# Execution Memory Log Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make execution memory retrieval, dispatch, prompt injection, and worker self-report visible inside the code-task log stream shown in the UI.

**Architecture:** Keep the existing `code_tasks/{taskId}/log_lines` transport and add a stable `[memory]` log grammar instead of building a new UI transport. `code-agent` owns retrieval-time visibility and post-run persistence markers; `orchestrator` owns runtime-visible lines for the memory payload it actually received and injected into the worker prompt, plus the worker's completion self-report.

**Tech Stack:** TypeScript, Fastify (`code-agent`), orchestrator task dispatch pipeline, Firestore `log_lines`, existing React/Firebase log streaming in the web app.

---

## Current Visibility Snapshot

Today the system already computes or stores all of the following:

- `code-agent` retrieval result on `code_tasks.executionMemoryContext`
  - `status`
  - `applicationId`
  - `retrievalVersion`
  - `querySummary`
  - `matchedMemories[].{memoryId,title,memoryType,score,appliesWhen,action,avoid,verification}`
  - `errorCode` / `errorMessage`
- hidden `execution_memory_applications` fields that are **not** shown in logs or UI
  - `queryText`
  - `queryComponents`
  - `queryRiskFlags`
  - `matchedMemories[].vectorScore`
  - `matchedMemories[].rerankScore`
  - application-level `status`
- `orchestrator` prompt payload for matched runs only
  - `applicationId`
  - `retrievalVersion`
  - `querySummary`
  - prompt-safe `matchedMemories[]`
- completion payload fields persisted on the task result
  - `execution_memory_ids_used`
  - `execution_memory_ids_rejected`
  - `execution_memory_usage_summary`
- post-run state shown in the UI card
  - `executionMemoryPostRun.status`
  - `generatedMemoryIds`
  - `evaluationSummary`

What is **not** visible in the execution log today:

- retrieval outcomes for `none` or `error`
- what hidden retrieval fields existed when the application record was created
- what exact memory payload the orchestrator received before building the worker prompt
- an explicit "memory section injected into prompt" marker
- an explicit log line for the worker's `memory_ids_used` / `memory_ids_rejected` / `memory_usage_summary`
- an explicit code-agent log line that the webhook persisted memory usage and queued post-run evaluation

## Recommended Approach

Use a contract-first visibility design.

- Keep `executionMemoryContext` as the prompt-safe subset used by the worker prompt.
- Add a sibling dispatch field, `executionMemoryVisibilityContext`, that is safe for logs but richer than the prompt payload.
- Log every retrieval outcome (`matched`, `none`, `error`) through the same `[memory]` grammar.
- Cap detail to one summary line plus at most three per-memory lines so the transcript stays readable.

Rejected alternatives:

- Minimal code-agent-only logging: fast, but it still would not show what the orchestrator actually received.
- UI-only expansion of the memory card: violates the request because the source of truth must be the execution log itself.

## Visibility Contract

### Dispatch Audit Contract

`code-agent` and `orchestrator` share this contract and can implement against it in parallel:

```ts
interface ExecutionMemoryVisibilityContext {
  status: 'matched' | 'none' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  queryComponents: string[];
  queryRiskFlags: string[];
  candidateCount: number;
  matchedCount: number;
  threshold: number;
  matchedMemories: Array<{
    memoryId: string;
    title: string;
    memoryType: 'implementation_pattern' | 'verification_pattern' | 'pitfall_pattern';
    promptScore: number;
    vectorScore?: number;
    rerankScore?: number;
  }>;
  errorCode?: string;
  errorMessage?: string;
}
```

Rules:

- Present for all execution-memory retrieval attempts, including `none` and `error`.
- Small enough for dispatch and logs; do **not** include full `queryText` or full Linear text.
- `promptScore` mirrors the current task-visible score so logs and UI card stay aligned.
- `threshold` is emitted explicitly so operators can see why candidates were filtered out.

### Log Grammar

All new memory-related log lines must start with `[memory]` after any runtime tag.

Examples:

```text
[memory] retrieval status=matched application=app-123 version=execution-memory-retrieval@1.0.0 candidates=20 matched=2 threshold=0.68 query="Auth callback logging and verification"
[memory] selected id=mem-1 type=verification_pattern promptScore=0.931 vectorScore=0.950 rerankScore=0.931 title="Cover route logging in app.inject tests"
[memory] selected id=mem-2 type=pitfall_pattern promptScore=0.901 vectorScore=0.900 rerankScore=0.901 title="Do not change handler without schema parity"
[memory] injected application=app-123 count=2
[memory] completion used=mem-1 rejected=mem-2 summary="Used the verification memory and rejected the stale pitfall memory."
[memory] postrun queued status=pending generated=0
```

Rules:

- One summary line per retrieval.
- One line per selected memory, maximum three.
- One explicit injection line from `orchestrator`.
- One explicit completion line from `orchestrator`.
- One explicit persistence/queueing line from `code-agent` when the completion webhook is accepted.

## Endpoint Changes

**Modified:**

- `POST /tasks` in `workers/orchestrator`
  - accept `executionMemoryVisibilityContext` in addition to the existing prompt-safe `executionMemoryContext`
- `POST /internal/webhooks/task-complete` in `apps/code-agent`
  - no response shape change; adds log-side effects for persisted memory usage and post-run queueing

**Created:** None

**Removed:** None

**Unchanged:**

- `POST /internal/logs`
- `GET /code/tasks/:taskId`
- Firestore `code_tasks/{taskId}/log_lines` streaming in the web app

## File Structure

### Code-Agent

| File | Action | Responsibility |
| --- | --- | --- |
| `apps/code-agent/src/domain/services/taskDispatcher.ts` | Modify | Add `ExecutionMemoryVisibilityContext` to the dispatch contract |
| `apps/code-agent/src/infra/services/taskDispatcherImpl.ts` | Modify | Serialize the new visibility payload into the orchestrator request |
| `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts` | Modify | Return both prompt-safe context and richer visibility metadata from one retrieval pass |
| `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` | Modify | Persist retrieval-time `[memory]` lines for first dispatch |
| `apps/code-agent/src/domain/usecases/drainRetryQueue.ts` | Modify | Persist retrieval-time `[memory]` lines for retry dispatch |
| `apps/code-agent/src/routes/webhookRoutes.ts` | Modify | Persist completion/post-run `[memory]` lines after webhook acceptance |
| `apps/code-agent/src/domain/formatters/executionMemoryLogFormatter.ts` | Create | Build bounded, stable `[memory]` lines from retrieval and post-run data |
| `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts` | Modify | Cover visibility payload fields and selection counts |
| `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts` | Modify | Assert retrieval log lines are written on first dispatch |
| `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts` | Modify | Assert retrieval log lines are written on retry dispatch |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts` | Modify | Assert completion/post-run `[memory]` lines are written |

### Orchestrator

| File | Action | Responsibility |
| --- | --- | --- |
| `workers/orchestrator/src/types/api.ts` | Modify | Accept the new visibility field on `CreateTaskRequest` |
| `workers/orchestrator/src/types/schemas.ts` | Modify | Validate the visibility payload for all retrieval outcomes |
| `workers/orchestrator/src/types/execution-memory.ts` | Modify | Define the shared visibility shape used by the dispatcher |
| `workers/orchestrator/src/services/task-dispatcher.ts` | Modify | Emit `[memory]` retrieval, injection, and completion lines via `appendOrchestratorTaskLog()` |
| `workers/orchestrator/src/__tests__/create-task-request-schema.test.ts` | Modify | Cover the visibility payload schema |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` | Modify | Assert runtime log lines for matched / none / error retrieval and completion self-report |

## Parallel Breakdown

### Subtask A: Code-Agent Visibility Ownership

Boundary:

- Owns retrieval-time facts that only `code-agent` knows.
- Owns direct writes into `code_tasks/{taskId}/log_lines`.
- Owns webhook-side persistence marker after completion.

Inputs:

- task prompt, sanitized prompt, Linear context, vector search results, application record write result, webhook result payload

Outputs:

- `executionMemoryVisibilityContext` on the dispatch request
- `[memory] retrieval ...` and `[memory] selected ...` lines in `log_lines`
- `[memory] postrun queued ...` line in `log_lines`

Non-ownership:

- does not decide how the worker prompt renders the memory section
- does not own runtime-tagged log lines (`[orchestrator]`)

### Subtask B: Orchestrator Runtime Visibility Ownership

Boundary:

- Owns what the orchestrator actually received from `code-agent`.
- Owns confirmation that the memory section was injected into the prompt build.
- Owns completion self-report lines derived from verified execution results.

Inputs:

- `CreateTaskRequest.executionMemoryVisibilityContext`
- existing prompt-safe `executionMemoryContext`
- verified `memory_ids_used`, `memory_ids_rejected`, `memory_usage_summary`

Outputs:

- `[orchestrator] [memory] retrieval ...`
- `[orchestrator] [memory] selected ...`
- `[orchestrator] [memory] injected ...`
- `[orchestrator] [memory] completion ...`

Non-ownership:

- does not write directly to Firestore repositories
- does not compute retrieval matches or post-run queueing

## Task 1: Code-Agent — Retrieval And Persistence Visibility

**Files:**

- Create: `apps/code-agent/src/domain/formatters/executionMemoryLogFormatter.ts`
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- Modify: `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts`
- Test: `apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

- [ ] **Step 1: Write failing tests for the visibility payload**

Add assertions in `prepareExecutionMemoryContext.test.ts` that the retrieval result now carries enough data to build the dispatch audit envelope:

```ts
expect(result.visibility).toEqual({
  status: 'matched',
  applicationId: 'app-123',
  retrievalVersion: 'execution-memory-retrieval@1.0.0',
  querySummary: 'Auth callback route changes with logging and route verification work',
  queryComponents: ['auth', 'route', 'logging', 'verification'],
  queryRiskFlags: ['env_propagation'],
  candidateCount: 3,
  matchedCount: 2,
  threshold: 0.68,
  matchedMemories: [
    expect.objectContaining({
      memoryId: 'mem-1',
      promptScore: 0.95,
      vectorScore: 0.95,
      rerankScore: 0.95,
    }),
  ],
});
```

- [ ] **Step 2: Run the focused retrieval tests and confirm failure**

Run:

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts
```

Expected: FAIL because the current use case does not expose a visibility payload or candidate counts.

- [ ] **Step 3: Implement a dedicated visibility formatter and dispatch envelope**

Create `apps/code-agent/src/domain/formatters/executionMemoryLogFormatter.ts`:

```ts
export function buildRetrievalLogLines(input: ExecutionMemoryVisibilityContext): string[] {
  const lines = [
    `[memory] retrieval status=${input.status} application=${input.applicationId ?? ''} version=${input.retrievalVersion ?? ''} candidates=${String(input.candidateCount)} matched=${String(input.matchedCount)} threshold=${input.threshold.toFixed(2)} query="${input.querySummary ?? ''}"`,
  ];

  for (const memory of input.matchedMemories.slice(0, 3)) {
    lines.push(
      `[memory] selected id=${memory.memoryId} type=${memory.memoryType} promptScore=${memory.promptScore.toFixed(3)} vectorScore=${String(memory.vectorScore ?? '')} rerankScore=${String(memory.rerankScore ?? '')} title="${memory.title}"`,
    );
  }

  if (input.status === 'error') {
    lines.push(`[memory] retrieval_error code=${input.errorCode ?? ''} message="${input.errorMessage ?? ''}"`);
  }

  return lines;
}
```

Then update `prepareExecutionMemoryContext.ts` so a single retrieval pass returns both:

```ts
return {
  context: {
    status: 'matched',
    applicationId,
    retrievalVersion: RETRIEVAL_VERSION,
    querySummary: normalization.summary,
    matchedAt: Timestamp.now(),
    matchedMemories: promptMemories,
  },
  visibility: {
    status: 'matched',
    applicationId,
    retrievalVersion: RETRIEVAL_VERSION,
    querySummary: normalization.summary,
    queryComponents: normalization.components,
    queryRiskFlags: normalization.riskFlags,
    candidateCount: nearestResult.value.length,
    matchedCount: matchedMemories.length,
    threshold: MIN_RERANK_SCORE,
    matchedMemories: matchedMemories.map((match) => ({
      memoryId: match.memory.id,
      title: match.memory.title,
      memoryType: match.memory.memoryType,
      promptScore: roundScore(match.rerankScore),
      vectorScore: roundScore(match.memory.vectorScore),
      rerankScore: roundScore(match.rerankScore),
    })),
  },
};
```

- [ ] **Step 4: Thread retrieval lines into queue and retry dispatches**

Update `drainTaskQueue.ts` and `drainRetryQueue.ts` so they receive `logLineRepo`, build retrieval lines after persistence succeeds, and store them before dispatch:

```ts
const logLines = buildRetrievalLogLines(taskExecutionMemory.visibility).map((text, index) => ({
  sequence: Date.now() * 1000 + index,
  text,
  timestamp: Timestamp.now(),
}));

await deps.logLineRepo.storeBatch(task.id, logLines);

const dispatchResult = await taskDispatcher.dispatch({
  ...request,
  executionMemoryContext: taskExecutionMemory.dispatchContext,
  executionMemoryVisibilityContext: taskExecutionMemory.visibility,
});
```

- [ ] **Step 5: Add webhook-side persistence logging**

In `webhookRoutes.ts`, after the task completion update succeeds, append a bounded marker:

```ts
await logLineRepo.storeBatch(taskId, [
  {
    sequence: Date.now() * 1000,
    text: `[memory] postrun queued status=pending generated=0`,
    timestamp: Timestamp.now(),
  },
]);
```

When the feature is disabled or the task is not an execution task, write nothing.

- [ ] **Step 6: Run code-agent tests**

Run:

```bash
cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
```

Expected: PASS with new visibility payload assertions and `[memory]` log line assertions.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/formatters/executionMemoryLogFormatter.ts apps/code-agent/src/domain/services/taskDispatcher.ts apps/code-agent/src/infra/services/taskDispatcherImpl.ts apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts apps/code-agent/src/domain/usecases/drainTaskQueue.ts apps/code-agent/src/domain/usecases/drainRetryQueue.ts apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/domain/useCases/prepareExecutionMemoryContext.test.ts apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "feat(code-agent): log execution memory retrieval visibility"
```

## Task 2: Orchestrator — Runtime Receipt, Injection, And Completion Logs

**Files:**

- Modify: `workers/orchestrator/src/types/api.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/types/execution-memory.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Test: `workers/orchestrator/src/__tests__/create-task-request-schema.test.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Write failing tests for visibility context acceptance**

Add a schema test that accepts matched, none, and error visibility payloads:

```ts
expect(
  CreateTaskRequestSchema.parse({
    taskId: 'task-1',
    workerType: 'auto',
    prompt: 'Implement the task',
    linearIssueLabels: [],
    hasChildren: false,
    webhookUrl: 'https://code-agent.test/internal/webhooks/task-complete',
    webhookSecret: 'secret',
    executionMemoryVisibilityContext: {
      status: 'none',
      applicationId: 'app-none',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'No prior matches',
      queryComponents: ['logging'],
      queryRiskFlags: [],
      candidateCount: 20,
      matchedCount: 0,
      threshold: 0.68,
      matchedMemories: [],
    },
  }),
).toBeTruthy();
```

- [ ] **Step 2: Write failing dispatcher tests for new log lines**

Add assertions in `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` that the transcript contains:

```ts
expect(logText).toContain('[orchestrator] [memory] retrieval status=matched');
expect(logText).toContain('[orchestrator] [memory] injected application=app-123 count=2');
expect(logText).toContain('[orchestrator] [memory] completion used=mem-1 rejected=mem-2');
```

- [ ] **Step 3: Run orchestrator tests and confirm failure**

Run:

```bash
cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/create-task-request-schema.test.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
```

Expected: FAIL because the request schema and dispatcher do not know about `executionMemoryVisibilityContext` or the new `[memory]` lines.

- [ ] **Step 4: Implement request parsing and runtime logging**

Extend the request types:

```ts
export interface CreateTaskRequest {
  // existing fields...
  executionMemoryContext?: ExecutionMemoryPromptContext;
  executionMemoryVisibilityContext?: ExecutionMemoryVisibilityContext;
}
```

Then in `task-dispatcher.ts`, emit log lines before prompt build and after completion verification:

```ts
if (task.executionMemoryVisibilityContext !== undefined) {
  for (const line of buildExecutionMemoryVisibilityLines(task.executionMemoryVisibilityContext)) {
    this.appendOrchestratorTaskLog(task.taskId, line);
  }
}

if (agentData !== undefined) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `[memory] completion used=${agentData.memory_ids_used} rejected=${agentData.memory_ids_rejected} summary="${agentData.memory_usage_summary}"`,
  );
}
```

The prompt itself remains driven by the existing prompt-safe `executionMemoryContext`.

- [ ] **Step 5: Emit an explicit injection marker**

Right before or right after the system prompt is built, add:

```ts
if (task.executionMemoryContext?.matchedMemories.length) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `[memory] injected application=${task.executionMemoryContext.applicationId} count=${String(task.executionMemoryContext.matchedMemories.length)}`,
  );
}
```

This is the definitive runtime proof that the worker prompt included the memory section.

- [ ] **Step 6: Run orchestrator tests**

Run:

```bash
cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/create-task-request-schema.test.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
```

Expected: PASS with matched / none / error visibility coverage and completion log assertions.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/types/api.ts workers/orchestrator/src/types/schemas.ts workers/orchestrator/src/types/execution-memory.ts workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/create-task-request-schema.test.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat(orchestrator): emit execution memory visibility logs"
```

## Task 3: Integration Verification And Rollout Proof

**Files:**

- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts` (if integration assertions belong there)
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` (if integration assertions belong there)

- [ ] **Step 1: Verify the full log sequence contract**

Use the existing task-dispatcher and webhook test helpers to assert the final visible order:

```text
[memory] retrieval ...
[memory] selected ...
[orchestrator] [memory] retrieval ...
[orchestrator] [memory] selected ...
[orchestrator] [memory] injected ...
[orchestrator] [memory] completion ...
[memory] postrun queued ...
```

- [ ] **Step 2: Run workspace verification for both touched services**

Run:

```bash
cd /repo && pnpm run verify:workspace:tracked -- code-agent
cd /repo && pnpm --filter orchestrator test
```

Expected: PASS.

- [ ] **Step 3: Run full tracked CI before merge**

Run:

```bash
cd /repo && pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Review the user-facing transcript manually**

Create or replay one execution task with memory matches and verify the Code Task UI log shows:

- retrieval outcome
- per-memory selection lines
- prompt injection marker
- completion self-report
- post-run queue marker

## Self-Review

Spec coverage:

- Current visibility inventory is documented.
- The recommended contract shows which hidden fields become log-visible.
- The parallel split is one subtask per service boundary with explicit contracts.
- The plan keeps the UI transport unchanged and uses the existing log stream, which matches the request.

Placeholder scan:

- No `TODO`, `TBD`, or "implement later" markers remain.
- Commands, files, and contract fields are explicit.

Type consistency:

- `executionMemoryContext` stays prompt-safe.
- `executionMemoryVisibilityContext` is the richer audit payload.
- `[memory]` is the single prefix across both services.
