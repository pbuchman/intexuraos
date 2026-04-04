# INT-1257: Execution Memory Cross-Agent Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the execution memory system so that planning and review agents both retrieve memories before dispatch and contribute new memories after completion, sharing a single memory pool with execution agents.

**Design Spec:** `docs/superpowers/specs/2026-04-04-execution-memory-cross-agent-design.md`

**Architecture:** The execution memory system lives in `apps/code-agent` (retrieval, distillation, gate logic, webhook handling) and `workers/orchestrator` (system prompt rendering, review content capture). All changes extend existing patterns — no new services, collections, or infrastructure.

**Services affected:** code-agent, orchestrator

---

## Pre-Implementation Checklist

Before starting any step, read these files to understand existing patterns:

1. `apps/code-agent/src/domain/models/executionMemory.ts` — current memory type definitions
2. `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts` — distillation + evaluation logic
3. `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts` — retrieval logic
4. `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` — pre-run retrieval gate (line ~372)
5. `apps/code-agent/src/domain/usecases/drainRetryQueue.ts` — pre-run retrieval gate (line ~256)
6. `apps/code-agent/src/routes/webhookRoutes.ts` — post-run queueing gate (line ~54), webhook result type (line ~140)
7. `workers/orchestrator/src/services/system-prompt.ts` — `buildExecutionMemorySection()` (line ~80), execution prompt injection (line ~350)

---

## Step 1: Data Model — Extend ExecutionMemoryType and ExecutionMemory

**Files to modify:**
- `apps/code-agent/src/domain/models/executionMemory.ts`

**What to do:**

1. Open `apps/code-agent/src/domain/models/executionMemory.ts`.
2. Add three new values to the `ExecutionMemoryType` union:

```typescript
export type ExecutionMemoryType =
  | 'implementation_pattern'
  | 'verification_pattern'
  | 'pitfall_pattern'
  | 'decomposition_pattern'
  | 'planning_decision'
  | 'review_finding';
```

3. Add a `sourceAgentType` field to the `ExecutionMemory` interface, after the `sourceLinearIssueId` field:

```typescript
sourceAgentType?: 'execution' | 'planning' | 'review';
```

Note: This is optional (`?`) because existing Firestore documents don't have it. Read-time handling is in Step 6.

**Tests:**
- No dedicated tests needed for type changes — they propagate through existing type-checking.

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass (type-checks all consumers of `ExecutionMemoryType`).

---

## Step 2: Create memoryEligibility Utility

**Files to create:**
- `apps/code-agent/src/domain/utils/memoryEligibility.ts`

**Files to create (tests):**
- `apps/code-agent/src/__tests__/domain/utils/memoryEligibility.test.ts`

**What to do:**

1. Create `apps/code-agent/src/domain/utils/memoryEligibility.ts`:

```typescript
const MEMORY_ELIGIBLE_AGENTS = new Set(['execution', 'planning', 'review']);

export function isMemoryEligibleAgent(
  agentType: string | undefined // @allow-undefined-type -- mirrors existing CodeTask.agentType
): boolean {
  return agentType !== undefined && MEMORY_ELIGIBLE_AGENTS.has(agentType);
}
```

2. Write tests covering:
   - `'execution'` → `true`
   - `'planning'` → `true`
   - `'review'` → `true`
   - `'pull_request'` → `false`
   - `'remediation'` → `false`
   - `undefined` → `false`
   - `''` (empty string) → `false`

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass.

---

## Step 3: Widen Pre-Run Retrieval Gates

**Files to modify:**
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`

**Existing tests to update:**
- `apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts`
- `apps/code-agent/src/__tests__/domain/useCases/drainRetryQueue.test.ts`

**What to do:**

1. In `drainTaskQueue.ts`, add an import for `isMemoryEligibleAgent` from `../utils/memoryEligibility.js`.
2. Find the condition at line ~374:
   ```typescript
   && agentType === 'execution'
   ```
   Replace with:
   ```typescript
   && isMemoryEligibleAgent(agentType)
   ```

3. Do the same in `drainRetryQueue.ts` at line ~258.

4. Update `drainTaskQueue.test.ts`:
   - Find existing tests that verify execution memory retrieval runs for execution agents.
   - Add two new tests following the same pattern:
     - **"prepares execution memory context for planning agent when enabled"** — create a queued task with `agentType: 'planning'`, verify `prepareExecutionMemoryContext` is called.
     - **"prepares execution memory context for review agent when enabled"** — same but with `agentType: 'review'`.
   - Add a negative test: **"does not prepare execution memory for pull_request agent"** — create a queued task with `agentType: 'pull_request'`, verify `prepareExecutionMemoryContext` is NOT called.

5. Update `drainRetryQueue.test.ts` with equivalent tests.

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass.

---

## Step 4: Widen Post-Run Queueing Gate

**Files to modify:**
- `apps/code-agent/src/routes/webhookRoutes.ts`

**Existing tests to update:**
- `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

