# Tiered Completion Verification — Split Deliverable vs Telemetry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop failing code tasks when the only thing missing is the memory-acknowledgment telemetry block, while keeping the existing strict verification for Opus/Sonnet workers unchanged.

**Architecture:** The orchestrator's `CompletionVerifier` currently returns a single `missingFields: string[]` that mixes two unrelated concerns: (a) deliverable fields required by the task contract (e.g. `gh_pr_url`, `review_comments_posted`) and (b) memory-acknowledgment telemetry fields (e.g. `memory_acknowledgment`, `memory_ids_unaccounted`). Both are treated as blocking, so a task that posted a valid PR review but forgot the telemetry block is retried 3× and marked `failed`. This plan (1) splits the verdict into `missingFields` (blocking — deliverable) and `telemetryMissingFields` (non-blocking — memory), (2) adds `telemetryExpectation: 'required' | 'optional'` per worker type, and (3) extracts the retry/accept/fail policy into a **pure function** `decideCompletionOutcome(verdict, tier, exitCode)` — so the policy is unit-testable without building a dispatcher test harness (none exists today: `task-dispatcher.test.ts` is 176 lines of pure-function tests only).

**Tech Stack:** TypeScript (strict mode), Zod, Vitest. No new dependencies, no Firestore migration (new `verificationHistory` fields are optional), no webhook shape change.

**Endpoint Changes:** None. No HTTP endpoints modified, created, removed, or unchanged — this is purely internal orchestrator logic.

**Non-goals / out of scope:**
- No worker prompt changes (system prompt keeps asking for memory ack).
- No downstream code-agent changes. Memory-effectiveness scoring downstream may treat tier=optional accepted tasks as "zero memories used" (same shape as "worker rejected all memories"). Acceptable skew — filed as follow-up tech debt, not in this plan.
- No coverage for `handleResumedAfterSuccessCompletion` — that's a separate code path (`task-dispatcher.ts:2037`) invoked from `handleTaskCompletion:1312` BEFORE the lines we're modifying, so resumed-after-success tasks are unaffected.
- **Compliance validation is intentionally NOT run for tier=optional accepted execution tasks.** Reason: compliance checks superpowers usage and workflow discipline, which weak models will have skipped for the same reasons they skipped telemetry — running compliance would produce false failures. Documented explicitly in the new branch; log line indicates the skip.

---

## File Structure

### Modified Files

| File                                                                         | Responsibility of change                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/completion-verifier.ts`                   | Split `CompletionVerifierVerdict` into `missingFields` (blocking) + `telemetryMissingFields`. Route memory-validation failures into telemetry. Relax `EXECUTION_SCHEMA` memory fields to optional. Export helpers `isTelemetryField`, `partitionMissingFields`. |
| `workers/orchestrator/src/services/isolation/types.ts`                       | Add `telemetryExpectation: 'required' \                                                                                                                                                                                                                         | 'optional'` to `WorkerTypeConfig`, populate every entry. |
| `workers/orchestrator/src/services/completion-outcome.ts`                    | **NEW FILE.** Pure function `decideCompletionOutcome(verdict, tier, exitCode)` returning a discriminated-union `CompletionOutcome`. This is the unit-testable policy layer.                                                                                     |
| `workers/orchestrator/src/services/task-dispatcher.ts`                       | Refactor `handleTaskCompletion` lines 1432–1748 to delegate retry/accept/fail decisions to `decideCompletionOutcome`. Thin wiring only.                                                                                                                         |
| `workers/orchestrator/src/types/task.ts`                                     | Extend `TaskVerificationRecord` with `telemetryMissingFields?: string[]` and `telemetryAccepted?: boolean`.                                                                                                                                                     |
| `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`    | Tests for split verdict and helpers. Update existing tests that asserted memory-fields in `missingFields`.                                                                                                                                                      |
| `workers/orchestrator/src/services/__tests__/completion-outcome.test.ts`     | **NEW FILE.** Exhaustive unit tests for `decideCompletionOutcome`.                                                                                                                                                                                              |
| `workers/orchestrator/src/services/isolation/__tests__/worker-types.test.ts` | **NEW FILE.** Assert every worker type declares `telemetryExpectation`.                                                                                                                                                                                         |

---

## Task 1: Split the verdict type

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` (around lines 43–59)

- [ ] **Step 1: Write the failing test**

Add to `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts` at the top level:

```ts
import type { CompletionVerifierVerdict } from '../completion-verifier.js';

describe('verdict telemetry split', () => {
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

(Only add the `import type` line if not already present — check first.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'verdict telemetry split'
```
Expected: TypeScript compile error "Property 'telemetryMissingFields' does not exist on type 'CompletionVerifierVerdict'".

