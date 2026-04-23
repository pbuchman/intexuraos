# Completion Verification — Decouple Deliverable from Telemetry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop failing code tasks when the only thing missing is the memory-acknowledgment telemetry block. Telemetry presence is observability data; it does not reflect on whether the task's deliverable was produced, so it must not gate task completion.

**Architecture:** The orchestrator's `CompletionVerifier` currently returns a single `missingFields: string[]` that mixes (a) deliverable contract fields (e.g. `gh_pr_url`, `review_comments_posted`) and (b) memory-acknowledgment telemetry fields (e.g. `memory_acknowledgment`, `memory_ids_unaccounted`). The orchestrator retries the worker up to 3× if either is missing, then marks the task `failed`. This plan (1) splits the verdict into `missingFields` (deliverable — still blocking) and `telemetryGaps` (observability — never blocking), (2) extracts the retry/accept/fail policy into a **pure function** `decideCompletionOutcome(verdict, exitCode, attempt, maxAttempts)` that is worker-agnostic, and (3) rewires the dispatcher to accept any task whose deliverable is intact regardless of telemetry. No per-worker tiers, no capability judgments, no hard-coded assumptions about which LLMs can emit the ceremony. Telemetry gaps are logged as warnings and persisted to `verificationHistory` for observability, but they never trigger retry or failure.

**Design principle:** Worker identity is irrelevant to the policy. A Sonnet-grade worker that forgets the memory ack for orchestrator reasons (e.g. premature verifier run on partial output — see motivating example below) and a glm-grade worker that forgets it for capability reasons both produced a valid deliverable; both succeed. As models evolve, no plan update is needed.

**Tech Stack:** TypeScript (strict mode), Zod, Vitest. No new dependencies, no Firestore migration (new `verificationHistory` fields are optional), no webhook shape change, no `WORKER_TYPES` config change.

**Endpoint Changes:** None. No HTTP endpoints modified, created, removed, or unchanged — this is purely internal orchestrator logic.

**Non-goals / out of scope:**
- No worker prompt changes (system prompt still asks for memory ack — workers that can emit it should continue doing so).
- No downstream code-agent changes. Memory-effectiveness scoring downstream may see more "no memory signal" records (empty `execution_memory_ids_used`) than before. The distinction between "rejected all memories" and "skipped telemetry" is recoverable via `verificationHistory[n].telemetryGaps` — if and when a downstream consumer cares, it reads that field. Not addressed in this change.
- No coverage for `handleResumedAfterSuccessCompletion` — that's a separate code path (`task-dispatcher.ts:2037`) invoked from `handleTaskCompletion:1312` BEFORE the lines we're modifying; resumed-after-success tasks are unaffected.
- Compliance validation behavior is unchanged: it continues to run for execution agents on successful verification, exactly as today. Since we no longer fail tasks for missing telemetry, every successful execution task runs compliance (including former glm-grade failures that now succeed).

**Behavior changes introduced by this plan (disclosed up-front):**

