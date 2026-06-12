# Tiered Completion Verification — Split Deliverable vs Telemetry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source of truth:** [INT-1459](https://linear.app/pbuchman/issue/INT-1459). This plan replaces any earlier draft and is self-contained — no cross-reference to prior planning issues is needed.

**Goal:** Stop failing code tasks when the only thing missing is the memory-acknowledgment telemetry block, while keeping strict verification for Opus/Sonnet workers unchanged.

**Architecture:** The orchestrator's `CompletionVerifier` currently returns a single `missingFields: string[]` that mixes two unrelated concerns:
1. Deliverable contract fields (e.g. `gh_pr_url`, `review_comments_posted`, `tracking_comment_id`).
2. Memory-acknowledgment telemetry fields (e.g. `memory_acknowledgment`, `memory_ids_unaccounted`, `memory_usage_summary`).

Both are treated as blocking, so a task that posted a valid PR review but forgot the telemetry block is retried 3× and marked `failed`. This plan:
1. Splits the verdict into `missingFields` (blocking — deliverable) and `telemetryMissingFields` (non-blocking when worker tier allows).
2. Adds `telemetryExpectation: 'required' | 'optional'` per worker type.
3. Extracts the retry/accept/fail policy into a **pure function** `decideCompletionOutcome(verdict, tier, exitCode)` — so the policy is unit-testable without a dispatcher test harness.

**Tech Stack:** TypeScript (strict mode: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`), Zod, Vitest. No new dependencies, no Firestore migration (new `verificationHistory` fields are optional), no webhook shape change.

**Endpoint Changes:** None. No HTTP endpoints modified, created, removed, or unchanged — this is purely internal orchestrator logic.

---

## Why this plan was rewritten

The previous iteration of this plan referenced an obsolete monolithic `completion-verifier.ts` (1,024 lines) and line numbers in `task-dispatcher.ts` that no longer exist. Between the original planning session and this rewrite, two PRs landed that restructured the same subsystem:

| PR                                                                                       | Impact on this plan                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1899** — "Refactor completion-verifier into schema/prompt-builder/llm-client modules" | `completion-verifier.ts` was reduced from 1,024 → 197 lines. Zod schemas moved to `completion-verifier/schemas.ts`; memory-validation logic moved to `completion-verifier/memory-validation.ts`; verdict types moved to `completion-verifier/types.ts`. `doVerify` now has only 5 return sites (vs. the plan's stale count of 7) and uses a `failVerdict` helper. |
| **#1913** — "Classify infra-failed attempts before completion verifier"                  | A new `classifyAttempt` step runs in `handleTaskCompletion` *before* the verifier. `infra_failed` attempts short-circuit to `finalizeAttemptAsInfraFailure` and never reach the policy function this plan extracts. The policy therefore does not need to handle infra-failure cases — but it MUST assume the verifier has already been called.                   |

Every file path, line range, return-site count, and test-file location below has been re-verified against the current `main` at the time of the rewrite. The plan also tightens robustness in the following ways:
- Uses the existing `failVerdict` helper rather than editing each `return` independently (less error surface).
- Guards `WORKER_TYPES[task.workerType]` with an explicit `?? 'required'` fallback to satisfy `noUncheckedIndexedAccess`.
- Acknowledges the INT-1455 infra short-circuit so `decideCompletionOutcome` has a clear, narrower contract.
- Anchors the new `decideCompletionOutcome` module under `services/task-dispatcher/` to match the sibling-module pattern already established by `task-dispatcher/prompts.ts` and `task-dispatcher/classify-attempt.ts`.

**Non-goals / out of scope:**
- No worker prompt changes (system prompt keeps asking for memory ack).
- No downstream code-agent changes. Memory-effectiveness scoring downstream may treat `tier=optional` accepted tasks as "zero memories used" (same shape as "worker rejected all memories"). Acceptable skew — filed as follow-up tech debt, not in this plan.
- No changes to `handleResumedAfterSuccessCompletion` (separate code path at `task-dispatcher.ts:1329` that branches BEFORE the tiered logic).
- No changes to the INT-1455 infra-failure short-circuit. It remains the first gate; the policy function runs only when the attempt successfully reaches the verifier.
- **Compliance validation is intentionally NOT run for tier=optional accepted execution tasks.** Reason: compliance checks superpowers usage and workflow discipline, which weak models will have skipped for the same reasons they skipped telemetry — running compliance would produce false failures. Documented explicitly in the new branch; log line indicates the skip.

---

## File Structure

### Modified files

| File                                                                                       | Responsibility of change                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workers/orchestrator/src/services/completion-verifier/types.ts`                           | Split `CompletionVerifierVerdict` into `missingFields` (blocking) + `telemetryMissingFields` (non-blocking candidate).                                                                                                                                                               |
| `workers/orchestrator/src/services/completion-verifier/schemas.ts`                         | Relax `EXECUTION_SCHEMA` memory fields to `.optional().default('')` to reach parity with every other schema.                                                                                                                                                                         |
| `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`               | Add `isTelemetryField`, `partitionMissingFields`, and the `TELEMETRY_FIELD_NAMES` set. Remove the `agentType === 'execution'` short-circuit in `detectEmptyMemoryFields` now that the schema no longer enforces memory fields as required.                                           |
| `workers/orchestrator/src/services/completion-verifier.ts`                                 | Extend `failVerdict` to accept an optional `telemetryMissingFields`. Update the 3 memory-related return sites in `doVerify` to emit into the telemetry bucket. Partition the schema-parse Zod errors into blocking vs telemetry.                                                     |
| `workers/orchestrator/src/services/isolation/types.ts`                                     | Add `telemetryExpectation: 'required' \                                                                                                                                                                                                                                              | 'optional'` to `WorkerTypeConfig`; populate every entry. |
| `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`                      | **NEW FILE.** Pure function `decideCompletionOutcome(verdict, tier, exitCode, attempt, maxAttempts) → CompletionOutcome`. This is the unit-testable policy layer.                                                                                                                    |
| `workers/orchestrator/src/services/task-dispatcher.ts`                                     | Refactor the post-classifier block inside `handleTaskCompletion` (approx. lines 1450–1772) to delegate retry/accept/fail decisions to `decideCompletionOutcome`. Thin wiring only. Adds a `WORKER_TYPES` lookup with `?? 'required'` fallback for `noUncheckedIndexedAccess` safety. |
| `workers/orchestrator/src/types/task.ts`                                                   | Extend `TaskVerificationRecord` with `telemetryMissingFields?: string[]` and `telemetryAccepted?: boolean`.                                                                                                                                                                          |

### New and updated test files

| File                                                                                         | Purpose                                                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/__tests__/services/completion-verifier/types.test.ts`              | **NEW.** Pin the verdict shape so future edits can't silently drop `telemetryMissingFields`.                          |
| `workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts`            | Extend with post-relaxation `EXECUTION_SCHEMA` cases.                                                                 |
| `workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts`  | Extend: `isTelemetryField`, `partitionMissingFields`, and the removed-guard behavior for execution agents.            |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`                    | Update existing tests that asserted memory fields in `missingFields`; add a top-level test for verdict routing.       |
| `workers/orchestrator/src/__tests__/services/task-dispatcher/decide-outcome.test.ts`         | **NEW.** Exhaustive unit tests for `decideCompletionOutcome`.                                                         |
| `workers/orchestrator/src/__tests__/services/isolation/worker-types.test.ts`                 | **NEW.** Assert every worker type declares `telemetryExpectation`.                                                    |

---

## Task 1: Split the verdict type in `completion-verifier/types.ts`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/types.ts` (the `CompletionVerifierVerdict` interface at line ~29).
- Create: `workers/orchestrator/src/__tests__/services/completion-verifier/types.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `workers/orchestrator/src/__tests__/services/completion-verifier/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CompletionVerifierVerdict } from '../../../services/completion-verifier/types.js';