- [ ] **Step 3: Add the field to the interface**

In `completion-verifier.ts` at the `CompletionVerifierVerdict` interface (line 43):

```ts
export interface CompletionVerifierVerdict {
  /** True when all blocking AND telemetry fields are present. */
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
git commit -m "feat(orchestrator): add telemetryMissingFields to CompletionVerifierVerdict"
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
/** Field names that represent memory-acknowledgment telemetry, not deliverable contract. */
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
- None modified. This is pure investigation to de-risk Tasks 4–5.

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

- [ ] **Step 4: Write the list into a temporary note at the top of the test file**

Prepend this block comment to `completion-verifier.test.ts` so the next step knows which tests to update:

```ts
/*
 * Migration list (remove when all updated):
 * Tests expected to move memory-field assertions from missingFields → telemetryMissingFields:
 *   - <line>: <test name>
 *   - <line>: <test name>
 *   ...
 * Tests expected to break on EXECUTION_SCHEMA relaxation:
 *   - <line>: <test name>
 *   ...
 */
```

Fill in from Steps 1–3. This block is deleted at the end of Task 5.

- [ ] **Step 5: Commit the investigation note**

```bash
git add workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "docs(orchestrator): enumerate tests affected by verdict-split refactor"
```

---

## Task 4: Route memory-validation failures into telemetry bucket

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts` at every `return` inside `doVerify` (around lines 675, 695, 815, 830, 870, 906, 925).

- [ ] **Step 1: Write failing test**

Append to `completion-verifier.test.ts`:

```ts
describe('memory validation routes into telemetryMissingFields', () => {
  it('emits memory_acknowledgment into telemetryMissingFields, not missingFields', async () => {
    // Mirror the existing fake LlmGenerateClient pattern already used in this file.
    // See existing "describe('OrchestratorCompletionVerifier', ...)" block for the helper.
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
    expect(verdict.telemetryMissingFields).toContain('memory_acknowledgment');
    expect(verdict.passed).toBe(false);
  });
});
```

`makeVerifierWithJsonResponse` and `makeMemoryContext` are patterns — mirror helpers already present in the test file. If they don't exist by that name, find the equivalent (search for `primaryClient:` and `matchedMemories:` in the existing tests) and reuse the exact construction.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'memory validation routes into telemetryMissingFields'
```
Expected: FAIL — `memory_acknowledgment` appears in `missingFields`, not `telemetryMissingFields`.

- [ ] **Step 3: Update every `return` inside `doVerify` to include `telemetryMissingFields`**

In `completion-verifier.ts`, the function `doVerify` (starts line 658) has 7 return sites. Update each.

**Fatal exit code (line ~675):**
```ts
return {
  passed: false,
  missingFields: [`fatal_exit_code_${String(fatalExitCode)}`],
  telemetryMissingFields: [],
  verifierFailure: false,
  trace: { transcript, prompt: '', response: '' },
};
```

**Transcript too short (line ~695):**
```ts
return {
  passed: false,
  missingFields: ['transcript_too_short'],
  telemetryMissingFields: [],
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
      telemetryMissingFields: parts.telemetry,
    },
    'Completion verifier: all models failed schema validation'
  );
  return {
    passed: false,
    missingFields: parts.blocking,
    telemetryMissingFields: parts.telemetry,
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
  telemetryMissingFields: [],
  verifierFailure: true,
  trace: { transcript, prompt, response: lastGeneratedContent },
};
```

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
    telemetryMissingFields: emptyMemoryFields,
    verifierFailure: false,
    succeededModelName,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

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
    telemetryMissingFields: memoryValidation.failures,
    verifierFailure: false,
    succeededModelName,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

**Success (line ~925):**
```ts
return {
  passed: true,
  missingFields: [],
  telemetryMissingFields: [],
  verifierFailure: false,
  agentData,
  succeededModelName,
  trace: { transcript, prompt, response: lastGeneratedContent },
};
```

- [ ] **Step 4: Run the new test**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts -t 'memory validation routes into telemetryMissingFields'
```
Expected: PASS.

- [ ] **Step 5: Migrate existing tests per Task 3's list**

For each test enumerated in Task 3's migration note:
- If the test asserted `missingFields` contained `memory_*` field names → change to assert against `telemetryMissingFields`.
- If the test asserted the verdict's `missingFields` is `[]` after memory validation → update to also check `telemetryMissingFields`.