1. **Opus/Sonnet/auto tasks that skip the memory-ack ceremony now succeed.** Previously retried 3× and failed terminally. This is the core goal, but worth flagging: any downstream watching "task failed with memory_acknowledgment missing" will see those failures drop. Verification step (Task 10) checks the terraform/monitoring tree for alerts that key off this message.
2. **Exit-code override becomes unconditional.** Current code (`task-dispatcher.ts:1557`) applies the override ONLY inside the `verification.passed` branch. Under `decideCompletionOutcome` rule 3, it fires for every non-zero exit regardless of verdict shape. Practical effect: a worker that produced no `gh_pr_url` AND crashed with exit=1 previously got retried; now it fails immediately with `TASK_EXIT_CODE_OVERRIDE`. Correct semantics (don't retry a crashed container for missing fields), but different from today. Covered by a dedicated test in Task 7.
3. **Compliance validator will post PR comments on tasks that previously didn't reach it.** The validator (`agent-compliance-validator.ts:540-576`) runs on every successful execution task and posts a PR comment when superpowers usage is missing. Tasks that previously failed at the telemetry gate never got these comments; now they will. No task failures result — compliance comments are non-fatal — but expect increased PR-comment noise from the compliance validator for weak-model execution tasks. If noise becomes a problem, the compliance validator itself can be tuned; not addressed here.

## Motivating examples

| Task                                        | Worker             | What happened                                         | Why current orchestrator fails it                                                                                                                       | Why this plan fixes it                                                                                                |
| ------------------------------------------- | ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `task_1dbe9147-4164-4b0c-aaef-39aa90e1f433` | `glm` (review)     | Posted review #4162575153, `result.prUrl` populated   | Missing `memory_acknowledgment` after 3 retries                                                                                                         | Deliverable (`gh_pr_url`) present → accept, log telemetry gap                                                         |
| `task_28f5349a-ab4e-4165-8598-c6b897d57531` | `auto` (execution) | Created PR #1906 with correct final block at 15:36:27 | Orchestrator closed the attempt window at 15:25:18 (inactivity-restart), verifier ran on partial output at 15:25:20 before the memory block was emitted | Deliverable (`gh_pr_url`) present in partial output → accept; the ceremony arrives later but no longer gates the task |

Full plan document (committed to the repo): `docs/plans/2026-04-23-completion-verifier-tiered-telemetry.md`.

---

## File Structure

### Modified Files

| File                                                                      | Responsibility of change                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/completion-verifier.ts`                | Split `CompletionVerifierVerdict` into `missingFields` (blocking deliverable) + `telemetryGaps` (observability-only). Route memory-validation failures into `telemetryGaps`. Relax `EXECUTION_SCHEMA` memory fields to optional. Export helpers `isTelemetryField`, `partitionMissingFields`. |
| `workers/orchestrator/src/services/completion-outcome.ts`                 | **NEW FILE.** Pure function `decideCompletionOutcome(verdict, exitCode, attempt, maxAttempts)` returning a discriminated-union `CompletionOutcome`. Worker-agnostic — no tier parameter.                                                                                                      |
| `workers/orchestrator/src/services/task-dispatcher.ts`                    | Refactor `handleTaskCompletion` lines 1432–1748 to delegate retry/accept/fail decisions to `decideCompletionOutcome`. Thin wiring only.                                                                                                                                                       |
| `workers/orchestrator/src/types/task.ts`                                  | Extend `TaskVerificationRecord` with `telemetryGaps?: string[]`.                                                                                                                                                                                                                              |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` | Tests for split verdict and helpers. Update existing tests that asserted memory-fields in `missingFields`.                                                                                                                                                                                    |
| `workers/orchestrator/src/services/__tests__/completion-outcome.test.ts`  | **NEW FILE.** Exhaustive unit tests for `decideCompletionOutcome`.                                                                                                                                                                                                                            |

### Explicitly NOT modified

- `workers/orchestrator/src/services/isolation/types.ts` — no `WorkerTypeConfig` changes. The decision is worker-agnostic.
- `packages/common-core/src/codeTaskWorkerTypes.ts` — unchanged.

---

## Task 1: Split the verdict type

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` (around lines 43–59)

- [ ] **Step 1: Write the failing test**

Add to `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` at the top level:

```ts
import type { CompletionVerifierVerdict } from '../completion-verifier.js';

describe('verdict telemetry split', () => {
  it('exposes telemetryGaps alongside missingFields', () => {
    const verdict: CompletionVerifierVerdict = {
      passed: false,
      missingFields: ['gh_pr_url'],
      telemetryGaps: ['memory_acknowledgment'],
      verifierFailure: false,
      trace: { transcript: '', prompt: '', response: '' },
    };
    expect(verdict.missingFields).toEqual(['gh_pr_url']);
    expect(verdict.telemetryGaps).toEqual(['memory_acknowledgment']);
  });
});
```

(Only add the `import type` line if not already present — check first.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'verdict telemetry split'
```
Expected: TypeScript compile error "Property 'telemetryGaps' does not exist on type 'CompletionVerifierVerdict'".

- [ ] **Step 3: Add the field to the interface**

In `completion-verifier.ts` at the `CompletionVerifierVerdict` interface (line 43):

```ts
export interface CompletionVerifierVerdict {
  /** True when all blocking deliverable fields are present AND no telemetry gaps exist. */
  passed: boolean;
  /** Blocking deliverable fields — (e.g. gh_pr_url, review_comments_posted). Non-empty → task cannot succeed. */
  missingFields: string[];
  /** Observability-only memory-telemetry gaps. Logged; NEVER triggers retry or failure. */
  telemetryGaps: string[];
  verifierFailure: boolean;
  agentData?:
    | PlanningAgentData
    | ExecutionAgentData
    | PullRequestAgentData
    | ReviewAgentData
    | RemediationAgentData;
  succeededModelName?: string;
  trace: CompletionVerifierTrace;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'verdict telemetry split'
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat(orchestrator): add telemetryGaps field to CompletionVerifierVerdict"
```

---

## Task 2: Telemetry field taxonomy helpers

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`

- [ ] **Step 1: Write the failing test**

Append to `completion-verifier.test.ts`:

```ts
import { isTelemetryField, partitionMissingFields } from '../completion-verifier.js';

describe('isTelemetryField', () => {
  it('returns true for memory-acknowledgment field names', () => {
    expect(isTelemetryField('memory_acknowledgment')).toBe(true);
    expect(isTelemetryField('memory_ids_used')).toBe(true);
    expect(isTelemetryField('memory_ids_used_invalid')).toBe(true);
    expect(isTelemetryField('memory_ids_rejected')).toBe(true);
    expect(isTelemetryField('memory_ids_rejected_invalid')).toBe(true);
    expect(isTelemetryField('memory_ids_overlap')).toBe(true);
    expect(isTelemetryField('memory_ids_unaccounted')).toBe(true);
    expect(isTelemetryField('memory_usage_summary')).toBe(true);
  });

  it('returns false for deliverable field names', () => {
    expect(isTelemetryField('gh_pr_url')).toBe(false);
    expect(isTelemetryField('review_comments_posted')).toBe(false);
    expect(isTelemetryField('review_types')).toBe(false);
    expect(isTelemetryField('tracking_comment_id')).toBe(false);
    expect(isTelemetryField('pr_url')).toBe(false);
    expect(isTelemetryField('summary')).toBe(false);
    expect(isTelemetryField('linear_url')).toBe(false);
    expect(isTelemetryField('outcome')).toBe(false);
    expect(isTelemetryField('fatal_exit_code_137')).toBe(false);
    expect(isTelemetryField('fatal_exit_code_139')).toBe(false);
    expect(isTelemetryField('transcript_too_short')).toBe(false);
  });
});

describe('partitionMissingFields', () => {
  it('splits a mixed list correctly', () => {
    const result = partitionMissingFields([
      'gh_pr_url',
      'memory_acknowledgment',
      'review_comments_posted',
      'memory_ids_unaccounted',
    ]);
    expect(result.blocking).toEqual(['gh_pr_url', 'review_comments_posted']);
    expect(result.telemetry).toEqual(['memory_acknowledgment', 'memory_ids_unaccounted']);
  });

  it('returns empty arrays for empty input', () => {
    const result = partitionMissingFields([]);
    expect(result.blocking).toEqual([]);
    expect(result.telemetry).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'isTelemetryField'
```
Expected: FAIL — not exported.

- [ ] **Step 3: Add the helpers**

In `completion-verifier.ts`, after the schema exports (around line 228, before `RESUME_SUMMARY_SCHEMA`):

```ts
/** Field names that represent memory-acknowledgment telemetry (observability), not deliverable contract. */
const TELEMETRY_FIELD_NAMES: ReadonlySet<string> = new Set([
  'memory_acknowledgment',
  'memory_ids_used',
  'memory_ids_used_invalid',
  'memory_ids_rejected',
  'memory_ids_rejected_invalid',
  'memory_ids_overlap',
  'memory_ids_unaccounted',
  'memory_usage_summary',
]);

/** True when the given field name is memory-telemetry only (not part of the deliverable contract). */
export function isTelemetryField(fieldName: string): boolean {
  return TELEMETRY_FIELD_NAMES.has(fieldName);
}

/** Partitions a flat missing-fields list into blocking (deliverable) and telemetry (memory ack). */
export function partitionMissingFields(fields: readonly string[]): {
  blocking: string[];
  telemetry: string[];
} {
  const blocking: string[] = [];
  const telemetry: string[] = [];
  for (const field of fields) {
    if (isTelemetryField(field)) {
      telemetry.push(field);
    } else {
      blocking.push(field);
    }
  }
  return { blocking, telemetry };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'isTelemetryField'
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'partitionMissingFields'
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "feat(orchestrator): add isTelemetryField and partitionMissingFields helpers"
```

---

## Task 3: Enumerate existing tests that will break

**Files:**
- None modified. Pure investigation to de-risk Tasks 4–5.

- [ ] **Step 1: Find tests that assert memory fields are in `missingFields`**

```bash
rg -n "missingFields.*memory_|memory_.*missingFields" workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
```

- [ ] **Step 2: Find tests that assume `EXECUTION_SCHEMA` rejects empty memory fields**

```bash
rg -n "EXECUTION_SCHEMA|execution.*memory_ids_used|execution agent.*memor" workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
```

- [ ] **Step 3: Find tests that depend on the `agentType !== 'execution'` guard**

```bash
rg -n "agentType.*execution.*memor|memory.*execution" workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
```

- [ ] **Step 4: Find dispatcher tests that assert retry-on-telemetry-missing**

```bash
rg -n "memory_acknowledgment|memory_ids_unaccounted|memory_usage_summary" workers/orchestrator/src/services/__tests__/
```

- [ ] **Step 5: Write the list into a temporary note at the top of `completion-verifier.test.ts`**

```ts
/*
 * Migration list (remove when all updated):
 * Tests expected to move memory-field assertions from missingFields → telemetryGaps:
 *   - <line>: <test name>
 *   - <line>: <test name>
 * Tests expected to break on EXECUTION_SCHEMA relaxation:
 *   - <line>: <test name>
 * Tests that asserted "retry on telemetry-missing" — need to flip to "accept on telemetry-missing":
 *   - <line>: <test name>
 */
```

Fill in from Steps 1–4. This block is deleted at the end of Task 5.

- [ ] **Step 6: Commit the investigation note**

```bash
git add workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "docs(orchestrator): enumerate tests affected by verdict-split refactor"
```

---

## Task 4: Route memory-validation failures into telemetryGaps

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` at every `return` inside `doVerify` (around lines 675, 695, 815, 830, 870, 906, 925).

- [ ] **Step 1: Write failing test**

Append to `completion-verifier.test.ts`:

```ts
describe('memory validation routes into telemetryGaps', () => {
  it('emits memory_acknowledgment into telemetryGaps, not missingFields', async () => {
    const verifier = makeVerifierWithJsonResponse({
      gh_pr_url: 'https://github.com/o/r/pull/1',
      review_id: '123',
      review_comments_posted: '2',
      review_types: 'plan_review',
      memory_ids_used: 'mem_1',
      memory_ids_rejected: '',
      memory_usage_summary: 'used mem_1',
      requirements_tracker_updated: '1',
      gh_actions_status: 'passed',
      needs_remediation: '0',
      review_body: '',
      review_inline_comments: '',
      summary: 'review posted',
    });
    const transcript = Array(20).fill('[claude] doing work').join('\n');
    const verdict = await verifier.verify({
      taskId: 't1',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'review',
      rawLogs: transcript, // no "Execution Memories Received" block
      executionMemoryContext: makeMemoryContext(['mem_1']),
    });
    expect(verdict.missingFields).toEqual([]);
    expect(verdict.telemetryGaps).toContain('memory_acknowledgment');
    expect(verdict.passed).toBe(false);
  });
});
```

`makeVerifierWithJsonResponse` and `makeMemoryContext` are patterns — mirror helpers already present in the test file. If they don't exist by that name, find the equivalent (search for `primaryClient:` and `matchedMemories:` in the existing tests) and reuse the exact construction.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'memory validation routes into telemetryGaps'
```
Expected: FAIL — `memory_acknowledgment` appears in `missingFields`, not `telemetryGaps`.

- [ ] **Step 3: Update every `return` inside `doVerify`**

In `completion-verifier.ts`, the function `doVerify` (starts line 658) has 7 return sites. Update each.

**Fatal exit code (line ~675):**
```ts
return {
  passed: false,
  missingFields: [`fatal_exit_code_${String(fatalExitCode)}`],
  telemetryGaps: [],
  verifierFailure: false,
  trace: { transcript, prompt: '', response: '' },
};
```

**Transcript too short (line ~695):**
```ts
return {
  passed: false,
  missingFields: ['transcript_too_short'],
  telemetryGaps: [],
  verifierFailure: false,
  trace: { transcript, prompt: '', response: '' },
};
```

**Schema parse failure (line ~815) — split Zod errors:**
```ts
if (parseResult !== undefined) {
  const zodMissing = getMissingFields(parseResult.error);
  const parts = partitionMissingFields(zodMissing);
  this.logger.error(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      model: succeededModelName,
      missingFields: parts.blocking,
      telemetryGaps: parts.telemetry,
    },
    'Completion verifier: all models failed schema validation'
  );
  return {
    passed: false,
    missingFields: parts.blocking,
    telemetryGaps: parts.telemetry,
    verifierFailure: false,
    succeededModelName,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

**All models failed / verifier unavailable (line ~830):**
```ts
return {
  passed: false,
  missingFields: [],
  telemetryGaps: [],
  verifierFailure: true,
  trace: { transcript, prompt, response: lastGeneratedContent },
};
```

**Hoist `agentData` declaration — REQUIRED before the next two returns.**

`const agentData = toAgentData(input.agentType, parseResult.data)` is currently at line 878 — AFTER the empty-memory-fields check at line 868. The new returns below reference `agentData`, so without hoisting, TypeScript fails with "Cannot find name 'agentData'". Move the declaration up so it sits immediately after the `if (!parseResult?.success) { ... }` block closes (around line 838), BEFORE the `hasInjectedMemories` declaration:

```ts
if (!parseResult?.success) {
  // ... existing returns ...
}

// Hoisted from line 878 so the empty-memory-fields and memoryValidation returns below can include agentData.
const agentData = toAgentData(input.agentType, parseResult.data);

const hasInjectedMemories =
  input.executionMemoryContext !== undefined &&
  input.executionMemoryContext.matchedMemories.length > 0;
```

Then **delete** the duplicate declaration at the old line 878.

**"Empty memory fields" post-parse check (line ~868) — route to telemetry:**
```ts
if (usedVal.trim() === '' && rejectedVal.trim() === '') {
  const emptyMemoryFields = ['memory_ids_used', 'memory_ids_rejected'];
  this.logger.warn(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      model: succeededModelName,
      emptyMemoryFields,
    },
    'Memory fields are empty despite memories being injected'
  );
  return {
    passed: false,
    missingFields: [],
    telemetryGaps: emptyMemoryFields,
    verifierFailure: false,
    succeededModelName,
    agentData,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

Note: include `agentData` in this return so the dispatcher can still accept the task (deliverable present, only telemetry missing).

**`validateMemoryReporting` failures (line ~906) — route to telemetry:**
```ts
if (memoryValidation.failures.length > 0) {
  this.logger.warn(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      model: succeededModelName,
      memoryValidationFailures: memoryValidation.failures,
    },
    'Completion verifier memory validation failed'
  );
  return {
    passed: false,
    missingFields: [],
    telemetryGaps: memoryValidation.failures,
    verifierFailure: false,
    succeededModelName,
    agentData,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

Note: also include `agentData` here for the same reason.

**Success (line ~925):**
```ts
return {
  passed: true,
  missingFields: [],
  telemetryGaps: [],
  verifierFailure: false,
  agentData,
  succeededModelName,
  trace: { transcript, prompt, response: lastGeneratedContent },
};
```

- [ ] **Step 4: Run the new test**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'memory validation routes into telemetryGaps'
```
Expected: PASS.

- [ ] **Step 5: Migrate existing tests per Task 3's list**

For each test enumerated in Task 3's migration note:
- If the test asserted `missingFields` contained `memory_*` field names → change to assert against `telemetryGaps`.
- If the test asserted the verdict's `missingFields` is `[]` after memory validation → update to also check `telemetryGaps`.

- [ ] **Step 6: Run the full verifier suite**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts
```
Expected: PASS. Fix any remaining failures with a per-test edit.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "refactor(orchestrator): route memory validation failures into telemetryGaps"
```

---

## Task 5: Relax EXECUTION_SCHEMA memory fields to optional

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` lines 164–178 (EXECUTION_SCHEMA) and line ~849 (the `agentType !== 'execution'` guard).

- [ ] **Step 1: Failing test**

Add to `completion-verifier.test.ts`:

```ts
import { EXECUTION_SCHEMA } from '../completion-verifier.js';

describe('EXECUTION_SCHEMA memory fields (post-relaxation)', () => {
  it('accepts JSON without memory fields and defaults them to empty strings', () => {
    const parsed = EXECUTION_SCHEMA.parse({
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: 'https://github.com/o/r/pull/1',
      summary: 'done',
    });
    expect(parsed.memory_ids_used).toBe('');
    expect(parsed.memory_ids_rejected).toBe('');
    expect(parsed.memory_usage_summary).toBe('');
  });

  it('still rejects JSON without gh_pr_url when outcome is implemented', () => {
    const result = EXECUTION_SCHEMA.safeParse({
      outcome: 'implemented',
      superpowers_subagent_driven_dev: 'used',
      superpowers_requesting_code_review: 'used',
      gh_pr_url: '',
      summary: 'done',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'EXECUTION_SCHEMA memory fields'
```
Expected: FAIL — Zod rejects the JSON without memory fields.

- [ ] **Step 3: Edit EXECUTION_SCHEMA**

```ts
export const EXECUTION_SCHEMA = z
  .object({
    outcome: z.enum(['implemented', 'already_completed']),
    superpowers_subagent_driven_dev: z.enum(['used', 'not used']),
    superpowers_requesting_code_review: z.enum(['used', 'not used']),
    gh_pr_url: z.string(),
    memory_ids_used: z.string().optional().default(''),
    memory_ids_rejected: z.string().optional().default(''),
    memory_usage_summary: z.string().optional().default(''),
    summary: z.string(),
  })
  .refine((data) => data.gh_pr_url !== '', {
    message: 'gh_pr_url is required for all execution outcomes',
    path: ['gh_pr_url'],
  });
```

Brings `EXECUTION_SCHEMA` into parity with every other schema (planning/pull_request/review/remediation already use `.optional().default('')` for these fields — see lines 153–155, 184–186, 200–202, 219–221).

- [ ] **Step 4: Remove the execution-agent guard**

Locate at line ~849:
```ts
if (hasInjectedMemories && input.agentType !== 'execution') {
```
Change to:
```ts
if (hasInjectedMemories) {
```

This runs the "empty memory fields" check for execution agents too, now that the Zod schema no longer enforces them. The empty-fields return routes to `telemetryGaps` (Task 4 step 3).

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts
```
Expected: PASS. Apply remaining migrations from Task 3's list for execution-agent tests.

- [ ] **Step 6: Remove the migration note**

Delete the comment block added in Task 3 step 5.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "refactor(orchestrator): relax EXECUTION_SCHEMA memory fields to optional"
```

---

## Task 6: Extend TaskVerificationRecord

**Files:**
- Modify: `workers/orchestrator/src/types/task.ts` lines 13–19.

- [ ] **Step 1: Edit the type**

```ts
export interface TaskVerificationRecord {
  attempt: number;
  passed: boolean;
  missingFields: string[];
  /** Memory-telemetry gaps at this attempt. Observability-only — never caused this attempt to fail. Absent in records written before this change. */
  telemetryGaps?: string[];
  verifierFailure: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
```
Expected: PASS (new field is optional).

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/types/task.ts
git commit -m "feat(orchestrator): extend TaskVerificationRecord with telemetryGaps"
```

---

## Task 7: Extract `decideCompletionOutcome` pure helper

**Files:**
- Create: `workers/orchestrator/src/services/completion-outcome.ts`
- Create: `workers/orchestrator/src/services/__tests__/completion-outcome.test.ts`

Worker-agnostic policy. No `tier` parameter, no `workerType`, no capability assumptions.

- [ ] **Step 1: Failing test — define the contract**

Create `workers/orchestrator/src/services/__tests__/completion-outcome.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideCompletionOutcome } from '../completion-outcome.js';
import type { CompletionVerifierVerdict } from '../completion-verifier.js';

function baseVerdict(
  overrides: Partial<CompletionVerifierVerdict> = {}
): CompletionVerifierVerdict {
  return {
    passed: false,
    missingFields: [],
    telemetryGaps: [],
    verifierFailure: false,
    trace: { transcript: '', prompt: '', response: '' },
    ...overrides,
  };
}

describe('decideCompletionOutcome', () => {
  describe('verifier failure (all LLMs down)', () => {
    it('retry-verifier when attempts remain', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ verifierFailure: true }),
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry-verifier');
    });

    it('fail-verifier when out of attempts', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ verifierFailure: true }),
        exitCode: 0,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail-verifier');
    });
  });

  describe('fatal exit codes', () => {
    it('fail without retry for fatal_exit_code_137', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ missingFields: ['fatal_exit_code_137'] }),
        exitCode: undefined,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail-fatal-exit');
      if (out.kind === 'fail-fatal-exit') {
        expect(out.field).toBe('fatal_exit_code_137');
      }
    });

    it('fail without retry for fatal_exit_code_139', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ missingFields: ['fatal_exit_code_139'] }),
        exitCode: undefined,
      });
      expect(out.kind).toBe('fail-fatal-exit');
    });
  });

  describe('exit-code override', () => {
    it('fail-exit-override when exit code non-zero, regardless of verdict shape', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: {} as never }),
        exitCode: 1,
      });
      expect(out.kind).toBe('fail-exit-override');
      if (out.kind === 'fail-exit-override') {
        expect(out.exitCode).toBe(1);
      }
    });

    it('fail-exit-override even if verdict has agentData and no blocking missing', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryGaps: ['memory_acknowledgment'],
          agentData: {} as never,
        }),
        exitCode: 1,
      });
      expect(out.kind).toBe('fail-exit-override');
    });

    it('fail-exit-override takes precedence over retry when blocking missing AND non-zero exit', () => {
      // Behavior change from v2: under the old flow, exit-code override ran INSIDE the
      // verification.passed branch only. Now it fires unconditionally (rule 3 before
      // blocking-retry rule 5) because a crashed container should not be retried for
      // missing fields when the crash is the root cause.
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ missingFields: ['gh_pr_url'] }),
        exitCode: 1,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail-exit-override');
    });

    it('fatal exit takes precedence over exit-code override when both apply', () => {
      // fatal_exit_code_137 is the strongest signal — terminal, no retry, no exit-code
      // override path. Rule 2 must fire before rule 3.
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ missingFields: ['fatal_exit_code_137'] }),
        exitCode: 137,
      });
      expect(out.kind).toBe('fail-fatal-exit');
    });
  });

  describe('accept paths', () => {
    it('accept when verifier passed, exit 0', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: { agentType: 'review' } as never }),
        exitCode: 0,
      });
      expect(out.kind).toBe('accept');
      if (out.kind === 'accept') {
        expect(out.telemetryGaps).toEqual([]);
      }
    });

    it('accept when agentData present and no blocking missing, even if telemetry gaps exist', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: [],
          telemetryGaps: ['memory_acknowledgment', 'memory_ids_unaccounted'],
          agentData: { agentType: 'execution' } as never,
        }),
        exitCode: 0,
      });
      expect(out.kind).toBe('accept');
      if (out.kind === 'accept') {
        expect(out.telemetryGaps).toEqual(['memory_acknowledgment', 'memory_ids_unaccounted']);
      }
    });

    it('accept when exit code undefined and deliverable present', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryGaps: ['memory_acknowledgment'],
          agentData: {} as never,
        }),
        exitCode: undefined,
      });
      expect(out.kind).toBe('accept');
    });
  });

  describe('blocking missing → retry or fail', () => {
    it('retry when blocking present and attempts remain', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ missingFields: ['gh_pr_url'] }),
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['gh_pr_url']);
      }
    });

    it('retry prompt includes telemetry gaps alongside blocking when both present', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
          telemetryGaps: ['memory_acknowledgment'],
        }),
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['gh_pr_url', 'memory_acknowledgment']);
      }
    });

    it('terminal fail when blocking missing and attempts exhausted', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ missingFields: ['gh_pr_url'] }),
        exitCode: 0,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail');
    });
  });

  describe('telemetry-only never triggers retry or fail', () => {
    it('does NOT retry when only telemetry gaps exist and agentData present', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryGaps: ['memory_acknowledgment'],
          agentData: {} as never,
        }),
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('accept');
    });

    it('fails when telemetry gaps exist but no agentData (worker produced nothing parsable)', () => {
      // This edge case: telemetry gaps set but no agentData — we have no deliverable.
      // Retry, don't accept.
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryGaps: ['memory_acknowledgment'],
          agentData: undefined,
        }),
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
    });
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-outcome.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the module**