**What to do:**

1. In `webhookRoutes.ts`, add an import for `isMemoryEligibleAgent` from `../domain/utils/memoryEligibility.js`.
2. Find the `shouldQueueExecutionMemoryPostRun` function (line ~54). Replace:
   ```typescript
   && params.agentType === 'execution'
   ```
   With:
   ```typescript
   && isMemoryEligibleAgent(params.agentType)
   ```

3. Add the new webhook result fields to the `TaskCompleteWebhookBody` type (around line ~163, after `needs_remediation`):
   ```typescript
   review_body?: string;
   review_inline_comments?: string;
   ```

4. Update `webhooks.test.ts`:
   - Find existing tests that verify execution memory post-run is queued for execution tasks.
   - Add two new tests:
     - **"queues execution memory post-run for planning task"** — complete a planning task, verify `executionMemoryPostRun.status` is `'pending'` on the updated task.
     - **"queues execution memory post-run for review task"** — same for review.
   - Add negative test: **"does not queue execution memory post-run for pull_request task"**.

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass.

---

## Step 5: Agent-Aware Distillation Skip + Schema Extension

**Files to modify:**
- `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`

**Existing tests to update:**
- `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

**What to do:**

### 5a. Extend DistillationSchema

1. In `processExecutionMemoryBacklog.ts`, find the `DistillationSchema` (line ~30).
2. Add `'planning_unclear'` to the `skipReason` enum:
   ```typescript
   skipReason: z.enum([
     'infra_only', 'insufficient_signal', 'already_completed', 'no_reusable_lesson', 'planning_unclear'
   ]).optional(),
   ```
3. Add the three new memory types to the `memoryType` enum:
   ```typescript
   memoryType: z.enum([
     'implementation_pattern', 'verification_pattern', 'pitfall_pattern',
     'decomposition_pattern', 'planning_decision', 'review_finding'
   ]),
   ```

### 5b. Extract shouldSkipDistillation

1. Find line ~198 where `task.result?.execution_outcome_label === 'already_completed'` is checked.
2. Extract this into a function:

```typescript
function shouldSkipDistillation(task: CodeTask): {
  skip: boolean;
  reason?: 'already_completed' | 'planning_unclear';
} {
  if (task.result?.execution_outcome_label === 'already_completed') {
    return { skip: true, reason: 'already_completed' };
  }
  if (task.agentType === 'planning' && task.result?.planning_outcome_label === 'unclear') {
    return { skip: true, reason: 'planning_unclear' };
  }
  return { skip: false };
}
```

3. Replace the inline check with:
```typescript
const skipCheck = shouldSkipDistillation(task);
if (skipCheck.skip) {
  return {
    status: 'skipped',
    generatedMemoryIds: [],
    ...(evaluationSummary !== undefined && { evaluationSummary }),
    skipReason: skipCheck.reason,
  };
}
```

4. Export `shouldSkipDistillation` in the `__testables` object at the bottom of the file.

### 5c. Tests

1. Add unit tests for `shouldSkipDistillation`:
   - Execution task with `execution_outcome_label: 'already_completed'` → `{ skip: true, reason: 'already_completed' }`
   - Planning task with `planning_outcome_label: 'unclear'` → `{ skip: true, reason: 'planning_unclear' }`
   - Planning task with `planning_outcome_label: 'planned'` → `{ skip: false }`
   - Review task (any status) → `{ skip: false }`
   - Execution task with `execution_outcome_label: 'implemented'` → `{ skip: false }`

2. Add a test verifying the extended `DistillationSchema` accepts `decomposition_pattern`, `planning_decision`, and `review_finding` as valid memory types.

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass.

---

## Step 6: Agent-Specific Distillation Prompt Builders

**Files to modify:**
- `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`

**Existing tests to update:**
- `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

**What to do:**

### 6a. Extract Existing Execution Distillation Prompt

1. Find the `distillTask` function (line ~431). The prompt is built inline (lines ~456-495).
2. Extract the prompt-building code into a new function `buildExecutionDistillationPrompt`:

```typescript
function buildExecutionDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  // Move the existing prompt construction here verbatim
  // Keep DISTILLATION_VERSION as-is for the execution prompt
}
```

3. The `distillTask` function should now call a router:

```typescript
const prompt = buildDistillationPrompt(task, logs, turnMetrics, issueContext);
```

### 6b. Create Prompt Router

