# INT-1352: Execution Memory Injection — Detailed Execution Plan

> **Execution Plan** — Converts the evaluation report findings into concrete, file-level implementation steps to fix the broken feedback loop, strengthen worker awareness, and improve memory quality.

**Date:** 2026-04-12
**Based on:** [INT-1352 Evaluation Report](./INT-1352-execution-memory-evaluation.md)
**Linear Issue:** [INT-1352](https://linear.app/pbuchman/issue/INT-1352/evaluate-code-task-memory-injection-for-optimization)

---

## Objective

Workers (Claude Code / Codex agents) receive injected execution memories but never report which ones they used. The feedback loop is broken: the system cannot learn which memories are helpful, quality scoring is inert, and suppression never triggers. This plan fixes the feedback loop end-to-end and strengthens the prompt so workers are **explicitly aware** of the memories they receive and **clearly state** that awareness.

---

## Scope

| Priority   | Finding                                                      | Steps     |
| ---------- | ------------------------------------------------------------ | --------- |
| P0         | Workers never report memory usage — broken feedback loop     | Steps 1–3 |
| P1         | Evaluator hallucinates memory IDs — silent evaluation drops  | Step 4    |
| P1         | Post-run errors are permanent — no recovery mechanism        | Step 5    |
| P2         | Generic memories dominate matches — high false-positive rate | Step 6    |
| P2         | 92% of corpus never applied — needs pruning                  | Step 7    |

---

## Step 1: Rewrite the Execution Memory Prompt Section (P0)

**Goal:** Strengthen the system prompt so workers are unmistakably aware of the execution memories they receive, and clearly state their awareness before proceeding.

**File:** `workers/orchestrator/src/services/system-prompt.ts`
**Function:** `buildExecutionMemorySection()` (lines 80–131)
**Prompt version:** Bump from current to next minor

### Current Problems

1. The memory section is formatted as metadata (application ID, retrieval version, query summary) — workers see it as administrative noise, not actionable context
2. The acknowledgment instruction says "MANDATORY" but is buried after 8 lines of metadata
3. No explanation of WHY memories matter — workers treat them as optional
4. The reporting instruction says "include in your final summary" without specifying the exact format or that it's machine-validated
5. No numbered index for memories — workers must reproduce full `mem_*` UUIDs

### Changes

Replace the entire `buildExecutionMemorySection` function body. The new prompt must:

**A. Context-setting preamble (new)**
```
### Execution Memory Context

You are receiving execution memories — lessons learned from previous code tasks. These memories were retrieved because they are semantically relevant to YOUR current task. The system uses your feedback on these memories to improve future task quality. Your acknowledgment and usage reporting are machine-validated and REQUIRED.
```

**B. Numbered memory listing (changed)**

Instead of:
```
#### Memory 1: mem_d2999121-0694-413d-adb0-35e45223c8d6
- Title: ...
```

Use:
```
#### [1] mem_d2999121-0694-413d-adb0-35e45223c8d6 — "Creating complex data migrations without test coverage"
- Type: verification_pattern | Score: 0.67
- Applies when: ...
- Action: ...
- Avoid: ...
- Verification: ...
```

Key differences: numbered index, title in header for scannability, type and score on one line. The numbered index `[1]`, `[2]`, `[3]` makes it easy for workers to reference memories.

**C. Mandatory acknowledgment block (strengthened)**

Replace current acknowledgment section with:

```
#### MANDATORY: Acknowledge Execution Memories NOW

You MUST print the following block IMMEDIATELY after reading the Linear issue, BEFORE any other work. This is machine-validated — the completion verifier will REJECT your output if this is missing.

📋 **Execution Memories Received:**
I have received and reviewed {N} execution memories for this task:
- [{index}] {memoryId} — "{title}" — APPLICABLE / NOT APPLICABLE because {one-sentence reason}

Example:
📋 **Execution Memories Received:**
I have received and reviewed 3 execution memories for this task:
- [1] mem_abc123 — "Always add index tests for Firestore migrations" — APPLICABLE because this task involves a Firestore migration
- [2] mem_def456 — "Shift cost calculation client-side" — NOT APPLICABLE because this task is unrelated to pricing
- [3] mem_ghi789 — "Safe execution guard for scheduled tasks" — APPLICABLE because the implementation involves a scheduled job

You must account for EVERY memory listed above. Skipping even one will cause verification failure.
```

**D. Mandatory reporting block (strengthened)**

Replace current reporting section with:

```
#### MANDATORY: Report Memory Usage in Final Output

Your final completion block MUST include these three fields. They are machine-validated — omitting them or leaving them empty will cause verification failure and task re-launch.

- **memory_ids_used**: Comma-separated IDs of memories you APPLIED (e.g., "mem_abc123,mem_ghi789"). Use the full memory ID exactly as shown above.
- **memory_ids_rejected**: Comma-separated IDs of memories you found NOT APPLICABLE (e.g., "mem_def456"). Every injected memory must appear in either used or rejected.
- **memory_usage_summary**: One sentence describing how the applicable memories influenced your work. If no memories applied, write "No memories were applicable to this task — all {N} were rejected as irrelevant."

The union of memory_ids_used and memory_ids_rejected MUST equal the full set of injected memories. Unaccounted memories will fail validation.
```

**E. Remove metadata noise**

Remove from the rendered section:
- `Retrieved application: {applicationId}` — worker doesn't need this
- `Retrieval version: {retrievalVersion}` — worker doesn't need this
- `Query summary: {querySummary}` — worker doesn't need this

These are observability fields that belong in logs, not in the worker's prompt.

### Verification

- Memory acknowledgment pattern `📋 **Execution Memories Received:**` followed by `I have received and reviewed` — testable by existing `validateMemoryReporting` function
- Each memory ID appears in brackets `[memoryId]` — already validated
- Worker states applicability per memory — new behavior visible in logs

---

## Step 2: Make Memory Fields Required in All Completion Schemas (P0)

**Goal:** Prevent Zod from silently defaulting empty memory fields, so the completion verifier catches missing fields before they propagate.

**File:** `workers/orchestrator/src/services/completion-verifier.ts`
**Lines:** 131–215 (Zod schemas)

### Current Problem

| Schema                | memory_ids_used                     | memory_ids_rejected  | memory_usage_summary |
| --------------------- | ----------------------------------- | -------------------- | -------------------- |
| `PLANNING_SCHEMA`     | `z.string().optional().default('')` | same                 | same                 |
| `EXECUTION_SCHEMA`    | `z.string()` ✅                      | same ✅               | same ✅               |
| `PULL_REQUEST_SCHEMA` | `z.string().optional().default('')` | same                 | same                 |
| `REVIEW_SCHEMA`       | `z.string().optional().default('')` | same                 | same                 |
| `REMEDIATION_SCHEMA`  | `z.string().optional().default('')` | same                 | same                 |

Only the execution schema requires these fields. All other schemas default to empty strings, which means Gemini extraction "succeeds" even when the worker never reported memory usage.

### Changes

**A. Change all schemas to use `z.string()` (required, no default) for memory fields:**

```typescript
// PLANNING_SCHEMA (line 140-142)
memory_ids_used: z.string(),       // was: z.string().optional().default('')
memory_ids_rejected: z.string(),   // was: z.string().optional().default('')
memory_usage_summary: z.string(),  // was: z.string().optional().default('')

// PULL_REQUEST_SCHEMA (line 171-173) — same change
// REVIEW_SCHEMA (line 187-189) — same change
// REMEDIATION_SCHEMA (line 206-208) — same change
```

**B. Conditional requirement:** Memory fields should only be required when memories were actually injected. Since the completion verifier receives `executionMemoryContext`, add conditional schema selection:

In the `verify()` method (around line 700), before Zod parsing:

```typescript
const hasInjectedMemories =
  input.executionMemoryContext !== undefined &&
  input.executionMemoryContext.matchedMemories.length > 0;

// Select schema variant based on whether memories were injected
const schema = hasInjectedMemories
  ? getSchemaWithRequiredMemory(input.agentType)
  : getSchemaWithOptionalMemory(input.agentType);
```

This avoids breaking tasks that legitimately have no memories injected (16 of 50 in the evaluation had no matches above threshold).

**C. Update the Gemini extraction prompt** (lines 275–400) to emphasize memory fields:

In the extraction prompt for each agent type, add emphasis:

```
IMPORTANT: If execution memories were injected, memory_ids_used, memory_ids_rejected, and memory_usage_summary are REQUIRED fields.
The agent MUST have reported these. Extract them from the agent's final output block.
If the agent did not report them, return empty strings — but know this will cause validation failure.
```

### Test Changes

**File:** `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

Update existing tests that rely on optional defaults:
- Tests that provide no memory fields when memories were injected should now fail Zod parse
- Add new tests verifying that tasks without injected memories still pass with optional memory fields
- Ensure all 5 agent types are tested for both with-memory and without-memory scenarios

---

## Step 3: Enhance the Missing-Fields Resume Prompt for Memory (P0)

**Goal:** When the completion verifier detects missing memory reporting, the resume prompt should tell the worker exactly what's needed, not just list field names.

**File:** `workers/orchestrator/src/services/task-dispatcher.ts`
**Function:** `buildMissingFieldsPrompt()` (lines 1612–1634)

### Current Problem

The resume prompt says:
```
Missing fields: memory_acknowledgment, memory_ids_unaccounted, memory_usage_summary
```

This is opaque — the worker doesn't know what `memory_acknowledgment` means or what to do about it.

### Changes

Detect memory-specific failures and add targeted instructions:

```typescript
private buildMissingFieldsPrompt(
  agentType: CompletionAgentType,
  missingFields: string[],
  rawLogs: string
): string {
  const transcript = getLast50Lines(rawLogs);
  const memoryFields = [
    'memory_acknowledgment', 'memory_ids_used_invalid',
    'memory_ids_rejected_invalid', 'memory_ids_overlap',
    'memory_ids_unaccounted', 'memory_usage_summary',
  ];
  const hasMemoryFailures = missingFields.some(
    (field) => memoryFields.includes(field)
  );

  const memoryGuidance = hasMemoryFailures ? [
    '',
    'EXECUTION MEMORY REPORTING FAILURE:',
    'You were injected with execution memories but did not properly report their usage.',
    'You MUST include in your final output:',
    '1. memory_ids_used: comma-separated IDs of memories you applied',
    '2. memory_ids_rejected: comma-separated IDs of memories you found irrelevant',
    '3. memory_usage_summary: one sentence about how memories influenced your work',
    'Every injected memory must appear in either used or rejected. No ID may be missing.',
    'If you did not use any memory, put all IDs in memory_ids_rejected.',
  ] : [];

  return [
    '[AUTO-CONTINUE ATTEMPT]',
    'Your last response was missing required fields for the completion verifier.',
    '',
    `Missing fields: ${missingFields.join(', ')}`,
    ...memoryGuidance,
    '',
    'Please ensure your final message includes all required information.',
    `Agent type: ${agentType}`,
    '',
    'Last 50 lines of transcript for reference:',
    transcript,
    '',
    'Constraints:',
    '- Do not restart from scratch.',
    '- Continue from current repository/worktree state.',
  ].join('\n');
}
```

### Test Changes

**File:** `workers/orchestrator/src/services/__tests__/task-dispatcher.test.ts`

Add test cases:
- `buildMissingFieldsPrompt` with memory-related missing fields includes memory guidance
- `buildMissingFieldsPrompt` with non-memory missing fields does not include memory guidance

---

## Step 4: Use Indexed References in Evaluator Prompt (P1)

**Goal:** Eliminate evaluator hallucination of memory IDs by using numbered indices instead of UUIDs.

**File:** `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`
**Function:** `evaluateApplication()` (lines 377–466)

### Current Problem

The evaluator prompt includes:
```
Matched memories: [{"memoryId":"mem_d2999121-0694-413d-adb0-35e45223c8d6", ...}]
```

The evaluator must reproduce the exact UUID in its response. Gemini occasionally truncates or corrupts UUIDs (9 instances, 8 tasks affected).

### Changes

**A. Build indexed memory map:**

```typescript
const indexedMemories = application.matchedMemories.map(
  (m, index) => ({
    index: index + 1,
    memoryId: m.memoryId,
    title: m.title,
    memoryType: m.memoryType,
  })
);
```

**B. Replace memory IDs with indices in the evaluator prompt:**

Change the `Matched memories` line to:
```typescript
`Matched memories:\n${indexedMemories.map(
  (m) => `[${String(m.index)}] ${m.title} (type: ${m.memoryType})`
).join('\n')}`,
```

**C. Update the evaluation schema to use indices:**

Change the schema from:
```typescript
memoryId: z.string().min(1),
```
To:
```typescript
memoryIndex: z.number().int().min(1),
```

**D. Update the schema block:**

```typescript
const EVALUATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "summary": "string (non-empty, overall assessment)",',
  '  "perMemory": [',
  '    {',
  '      "memoryIndex": 1,  // integer index from [N] above',
  '      "outcome": "positive" | "neutral" | "negative" | "unknown",',
  '      "reason": "string (why this outcome)",',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
].join('\n');
```

**E. Map indices back to IDs after parsing:**

```typescript
const indexToId = new Map(
  indexedMemories.map((m) => [m.index, m.memoryId])
);