describe('CompletionVerifierVerdict shape', () => {
  it('exposes telemetryMissingFields alongside missingFields', () => {
    const verdict: CompletionVerifierVerdict = {
      passed: false,
      missingFields: ['gh_pr_url'],
      telemetryMissingFields: ['memory_acknowledgment'],
      verifierFailure: false,
      trace: { transcript: '', prompt: '', response: '' },
    };
    expect(verdict.missingFields).toEqual(['gh_pr_url']);
    expect(verdict.telemetryMissingFields).toEqual(['memory_acknowledgment']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- types.test.ts -t 'CompletionVerifierVerdict shape'
```
Expected: TypeScript compile error "Property 'telemetryMissingFields' does not exist on type 'CompletionVerifierVerdict'".

- [ ] **Step 3: Add the field to the interface**

In `workers/orchestrator/src/services/completion-verifier/types.ts`, replace the `CompletionVerifierVerdict` interface:

```ts
export interface CompletionVerifierVerdict {
  /** True when LLM extraction succeeded and all Zod fields were present — does NOT mean the agent completed its task. */
  passed: boolean;
  /** Blocking fields — deliverable contract (e.g. gh_pr_url, review_comments_posted). Non-empty → task cannot succeed regardless of worker tier. */
  missingFields: string[];
  /** Telemetry fields — memory acknowledgment / reporting. Non-empty → task may still succeed when worker tier is 'optional'. */
  telemetryMissingFields: string[];
  verifierFailure: boolean;
  agentData?:
    | PlanningAgentData
    | ExecutionAgentData
    | PullRequestAgentData
    | ReviewAgentData
    | RemediationAgentData;
  /** Model name that produced the response. Undefined when no model produced content. */
  succeededModelName?: string;
  trace: CompletionVerifierTrace;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @intexuraos/orchestrator test -- types.test.ts -t 'CompletionVerifierVerdict shape'
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier/types.ts workers/orchestrator/src/__tests__/services/completion-verifier/types.test.ts
git commit -m "feat(orchestrator): add telemetryMissingFields to CompletionVerifierVerdict [INT-1459]"
```

---

## Task 2: Telemetry field taxonomy helpers in `memory-validation.ts`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`.
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts`.

Rationale: `memory-validation.ts` is the natural home for memory-telemetry classification — it already knows the canonical names of every memory-field failure it emits, so the `TELEMETRY_FIELD_NAMES` set lives next to the code that produces those names.

- [ ] **Step 1: Write the failing test**

Append to `workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts`:

```ts
import {
  isTelemetryField,
  partitionMissingFields,
} from '../../../services/completion-verifier/memory-validation.js';

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

- [ ] **Step 2: Run to verify fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- memory-validation.test.ts -t 'isTelemetryField'
```
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add the helpers**

In `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`, append at the bottom of the file:

```ts
/** Field names that represent memory-acknowledgment telemetry, not deliverable contract.
 *
 * Centralised here because this module is the only producer of these names:
 *  - `detectEmptyMemoryFields` emits `memory_ids_used` / `memory_ids_rejected`.
 *  - `validateMemoryReporting` emits the remaining six members.
 * Callers that need to partition a flat `missingFields` list must use `partitionMissingFields`
 * rather than re-deriving the set — otherwise the two copies can drift. */
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

- [ ] **Step 4: Re-export from the parent barrel**

The file `workers/orchestrator/src/services/completion-verifier.ts` already does `export * from './completion-verifier/schemas.js'` and similar. Confirm that memory-validation helpers are re-exported by adding an explicit re-export if `export * from './completion-verifier/memory-validation.js'` is not already in place:

```bash
rg -n "export .* from .*memory-validation" workers/orchestrator/src/services/completion-verifier.ts
```
If only `buildMemoryAcknowledgmentPattern` is re-exported today, add beside it:

```ts
export { isTelemetryField, partitionMissingFields } from './completion-verifier/memory-validation.js';
```

(Consumers import from `./completion-verifier.js` — keeping the barrel surface stable.)

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- memory-validation.test.ts -t 'isTelemetryField'
pnpm --filter @intexuraos/orchestrator test -- memory-validation.test.ts -t 'partitionMissingFields'
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier/memory-validation.ts workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts
git commit -m "feat(orchestrator): add isTelemetryField and partitionMissingFields helpers [INT-1459]"
```

---

## Task 3: Enumerate existing tests that will break

**Files:** None modified. Pure investigation to de-risk Tasks 4–5.

- [ ] **Step 1: Find tests that assert memory fields are in `missingFields`**

```bash
rg -n "missingFields.*memory_|memory_.*missingFields" workers/orchestrator/src/__tests__/ workers/orchestrator/src/services/__tests__/
```

- [ ] **Step 2: Find tests that assume `EXECUTION_SCHEMA` rejects empty memory fields**

```bash
rg -n "EXECUTION_SCHEMA|execution.*memory_ids_used|execution agent.*memor" workers/orchestrator/src/__tests__/ workers/orchestrator/src/services/__tests__/
```

- [ ] **Step 3: Find tests that depend on the `agentType === 'execution'` guard in `detectEmptyMemoryFields`**

```bash
rg -n "agentType.*execution.*memor|detectEmptyMemoryFields.*execution" workers/orchestrator/src/__tests__/
```

- [ ] **Step 4: Write the list into a temporary note at the top of `services/__tests__/completion-verifier.test.ts`**

Prepend this block comment so subsequent steps know which assertions to flip:

```ts
/*
 * [INT-1459] Migration list (remove when all updated):
 * Tests expected to move memory-field assertions from missingFields → telemetryMissingFields:
 *   - <file>:<line>: <test name>
 *   ...
 * Tests expected to break on EXECUTION_SCHEMA relaxation:
 *   - <file>:<line>: <test name>
 *   ...
 * Tests that will break when the `agentType === 'execution'` guard is removed:
 *   - <file>:<line>: <test name>
 *   ...
 */
```

Fill in the three sections from Steps 1–3. This block is deleted at the end of Task 5.

- [ ] **Step 5: Commit the investigation note**

```bash
git add workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "docs(orchestrator): enumerate tests affected by verdict-split refactor [INT-1459]"
```

---

## Task 4: Route memory-validation failures into the telemetry bucket

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` — extend `failVerdict`, update the three memory-aware return sites in `doVerify`, partition Zod parse errors.
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` — add the routing tests.

The refactored `doVerify` has five `return failVerdict(...)` sites:
1. Line ~89 — fatal exit code (blocking).
2. Line ~97 — transcript too short (blocking).
3. Line ~118 — Zod schema-parse failure (may contain both kinds).
4. Line ~122 — verifier failure / all models down (neither — `verifierFailure: true`).
5. Line ~132 — `detectEmptyMemoryFields` → telemetry.
6. Line ~147 — `validateMemoryReporting.failures` → telemetry.

And one success return at line ~152.

Rather than editing each site by hand (plan v1 approach, now stale), extend the existing `failVerdict` helper with an optional `telemetry: string[]` parameter. Only the three memory-aware sites (3, 5, 6) need to pass it. The success return and the two always-blocking returns (1, 2, 4) simply get `telemetryMissingFields: []` by default.

- [ ] **Step 1: Write failing test for verdict routing (review agent path)**

Append to `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`. The file already has helpers (`primaryClient`, `matchedMemories`) built inline — reuse the exact construction used by the existing memory-validation tests in this file. Search `makeVerifier` or `primaryClient: {` to find the pattern.

```ts
describe('[INT-1459] verdict routing — memory validation → telemetry bucket', () => {
  it('emits memory_acknowledgment into telemetryMissingFields, not missingFields', async () => {
    // Mirror the existing fake-LlmGenerateClient helper in this file.
    const verifier = /* … construct with the helper used by the nearby tests … */;
    const transcript = Array(20).fill('[claude] doing work').join('\n');
    const verdict = await verifier.verify({
      taskId: 't1',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'review',
      rawLogs: transcript, // no "Execution Memories Received" block
      executionMemoryContext: /* inject one memory */,
    });
    expect(verdict.missingFields).toEqual([]);
    expect(verdict.telemetryMissingFields).toContain('memory_acknowledgment');
    expect(verdict.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'verdict routing'
```
Expected: FAIL — `memory_acknowledgment` still appears in `missingFields`.

- [ ] **Step 3: Extend `failVerdict` and update the three memory-aware return sites**

In `workers/orchestrator/src/services/completion-verifier.ts`, replace the existing `failVerdict` helper:

```ts
function failVerdict(
  missingFields: string[],
  trace: CompletionVerifierVerdict['trace'],
  opts: { model?: string; verifierFailure?: boolean; telemetryMissingFields?: string[] } = {}
): CompletionVerifierVerdict {
  return {
    passed: false,
    missingFields,
    telemetryMissingFields: opts.telemetryMissingFields ?? [],
    verifierFailure: opts.verifierFailure ?? false,
    ...(opts.model !== undefined && { succeededModelName: opts.model }),
    trace,
  };
}
```

Update the success return (line ~152) to also emit the new field:

```ts
return {
  passed: true,
  missingFields: [],
  telemetryMissingFields: [],
  verifierFailure: false,
  agentData,
  succeededModelName: model,
  trace,
};
```

Update the schema-parse failure site (line ~118) to partition errors:

```ts
if (llmResult.error.kind === 'schema-failed') {
  const { modelName: model, missingFields } = llmResult.error;
  const parts = partitionMissingFields(missingFields);
  logger.error(
    { taskId, attempt, model, missingFields: parts.blocking, telemetryMissingFields: parts.telemetry },
    'Completion verifier: all models failed schema validation'
  );
  return failVerdict(parts.blocking, trace, { model, telemetryMissingFields: parts.telemetry });
}
```

Add the import near the top of the file:

```ts
import { detectEmptyMemoryFields, validateMemoryReporting, partitionMissingFields } from './completion-verifier/memory-validation.js';
```

Update the `detectEmptyMemoryFields` site (line ~132):

```ts
if (emptyMemoryFields !== undefined) {
  logger.warn({ taskId, attempt, model, emptyMemoryFields }, 'Memory fields are empty despite memories being injected');
  return failVerdict([], trace, { model, telemetryMissingFields: emptyMemoryFields });
}
```

Update the `validateMemoryReporting` site (line ~147):

```ts
if (memoryValidation.failures.length > 0) {
  logger.warn(
    { taskId, attempt, model, memoryValidationFailures: memoryValidation.failures },
    'Completion verifier memory validation failed'
  );
  return failVerdict([], trace, { model, telemetryMissingFields: memoryValidation.failures });
}
```

Leave the fatal-exit (line ~89), transcript-too-short (line ~97), and verifier-failure (line ~122) sites untouched — they continue to pass only blocking fields (`[]` telemetry via the default).

- [ ] **Step 4: Run the new test**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'verdict routing'
```
Expected: PASS.

- [ ] **Step 5: Migrate existing tests per Task 3's list**

For each entry in Task 3's migration note:
- If the test asserted `missingFields` contained `memory_*` names → flip to assert against `telemetryMissingFields`.
- If the test asserted `missingFields` was `[]` after memory validation → keep the `[]` assertion, add a matching `telemetryMissingFields` assertion.
- Module-level tests in `src/__tests__/services/completion-verifier/memory-validation.test.ts` still test the helper return shapes (unchanged); only the integration-level `verifier.verify(...)` expectations need to move.

- [ ] **Step 6: Run the full verifier suite**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts memory-validation.test.ts
```
Expected: PASS. Fix any remaining failures with per-test edits.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts
git commit -m "refactor(orchestrator): route memory validation failures into telemetryMissingFields [INT-1459]"
```

---

## Task 5: Relax `EXECUTION_SCHEMA` and drop the execution-agent guard

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/schemas.ts` (EXECUTION_SCHEMA at line ~98–112).
- Modify: `workers/orchestrator/src/services/completion-verifier/memory-validation.ts` (`detectEmptyMemoryFields` at line ~21–23).
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts` (add cases).

- [ ] **Step 1: Failing test for the relaxed schema**

Append to `workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts`:

```ts
import { EXECUTION_SCHEMA } from '../../../services/completion-verifier/schemas.js';

describe('[INT-1459] EXECUTION_SCHEMA memory fields (post-relaxation)', () => {
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
pnpm --filter @intexuraos/orchestrator test -- schemas.test.ts -t 'EXECUTION_SCHEMA memory fields'
```
Expected: FAIL — Zod rejects the JSON without memory fields.

- [ ] **Step 3: Edit `EXECUTION_SCHEMA`**

In `workers/orchestrator/src/services/completion-verifier/schemas.ts`, replace `EXECUTION_SCHEMA`:

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

Note for the reviewer: this brings `EXECUTION_SCHEMA` into parity with every other schema in this file — `PLANNING_SCHEMA`, `PULL_REQUEST_SCHEMA`, `REVIEW_SCHEMA`, and `REMEDIATION_SCHEMA` already use `.optional().default('')` for the three memory fields.

- [ ] **Step 4: Remove the execution-agent guard in `detectEmptyMemoryFields`**

In `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`, delete lines 21–23:

```ts
// DELETE these lines:
  if (agentType === 'execution') {
    return undefined;
  }
```

The emptied-fields check now also runs for execution agents. The Zod schema no longer enforces the memory fields, so emptiness is the only remaining signal — routing through `telemetryMissingFields` (already wired in Task 4) means execution-agent empty-memory-field failures become non-blocking for `tier=optional` workers.

Because `agentType` is no longer referenced inside the function body, the parameter may trigger an `unused parameter` lint warning. Keep the parameter in the signature (callers depend on the positional arity; removing it is an API change beyond this plan's scope) but rename it to `_agentType` to satisfy ESLint:

```ts
export function detectEmptyMemoryFields(
  _agentType: CompletionAgentType,
  executionMemoryContext: ExecutionMemoryPromptContext | undefined,
  parsed: unknown
): string[] | undefined {
```

- [ ] **Step 5: Update the `detectEmptyMemoryFields` test in `memory-validation.test.ts`**

Search for tests that assert `detectEmptyMemoryFields('execution', …)` returns `undefined`; flip those to expect `['memory_ids_used', 'memory_ids_rejected']` when both fields are blank.

```bash
rg -n "detectEmptyMemoryFields.*'execution'" workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts memory-validation.test.ts schemas.test.ts
```
Expected: PASS. Apply remaining migrations from Task 3's list for execution-agent integration tests.

- [ ] **Step 7: Remove the migration note**

Delete the comment block added in Task 3, Step 4.

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier/schemas.ts workers/orchestrator/src/services/completion-verifier/memory-validation.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts
git commit -m "refactor(orchestrator): relax EXECUTION_SCHEMA memory fields and drop execution-agent guard [INT-1459]"
```

---

## Task 6: Add `telemetryExpectation` to `WorkerTypeConfig`

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts`.
- Create: `workers/orchestrator/src/__tests__/services/isolation/worker-types.test.ts`.

- [ ] **Step 1: Failing test**

Create `workers/orchestrator/src/__tests__/services/isolation/worker-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WORKER_TYPES } from '../../../services/isolation/types.js';

describe('[INT-1459] WORKER_TYPES telemetryExpectation', () => {
  it('every worker type declares telemetryExpectation', () => {
    for (const [name, config] of Object.entries(WORKER_TYPES)) {
      expect(
        config.telemetryExpectation,
        `${name} missing telemetryExpectation`
      ).toMatch(/^(required|optional)$/);
    }
  });

  it('opus, sonnet, and auto are required', () => {
    expect(WORKER_TYPES.opus.telemetryExpectation).toBe('required');
    expect(WORKER_TYPES.sonnet.telemetryExpectation).toBe('required');
    expect(WORKER_TYPES.auto.telemetryExpectation).toBe('required');
  });

  it('weaker models are optional', () => {
    expect(WORKER_TYPES.glm.telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES.qwen.telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES.kimi.telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES.minimax.telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES['mimo-pro'].telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES['openrouter-free'].telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES.codex.telemetryExpectation).toBe('optional');
    expect(WORKER_TYPES['codex-xhigh'].telemetryExpectation).toBe('optional');
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- worker-types.test.ts
```
Expected: FAIL — property doesn't exist (TypeScript error).

- [ ] **Step 3: Extend the interface and populate every entry**

In `workers/orchestrator/src/services/isolation/types.ts`, update `WorkerTypeConfig`:

```ts
export interface WorkerTypeConfig {
  runtime: WorkerRuntime;
  apiBaseUrl: string;
  apiKeyEnvVar?:
    | 'ANTHROPIC_API_KEY'
    | 'MINIMAX_API_KEY'
    | 'MIMO_API_KEY'
    | 'DASHSCOPE_API_KEY'
    | 'OPENROUTER_API_KEY';
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh';
  disableExperimentalBetas?: boolean;
  /**
   * Whether this worker tier is expected to emit the full memory-acknowledgment
   * telemetry block. 'required' → missing telemetry triggers retry/terminal-fail
   * (Opus/Sonnet-grade). 'optional' → missing telemetry is logged as a warning
   * but does not block task completion (weaker/cheaper models).
   */
  telemetryExpectation: 'required' | 'optional';
}
```

Replace the `WORKER_TYPES` object; every entry MUST declare `telemetryExpectation`:

```ts
export const WORKER_TYPES: Record<WorkerType, WorkerTypeConfig> = {
  auto: {
    runtime: 'claude',
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    telemetryExpectation: 'required',
  },
  opus: {
    runtime: 'claude',
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'opus',
    effort: 'high',
    telemetryExpectation: 'required',
  },
  sonnet: {
    runtime: 'claude',
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'sonnet',
    telemetryExpectation: 'required',
  },
  minimax: {
    runtime: 'claude',
    apiBaseUrl: 'https://api.minimax.io/anthropic',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    model: 'MiniMax-M2.7',
    telemetryExpectation: 'optional',
  },
  'mimo-pro': {
    runtime: 'claude',
    apiBaseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
    apiKeyEnvVar: 'MIMO_API_KEY',
    model: 'mimo-v2.5-pro',
    telemetryExpectation: 'optional',
  },
  glm: {
    runtime: 'claude',
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'glm-5',
    telemetryExpectation: 'optional',
  },
  qwen: {
    runtime: 'claude',
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'qwen3.5-plus',
    telemetryExpectation: 'optional',
  },
  kimi: {
    runtime: 'claude',
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'kimi-k2.5',
    telemetryExpectation: 'optional',
  },
  codex: {
    runtime: 'codex',
    apiBaseUrl: 'https://api.openai.com',
    telemetryExpectation: 'optional',
  },
  'codex-xhigh': {
    runtime: 'codex',
    apiBaseUrl: 'https://api.openai.com',
    effort: 'xhigh',
    telemetryExpectation: 'optional',
  },
  'openrouter-free': {
    runtime: 'claude',
    apiBaseUrl: 'https://openrouter.ai/api',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    model: 'google/gemma-4-31b-it:free',
    effort: 'high',
    disableExperimentalBetas: true,
    telemetryExpectation: 'optional',
  },
};
```

**Robustness note:** `WorkerType` is a literal union re-exported from `@intexuraos/common-core`. If the package adds a new worker type in the future and consumers forget to extend `WORKER_TYPES`, the `Record<WorkerType, WorkerTypeConfig>` type will fail to compile. The Task 9 dispatcher lookup still uses a `?? 'required'` runtime fallback in case `WORKER_TYPES[task.workerType]` is `undefined` under `noUncheckedIndexedAccess`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- worker-types.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/types.ts workers/orchestrator/src/__tests__/services/isolation/worker-types.test.ts
git commit -m "feat(orchestrator): add telemetryExpectation per worker type [INT-1459]"
```

---

## Task 7: Extend `TaskVerificationRecord`

**Files:**
- Modify: `workers/orchestrator/src/types/task.ts` (interface at lines 13–19).

- [ ] **Step 1: Edit the type**

Replace the `TaskVerificationRecord` interface in `workers/orchestrator/src/types/task.ts`:

```ts
export interface TaskVerificationRecord {
  attempt: number;
  passed: boolean;
  missingFields: string[];
  /** Memory-telemetry fields missing at this attempt. Separate from missingFields because they may be non-blocking for optional-tier workers. Absent in records written before the tiered-telemetry change. */
  telemetryMissingFields?: string[];
  /** True when this attempt was accepted despite missing telemetry (tier=optional). Absent or false otherwise. */
  telemetryAccepted?: boolean;
  verifierFailure: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
```
Expected: PASS (new fields are optional, so existing Firestore documents remain valid).

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/types/task.ts
git commit -m "feat(orchestrator): extend TaskVerificationRecord with telemetry fields [INT-1459]"
```

---

## Task 8: Extract `decideCompletionOutcome` pure helper

**Files:**
- Create: `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`.
- Create: `workers/orchestrator/src/__tests__/services/task-dispatcher/decide-outcome.test.ts`.

Rationale: placing this next to `task-dispatcher/prompts.ts` and `task-dispatcher/classify-attempt.ts` keeps the dispatcher's policy/helper modules grouped. The dispatcher already imports from this directory — one more sibling is zero coupling cost.

- [ ] **Step 1: Failing test — define the contract**

Create `workers/orchestrator/src/__tests__/services/task-dispatcher/decide-outcome.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideCompletionOutcome } from '../../../services/task-dispatcher/decide-outcome.js';
import type { CompletionVerifierVerdict } from '../../../services/completion-verifier/types.js';

function baseVerdict(
  overrides: Partial<CompletionVerifierVerdict> = {}
): CompletionVerifierVerdict {
  return {
    passed: false,
    missingFields: [],
    telemetryMissingFields: [],
    verifierFailure: false,
    trace: { transcript: '', prompt: '', response: '' },
    ...overrides,
  };
}

describe('[INT-1459] decideCompletionOutcome', () => {
  describe('success paths', () => {
    it('accept when verifier passed and exit code is 0', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          passed: true,
          agentData: { agentType: 'review' } as never,
        }),
        tier: 'required',
        exitCode: 0,
      });
      expect(out).toEqual({ kind: 'accept', telemetryAccepted: false });
    });

    it('accept when passed and exit code undefined', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: {} as never }),
        tier: 'optional',
        exitCode: undefined,
      });
      expect(out.kind).toBe('accept');
    });
  });

  describe('tier=optional telemetry-only missing', () => {
    it('accept and flag telemetryAccepted when only telemetry missing and exit code 0', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: [],
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: { agentType: 'review' } as never,
        }),
        tier: 'optional',
        exitCode: 0,
      });
      expect(out).toEqual({ kind: 'accept', telemetryAccepted: true });
    });

    it('accept when exit code undefined (no worker exit info)', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: {} as never,
        }),
        tier: 'optional',
        exitCode: undefined,
      });
      expect(out.kind).toBe('accept');
    });

    it('fail-exit-override when exit code non-zero, even if verdict is telemetry-only', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: {} as never,
        }),
        tier: 'optional',
        exitCode: 1,
      });
      expect(out.kind).toBe('fail-exit-override');
      if (out.kind === 'fail-exit-override') {
        expect(out.exitCode).toBe(1);
      }
    });

    it('does NOT accept if agentData missing (nothing to build a result from)', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: undefined,
        }),
        tier: 'optional',
        exitCode: 0,
      });
      expect(out.kind).not.toBe('accept');
    });
  });

  describe('tier=required telemetry-only missing', () => {
    it('retry with union missing fields when attempts remain', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: {} as never,
        }),
        tier: 'required',
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['memory_acknowledgment']);
      }
    });

    it('terminal failure when out of attempts', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
        }),
        tier: 'required',
        exitCode: 0,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail');
    });
  });

  describe('blocking missing (any tier)', () => {
    it('retry when blocking present and attempts remain, tier=optional', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
        }),
        tier: 'optional',
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['gh_pr_url']);
      }
    });

    it('retry with union when both blocking and telemetry present', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
          telemetryMissingFields: ['memory_acknowledgment'],
        }),
        tier: 'required',
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['gh_pr_url', 'memory_acknowledgment']);
      }
    });

    it('terminal fail when out of attempts and blocking missing', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
        }),
        tier: 'optional',
        exitCode: 0,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail');
    });
  });

  describe('fatal exit codes', () => {
    it('fail without retry when missingFields contains fatal_exit_code_137', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['fatal_exit_code_137'],
        }),
        tier: 'optional',
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
        verdict: baseVerdict({
          missingFields: ['fatal_exit_code_139'],
        }),
        tier: 'required',
        exitCode: undefined,
      });
      expect(out.kind).toBe('fail-fatal-exit');
    });
  });

  describe('verifier failure (all LLMs down)', () => {
    it('retry-verifier when attempts remain', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ verifierFailure: true }),
        tier: 'required',
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry-verifier');
    });

    it('fail-verifier when out of attempts', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ verifierFailure: true }),
        tier: 'required',
        exitCode: 0,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail-verifier');
    });
  });

  describe('exit-code override', () => {
    it('fail-exit-override when verdict passed but exit code non-zero', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: {} as never }),
        tier: 'required',
        exitCode: 1,
      });
      expect(out.kind).toBe('fail-exit-override');
      if (out.kind === 'fail-exit-override') {
        expect(out.exitCode).toBe(1);
      }
    });
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- decide-outcome.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the module**

Create `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`:

```ts
import type { CompletionVerifierVerdict } from '../completion-verifier/types.js';

export type TelemetryExpectation = 'required' | 'optional';

export interface CompletionOutcomeInput {
  verdict: CompletionVerifierVerdict;
  tier: TelemetryExpectation;
  /** Worker Docker exit code if known. undefined → no exit info. */
  exitCode: number | undefined;
  /** Current attempt (1-indexed). Defaults to 1 for decision-only tests. */
  attempt?: number;
  /** Max attempts allowed. Defaults to 3. */
  maxAttempts?: number;
}

export type CompletionOutcome =
  | { kind: 'accept'; telemetryAccepted: boolean }
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
 * Pure policy function. Given a verdict, worker tier, and exit code, decides what the
 * dispatcher should do next. No side effects — the dispatcher reads the outcome and
 * performs the effect (retry / finalize / log).
 *
 * Precondition: caller has already run the INT-1455 infra-failure classifier and
 * confirmed the attempt is NOT infra-failed. This function assumes a real
 * verifier verdict.
 */
export function decideCompletionOutcome(input: CompletionOutcomeInput): CompletionOutcome {
  const { verdict, tier, exitCode } = input;
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 3;

  // 1. Verifier failure (all validation LLMs down) — retry verifier only, don't rerun worker.
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

  // 3. Exit-code override: a non-zero exit overrides any claim of success.
  //    Applies whether or not the verdict otherwise looks clean.
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'fail-exit-override', exitCode };
  }

  // 4. Verifier passed and agentData present → accept.
  if (verdict.passed && verdict.agentData !== undefined) {
    return { kind: 'accept', telemetryAccepted: false };
  }

  // 5. Only telemetry missing + tier=optional + agentData present → accept with flag.
  const blockingMissing = verdict.missingFields;
  const telemetryMissing = verdict.telemetryMissingFields;
  const onlyTelemetry =
    blockingMissing.length === 0 &&
    telemetryMissing.length > 0 &&
    verdict.agentData !== undefined;
  if (onlyTelemetry && tier === 'optional') {
    return { kind: 'accept', telemetryAccepted: true };
  }

  // 6. Anything missing (blocking, telemetry, or both) — retry or fail based on attempts.
  const allMissing = [...blockingMissing, ...telemetryMissing];
  if (allMissing.length > 0) {
    if (attempt < maxAttempts) {
      return { kind: 'retry', missingFields: allMissing };
    }
    return { kind: 'fail', missingFields: allMissing };
  }

  // 7. Fallback: passed is false but no missing fields and no agentData (shouldn't happen
  //    with a correct verifier; treat as a generic fail).
  return { kind: 'fail', missingFields: [] };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- decide-outcome.test.ts
```
Expected: PASS all cases.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts workers/orchestrator/src/__tests__/services/task-dispatcher/decide-outcome.test.ts
git commit -m "feat(orchestrator): add decideCompletionOutcome pure policy helper [INT-1459]"
```

---

## Task 9: Wire `decideCompletionOutcome` into the dispatcher

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` — replace the decision tree in `handleTaskCompletion` from the post-classifier point (approx. line 1450) through the terminal-failure block (approx. line 1772).

Strategy: keep all side-effectful steps (logging, persistence, worker restart, webhooks) exactly as today, but replace the decision tree with a single `decideCompletionOutcome` call plus a switch on the outcome kind. The INT-1455 infra-failure short-circuit at lines 1445–1448 (`if (classification.outcome === 'infra_failed') { ... return; }`) stays intact as the first gate.

- [ ] **Step 1: Add imports at the top of `task-dispatcher.ts`**

```ts
import { WORKER_TYPES } from './isolation/types.js';
import { decideCompletionOutcome, type CompletionOutcome } from './task-dispatcher/decide-outcome.js';
```

`hasFatalExitCodeField` is still used elsewhere (it's re-exported from `task-dispatcher.ts` line ~87 for consumers); do NOT remove the import.

- [ ] **Step 2: Update the "Missing fields" log line to also emit telemetry missing**

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
if (verification.telemetryMissingFields.length > 0) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Telemetry missing: ${verification.telemetryMissingFields.join(' | ')}`
  );
}
```

- [ ] **Step 3: Persist `telemetryMissingFields` in the first `verificationHistory` push**

Replace the push at approx. line 1502:
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
    telemetryMissingFields: verification.telemetryMissingFields,
    verifierFailure: verification.verifierFailure,
    createdAt: new Date().toISOString(),
  },
];
```

- [ ] **Step 4: Persist `telemetryMissingFields` in the verifier-retry `verificationHistory` push**

Inside the `if (verification.verifierFailure) { ... }` block, locate the second `verificationHistory` push (approx. line 1532). Add `telemetryMissingFields: retryVerification.telemetryMissingFields,` analogously.

- [ ] **Step 5: Replace the decision tree (approx. lines 1513–1772) with outcome dispatch**

The large block spanning `if (verification.verifierFailure) { ... }` through the terminal-failure block is the decision tree. Replace it with a call to `decideCompletionOutcome` plus a switch on the kind. Paste the following **right after** the updated first `task.verificationHistory = [...]` block (step 3 above):

```ts
const tier = WORKER_TYPES[task.workerType]?.telemetryExpectation ?? 'required';
const outcome: CompletionOutcome = decideCompletionOutcome({
  verdict: verification,
  tier,
  exitCode,
  attempt,
  maxAttempts,
});

switch (outcome.kind) {
  case 'accept': {
    // Non-zero exit-code override is handled by decideCompletionOutcome (fail-exit-override).
    // By the time we reach 'accept', exit code is 0 or undefined.

    if (outcome.telemetryAccepted) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Telemetry incomplete but accepted (worker=${task.workerType} tier=optional): ${verification.telemetryMissingFields.join(', ')}`
      );
      this.logger.warn(
        {
          taskId: task.taskId,
          attempt,
          workerType: task.workerType,
          telemetryMissingFields: verification.telemetryMissingFields,
        },
        'Accepting task despite missing telemetry (optional tier)'
      );
      const last = task.verificationHistory?.at(-1);
      if (last !== undefined) {
        last.telemetryAccepted = true;
      }
    }

    // Pending messages delivery — original logic from the verifier-passed branch.
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
        this.attemptStartedAt.delete(task.taskId);
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
      outcome.telemetryAccepted
        ? 'Completion accepted (telemetry incomplete, tier=optional)'
        : 'Completion verification passed'
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    const finalResult = this.buildResultFromVerification(task, result, verification);

    // Compliance validation: only for fully-passing execution tasks. Tier=optional accepted
    // tasks skip compliance because weak models that skipped telemetry will also have skipped
    // superpowers usage — running compliance would produce false failures.
    /* v8 ignore start -- source-map: void fire-and-forget compliance validation branches misattributed by v8 @preserve */
    let complianceInput: ComplianceValidationInput | undefined;
    if (
      !outcome.telemetryAccepted &&
      completionAgentType === 'execution' &&
      this.agentComplianceValidator !== undefined
    ) {
      complianceInput = await this.prepareComplianceValidationInput(
        task,
        finalResult,
        verification
      );
    } else if (outcome.telemetryAccepted && completionAgentType === 'execution') {
      this.appendOrchestratorTaskLog(
        task.taskId,
        'Skipping compliance validation for tier=optional accepted execution task'
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
    /* v8 ignore start -- upstream: verifierFailure path requires all validation models to return parse errors; FakeCompletionVerifier always returns valid responses @preserve */
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
        telemetryMissingFields: retryVerification.telemetryMissingFields,
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
    // Verifier still failed — fall through to terminal verifier failure.
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

    const resumePrompt = buildMissingFieldsPromptFn(
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
      this.attemptStartedAt.delete(task.taskId);
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

After pasting, **delete** the entire old decision block — everything from the old `if (verification.verifierFailure) { ... }` through the old terminal-failure block (former lines ~1513–1772). The switch now handles every case.

Robustness notes:
- `WORKER_TYPES[task.workerType]?.telemetryExpectation ?? 'required'` is the safe default: any unknown/new worker type is treated as tier=required (strictest). This preserves the current behavior when a new type is added to `CodeTaskWorkerType` but the `WORKER_TYPES` table is forgotten (though the `Record<WorkerType, …>` type would usually catch this at compile time).
- The outcome `switch` is exhaustive over the discriminated-union's `kind`s. TypeScript will flag any missing case if the union grows.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
pnpm --filter @intexuraos/orchestrator lint
```
Expected: PASS. Resolve any unused-import warnings locally; in particular, confirm `hasFatalExitCodeField` is still imported (it is used elsewhere in `task-dispatcher.ts` — see the re-export at line ~87).

- [ ] **Step 7: Run the full orchestrator test suite**

```bash
pnpm --filter @intexuraos/orchestrator test
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts
git commit -m "refactor(orchestrator): dispatch completion decisions through decideCompletionOutcome [INT-1459]"
```

---

## Task 10: Reference documentation

**Files:**
- Create: `.claude/reference/orchestrator-completion-tiers.md`.

- [ ] **Step 1: Write the reference note**

Create `.claude/reference/orchestrator-completion-tiers.md`:

```markdown
# Orchestrator Completion Verification — Tiered Telemetry

The orchestrator's `CompletionVerifier` splits missing-field failures into two categories:

- **Blocking (`missingFields`)** — deliverable contract fields (e.g. `gh_pr_url`, `review_comments_posted`, `tracking_comment_id`). Missing these always fails the task regardless of worker.
- **Telemetry (`telemetryMissingFields`)** — memory-acknowledgment fields (`memory_acknowledgment`, `memory_ids_*`, `memory_usage_summary`). These exist to measure memory-effectiveness; their absence should not fail an otherwise-valid task when the worker is known to be weaker.

Each worker type in `workers/orchestrator/src/services/isolation/types.ts:WORKER_TYPES` declares `telemetryExpectation`:

| Tier       | Workers                                                                                 | Behavior on telemetry-only failure                                                             |
| ---------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `required` | `auto`, `opus`, `sonnet`                                                                | Retry with full missing-fields prompt. Terminal fail after 3 attempts.                         |
| `optional` | `glm`, `qwen`, `kimi`, `minimax`, `mimo-pro`, `codex`, `codex-xhigh`, `openrouter-free` | Accept as completed with a `warn` log line. `verificationHistory[n].telemetryAccepted = true`. |

### Ordering of completion gates

In `handleTaskCompletion` the gates run in this order:
1. **INT-1455 attempt classifier** (`classifyAttempt` in `task-dispatcher/classify-attempt.ts`) — infra-failed attempts short-circuit to `finalizeAttemptAsInfraFailure` and never reach the verifier.
2. **`completionVerifier.verify(...)`** — produces a `CompletionVerifierVerdict` with `missingFields` and `telemetryMissingFields` already partitioned.
3. **`decideCompletionOutcome(verdict, tier, exitCode, attempt, maxAttempts)`** — pure policy function that returns a discriminated-union `CompletionOutcome`.
4. **Dispatcher switch on outcome.kind** — performs side effects (retry worker, finalize task, log).

### Policy helper

All retry/accept/fail decisions flow through `decideCompletionOutcome(...)` in `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`. This is a pure function — test it in `decide-outcome.test.ts`, not in dispatcher tests.

### Compliance validation

Compliance validation (superpowers-usage check for execution tasks at `task-dispatcher.ts:prepareComplianceValidationInput`) runs **only for tier=required accepted tasks**. Tier=optional accepted tasks skip compliance because weak models that skipped telemetry will also have skipped the disciplines compliance checks for, producing false failures.

### Observability note

Tier=optional accepted tasks emit empty/missing `execution_memory_ids_used` etc. in their `TaskResult`. Downstream memory-effectiveness scoring may read these as "zero memories used" — indistinguishable from "worker rejected all memories." Filed as follow-up tech debt; not addressed in this change.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/reference/orchestrator-completion-tiers.md
git commit -m "docs: add orchestrator completion tiers reference [INT-1459]"
```

---

## Task 11: Full verification

**Files:** None modified — this is verification.

- [ ] **Step 1: Typecheck & lint**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
pnpm --filter @intexuraos/orchestrator lint
```

- [ ] **Step 2: Workspace CI**

```bash
pnpm run verify:workspace:tracked -- orchestrator 2>&1 | tee /tmp/ci-orchestrator.txt
```
Expected: all green, 95% coverage maintained.

- [ ] **Step 3: Repo-wide CI gate**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked.txt
```
Expected: PASS.

- [ ] **Step 4: Coverage triage**

Any coverage regression: add a test (preferred) or a `/* v8 ignore <category> -- <testing blocker reason> @preserve */`. Never edit `vitest.config.ts` exclusions. Valid categories are listed in `.claude/CLAUDE.md`: `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`.

- [ ] **Step 5: Sanity check — no broken imports or stale `unused-import` warnings**

```bash
rg -n "from '.*completion-verifier.js'" workers/orchestrator/src
rg -n "from '.*task-dispatcher/decide-outcome.js'" workers/orchestrator/src
```
All imports must resolve.

---

## Task 12: Pull request

**Files:** None modified.

- [ ] **Step 1: Confirm branch is feature-scoped**

```bash
gh pr status
```
Branch must be `feature/int-1459-<slug>` (never commit to `main` or `development`).

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "[INT-1459] feat(orchestrator): tiered telemetry acceptance" --body "$(cat <<'EOF'
## Summary
- Split `CompletionVerifierVerdict.missingFields` into blocking (deliverable) vs `telemetryMissingFields` (memory acknowledgment).
- Add `telemetryExpectation: 'required' | 'optional'` per worker type — `required` for opus/sonnet/auto (preserves existing behavior), `optional` for glm/qwen/kimi/minimax/mimo-pro/codex/codex-xhigh/openrouter-free.
- Extract policy into pure `decideCompletionOutcome(verdict, tier, exitCode, attempt, maxAttempts)` in `task-dispatcher/decide-outcome.ts`; dispatcher is now a thin switch over the outcome kind.
- Dispatcher accepts a task as completed when only telemetry is missing and the worker's tier is `optional`, with `verificationHistory[n].telemetryAccepted = true`.
- Tier=optional accepted execution tasks skip compliance validation (weak models skipping telemetry will also have skipped superpowers checks — compliance would produce false failures).
- Tier=required behavior is preserved bit-for-bit: telemetry-only failures retry with the union (blocking + telemetry) passed to `buildMissingFieldsPrompt`.
- Relaxed `EXECUTION_SCHEMA` to `.optional().default('')` for the three memory fields (parity with every other agent schema).
- Removed the `agentType === 'execution'` short-circuit in `detectEmptyMemoryFields` now that the schema no longer enforces the fields.

## Why
Weak models (glm-5 etc.) successfully complete review tasks (PR review posted, result populated) but fail the strict memory-acknowledgment block 3× and get marked `failed`. The strict policy makes sense for Opus/Sonnet but wastes a cheap worker's successful attempt.

## Test plan
- [ ] `pnpm --filter @intexuraos/orchestrator test` — all tests pass including new `decide-outcome.test.ts` suite
- [ ] `pnpm run verify:workspace:tracked -- orchestrator`
- [ ] `pnpm run ci:tracked`
- [ ] Manual: dispatch a glm review task in dev that forgets memory ack → verify `status=completed` in Firestore `code_tasks` doc; verify `verificationHistory[n].telemetryAccepted=true`; verify orchestrator log shows "Telemetry incomplete but accepted".
- [ ] Manual: dispatch an Opus task that forgets memory ack → verify existing 3-attempt retry behavior unchanged.

Fixes INT-1459
EOF
)"
```

---

## Self-Review Checklist

1. **Codebase alignment verified** — every file path, line range, and return-site count references the post-PR-#1899 module layout. `completion-verifier.ts` is the 197-line orchestrator; Zod schemas live in `completion-verifier/schemas.ts`; memory-validation in `completion-verifier/memory-validation.ts`; types in `completion-verifier/types.ts`.

2. **INT-1455 interaction documented** — `decideCompletionOutcome` runs *after* the infra-failure classifier; it never sees `infra_failed` attempts. Explicit precondition in the module docstring.

3. **Spec coverage:**
   - ✅ Split verification into two buckets — Tasks 1, 4 (verdict + memory-validation routing).
   - ✅ Per-worker-type `telemetryExpectation` — Task 6.
   - ✅ Tier=required preserves current behavior — Task 8 unit tests cover telemetry-only retry (uses union). Task 9 wiring preserves all original side effects.
   - ✅ Tier=optional accepts on telemetry-only — Task 8 tests `onlyTelemetry + tier=optional + exit=0 → accept`.
   - ✅ Observability via `verificationHistory` — Tasks 7 + 9.
   - ✅ Non-zero exit code override applies BEFORE tier=optional accept — Task 8 explicit test `fail-exit-override when exit code non-zero, even if verdict is telemetry-only`.
   - ✅ Compliance validator intentionally skipped for tier=optional accepted execution — Task 9 step 5 + Task 10 docs.
   - ✅ Fatal exit codes (137/139) route to blocking — existing `doVerify` behavior preserved + Task 8 explicit test.

4. **Placeholder scan:** None. All `<INT-ID>` references resolved to INT-1459.

5. **Type consistency:**
   - `CompletionVerifierVerdict.telemetryMissingFields` — defined Task 1, written by Task 4, read by Task 8/9.
   - `TaskVerificationRecord.{telemetryMissingFields, telemetryAccepted}` — defined Task 7, written Task 9 steps 3/4/5.
   - `WorkerTypeConfig.telemetryExpectation` — defined Task 6, read Task 9 step 5.
   - `CompletionOutcome` discriminated union — defined Task 8, consumed Task 9 step 5 switch.
   - `isTelemetryField`, `partitionMissingFields` — defined Task 2, consumed Task 4 schema-parse-failure return site.
   - `failVerdict` helper — extended in Task 4 to carry `telemetryMissingFields`.

6. **Strict-mode robustness:**
   - `WORKER_TYPES[task.workerType]?.telemetryExpectation ?? 'required'` handles `noUncheckedIndexedAccess` without a non-null assertion.
   - `detectEmptyMemoryFields` parameter renamed to `_agentType` after guard removal to pass ESLint.
   - Schema parse failure uses `partitionMissingFields` to stay aligned with the dual-bucket invariant of the verdict.

7. **TDD compliance:** Every task writes a failing test first (Step 1), confirms failure (Step 2), then implements (Step 3+). Task 3 is a pre-investigation to de-risk Tasks 4–5.

8. **Breaking-test enumeration:** Task 3 dedicates a whole task to finding and listing tests that will break in Tasks 4–5. Eliminates "rediscover mid-task" risk.

9. **No accidental scope:** `handleResumedAfterSuccessCompletion`, the INT-1455 infra-failure path, webhook shape, and Firestore document layout are all explicitly preserved.

10. **Log-line consistency:** Task 9 step 2 adds a separate `Telemetry missing:` log after the existing `Missing fields:` log. The `retry` case in the switch logs `outcome.missingFields` (union of blocking + telemetry); the `fail` case error message also uses the union. No mismatch.

11. **Webhook contract:** `TaskResult` and `TaskError` shapes unchanged. `verificationHistory` gains two optional fields — backward compatible. Webhook consumers that only read `status`/`result`/`error` continue to work.

12. **Coverage:** Task 8 is well-covered (12+ explicit cases). Task 9 adds some v8-ignore blocks on paths unchanged from today (queued-messages, upstream retry error paths). Task 11 step 4 catches any regression.