Create `workers/orchestrator/src/services/completion-outcome.ts`:

```ts
import type { CompletionVerifierVerdict } from './completion-verifier.js';

export interface CompletionOutcomeInput {
  verdict: CompletionVerifierVerdict;
  /** Worker Docker exit code if known. undefined → no exit info. */
  exitCode: number | undefined;
  /** Current attempt (1-indexed). Defaults to 1 for decision-only tests. */
  attempt?: number;
  /** Max attempts allowed. Defaults to 3. */
  maxAttempts?: number;
}

export type CompletionOutcome =
  | { kind: 'accept'; telemetryGaps: string[] }
  | { kind: 'retry'; missingFields: string[] }
  | { kind: 'retry-verifier' }
  | { kind: 'fail'; missingFields: string[] }
  | { kind: 'fail-verifier' }
  | { kind: 'fail-fatal-exit'; field: string }
  | { kind: 'fail-exit-override'; exitCode: number };

/** Field names indicating a fatal worker exit (SIGKILL/SIGSEGV). Set by the verifier short-circuit. */
const FATAL_EXIT_FIELDS = new Set(['fatal_exit_code_137', 'fatal_exit_code_139']);

function findFatalExitField(missingFields: readonly string[]): string | undefined {
  return missingFields.find((f) => FATAL_EXIT_FIELDS.has(f));
}

/**
 * Pure, worker-agnostic policy function. Given a verdict and exit code, decides
 * what the dispatcher should do next. No side effects — the dispatcher reads the
 * outcome and performs the effect (retry / finalize / log). Worker identity does
 * not enter the policy: telemetry gaps are observability only and never block
 * acceptance when a deliverable (agentData) is present.
 */
export function decideCompletionOutcome(input: CompletionOutcomeInput): CompletionOutcome {
  const { verdict, exitCode } = input;
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 3;

  // 1. Verifier failure (all validation LLMs down) — retry verifier, don't rerun worker.
  if (verdict.verifierFailure) {
    if (attempt < maxAttempts) {
      return { kind: 'retry-verifier' };
    }
    return { kind: 'fail-verifier' };
  }

  // 2. Fatal exit codes surface as blocking fields — terminal, no retry.
  const fatalField = findFatalExitField(verdict.missingFields);
  if (fatalField !== undefined) {
    return { kind: 'fail-fatal-exit', field: fatalField };
  }

  // 3. Non-zero exit code overrides any claim of success. A crashed container is a failure
  //    regardless of verdict shape.
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'fail-exit-override', exitCode };
  }

  // 4. Deliverable present AND no blocking fields missing → accept, regardless of telemetry.
  //    Telemetry gaps are recorded for observability but never block.
  if (verdict.missingFields.length === 0 && verdict.agentData !== undefined) {
    return { kind: 'accept', telemetryGaps: [...verdict.telemetryGaps] };
  }

  // 5. Missing fields (blocking, telemetry, or both) and no deliverable → retry or fail.
  //    The retry prompt receives the union so the worker gets guidance on everything that's
  //    off. Telemetry missing alone WITHOUT agentData means the worker produced nothing we
  //    can accept — still retry.
  const allMissing = [...verdict.missingFields, ...verdict.telemetryGaps];
  if (allMissing.length > 0) {
    if (attempt < maxAttempts) {
      return { kind: 'retry', missingFields: allMissing };
    }
    return { kind: 'fail', missingFields: allMissing };
  }

  // 6. Fallback: no missing fields, no agentData (shouldn't happen with a correct verifier).
  return { kind: 'fail', missingFields: [] };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-outcome.test.ts
```
Expected: PASS all cases.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/completion-outcome.ts workers/orchestrator/src/services/__tests__/completion-outcome.test.ts
git commit -m "feat(orchestrator): add decideCompletionOutcome worker-agnostic policy helper"
```

---

## Task 8: Wire `decideCompletionOutcome` into the dispatcher

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` lines 1432–1748 (the post-verification block in `handleTaskCompletion`).