const resolvedPerMemory = parsed.perMemory.map((outcome) => ({
  memoryId: indexToId.get(outcome.memoryIndex) ?? `unknown-index-${String(outcome.memoryIndex)}`,
  outcome: outcome.outcome,
  reason: outcome.reason,
  confidence: outcome.confidence,
}));
```

**F. Update the unknown ID detection** (lines 468–477):

Use `indexToId.get()` result to detect unmapped indices instead of checking `knownMemoryIds`:

```typescript
for (const outcome of resolvedPerMemory) {
  if (outcome.memoryId.startsWith('unknown-index-')) {
    deps.logger.warn(
      { taskId: task.id, memoryIndex: outcome.memoryId },
      'Evaluator returned outcome for unknown memory index, skipping'
    );
    continue;
  }
  // ... existing memory update logic
}
```

**G. Bump evaluation version:** Change `EVALUATION_VERSION` from `'execution-memory-evaluator@1.0.0'` to `'execution-memory-evaluator@2.0.0'` (major bump — schema change).

### Test Changes

**File:** `apps/code-agent/src/domain/usecases/__tests__/processExecutionMemoryBacklog.test.ts`

- Update all tests that check evaluator prompt to expect indexed format
- Update all tests that mock evaluator response to return `memoryIndex` instead of `memoryId`
- Add test: evaluator returns valid index → resolves to correct memory ID
- Add test: evaluator returns invalid index → logs warning and skips
- Add test: index mapping round-trips correctly for 1, 2, 3 memories

---

## Step 5: Add Sweep Job for Errored Post-Run Tasks (P1)

**Goal:** Automatically retry post-run processing for tasks permanently stuck in `error` state.

**File:** `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`

### Current Problem

7 tasks have permanent `error` status from the Apr 11 Gemini outage. Max 3 retries were exhausted within the same outage window. No recovery mechanism exists.

### Changes

**A. Add a new function `sweepErroredApplications()`:**

```typescript
export async function sweepErroredApplications(
  deps: ProcessExecutionMemoryBacklogDeps
): Promise<{ requeued: number; skipped: number }> {
  // Find tasks with executionMemoryPostRun.status === 'error'
  // AND executionMemoryPostRun.updatedAt < (now - 24 hours)
  // Reset to 'pending' with retryCount incremented
  // Cap total retries at 6 (3 original + 3 sweep)
}
```

**B. Add a new route or scheduler entry** to call `sweepErroredApplications()` periodically (once per hour or via Cloud Scheduler).

**File:** `apps/code-agent/src/routes/internal/execution-memory-routes.ts` (or new file)

Add endpoint:
```
POST /internal/execution-memory/sweep-errored
```

**C. Wire up Cloud Scheduler** in Terraform:

**File:** `terraform/environments/dev/main.tf`

Add a Cloud Scheduler job that hits the sweep endpoint every 6 hours.

### Test Changes

- Add test: `sweepErroredApplications` resets errored tasks older than 24h to pending
- Add test: `sweepErroredApplications` skips tasks errored less than 24h ago
- Add test: `sweepErroredApplications` respects max retry cap (does not re-enqueue beyond 6 total retries)
- Add test: route integration test for the sweep endpoint

---

## Step 6: Agent-Type-Specific Rerank Threshold (P2)

**Goal:** Reduce false-positive memory injection for review agents, which have the highest irrelevant match rate.

**File:** `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`
**Constant:** `MIN_RERANK_SCORE` (line 19)

### Current Problem

The threshold is a global `0.50` for all agent types. Review agents (58% injection rate) receive generic memories like "Comprehensive Verification" that match broadly but aren't task-specific.

### Changes

**A. Replace global constant with agent-type-aware function:**

```typescript
const BASE_RERANK_THRESHOLD = 0.50;
const REVIEW_RERANK_THRESHOLD = 0.55;