```typescript
function buildDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  switch (task.agentType) {
    case 'planning':
      return buildPlanningDistillationPrompt(task, logs, turnMetrics, issueContext);
    case 'review':
      return buildReviewDistillationPrompt(task, logs, issueContext);
    default:
      return buildExecutionDistillationPrompt(task, logs, turnMetrics, issueContext);
  }
}
```

### 6c. Planning Distillation Prompt

Create `buildPlanningDistillationPrompt`. Use version `planning-memory-distiller@1.0.0`.

**IMPORTANT:** Use the same JSON schema block as the execution prompt, but with the extended memory types. The prompt structure is defined in the design spec, section 3c. Copy the exact prompt text from the design spec.

Key planning-specific fields to include:
- `task.result?.planning_outcome_label`
- `task.result?.planning_is_complex`
- `task.result?.planning_subtask_urls` (count the comma-separated URLs)
- `task.result?.planning_superpowers_writing_plans_used`
- `task.result?.planning_pr_url`

### 6d. Review Distillation Prompt

Create `buildReviewDistillationPrompt`. Use version `review-memory-distiller@1.0.0`.

**IMPORTANT:** Use the same JSON schema block as the execution prompt, but with the extended memory types. The prompt structure is defined in the design spec, section 3d. Copy the exact prompt text from the design spec.

Key review-specific fields to include:
- `task.result?.review_body`
- `task.result?.review_inline_comments`
- `task.result?.review_types`
- `task.result?.review_comments_posted`
- `task.result?.needs_remediation`
- `task.result?.gh_actions_status`

### 6e. Set sourceAgentType on Created Memories

In the `processOneTask` function, when creating or updating memories (the loop starting at line ~218), set `sourceAgentType` based on `task.agentType`:

```typescript
const sourceAgentType = task.agentType === 'planning' ? 'planning'
  : task.agentType === 'review' ? 'review'
  : 'execution';
```

Pass `sourceAgentType` to both `deps.executionMemoryRepo.create()` and `updateExistingMemory()`.

### 6f. Handle sourceAgentType in Repository

**File:** `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts`

Read this file first. In the `create` method, add `sourceAgentType` to the document data. In any read/list methods, map `undefined` to `'execution'` for backward compatibility:

```typescript
sourceAgentType: (doc.sourceAgentType as ExecutionMemory['sourceAgentType']) ?? 'execution',
```

### 6g. Tests

1. Test `buildDistillationPrompt` router: verify it returns the correct prompt builder output for `'planning'`, `'review'`, and `'execution'` (or `undefined`) agent types. You don't need to test the full prompt content — verify each prompt contains its version string:
   - `'planning'` → prompt includes `'planning-memory-distiller@1.0.0'`
   - `'review'` → prompt includes `'review-memory-distiller@1.0.0'`
   - `'execution'` / `undefined` → prompt includes `'execution-memory-distiller@2.0.0'`

2. Test planning prompt includes planning-specific fields: `planning_outcome_label`, `planning_is_complex`.

3. Test review prompt includes review-specific fields: `review_body`, `review_inline_comments`.

4. **Critical: existing execution distillation tests must still pass.** The refactoring (extracting `buildExecutionDistillationPrompt`) must not change existing behavior.

5. Export `buildDistillationPrompt`, `buildPlanningDistillationPrompt`, `buildReviewDistillationPrompt`, `shouldSkipDistillation` in `__testables`.

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass.

---

## Step 7: Agent-Aware Evaluation Context

**Files to modify:**
- `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`