Thin wiring only. Policy is covered by Task 7's unit tests.

- [ ] **Step 1: Add import**

At the top of `task-dispatcher.ts`:

```ts
import { decideCompletionOutcome, type CompletionOutcome } from './completion-outcome.js';
```

- [ ] **Step 2: Update the log line at lines 1447–1452 to emit both lists**

Replace:
```ts
if (verification.missingFields.length > 0) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Missing fields: ${verification.missingFields.join(' | ')}`
  );
}
```
with:
```ts
if (verification.missingFields.length > 0) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Missing fields: ${verification.missingFields.join(' | ')}`
  );
}
if (verification.telemetryGaps.length > 0) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Telemetry gaps: ${verification.telemetryGaps.join(' | ')}`
  );
}
```

- [ ] **Step 3: Update the first verificationHistory push at line ~1480**

Replace:
```ts
task.verificationHistory = [
  ...(task.verificationHistory ?? []),
  {
    attempt,
    passed: verification.passed,
    missingFields: verification.missingFields,
    verifierFailure: verification.verifierFailure,
    createdAt: new Date().toISOString(),
  },
];
```
with:
```ts
task.verificationHistory = [
  ...(task.verificationHistory ?? []),
  {
    attempt,
    passed: verification.passed,
    missingFields: verification.missingFields,
    telemetryGaps: verification.telemetryGaps,
    verifierFailure: verification.verifierFailure,
    createdAt: new Date().toISOString(),
  },
];
```

- [ ] **Step 4: Update the second verificationHistory push at line ~1510**

Inside the `if (verification.verifierFailure)` block (retry-verifier path):
```ts
task.verificationHistory = [
  ...(task.verificationHistory ?? []),
  {
    attempt: attempt + 1,
    passed: retryVerification.passed,
    missingFields: retryVerification.missingFields,
    telemetryGaps: retryVerification.telemetryGaps,
    verifierFailure: retryVerification.verifierFailure,
    createdAt: new Date().toISOString(),
  },
];
```

- [ ] **Step 5: Replace the decision tree (lines ~1491–1748) with outcome dispatch**

The large block spanning `if (verification.verifierFailure) { ... }` through the terminal-failure block is the decision tree. Replace it with a call to `decideCompletionOutcome` and a switch on the kind. Paste the following **right after** the updated first `task.verificationHistory = [...]` block (step 3 above):

```ts
const outcome: CompletionOutcome = decideCompletionOutcome({
  verdict: verification,
  exitCode,
  attempt,
  maxAttempts,
});