function getMinRerankScore(agentType: string): number {
  return agentType === 'review' ? REVIEW_RERANK_THRESHOLD : BASE_RERANK_THRESHOLD;
}
```

**B. Pass `agentType` to the retrieval function** (may need to add parameter to `prepareExecutionMemoryContext`):

```typescript
export async function prepareExecutionMemoryContext(
  task: CodeTask,
  deps: ExecutionMemoryContextDeps,
  agentType: string  // new parameter
): Promise<...> {
  // ...
  const minScore = getMinRerankScore(agentType);
  const matchedMemories = reranked
    .filter((candidate) => candidate.rerankScore >= minScore)
    .slice(0, MAX_MATCHES);
}
```

**C. Update callers** to pass the agent type.

### Test Changes

- Add test: review agent uses 0.55 threshold
- Add test: execution agent uses 0.50 threshold
- Add test: candidate at 0.52 passes for execution but fails for review

---

## Step 7: Corpus Pruning for Aged Zero-Application Memories (P2)

**Goal:** Archive memories that have never been applied after 30 days, reducing corpus size and improving retrieval signal-to-noise.

**File:** `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts` (or new file)

### Current Problem

911 of 990 active memories have `applicationCount = 0`. The corpus grows at ~2.7 memories/task but retrieval only surfaces top-3 from 20 nearest neighbors. The long tail is dead weight.

### Changes

**A. Add a new function `pruneStaleMemories()`:**

```typescript
export async function pruneStaleMemories(
  deps: { executionMemoryRepo: ExecutionMemoryRepository; logger: Logger },
  options: { maxAgeDays: number; dryRun: boolean }
): Promise<{ archived: number; skipped: number }> {
  // Query: status === 'active' AND applicationCount === 0
  //   AND createdAt < (now - maxAgeDays)
  // Set status to 'archived' (not deleted — reversible)
}
```

**B. Add route:**

```
POST /internal/execution-memory/prune-stale
```

With query parameter `dryRun=true` for safe preview.

**C. Schedule:** Run weekly via Cloud Scheduler with `maxAgeDays: 30`.

### Test Changes

- Add test: memories with 0 applications older than 30 days are archived
- Add test: memories with >0 applications are never archived regardless of age
- Add test: memories newer than 30 days are not archived even with 0 applications
- Add test: dry run mode returns counts without modifying data

---

## Endpoint Changes

### Modified

None — no existing endpoint behavior changes.

### Created

| Endpoint                                        | Service    | Purpose                                                 |
| ----------------------------------------------- | ---------- | ------------------------------------------------------- |
| `POST /internal/execution-memory/sweep-errored` | code-agent | Retry permanently errored post-run evaluations (Step 5) |
| `POST /internal/execution-memory/prune-stale`   | code-agent | Archive aged zero-application memories (Step 7)         |

### Removed

None.

### Unchanged

All existing execution memory retrieval, injection, and evaluation endpoints remain unchanged.

---

## Implementation Order

```
Step 1 (prompt rewrite) ──────────┐
                                   ├──→ Deploy together: fixes the feedback loop end-to-end
