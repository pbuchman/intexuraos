# Execution Memory Fixes — Design Spec

Based on INT-1267 audit findings. Five issues identified, all in `apps/code-agent`.

---

## Fix 1: Evaluation Schema Block + Schema Repair

### Problem

The evaluation prompt (line 423-433 of `processExecutionMemoryBacklog.ts`) says only "Return JSON only" with no schema definition. The LLM omits the required `summary` field, causing Zod validation failure. This blocked 2/7 INT-1267 tasks (planning + execution) from completing post-run evaluation.

The distillation prompt already has a proper `DISTILLATION_SCHEMA_BLOCK` with examples (lines 494-523). The evaluation prompt needs an equivalent.

Additionally, the evaluation path uses `EvaluationSchema.parse()` directly (line 440) with no try/catch and no repair — any schema violation throws and fails permanently after 3 attempts. The distillation path already implements a repair pattern (lines 675-694) that catches the first parse error and re-submits with the error context. The evaluation path should follow the same pattern.

### Solution

1. **Add `EVALUATION_SCHEMA_BLOCK`** — Explicit JSON schema definition + examples, modeled on `DISTILLATION_SCHEMA_BLOCK` (lines 494-523). Include the exact shape, field types, and two examples (one with perMemory populated, one with empty array).

2. **Add schema repair to evaluation** — Wrap the `EvaluationSchema.parse()` call (line 440) in try/catch with a refinement retry, identical to the pattern used by `distillTask()` at lines 675-694:
   - First parse fails → log warning
   - Build refinement prompt appending: original prompt + error message + "Fix the JSON"
   - Re-generate with evaluator client
   - Re-parse with `EvaluationSchema.parse()`
   - If second parse fails, throw (propagates to the 3-attempt outer retry in `processExecutionMemoryBacklog`)

### Files

- `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`: Add `EVALUATION_SCHEMA_BLOCK` constant, modify `evaluateApplication()` to include it in prompt and add repair retry
- `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`: Add tests for evaluation repair path

---

## Fix 2: Application Repository DI Wiring

### Problem

Task `task_50422888` hit `application_repo_unavailable` because `executionMemoryApplicationRepo` is marked optional (`?`) in the service container (line 141 of `services.ts`) and a code path dispatched memory preparation without providing it.

Looking at the code: `services.ts` line 517-520 creates the repo and line 619 wires it into the container. The repo is always created when services initialize. The optional typing exists so tests don't need to provide it. The `prepareExecutionMemoryContext` function checks for `undefined` at line 80 and returns an error.

### Root Cause Clarification

The repo IS wired in `services.ts` — it's created unconditionally at line 517. The `task_50422888` dispatch was a **review task dispatched through webhookRoutes** (line 61, `isMemoryEligibleAgent` check). The `shouldPrepareExecutionMemory` function in webhookRoutes passes through to the drain queue, which receives `deps.executionMemory?.executionMemoryApplicationRepo`. The issue is that the `executionMemory` optional bag on the drain deps may not be populated for all dispatch code paths.

### Solution

Trace the exact dispatch path that creates review tasks after remediation and ensure it passes the memory resources. The fix is in `webhookRoutes.ts` where the webhook handler constructs drain dependencies — ensure `executionMemory` bag is always populated when `executionMemoryEnabled` is true.

### Files

- `apps/code-agent/src/routes/webhookRoutes.ts`: Audit all paths that call `drainTaskQueue` or `drainRetryQueue` to ensure `executionMemory` bag is populated
- `apps/code-agent/src/__tests__/routes/webhookRoutes.test.ts`: Add test for memory resources being passed through

---

## Fix 3: Vector Scoring — Distance Not Populated

### Problem

All `vectorScore` values are exactly `1.0` across all INT-1267 applications. The code at `firestoreExecutionMemoryRepository.ts` line 171:

```typescript
const distance = (doc as { distance?: number }).distance ?? 0;
```

The `?? 0` fallback means if `.distance` is `undefined`, score becomes `1 - 0 = 1.0`. The `findNearest()` call at lines 155-162 does NOT request distance output:

```typescript
filteredCollection.findNearest('embedding', FieldValue.vector(input.embedding), {
  limit: input.limit,
  distanceMeasure: 'COSINE',
});
```

