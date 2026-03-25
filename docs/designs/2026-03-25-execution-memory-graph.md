# Execution Memory Graph v1

Linear issue: [INT-1098](https://linear.app/pbuchman/issue/INT-1098/execution-memory-graph-v1)

## Summary

Execution Memory Graph v1 makes `code-agent` persist reusable execution lessons from completed tasks, retrieve the best matches before future execution dispatches, inject them into the `orchestrator` execution system prompt, and evaluate whether those memories helped.

The phase-1 design is intentionally narrow:

- vector-first retrieval only
- execution-agent tasks only
- `code-agent` owns all memory state and all post-run processing
- `orchestrator` only consumes precomputed memory context and returns memory usage self-report fields
- retrieval and distillation failures must never block task dispatch or task completion

## Goals

- Convert completed execution-task evidence into reusable canonical memories.
- Reuse those memories on similar future execution tasks.
- Keep the memory system auditable at the task, memory, and application-event levels.
- Make memory usage visible in the task detail API and UI.
- Introduce the feature behind a flag and ship it without destabilizing existing task execution.

## Non-Goals

- Planning-agent, review-agent, or pull-request-agent memory retrieval.
- Cross-repository transfer in v1.
- LLM reranking after vector search.
- Automatic prompt rewriting of the user prompt.
- Real-time distillation inline with the terminal webhook request.

## Locked Architecture Decisions

- Retrieval mode is vector-first.
- Canonical memory storage lives in Firestore under `code-agent` ownership.
- The memory collections are top-level collections, not task subcollections.
- Query normalization, distillation, and evaluation use `Gemini 2.5 Flash`.
- Embeddings use OpenAI `text-embedding-3-small`.
- `orchestrator` receives already-ranked memory context from `code-agent`.
- Memory context is injected into the execution system prompt, not hidden in the user prompt.
- Post-run distillation and evaluation run in a scheduler-backed durable processor, not in the webhook hot path.

## User-Facing Outcome

When an execution task starts, the worker receives a short, typed “execution memory” section containing the top matched lessons from previous similar tasks. When the task finishes, the task detail page shows:

- whether memories were matched
- which memories were supplied
- whether the worker reported using or rejecting them
- whether the run produced new reusable memories

## End-to-End Flow

1. A new execution task is queued in `code-agent`.
2. Right before dispatch, `code-agent` builds a retrieval query from the task prompt, repository context, labels, and Linear issue context.
3. `code-agent` normalizes the query with Gemini, embeds it with OpenAI, runs Firestore vector search, reranks the candidates, persists an application record, and stores a compact match summary on the task.
4. `code-agent` dispatches the task to `orchestrator` with `executionMemoryContext`.
5. `orchestrator` injects the matched memories into the execution system prompt and requires the worker to report which memories were used or rejected in `EXECUTION_AGENT_FINAL`.
6. When the task completes, `code-agent` marks post-run memory processing as pending.
7. A scheduler-backed processor distills reusable lessons from logs, metrics, results, and Linear context, upserts canonical memories, evaluates the application outcome, and updates counters on the matched memories.

## Data Ownership

`code-agent` owns all new memory state:

- `execution_memories`
- `execution_memory_applications`
- task-level execution memory summary fields on `code_tasks`

`orchestrator` does not own persistent memory state. It only receives prompt-ready context and returns memory usage self-report fields in the completion payload.

## Endpoint Changes

### Modified

- `POST /tasks` in `workers/orchestrator`
- `POST /internal/webhooks/task-complete` in `apps/code-agent`
- `GET /code/tasks/:taskId` in `apps/code-agent`

### Created

- `POST /internal/code-tasks/process-execution-memory` in `apps/code-agent`

### Removed

- none

### Unchanged

- task submission
- retry submission
- implementation start
- task log streaming
- task cancellation

## Firestore Model

### Collection: `execution_memories`

Owner: `code-agent`

Purpose: canonical reusable execution lessons

Document shape:

- `id: string`
- `repository: string`
- `sourceTaskId: string`
- `sourceLinearIssueId?: string`
- `memoryType: 'implementation_pattern' | 'verification_pattern' | 'pitfall_pattern'`
- `title: string`
- `appliesWhen: string`
- `action: string`
- `avoid: string`
- `verification: string`
- `evidenceSummary: string`
- `retrievalText: string`
- `keywords: string[]`
- `labelHints: string[]`
- `componentHints: string[]`
- `embedding: vector<1536>`
- `embeddingModel: 'text-embedding-3-small'`
- `fingerprint: string`
- `distillationVersion: string`
- `qualityScore: number`
- `applicationCount: number`
- `positiveCount: number`
- `negativeCount: number`
- `status: 'active' | 'suppressed'`
- `createdAt: Timestamp`
- `updatedAt: Timestamp`

### Collection: `execution_memory_applications`

Owner: `code-agent`

Purpose: auditable record of what retrieval returned for a specific execution task

Document shape:

- `id: string`
- `taskId: string`
- `repository: string`
- `linearIssueId?: string`
- `querySummary: string`
- `queryText: string`
- `queryComponents: string[]`
- `queryRiskFlags: string[]`
- `retrievalVersion: string`
- `matchedMemories: { memoryId: string; vectorScore: number; rerankScore: number; title: string; memoryType: string }[]`
- `status: 'matched' | 'no_match' | 'error'`
- `memoryIdsUsed: string[]`
- `memoryIdsRejected: string[]`
- `evaluationSummary?: string`
- `perMemoryOutcome?: { memoryId: string; outcome: 'positive' | 'neutral' | 'negative' | 'unknown'; reason: string; confidence: number }[]`
- `createdAt: Timestamp`
- `updatedAt: Timestamp`
- `completedAt?: Timestamp`

### Task-level additions on `code_tasks`

#### `executionMemoryContext`

- `status: 'none' | 'matched' | 'error'`
- `applicationId: string`
- `retrievalVersion: string`
- `querySummary: string`
- `matchedAt?: Timestamp`
- `matchedMemories: { memoryId: string; title: string; memoryType: string; score: number; appliesWhen: string; action: string; avoid: string; verification: string }[]`
- `errorCode?: string`
- `errorMessage?: string`

#### `executionMemoryPostRun`

- `status: 'pending' | 'processing' | 'completed' | 'skipped' | 'error'`
- `attempts: number`
- `lastAttemptAt?: Timestamp`
- `generatedMemoryIds: string[]`
- `evaluationSummary?: string`
- `skipReason?: string`
- `errorMessage?: string`
- `completedAt?: Timestamp`

## Migrations

### `069_create_execution_memories.mjs`

Create:

- vector index on `execution_memories.embedding`
- dimension `1536`
- flat index enabled
- security rule denying direct client access

### `070_execution-memory-pipeline-indexes.mjs`

Create:

- composite index for `code_tasks(agentType ASC, executionMemoryPostRun.status ASC, completedAt ASC)`

### `firestore-collections.json`

Add:

- `execution_memories`
- `execution_memory_applications`

## Environment and Config Changes

Add these env vars to `apps/code-agent/src/index.ts`, `apps/code-agent/src/config.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs`:

- `INTEXURAOS_EXECUTION_MEMORY_ENABLED`
- `INTEXURAOS_OPENAI_APP_API_KEY`

Behavior:

- if the feature flag is `false`, retrieval and post-run processing are bypassed
- if the flag is `true` but OpenAI config is missing, retrieval records a task-level `error` state and dispatch continues

## Shared Package Change

Do not import the embedding client from `apps/chat-agent`.

Instead:

- extend `packages/infra-gpt` with a small reusable embedding helper
- reuse the existing OpenAI dependency already present there
- keep `apps/chat-agent` and `apps/code-agent` as separate consumers of the shared helper

This avoids app-to-app imports and keeps embedding logic in the package layer where it belongs.

## Code-Agent Changes

### New repositories

Create:

- `apps/code-agent/src/domain/repositories/executionMemoryRepository.ts`
- `apps/code-agent/src/domain/repositories/executionMemoryApplicationRepository.ts`
- `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts`
- `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryApplicationRepository.ts`

Responsibilities:

- persist canonical memories
- run vector search
- persist retrieval/application records
- upsert counters and evaluation results

### Existing repositories to extend

Extend:

- `LogLineRepository` with a read API for recent lines
- `TurnMetricsRepository` with a read API for all attempts
- `CodeTaskRepository` with a query for pending post-run memory processing

### Service wiring

Wire in `apps/code-agent/src/services.ts`:

- Gemini generate client for query normalization
- Gemini generate client for distillation
- Gemini generate client for application evaluation
- OpenAI embedding client
- new repositories
- new use cases

Use a stable internal user identity such as `system:execution-memory` for usage logging.

### Retrieval hook point

Modify:

- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`

Behavior:

- only execution-agent tasks call `prepareExecutionMemoryContext()`
- retrieval happens immediately before dispatch
- if retrieval fails, dispatch proceeds and the task gets `executionMemoryContext.status = 'error'`

### Terminal webhook hook point

Modify:

- `apps/code-agent/src/routes/webhookRoutes.ts`

Behavior:

- when an execution task reaches terminal state, mark `executionMemoryPostRun.status = 'pending'`
- do not run distillation inline in the request
- accept and persist the new orchestrator result fields:
  - `execution_memory_ids_used`
  - `execution_memory_ids_rejected`
  - `execution_memory_usage_summary`

### Scheduler-backed processor

Create:

- `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`
- `apps/code-agent/src/routes/internalExecutionMemoryRoutes.ts` or add the route into an existing internal route module if that keeps file size sane

Processor contract:

- query pending tasks oldest-first
- atomically move one task from `pending` to `processing`
- assemble evidence
- run distillation if the task outcome is reusable
- run application evaluation if the task had matched memories
- mark the task `completed`, `skipped`, or `error`

## Retrieval Pipeline

### Applicability

Run retrieval only when all of these are true:

- feature flag enabled
- task agent type is `execution`
- repository present
- task has not already been assigned memory context

### Retrieval input assembly

Use:

- `task.prompt`
- `task.sanitizedPrompt`
- `task.repository`
- `task.workerType`
- `task.linearIssueId`
- Linear labels if available
- Linear description
- newest 5 Linear comments

Truncation rules:

- description max `2500` chars
- each comment max `800` chars
- total Linear context max `5000` chars

### Query normalization

Model: `Gemini 2.5 Flash`

Version: `execution-memory-query-normalizer@1.0.0`

Output schema:

```json
{
  "semanticQuery": "string",
  "components": ["string"],
  "riskFlags": ["string"],
  "verificationGoals": ["string"],
  "labelHints": ["string"],
  "summary": "string"
}
```

Fallback if Gemini fails:

- deterministic concatenation of prompt + issue title + truncated description + newest comments

### Embedding

- model: `text-embedding-3-small`
- embed the normalized `semanticQuery`

### Vector search

- fetch top `20` nearest neighbors from `execution_memories`
- Firestore native `findNearest()` on `embedding`

### Deterministic reranking

Hard filters:

- `repository` must equal the current task repository
- `status` must equal `active`

Final score:

- `0.65 * vectorScore`
- `0.15 * componentOverlap`
- `0.10 * labelOverlap`
- `0.10 * memoryEffectiveness`

Where:

- `memoryEffectiveness = (positiveCount + 1) / (applicationCount + 2)`

Keep:

- top `3` memories
- each with final score `>= 0.68`

If none survive:

- store application record with `status = 'no_match'`
- set task `executionMemoryContext.status = 'none'`

### Prompt payload shape

Pass a typed context object to `orchestrator`, not freeform text:

```ts
interface ExecutionMemoryPromptContext {
  applicationId: string;
  retrievalVersion: string;
  querySummary: string;
  matchedMemories: {
    memoryId: string;
    title: string;
    memoryType: 'implementation_pattern' | 'verification_pattern' | 'pitfall_pattern';
    score: number;
    appliesWhen: string;
    action: string;
    avoid: string;
    verification: string;
  }[];
}
```

Prompt-size rules:

- each memory max `700` chars across all descriptive fields
- full memory section max `6000` chars

## Orchestrator Changes

### Request threading

Extend:

- `workers/orchestrator/src/types/api.ts`
- `workers/orchestrator/src/types/task.ts`
- `workers/orchestrator/src/types/schemas.ts`
- `apps/code-agent/src/domain/services/taskDispatcher.ts`
- `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`

Add:

- `executionMemoryContext?: ExecutionMemoryPromptContext`

### Execution system prompt

Modify:

- `workers/orchestrator/src/services/system-prompt.ts`

Changes:

- add a dedicated execution-only memory section
- bump execution prompt version from `5.1.0` to `6.0.0`

New section requirements:

- memories are advisory, not authoritative
- the worker must still trust current repo and Linear state over memory
- the worker must ignore mismatched memories
- the worker must not copy stale branch names, issue IDs, or URLs from memories

### Completion contract

Extend `EXECUTION_AGENT_FINAL` with:

- `memory_ids_used: <comma-separated memory IDs or empty>`
- `memory_ids_rejected: <comma-separated memory IDs or empty>`
- `memory_usage_summary: <one sentence or empty>`

### Completion verifier

Modify:

- `workers/orchestrator/src/services/completion-verifier.ts`

Changes:

- extend `EXECUTION_SCHEMA`
- update the verifier prompt examples
- extract and pass through the new memory fields

## Distillation Pipeline

### Input evidence

The processor uses:

- task document
- task result and error
- latest 350 formatted log lines
- turn metrics for all attempts
- Linear issue description and comments

### Distillation model contract

Model: `Gemini 2.5 Flash`

Version: `execution-memory-distiller@1.0.0`

Output schema:

```json
{
  "decision": "create | skip",
  "skipReason": "infra_only | insufficient_signal | already_completed | no_reusable_lesson | ",
  "evidenceSummary": "string",
  "memories": [
    {
      "memoryType": "implementation_pattern | verification_pattern | pitfall_pattern",
      "title": "string",
      "appliesWhen": "string",
      "action": "string",
      "avoid": "string",
      "verification": "string",
      "evidenceSummary": "string",
      "retrievalText": "string",
      "keywords": ["string"],
      "componentHints": ["string"],
      "confidence": 0
    }
  ]
}
```

Rules:

- max `3` memories per task
- skip infra-only failures
- skip already-completed outcomes
- skip tasks with no reusable lesson

### Memory dedupe and merge

First pass:

- exact fingerprint match using
- `sha256(repository + memoryType + normalized(title + appliesWhen + action + avoid))[:24]`

Second pass:

- near-duplicate vector search top `5`
- merge when cosine similarity `>= 0.94`
- require matching `memoryType`

When merging:

- update `updatedAt`
- refresh `evidenceSummary`
- recompute `qualityScore`
- preserve counters

## Application Evaluation Pipeline

### Applicability

Run evaluation when:

- the task had an `executionMemoryContext.applicationId`

### Model contract

Model: `Gemini 2.5 Flash`

Version: `execution-memory-evaluator@1.0.0`

Output schema:

```json
{
  "summary": "string",
  "perMemory": [
    {
      "memoryId": "string",
      "outcome": "positive | neutral | negative | unknown",
      "reason": "string",
      "confidence": 0
    }
  ]
}
```

Inputs:

- matched memories
- worker self-report fields
- task result summary
- terminal status
- latest 200 log lines

Counter updates:

- increment `applicationCount` for every matched memory
- increment `positiveCount` for `positive`
- increment `negativeCount` for `negative`

## Failure and Retry Policy

### Retrieval-time failures

- never fail dispatch
- mark task memory context as `error`
- create an application record if enough context exists

### Post-run processor failures

- retry up to `3` times
- after the last failure, mark `executionMemoryPostRun.status = 'error'`
- do not retry indefinitely

### Distillation skip cases

- `infra_only`
- `already_completed`
- `insufficient_signal`
- `no_reusable_lesson`

## UI and API Changes

### Backend API

Modify:

- `apps/code-agent/src/routes/codeRoutes.ts`

Add to task detail response:

- `executionMemoryContext`
- `executionMemoryPostRun`

### Web types

Modify:

- `apps/web/src/types/index.ts`

Add matching client types for the two new task-level objects.

### Task detail page

Modify:

- `apps/web/src/pages/CodeTaskViewPageV2.tsx`
- `apps/web/src/components/code-tasks/v2/V2TaskHeader.tsx`

Behavior:

- header chip: `Memory: 3 matches`, `Memory: none`, or `Memory: error`
- detail card below the run summary:
  - matched memories
  - type and score
  - post-run status
  - generated memory IDs if new memories were created

No new screen in v1.

## Example Scenario

Task:

- execution task for an Auth0 callback bug in `intexuraos`
- prompt requires route changes, request logging, and env propagation

Retrieval:

- query normalizer outputs a semantic query about Auth0 callback execution paths, request logging, route verification, and env propagation
- vector search returns:
  - `MEM-142` pitfall about missing `logIncomingRequest()`
  - `MEM-155` verification pattern about route-level `app.inject()` coverage
  - `MEM-188` implementation pattern about updating env vars in three required places

Prompt injection:

- `orchestrator` includes the three memory entries in the execution system prompt

Worker report:

- `memory_ids_used = MEM-142,MEM-155`
- `memory_ids_rejected = MEM-188`
- `memory_usage_summary = "Used prior route-logging and test coverage lessons; env guidance did not apply."`

Post-run evaluation:

- `MEM-142` becomes `positive`
- `MEM-155` becomes `positive`
- `MEM-188` becomes `neutral`

Distillation:

- the run emits a new `verification_pattern` memory about updating route schema and task-detail serialization together

## Implementation Order

1. Firestore ownership and migration layer
2. Shared embedding helper in `infra-gpt`
3. `code-agent` repositories and typed task model additions
4. retrieval pipeline in queue drain paths
5. orchestrator request threading and prompt changes
6. completion verifier changes
7. terminal webhook pending-state changes
8. scheduler-backed post-run processor
9. task detail API expansion
10. web task detail UI
11. rollout behind feature flag

## Test Plan

### Unit tests

- query normalization success and fallback
- deterministic reranking
- no-match path
- retrieval failure path that still dispatches
- distillation create and skip decisions
- duplicate merge behavior
- application evaluation counter updates

### Repository tests

- vector search on `execution_memories`
- application record persistence
- pending post-run task query

### Route tests

- terminal webhook marks execution memory processing pending
- scheduler endpoint processes a batch
- task detail route returns the new fields

### Orchestrator tests

- execution prompt includes memory section only for execution tasks
- prompt version bump to `6.0.0`
- completion verifier extracts the new memory usage fields

### Web tests

- header chip rendering
- task detail memory card rendering

### Migration tests

- vector index definition for `execution_memories`
- composite index definition for post-run processor queries

## Acceptance Criteria

- execution-task retrieval is vector-first and repository-scoped
- retrieval failures never block dispatch
- memory context is injected into the execution system prompt via typed payload
- workers report used and rejected memory IDs in `EXECUTION_AGENT_FINAL`
- post-run distillation and evaluation are durable and retryable
- canonical memories are deduped and effectiveness-scored
- task detail API and UI expose matched memory context and post-run status
- rollout is gated by `INTEXURAOS_EXECUTION_MEMORY_ENABLED`