switch (outcome.kind) {
  case 'accept': {
    if (outcome.telemetryGaps.length > 0) {
      this.logger.warn(
        {
          taskId: task.taskId,
          attempt,
          workerType: task.workerType,
          telemetryGaps: outcome.telemetryGaps,
        },
        'Task accepted with telemetry gaps (observability-only)'
      );
    }

    // Pending messages delivery (original logic from line 1578 block).
    /* v8 ignore start -- upstream: pending messages delivery path requires sendMessage called on a completing task; timing-dependent race cannot be reproduced with fake timer sequential execution @preserve */
    const pendingQueue = this.pendingMessages.get(task.taskId);
    if (pendingQueue !== undefined && pendingQueue.length > 0) {
      this.pendingMessages.delete(task.taskId);
      const combinedPrompt = pendingQueue.join('\n\n');
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Delivering ${String(pendingQueue.length)} queued message(s) instead of finalizing`
      );
      this.appendTaggedTaskLog(
        task.taskId,
        'prompt',
        combinedPrompt.length > 200 ? combinedPrompt.slice(0, 200) + '…' : combinedPrompt
      );
      await this.flushTaskLogs(task.taskId);
      await this.teardownAttempt(task.taskId, true);
      const resumeResult = await this.startWorkerAttempt(task, {
        prompt: combinedPrompt,
        continueSession: true,
        injectActiveGoal: true,
      });
      if (resumeResult.ok) {
        task.containerId = resumeResult.containerId;
        await this.saveTask(task);
        this.claudeErrors.delete(task.taskId);
        this.taskExitCodes.delete(task.taskId);
        return;
      }
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Failed to deliver queued messages, finalizing normally`
      );
    }
    /* v8 ignore stop @preserve */

    this.appendOrchestratorTaskLog(
      task.taskId,
      outcome.telemetryGaps.length > 0
        ? `Completion accepted (telemetry gaps: ${outcome.telemetryGaps.join(', ')})`
        : 'Completion verification passed'
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    const finalResult = this.buildResultFromVerification(task, result, verification);

    // Compliance validation: unchanged — runs for every successful execution task. We no
    // longer fail tasks for missing telemetry, so every task reaching here has produced
    // a valid deliverable and should be compliance-checked normally.
    /* v8 ignore start -- source-map: void fire-and-forget compliance validation branches misattributed by v8; detached promise created by void expression not tracked by coverage instrumentation @preserve */
    let complianceInput: ComplianceValidationInput | undefined;
    if (completionAgentType === 'execution' && this.agentComplianceValidator !== undefined) {
      complianceInput = await this.prepareComplianceValidationInput(
        task,
        finalResult,
        verification
      );
    }

    const keepLogOpen = complianceInput !== undefined;
    await this.finalizeTaskWithResult(task, completionAgentType, finalResult, keepLogOpen);

    if (complianceInput !== undefined) {
      void this.executeComplianceValidation(task, complianceInput).finally(() => {
        void this.flushAndCloseLogForwarder(task.taskId);
      });
    }
    /* v8 ignore stop @preserve */
    return;
  }

  case 'retry-verifier': {
    /* v8 ignore start -- upstream: verifierFailure path requires all validation models to return parse errors; FakeCompletionVerifier always returns valid responses and cannot simulate upstream failures @preserve */
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Verifier failure; retrying verifier (${String(attempt + 1)}/${String(maxAttempts)})`
    );
    const retryVerification = await this.completionVerifier.verify({
      taskId: task.taskId,
      attempt: attempt + 1,
      maxAttempts,
      agentType: completionAgentType,
      rawLogs,
      ...(task.executionMemoryContext !== undefined && {
        executionMemoryContext: task.executionMemoryContext,
      }),
    });
    task.verificationHistory = [
      ...(task.verificationHistory ?? []),
      {
        attempt: attempt + 1,
        passed: retryVerification.passed,
        missingFields: retryVerification.missingFields,
        telemetryGaps: retryVerification.telemetryGaps,
        verifierFailure: retryVerification.verifierFailure,
        createdAt: new Date().toISOString(),
      },
    ];
    task.attemptCount = attempt + 1;

    if (retryVerification.passed && retryVerification.agentData !== undefined) {
      this.appendOrchestratorTaskLog(task.taskId, 'Verifier retry succeeded');
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt + 1);
      const finalResult = this.buildResultFromVerification(task, result, retryVerification);
      await this.finalizeTaskWithResult(task, completionAgentType, finalResult);
      return;
    }
    const error: TaskError = {
      code: 'TASK_COMPLETION_VERIFIER_FAILED',
      message: 'Completion verifier unavailable (all validation models failed)',
      remediation: {
        action: 'contact_support',
        manualSteps: [
          'Ensure INTEXURAOS_GEMINI_APP_API_KEY and INTEXURAOS_OPENROUTER_APP_API_KEY are configured for orchestrator.',
          'Check connectivity to all configured validation models and retry task after verifier is healthy.',
        ],
      },
    };
    this.appendOrchestratorTaskLog(task.taskId, 'Terminal failure: verifier unavailable');
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
    return;
    /* v8 ignore stop @preserve */
  }

  case 'fail-verifier': {
    /* v8 ignore start -- upstream: verifier failure path @preserve */
    const error: TaskError = {
      code: 'TASK_COMPLETION_VERIFIER_FAILED',
      message: 'Completion verifier unavailable (all validation models failed)',
      remediation: {
        action: 'contact_support',
        manualSteps: [
          'Ensure INTEXURAOS_GEMINI_APP_API_KEY and INTEXURAOS_OPENROUTER_APP_API_KEY are configured for orchestrator.',
          'Check connectivity to all configured validation models and retry task after verifier is healthy.',
        ],
      },
    };
    this.appendOrchestratorTaskLog(task.taskId, 'Terminal failure: verifier unavailable');
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
    return;
    /* v8 ignore stop @preserve */
  }

  case 'fail-exit-override': {
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Non-zero exit code (${String(outcome.exitCode)}) overrides verifier decision`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    const error: TaskError = {
      code: 'TASK_EXIT_CODE_OVERRIDE',
      message: `Non-zero exit code (${String(outcome.exitCode)}) overrides verifier decision`,
      remediation: { action: 'retry' },
    };
    /* v8 ignore start -- ts-type: conditional spread for exact optional property types @preserve */
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
    /* v8 ignore stop @preserve */
    return;
  }

  case 'fail-fatal-exit': {
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Fatal exit code detected (${outcome.field}); skipping retry — session state is not recoverable`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    const error: TaskError = {
      code: 'TASK_FATAL_EXIT_CODE',
      message: `Worker process killed by signal: ${outcome.field}`,
      remediation: { action: 'retry' },
    };
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
    return;
  }

  case 'retry': {
    /* v8 ignore start -- upstream: FakeIsolationProvider cannot drive the missing-fields retry path in fake-driven tests @preserve */
    this.logForwarder.appendChunk(task.taskId, '\n\n');
    const nextAttempt = attempt + 1;
    const runtimeName = this.getRuntimeDisplayName(task);
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Missing fields; re-launching ${runtimeName} (${String(nextAttempt)}/${String(maxAttempts)}): ${outcome.missingFields.join(', ')}`
    );
    await this.flushTaskLogs(task.taskId);
    await this.teardownAttempt(task.taskId, true);

    const resumePrompt = this.buildMissingFieldsPrompt(
      completionAgentType,
      outcome.missingFields,
      rawLogs,
      task.executionMemoryContext
    );
    const resumePreview =
      resumePrompt.length > 500 ? resumePrompt.slice(0, 500) + '…' : resumePrompt;
    this.appendTaggedTaskLog(task.taskId, 'prompt', `Resume prompt:\n${resumePreview}`);
    const resumeStart = await this.startWorkerAttempt(task, {
      prompt: resumePrompt,
      continueSession: true,
    });

    if (resumeStart.ok) {
      task.attemptCount = nextAttempt;
      task.containerId = resumeStart.containerId;
      await this.saveTask(task);
      this.logger.info(
        { taskId: task.taskId, attempt: nextAttempt, maxAttempts },
        'Resumed task with follow-up attempt'
      );
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Resume attempt started: attempt=${String(nextAttempt)}/${String(maxAttempts)}`
      );
      this.claudeErrors.delete(task.taskId);
      this.taskExitCodes.delete(task.taskId);
      return;
    }

    const resumeError: TaskError = {
      code: 'RESUME_ATTEMPT_FAILED',
      message: `Failed to start attempt ${String(nextAttempt)}: ${String(resumeStart.error)}`,
      remediation: { action: 'retry' },
    };
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: resume start failed for attempt=${String(nextAttempt)} (${resumeError.message})`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error: resumeError,
    });
    return;
    /* v8 ignore stop @preserve */
  }

  case 'fail': {
    /* v8 ignore start -- upstream: terminal failure path; FakeIsolationProvider cannot exhaust attempts in fake-driven tests @preserve */
    const error: TaskError = {
      code: 'TASK_COMPLETION_VERIFICATION_FAILED',
      message:
        outcome.missingFields.length > 0
          ? `Missing fields: ${outcome.missingFields.join(', ')}`
          : 'Completion verification failed',
      remediation: {
        action: 'retry',
        ...(outcome.missingFields.length > 0 && {
          manualSteps: outcome.missingFields,
        }),
      },
    };
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: completion criteria not met after ${String(attempt)} attempts`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
    return;
    /* v8 ignore stop @preserve */
  }
}
```

After pasting, **delete** the entire old decision block — everything from the old `if (verification.verifierFailure) { ... }` through the old terminal-failure block (former lines 1491–1748 approximately). The switch handles every case.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
```
Expected: PASS. Fix any imports or unused variables. `hasFatalExitCodeField` is no longer called here — remove the import if it becomes unused.

- [ ] **Step 7: Run the full orchestrator test suite**

```bash
pnpm --filter @intexuraos/orchestrator test
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts
git commit -m "refactor(orchestrator): dispatch completion decisions through decideCompletionOutcome"
```

---

## Task 9: Documentation

**Files:**
- Create: `.claude/reference/orchestrator-completion-policy.md`

- [ ] **Step 1: Write the reference note**

```markdown
# Orchestrator Completion Verification — Policy

The orchestrator's `CompletionVerifier` splits missing-field failures into two categories:

- **Blocking (`missingFields`)** — deliverable contract fields (e.g. `gh_pr_url`, `review_comments_posted`, `tracking_comment_id`). Missing these triggers retry (up to 3 attempts) then terminal failure.
- **Telemetry gaps (`telemetryGaps`)** — memory-acknowledgment fields (`memory_acknowledgment`, `memory_ids_*`, `memory_usage_summary`). These exist to measure memory-effectiveness. They are **observability data only** — never block task completion.

### Policy is worker-agnostic

The retry/accept/fail decision lives in `workers/orchestrator/src/services/completion-outcome.ts:decideCompletionOutcome`. It takes the verdict, exit code, and attempt counters — **not** the worker type. Any worker that produced a valid deliverable (`agentData` present, no blocking fields missing) is accepted, regardless of which LLM ran.

Rationale: telemetry gaps arise from many causes — model capability, orchestrator-side issues (premature verifier runs on partial output), session restarts, prompt drift. None of these reflect on whether the worker produced its deliverable. Treating telemetry as a blocking requirement means tasks fail for reasons unrelated to their actual outcome.

### Policy rules (evaluated in order)

1. `verdict.verifierFailure` (all validation LLMs down) → retry verifier / fail-verifier.
2. `missingFields` contains a `fatal_exit_code_*` → terminal fail.
3. `exitCode !== 0 && exitCode !== undefined` → exit-code override, fail.
4. `agentData` present AND `missingFields.length === 0` → **accept**, even if telemetry gaps exist.
5. Any missing (blocking, telemetry, or both) AND no acceptable deliverable → retry with union (or fail when attempts exhausted).

### Observability

Each `verificationHistory[n]` record persists:
- `missingFields` — fields that triggered blocking behavior.
- `telemetryGaps?` — memory fields missing at this attempt. Absent in pre-change records.

Downstream memory-effectiveness scoring can distinguish "worker actively rejected all memories" (empty `memory_ids_used`, `telemetryGaps === []`) from "worker skipped telemetry" (empty `memory_ids_used`, `telemetryGaps` includes `memory_acknowledgment`). Filed as follow-up tech debt — current downstream conflates both cases.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/reference/orchestrator-completion-policy.md
git commit -m "docs: add orchestrator completion policy reference"
```

---

## Task 10: Full verification

**Files:**
- None modified — this is verification.

- [ ] **Step 1: Typecheck & lint**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
pnpm --filter @intexuraos/orchestrator lint
```

- [ ] **Step 2: Workspace CI**

```bash
pnpm run verify:workspace:tracked orchestrator 2>&1 | tee /tmp/ci-orchestrator.txt
```
Expected: all green, 95% coverage maintained.

- [ ] **Step 3: Repo-wide CI gate**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked.txt
```
Expected: PASS.

- [ ] **Step 4: Coverage triage**

Any coverage regression: add a test (preferred) or a `/* v8 ignore <category> -- <testing blocker reason> @preserve */`. Never edit `vitest.config.ts` exclusions.

- [ ] **Step 5: Audit monitoring/alerting configs for "memory_acknowledgment" keys**

The plan drops the "task failed with memory_acknowledgment missing" failure class. Verify no alerting rule depends on that message:

```bash
rg -n "memory_acknowledgment|memory_ids_unaccounted|memory_usage_summary" terraform/ .github/ .claude/ 2>&1 | rg -v "^docs/|^workers/orchestrator/src/"
rg -n "TASK_COMPLETION_VERIFICATION_FAILED" terraform/ .github/ 2>&1
```

If either command returns a hit in a monitoring/alerting config (Dash0 alert rule, Sentry filter, GitHub workflow), update it to either (a) stop keying off the memory failure class, or (b) key off `verificationHistory[n].telemetryGaps` instead. If no hits: note "no monitoring dependency found" in the PR body.

---

## Task 11: Pull request

**Files:**
- None modified.

- [ ] **Step 1: Confirm branch is feature-scoped**

```bash
gh pr status
```
Branch must be `feature/INT-<id>-<slug>`. Never commit to `main` or `development`.

- [ ] **Step 2: Open the PR** (replace `<INT-ID>` with the actual ID)

```bash
gh pr create --title "feat(orchestrator): decouple deliverable from telemetry in completion verification (<INT-ID>)" --body "$(cat <<'EOF'
## Summary
- Split `CompletionVerifierVerdict.missingFields` into blocking (deliverable) vs `telemetryGaps` (observability). Memory-acknowledgment fields now flow into `telemetryGaps`, never block task completion.
- Extract policy into pure `decideCompletionOutcome(verdict, exitCode, attempt, maxAttempts)` — **worker-agnostic**. No `workerType` input, no capability assumptions, no per-model configuration. Policy is a single set of rules that applies uniformly to every worker.
- Dispatcher accepts any task whose deliverable is intact (`agentData` present, no blocking fields missing) regardless of telemetry. Retry continues to fire for blocking missing fields; compliance validation runs unchanged for successful execution tasks.
- `EXECUTION_SCHEMA` relaxed: memory fields become `.optional().default('')` — parity with every other schema.

## Why
Telemetry presence/absence doesn't reflect on whether the deliverable was produced. Worker identity shouldn't either. As LLMs evolve, hard-coded per-worker assumptions rot. This design generalizes by dropping those assumptions entirely.

Motivating examples:
- `task_1dbe9147-4164-4b0c-aaef-39aa90e1f433` (glm, review): posted review #4162575153 but failed for missing `memory_acknowledgment`. Now accepts.
- `task_28f5349a-ab4e-4165-8598-c6b897d57531` (auto / Sonnet, execution): created PR #1906 with correct final block, but orchestrator closed the attempt window early and verifier ran on partial output. Now accepts (the deliverable — `gh_pr_url` — was in the partial output).

## Behavior changes vs current
1. Opus/Sonnet/auto tasks that skip the memory-ack ceremony now succeed (previously: 3-attempt retry + terminal fail).
2. Exit-code override fires for any non-zero exit, not only inside the `verification.passed` branch. A worker that crashed AND produced no `gh_pr_url` now fails immediately with `TASK_EXIT_CODE_OVERRIDE` instead of retrying.
3. Compliance validator posts PR comments on tasks that previously failed at the telemetry gate. Non-fatal; expect increased compliance PR-comment noise for weak-model execution tasks.

No monitoring/alerting dependencies on the dropped failure class (verified via Task 10 Step 5 grep).

## Test plan
- [ ] `pnpm --filter @intexuraos/orchestrator test` — all tests pass including new `completion-outcome.test.ts` suite
- [ ] `pnpm run verify:workspace:tracked orchestrator`
- [ ] `pnpm run ci:tracked`
- [ ] Manual: dispatch a glm review task that skips memory ack → `status=completed`, `verificationHistory[n].telemetryGaps` includes the gaps.
- [ ] Manual: dispatch an Opus task that skips memory ack → also accepts (was previously a 3-attempt retry + terminal failure).
- [ ] Manual: dispatch a task where the worker fails to produce `gh_pr_url` → still retries up to 3 attempts, still fails terminally.
- [ ] Manual: dispatch a task that crashes with exit=1 without producing `gh_pr_url` → fails immediately with `TASK_EXIT_CODE_OVERRIDE`, does NOT retry.

Fixes <INT-ID>
EOF
)"
```

---

## Self-Review Checklist (post-rewrite)

1. **Design principle holds end-to-end:**
   - ✅ Worker identity does not enter `decideCompletionOutcome` (no `tier`, no `workerType`).
   - ✅ Telemetry gaps never block acceptance — only blocking deliverable fields do.
   - ✅ No `WORKER_TYPES` config change — the plan is robust to LLM evolution by construction.

2. **Spec coverage:**
   - ✅ Verdict split — Tasks 1, 4.
   - ✅ Memory failures → telemetry bucket — Task 4.
   - ✅ EXECUTION_SCHEMA parity — Task 5.
   - ✅ Universal policy — Task 7 (no tier parameter).
   - ✅ Observability via `verificationHistory.telemetryGaps` — Tasks 6, 8.
   - ✅ Non-zero exit code override — Task 7 rule 3 + explicit test.
   - ✅ Fatal exit codes — Task 4 step 3 + Task 7 explicit test.
   - ✅ Compliance validation for execution agents unchanged.

3. **Placeholder scan:** `<INT-ID>` in Task 11 is flagged for user input. No TBD/TODO/"handle edge cases"/"similar to Task N".

4. **Type consistency:**
   - `CompletionVerifierVerdict.telemetryGaps` — defined Task 1, written Task 4, read Task 7/8.
   - `TaskVerificationRecord.telemetryGaps` — defined Task 6, written Task 8 steps 3/4.
   - `CompletionOutcome` discriminated union — defined Task 7, consumed Task 8 step 5 switch.
   - `isTelemetryField`, `partitionMissingFields` — defined Task 2, consumed Task 4 schema-parse-failure return.

5. **TDD compliance:** Task 7 strictly test-first (exhaustive unit tests drive the pure function). Tasks 1, 2, 5 test-first. Task 4 writes failing test then updates 7 return sites (mechanical same-shape change). Task 8 is wiring only; behavior covered by Task 7 tests.

6. **Breaking-test enumeration:** Task 3 enumerates affected tests before Tasks 4–5 modify them.

7. **Test harness:** No dispatcher harness needed. Task 7 unit-tests the policy in isolation, matches the current codebase.

8. **Log-line consistency:** Task 8 step 2 updates log at lines 1447–1452 to emit both `Missing fields:` and `Telemetry gaps:` lines. Retry case logs union. Error in fail case uses union. No mismatch.

9. **No accidental scope:** `handleResumedAfterSuccessCompletion` at `task-dispatcher.ts:2037` is not modified — runs before the tiered logic.

10. **Webhook contract:** `TaskResult` and `TaskError` shapes unchanged. `verificationHistory` gains one optional field (`telemetryGaps`) — backward compatible.

11. **Compliance validator:** Runs for execution agents on every `accept` outcome (unchanged from current behavior). No skip branch needed because the plan no longer has two kinds of accept.

12. **Observability:** Every accepted task with telemetry gaps emits a `warn`-level log (`Task accepted with telemetry gaps (observability-only)`) and persists `telemetryGaps` to `verificationHistory`. No telemetry signal is silently discarded.

13. **Compile-safety of Task 4:** `agentData` is referenced in the empty-memory-fields return (line 868) and the memoryValidation-failures return (line 906). The original declaration at line 878 is AFTER the first of these. Task 4's hoist step moves the declaration to just after the `if (!parseResult?.success)` block closes, ensuring `agentData` is in scope at both returns. Without this hoist, TypeScript fails compilation.

14. **Exit-code override precedence test:** Explicitly covered by `fail-exit-override takes precedence over retry when blocking missing AND non-zero exit` in Task 7's test suite. Documents the behavior change from v2/current.

15. **Fatal-exit-vs-exit-override precedence:** Explicitly covered by `fatal exit takes precedence over exit-code override when both apply` in Task 7's test suite. `fatal_exit_code_*` fields always win over exit-code override.

16. **Monitoring audit:** Task 10 Step 5 greps `terraform/`, `.github/`, `.claude/` for dependencies on the dropped failure class. The PR body reports the result.

17. **Behavior changes disclosed up-front:** Three explicit behavior-change entries in the Non-goals section document (a) Opus/Sonnet now accepting telemetry-only failures, (b) unconditional exit-code override, (c) increased compliance PR-comment noise. Each is covered by either a test, a doc reference, or both.