- [ ] **Step 6: Run the full verifier suite**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts
```
Expected: PASS. Fix any remaining failures with a per-test edit.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "refactor(orchestrator): route memory validation failures into telemetryMissingFields"
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

Note for reviewer: this brings `EXECUTION_SCHEMA` into parity with every other schema (planning/pull_request/review/remediation already use `.optional().default('')` for these fields — see lines 153–155, 184–186, 200–202, 219–221).

- [ ] **Step 4: Remove the execution-agent guard**

Locate at line ~849:
```ts
if (hasInjectedMemories && input.agentType !== 'execution') {
```
Change to:
```ts
if (hasInjectedMemories) {
```

This runs the "empty memory fields" check for execution agents too, now that the Zod schema no longer enforces them. The empty-fields return already routes to `telemetryMissingFields` (Task 4 step 3).

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts
```
Expected: PASS. Apply remaining migrations from Task 3's list for execution-agent tests.

- [ ] **Step 6: Remove the migration note**

Delete the comment block added in Task 3 step 4.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "refactor(orchestrator): relax EXECUTION_SCHEMA memory fields to optional"
```

---

## Task 6: Add telemetryExpectation to WorkerTypeConfig

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Create: `workers/orchestrator/src/services/isolation/__tests__/worker-types.test.ts`

- [ ] **Step 1: Failing test**

Create `workers/orchestrator/src/services/isolation/__tests__/worker-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WORKER_TYPES } from '../types.js';

describe('WORKER_TYPES telemetryExpectation', () => {
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

- [ ] **Step 3: Extend the interface**

In `workers/orchestrator/src/services/isolation/types.ts`:

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

- [ ] **Step 4: Populate every entry**

Replace the `WORKER_TYPES` object:

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
    model: 'mimo-v2-pro',
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

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @intexuraos/orchestrator test -- worker-types.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/isolation/types.ts workers/orchestrator/src/services/isolation/__tests__/worker-types.test.ts
git commit -m "feat(orchestrator): add telemetryExpectation per worker type"
```

---

## Task 7: Extend TaskVerificationRecord

**Files:**
- Modify: `workers/orchestrator/src/types/task.ts` lines 13–19.

- [ ] **Step 1: Edit the type**

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
Expected: PASS (new fields are optional).

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/types/task.ts
git commit -m "feat(orchestrator): extend TaskVerificationRecord with telemetry fields"
```

---

## Task 8: Extract `decideCompletionOutcome` pure helper

**Files:**
- Create: `workers/orchestrator/src/services/completion-outcome.ts`
- Create: `workers/orchestrator/src/services/__tests__/completion-outcome.test.ts`

This is the unit-testable policy layer. Every retry/accept/fail decision goes through this function. The dispatcher (Task 9) just dispatches on the returned discriminated union.

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
    telemetryMissingFields: [],
    verifierFailure: false,
    trace: { transcript: '', prompt: '', response: '' },
    ...overrides,
  };
}

describe('decideCompletionOutcome', () => {
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
pnpm --filter @intexuraos/orchestrator test -- completion-outcome.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the module**

Create `workers/orchestrator/src/services/completion-outcome.ts`:

```ts
import type { CompletionVerifierVerdict } from './completion-verifier.js';

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

  // 7. Fallback: passed is false but no missing fields and no agentData (shouldn't happen with
  //    a correct verifier; treat as a generic fail).
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
git commit -m "feat(orchestrator): add decideCompletionOutcome pure policy helper"
```

---

## Task 9: Wire `decideCompletionOutcome` into the dispatcher

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` lines 1432–1748 (the post-verification block in `handleTaskCompletion`).

This is where the plan meets the dispatcher. The strategy: **keep all the side-effectful steps (logging, persistence, worker restart, webhooks) but replace the decision tree with a single `decideCompletionOutcome` call plus a switch on the outcome kind**. We deliberately do NOT add a new test harness here — the policy is covered by Task 8's unit tests.

- [ ] **Step 1: Add imports at the top of `task-dispatcher.ts`**

```ts
import { WORKER_TYPES } from './isolation/types.js';
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
if (verification.telemetryMissingFields.length > 0) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Telemetry missing: ${verification.telemetryMissingFields.join(' | ')}`
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
    telemetryMissingFields: verification.telemetryMissingFields,
    verifierFailure: verification.verifierFailure,
    createdAt: new Date().toISOString(),
  },
];
```

- [ ] **Step 4: Update the second verificationHistory push at line ~1510**

Inside the `if (verification.verifierFailure)` block, the retry-verifier path. Locate:
```ts
task.verificationHistory = [
  ...(task.verificationHistory ?? []),
  {
    attempt: attempt + 1,
    passed: retryVerification.passed,
    missingFields: retryVerification.missingFields,
    verifierFailure: retryVerification.verifierFailure,
    createdAt: new Date().toISOString(),
  },
];
```
Replace with:
```ts
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
```

- [ ] **Step 5: Replace the decision tree (lines ~1491–1748) with outcome dispatch**

The large block spanning `if (verification.verifierFailure) { ... }` through the terminal-failure block is the decision tree. Replace it with a call to `decideCompletionOutcome` and a switch on the kind. Paste the following **right after** the updated first `task.verificationHistory = [...]` block (step 3 above):

```ts
const tier = WORKER_TYPES[task.workerType].telemetryExpectation;
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

    // Pending messages delivery — original logic from line 1578 block.
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
    /* v8 ignore start -- source-map: void fire-and-forget compliance validation branches misattributed by v8; detached promise created by void expression not tracked by coverage instrumentation @preserve */
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
    // Fall through to fail-verifier handling by re-deciding with the new verdict.
    // Simpler: fail directly since we've exhausted verifier retry.
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

After pasting, **delete** the entire old decision block — everything from the old `if (verification.verifierFailure) { ... }` through the old terminal-failure block (former lines 1491–1748 approximately). The switch now handles every case.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @intexuraos/orchestrator typecheck
```
Expected: PASS. Fix any imports or unused variables. In particular, `hasFatalExitCodeField` is no longer called here — remove the import if it becomes unused (check with `rg -n "hasFatalExitCodeField" workers/orchestrator/src/services/task-dispatcher.ts`).

- [ ] **Step 7: Run the full orchestrator test suite**

```bash
pnpm --filter @intexuraos/orchestrator test
```
Expected: all tests pass. If the existing `task-dispatcher.test.ts` tests break (they test `buildMissingFieldsPrompt` only, so unlikely), debug and fix per test.

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts
git commit -m "refactor(orchestrator): dispatch completion decisions through decideCompletionOutcome"
```

---

## Task 10: Documentation

**Files:**
- Create: `.claude/reference/orchestrator-completion-tiers.md`

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

### Policy helper

All retry/accept/fail decisions flow through `decideCompletionOutcome(verdict, tier, exitCode)` in `workers/orchestrator/src/services/completion-outcome.ts`. This is a pure function — test it in `completion-outcome.test.ts`, not in dispatcher tests.

### Compliance validation

Compliance validation (superpowers-usage check for execution tasks at `task-dispatcher.ts:prepareComplianceValidationInput`) runs **only for tier=required accepted tasks**. Tier=optional accepted tasks skip compliance because weak models that skipped telemetry will also have skipped the disciplines compliance checks for, producing false failures.

### Observability note

Tier=optional accepted tasks emit empty/missing `execution_memory_ids_used` etc. in their `TaskResult`. Downstream memory-effectiveness scoring may read these as "zero memories used" — indistinguishable from "worker rejected all memories." Filed as follow-up tech debt; not addressed in this change.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/reference/orchestrator-completion-tiers.md
git commit -m "docs: add orchestrator completion tiers reference"
```

---

## Task 11: Full verification

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

---

## Task 12: Pull request

**Files:**
- None modified.

- [ ] **Step 1: Confirm branch is feature-scoped**

```bash
gh pr status
```
Branch must be `feature/INT-<id>-<slug>` (never commit to `main` or `development`). Ask the user for the Linear issue ID before opening the PR — do not invent one.

- [ ] **Step 2: Open the PR** (replace `<INT-ID>` with the actual ID from the user)

```bash
gh pr create --title "feat(orchestrator): tiered telemetry acceptance (<INT-ID>)" --body "$(cat <<'EOF'
## Summary
- Split `CompletionVerifierVerdict.missingFields` into blocking (deliverable) vs `telemetryMissingFields` (memory acknowledgment).
- Add `telemetryExpectation: 'required' | 'optional'` per worker type — `required` for opus/sonnet/auto (preserves existing behavior), `optional` for glm/qwen/kimi/minimax/mimo-pro/codex/openrouter-free.
- Extract policy into pure `decideCompletionOutcome(verdict, tier, exitCode)` — dispatcher is now a thin switch over the outcome kind.
- Dispatcher accepts a task as completed when only telemetry is missing and the worker's tier is `optional`, with `verificationHistory[n].telemetryAccepted = true`.
- Tier=optional accepted execution tasks skip compliance validation (weak models skipping telemetry will also have skipped superpowers checks — compliance would produce false failures).
- Tier=required behavior is preserved bit-for-bit: telemetry-only failures retry with the union (blocking + telemetry) passed to `buildMissingFieldsPrompt`.

## Why
Weak models (glm-5 etc.) successfully complete review tasks (PR review posted, result populated) but fail the strict memory-acknowledgment block 3× and get marked `failed`. Example: task_1dbe9147-4164-4b0c-aaef-39aa90e1f433 posted a valid review, then failed after 3 attempts for missing `memory_acknowledgment`.

## Test plan
- [ ] `pnpm --filter @intexuraos/orchestrator test` — all tests pass including new `completion-outcome.test.ts` suite
- [ ] `pnpm run verify:workspace:tracked orchestrator`
- [ ] `pnpm run ci:tracked`
- [ ] Manual: dispatch a glm review task in dev that forgets memory ack → verify `status=completed` in Firestore `code_tasks` doc; verify `verificationHistory[n].telemetryAccepted=true`; verify orchestrator log shows "Telemetry incomplete but accepted".
- [ ] Manual: dispatch an Opus task that forgets memory ack → verify existing 3-attempt retry behavior unchanged.

Fixes <INT-ID>
EOF
)"
```

---

## Self-Review Checklist (post-rewrite)

1. **Spec coverage:**
   - ✅ Split verification into two gates — Tasks 1, 4 (verdict + memory-validation routing).
   - ✅ Per-worker-type `telemetryExpectation` — Task 6.
   - ✅ Tier=required preserves current behavior — Task 8 unit tests cover telemetry-only retry (uses union). Task 9 wiring preserves all original side effects.
   - ✅ Tier=optional accepts on telemetry-only — Task 8 tests `onlyTelemetry + tier=optional + exit=0 → accept`.
   - ✅ Observability via `verificationHistory` — Tasks 7 + 9.
   - ✅ Non-zero exit code override applies BEFORE tier=optional accept — Task 8 explicit test `fail-exit-override when exit code non-zero, even if verdict is telemetry-only`.
   - ✅ Compliance validator intentionally skipped for tier=optional accepted execution — Task 9 step 5 + Task 10 docs.
   - ✅ Fatal exit codes (137/139) route to blocking — Task 4 step 3 + Task 8 explicit test.

2. **Placeholder scan:** All `<INT-ID>` placeholders are flagged with "ask the user" — acceptable. No TBD/TODO/"similar to Task N"/"handle edge cases" phrases.

3. **Type consistency:**
   - `CompletionVerifierVerdict.telemetryMissingFields` — defined Task 1, written by Task 4, read by Task 8/9.
   - `TaskVerificationRecord.{telemetryMissingFields, telemetryAccepted}` — defined Task 7, written Task 9 steps 3/4/5.
   - `WorkerTypeConfig.telemetryExpectation` — defined Task 6, read Task 9 step 5.
   - `CompletionOutcome` discriminated union — defined Task 8, consumed Task 9 step 5 switch.
   - `isTelemetryField`, `partitionMissingFields` — defined Task 2, consumed Task 4 schema-parse-failure return.

4. **TDD compliance:** Task 8 is strictly test-first (exhaustive unit tests drive the pure function). Tasks 1, 2, 5, 6 are test-first. Task 4 writes a failing test then updates 7 return sites as a single edit — acceptable because they're all the same mechanical shape-change. Task 9 is wiring only; the behavior is covered by Task 8 unit tests, so TDD-via-proxy.

5. **Breaking-test enumeration:** Task 3 dedicates a whole task to finding and listing tests that will break in Tasks 4–5. Eliminates "rediscover mid-task" risk.

6. **Test harness:** Task 9 explicitly does NOT require a dispatcher test harness. Task 8 unit-tests the policy in isolation. This matches the current codebase (no dispatcher harness exists today).

7. **Log-line consistency:** Task 9 step 2 updates the log at lines 1447–1452 to emit both `Missing fields:` and `Telemetry missing:` lines. The `retry` case in the switch logs `outcome.missingFields` (union), matching the error built in the `fail` case (also union). No mismatch.

8. **No accidental scope:** `handleResumedAfterSuccessCompletion` path at `task-dispatcher.ts:2037` is not modified — it runs before reaching the tiered logic. Non-goals section calls this out.

9. **Webhook contract:** `TaskResult` and `TaskError` shapes unchanged. `verificationHistory` gains two optional fields — backward compatible. Webhook consumers that only read `status`/`result`/`error` continue to work.

10. **Coverage:** Task 8 is well-covered (12+ explicit cases). Task 9 adds some v8-ignore blocks on paths unchanged from today (queued-messages, upstream retry error paths). Task 11 step 4 catches any regression.

11. **Docs:** Task 10 adds a reference note so future maintainers don't have to reverse-engineer the tier system.