**Existing tests to update:**
- `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

**What to do:**

1. Find the `evaluateApplication` function (line ~317). Locate where the evaluation prompt is built (line ~360-370), specifically the lines that reference:
   - `task.result?.execution_memory_ids_used`
   - `task.result?.execution_memory_ids_rejected`
   - `task.result?.execution_memory_usage_summary`

2. Extract these into a `buildEvaluationContext` function:

```typescript
function buildEvaluationContext(task: CodeTask): {
  selfReportUsed: string;
  selfReportRejected: string;
  selfReportSummary: string;
} {
  switch (task.agentType) {
    case 'planning':
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.planning_outcome_label === 'planned'
          ? 'Planning completed successfully'
          : 'Planning outcome was unclear',
      };
    case 'review':
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.needs_remediation === '1'
          ? `Review found issues requiring remediation (${task.result?.review_comments_posted ?? '0'} comments)`
          : 'Review completed with no remediation needed',
      };
    default:
      return {
        selfReportUsed: task.result?.execution_memory_ids_used ?? '',
        selfReportRejected: task.result?.execution_memory_ids_rejected ?? '',
        selfReportSummary: task.result?.execution_memory_usage_summary ?? '',
      };
  }
}
```

3. Update the evaluation prompt builder to use this function instead of directly referencing the result fields.

4. Also update the early-return path (line ~324) that returns `task.result?.execution_memory_usage_summary` when there's no applicationId. Use `buildEvaluationContext(task).selfReportSummary` instead.

5. Export `buildEvaluationContext` in `__testables`.

### Tests

1. Test `buildEvaluationContext` for all three agent types:
   - Execution task with all self-report fields → returns them directly
   - Execution task with missing self-report fields → returns empty strings
   - Planning task with `planned` outcome → returns success summary
   - Planning task with `unclear` outcome → returns unclear summary
   - Review task with `needs_remediation: '1'` and `review_comments_posted: '5'` → returns remediation summary with count
   - Review task with `needs_remediation: '0'` → returns "no remediation needed"

**Verification:**
- `pnpm run verify:workspace:tracked -- code-agent` must pass.

---

## Step 8: Orchestrator — System Prompt Memory Injection

**Files to modify:**
- `workers/orchestrator/src/services/system-prompt.ts`

**Existing tests to update:**
- `workers/orchestrator/src/__tests__/services/system-prompt.test.ts`

**What to do:**

1. Read `workers/orchestrator/src/services/system-prompt.ts` fully first.
2. Find where `buildExecutionMemorySection(params.executionMemoryContext)` is called (line ~350, inside the execution agent prompt section).
3. Find the **planning agent prompt section**. Look for the `[AGENT:PLANNING]` marker or the planning prompt builder function. Add the same `buildExecutionMemorySection(params.executionMemoryContext)` call:
   - Place it after the Linear issue context block and before the complexity classification instruction.
4. Find the **review agent prompt section**. Look for the `[AGENT:REVIEW]` marker or the review prompt builder function. Add the same call:
   - Place it after the review types list and before the mandatory first action instruction.

**Important:** The `buildExecutionMemorySection` function already handles `undefined` and empty arrays gracefully (returns empty string). No conditional wrapping needed.

### Tests

1. Test that the planning agent system prompt includes the memory section when `executionMemoryContext` has matched memories.
2. Test that the planning agent system prompt does NOT include the memory section when `executionMemoryContext` is undefined.
3. Same two tests for the review agent system prompt.
4. Verify existing execution agent memory prompt tests still pass.

**Verification:**
- `pnpm run verify:workspace:tracked -- orchestrator` must pass.

---

## Step 9: Orchestrator — Review Content Capture in Webhook

**Files to modify:**
- `workers/orchestrator/src/services/webhook-client.ts` (or wherever the webhook result is built for review tasks)

**What to do:**

1. Read the orchestrator's review completion handler. Search for where `REVIEW_AGENT_FINAL` is parsed and where `review_id`, `review_comments_posted`, `review_types`, and `needs_remediation` are extracted from the agent's output.

2. In the same parsing section, extract two additional fields:
   - `review_body`: The full review summary text that was posted to GitHub. This is the `body` field of the `POST /reviews` API call.
   - `review_inline_comments`: JSON-serialized array of inline comments `[{path, line, body}]`. These are the `comments` array of the `POST /reviews` API call.

3. Include both fields in the webhook result payload sent to code-agent.

**IMPORTANT:** Read the orchestrator code carefully to understand exactly where the review body and inline comments are available. The parsing logic may be in `system-prompt.ts`, a dedicated parser, or the task completion handler. Search for `review_comments_posted` to find the right location.

### Tests

1. Test that a completed review task webhook includes `review_body` and `review_inline_comments` in the result payload.
2. Test that if the review has no inline comments, `review_inline_comments` is `'[]'` (empty JSON array).

**Verification:**
- `pnpm run verify:workspace:tracked -- orchestrator` must pass.

---

## Step 10: Full Integration Verification

**What to do:**

1. Run the full CI suite:
   ```bash
   pnpm run ci:tracked
   ```

2. Verify all existing tests pass — no regressions.

3. Verify the new tests pass for both `code-agent` and `orchestrator`.

4. Check that the `ExecutionMemoryType` type change propagates correctly by searching for any switch/case or if/else that checks memory types:
   ```bash
   rg "memoryType.*===" apps/code-agent/src/ workers/orchestrator/src/
   rg "memoryType.*switch" apps/code-agent/src/ workers/orchestrator/src/
   ```
   If any exhaustive switches exist on `ExecutionMemoryType`, they need new cases for the three new types.

---

## Endpoint Changes

### Modified
- `POST /internal/webhooks/task-complete` — accepts `review_body` and `review_inline_comments` result fields; post-run queueing gate widened
- `POST /internal/process-execution-memory-backlog` — processes planning and review tasks

### Created
- None

### Removed
- None

### Unchanged
- `POST /internal/drain-queue` — memory retrieval gate widened internally (no API contract change)
- All other endpoints