Step 2 (schema enforcement) ──────┤
                                   │
Step 3 (resume prompt) ───────────┘
                                   
Step 4 (indexed evaluator) ────────→ Independent — can deploy separately

Step 5 (sweep job) ────────────────→ Independent — can deploy separately

Step 6 (review threshold) ─────────→ Deploy after Step 1–3 prove memory reporting works
Step 7 (corpus pruning) ───────────→ Deploy after Step 6 (threshold change may affect application counts)
```

**Recommended grouping:**
- **PR 1:** Steps 1 + 2 + 3 (P0 — fix the broken feedback loop)
- **PR 2:** Step 4 (P1 — fix evaluator hallucination)
- **PR 3:** Step 5 (P1 — add sweep job)
- **PR 4:** Steps 6 + 7 (P2 — quality improvements, after observing P0 fix results)

---

## Files Changed Summary

| File                                                                                  | Steps   | Nature                                              |
| ------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- |
| `workers/orchestrator/src/services/system-prompt.ts`                                  | 1       | Rewrite `buildExecutionMemorySection()`             |
| `workers/orchestrator/src/services/completion-verifier.ts`                            | 2       | Make memory fields required; add conditional schema |
| `workers/orchestrator/src/services/task-dispatcher.ts`                                | 3       | Enhance `buildMissingFieldsPrompt()`                |
| `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts`                | 4, 5, 7 | Indexed evaluator; sweep function; prune function   |
| `apps/code-agent/src/domain/usecases/prepareExecutionMemoryContext.ts`                | 6       | Agent-type-specific threshold                       |
| `apps/code-agent/src/routes/internal/execution-memory-routes.ts`                      | 5, 7    | New sweep + prune endpoints                         |
| `terraform/environments/dev/main.tf`                                                  | 5, 7    | Cloud Scheduler jobs                                |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`             | 2       | Schema enforcement tests                            |
| `workers/orchestrator/src/services/__tests__/task-dispatcher.test.ts`                 | 3       | Resume prompt tests                                 |
| `apps/code-agent/src/domain/usecases/__tests__/processExecutionMemoryBacklog.test.ts` | 4, 5, 7 | Evaluator + sweep + prune tests                     |
| `apps/code-agent/src/domain/usecases/__tests__/prepareExecutionMemoryContext.test.ts` | 6       | Threshold tests                                     |

---

## Success Criteria

After deploying Steps 1–3 (P0 fix), within the next 50 tasks:

1. **Memory acknowledgment rate:** ≥ 90% of tasks with injected memories print the `📋 Execution Memories Received:` block
2. **Memory reporting rate:** ≥ 80% of completed tasks report non-empty `memory_ids_used` or `memory_ids_rejected` (vs. current 0%)
3. **Evaluation outcome diversity:** ≥ 50% of `perMemoryOutcome` values are `positive`, `neutral`, or `negative` (vs. current 100% `unknown`)
4. **Worker context awareness:** Workers explicitly state per-memory applicability in their acknowledgment block — visible in task logs

After deploying Step 4 (P1 evaluator):

5. **Hallucination rate:** 0 instances of "Evaluator returned outcome for unknown memory ID" in the next 50 post-run evaluations (vs. current 9 in 50)

After deploying Steps 6–7 (P2 quality):

6. **Review false positives:** ≤ 40% of review agent memory injections rated `neutral` or `negative` (vs. current estimated >50%)
7. **Corpus utilization:** ≥ 15% of active memories have `applicationCount > 0` (vs. current 8%)