In `@google-cloud/firestore@7.x`, the `findNearest()` requires `distanceResultField` option to populate distance values on result documents. Without it, `.distance` is undefined.

### Solution

1. Add `distanceResultField: 'vectorDistance'` to the `findNearest()` options — this writes the computed distance into a virtual field on each result document.
2. Read the distance from `doc.data().vectorDistance` instead of casting to `{ distance?: number }`.
3. Remove the `?? 0` fallback or change it to `?? 1` (unknown distance = low score, not perfect score) as a safety net.

### Files

- `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts`: Add `distanceResultField`, change distance extraction logic
- `apps/code-agent/src/__tests__/infra/repositories/firestoreExecutionMemoryRepository.test.ts`: Update test mocks to include distance in results

---

## Fix 4: Include Remediation Agents in Memory Retrieval

### Problem

`memoryEligibility.ts` line 1 excludes remediation:
```typescript
const MEMORY_ELIGIBLE_AGENTS = new Set(['execution', 'planning', 'review']);
```

Remediation agents rewrite plans or fix code based on review findings. They would benefit from pitfall and verification pattern memories — especially the "Misidentifying System Architecture" pattern that was generated during INT-1267 and directly relevant to the remediation rewrite.

### Solution

1. Add `'remediation'` to `MEMORY_ELIGIBLE_AGENTS` set.
2. Update the test in `memoryEligibility.test.ts` to expect `true` for `'remediation'`.
3. The `createRemediationTask.ts` flow doesn't need changes — remediation tasks enter the drain queue like other tasks, where `isMemoryEligibleAgent` is the gating check (line 375 of `drainTaskQueue.ts`). Once the eligibility check passes, memory preparation happens automatically.
4. Post-run distillation also works automatically — the `processOneTask` switch on `agentType` at line 237 falls through to the `default` case (execution distillation), which is appropriate for remediation.

### Files

- `apps/code-agent/src/domain/utils/memoryEligibility.ts`: Add `'remediation'` to set
- `apps/code-agent/src/__tests__/domain/utils/memoryEligibility.test.ts`: Update test

---

## Fix 5: Agent Memory Usage Tracking

### Problem

`memoryIdsUsed` is `[]` across all applications. The field is populated from `task.result?.execution_memory_ids_used` (line 372 of `processExecutionMemoryBacklog.ts`), which comes from the completion verifier's extraction of the agent's self-report. The agents never self-report because:

1. The system prompt includes matched memories but doesn't instruct the agent to report which ones it applied.
2. The completion verifier extracts fields like `execution_memory_ids_used` from agent output, but agents don't know they should produce these fields.

### Solution

This is a system prompt change in the orchestrator, not code-agent. The orchestrator's `buildExecutionMemorySection()` in `system-prompt.ts` renders the matched memories into the prompt. It should also include an instruction block telling the agent to report memory usage in its completion output.

1. In the orchestrator's `system-prompt.ts`, append to the execution memory section:
   - An instruction that the agent should, in its final output or stop-hook summary, include which memory IDs it applied and which it found irrelevant
   - The expected format: comma-separated memory IDs for `execution_memory_ids_used` and `execution_memory_ids_rejected`
2. The completion verifier already extracts these fields — the issue is purely that agents don't emit them.

### Files

- `workers/orchestrator/src/services/system-prompt.ts`: Add memory usage reporting instructions to `buildExecutionMemorySection()`
- `workers/orchestrator/src/__tests__/services/system-prompt.test.ts`: Update snapshot/assertion tests

---

## Open Questions (for PR review)

1. **Fix 3 (vector scoring):** Need to verify whether `@google-cloud/firestore@7.11.6` actually supports `distanceResultField` option, or if we need the newer `distanceThreshold`/`distanceField` API. The exact API name may vary by SDK version.

2. **Fix 5 (agent tracking):** The agent runs in a container with limited ability to structure output. The completion verifier may need to be lenient about format (e.g., accept both `mem_xxx,mem_yyy` and `["mem_xxx","mem_yyy"]`).

3. **Fix 4 (remediation eligibility):** Remediation agents operate on specific review findings. The matched memories might dilute focus. Worth monitoring the first few runs to confirm memory relevance doesn't degrade remediation quality.
