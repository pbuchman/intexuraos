# Robust Memory-Acknowledgment Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the orchestrator from terminally failing review/planning/PR tasks solely because the worker omitted the `📋 Execution Memories Received:` block, when the rest of the work succeeded.

**Architecture:** Two production changes plus tests. (1) `buildMissingFieldsPrompt` in `task-dispatcher.ts` gains access to the injected-memory context and emits explicit bullet-format instructions plus the exact memory IDs when `memory_acknowledgment` is flagged — so attempt 2+ has actionable instructions. (2) `validateMemoryReporting` in `completion-verifier.ts` splits its return into hard `failures` vs `softWarnings`; `memory_acknowledgment` becomes a soft warning when the `memory_ids_used / memory_ids_rejected / memory_usage_summary` triplet is fully consistent, so pure bookkeeping drift never kills completed work. (3) A new end-to-end regression test pins the auto-continue→verifier loop against drift.

**Tech Stack:** TypeScript strict mode, Vitest, Zod. No schema changes, no migrations, no endpoint changes.

---

## Endpoint Changes

- **Modified:** none
- **Created:** none
- **Removed:** none
- **Unchanged:** all existing orchestrator HTTP endpoints

This plan touches only the orchestrator's internal verifier + prompt-builder. No HTTP routes.

---

## Context — why this change

The review task `task_7a5ec639-984f-465d-8315-f6df16093c09` (PR #1874) completed the real review on attempt 1 (review `4132821304` posted, tracker updated, checks green) but was terminally failed by the completion verifier on all 3 attempts with `Missing fields: memory_acknowledgment`.

Root cause evidence (from `/tmp/task-7a5ec639-logs.txt`):

1. **Attempt 1 (01:41:02):** Agent's `REVIEW_AGENT_FINAL` block had the triplet fields (`memory_ids_used: none`, `memory_ids_rejected: mem_d2999121…`, `memory_usage_summary: …`) but no `📋 Execution Memories Received:` block. Verifier correctly flagged `memory_acknowledgment`.

2. **Attempt 2 (01:41:55):** The auto-continue prompt says (full source at `workers/orchestrator/src/services/task-dispatcher.ts:79-91`):

   ```
   EXECUTION MEMORY REPORTING FAILURE:
   You were injected with execution memories but did not properly report their usage.
   You MUST include in your final output:
   1. memory_ids_used: …
   2. memory_ids_rejected: …
   3. memory_usage_summary: …
   ```

   Those are **different checks** from `memory_acknowledgment`. The prompt never mentions the bullet format `- [1] memoryId — "title" — APPLICABLE|NOT APPLICABLE because …` that `buildMemoryAcknowledgmentPattern` (completion-verifier.ts:551-554) actually requires. The agent tried to help by inlining the block as the *value* of a `memory_acknowledgment:` field (mid-line `[1] mem_d2999121 …`). The regex is anchored at `^\s*(?:\[[^\]]+\]\s+)?-\s*\[\d+\]\s+<id>\b` (line-start only), so mid-line occurrences don't match.

3. **Attempt 3 (01:44:24):** Agent dropped the inline field and kept only the triplet — no acknowledgment block at all. Terminal failure.

So the auto-continue prompt actively misled the agent toward fixes that can't satisfy the gate. The INT-1411 fix (commits `83b85e3cc`, `a9342a533`) aligned the regex with the prompt format, but the auto-continue text was left out of that alignment.

Secondary concern: even with a correct auto-continue prompt, a finicky worker (glm-5, codex, etc.) can drop the block. Failing the entire task on this bookkeeping omission — when the triplet fields are fully consistent — is hostile. The triplet proves the worker was memory-aware; the block is audit sugar.

---

## File Structure

### Modify
- `workers/orchestrator/src/services/task-dispatcher.ts`
  - Extend `buildMissingFieldsPrompt` signature to accept `executionMemoryContext?: ExecutionMemoryPromptContext`.
  - When `memory_acknowledgment` is in `missingFields`, emit the full bullet template plus the exact injected memory IDs.
  - Update the single call site (`this.buildMissingFieldsPrompt(completionAgentType, verification.missingFields, rawLogs)`) to pass `task.executionMemoryContext`.
- `workers/orchestrator/src/services/completion-verifier.ts`
  - Change `validateMemoryReporting` return shape from `string[]` to `{ failures: string[]; softWarnings: string[] }`.
  - Rule: when `memory_acknowledgment` is the only finding AND the triplet (`memory_ids_used ∪ memory_ids_rejected == injectedIds`, no overlap, non-empty `memory_usage_summary`) is consistent, route it to `softWarnings` instead of `failures`.
  - Update the caller inside `doVerify` to union `failures` (hard — fails the verifier) and log `softWarnings` via `this.logger.warn` at that call site.
- `workers/orchestrator/src/services/__tests__/task-dispatcher.test.ts`
  - Add tests for the new `memory_acknowledgment` branch (with `executionMemoryContext`) producing the bullet template and ID list.
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`
  - Add tests for the soft-warning path (triplet consistent, block absent → `passed: true` + warning logged).
  - Add an end-to-end loop fixture: verifier rejects attempt 1 → `buildMissingFieldsPrompt` produces a prompt containing the bullet template and the specific injected IDs → a simulated attempt-2 agent output that follows that template passes the verifier.

### Add
None. All changes fit in existing files.

---

## Task 1: Extend `buildMissingFieldsPrompt` to carry the acknowledgment block template

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:60-110`
- Modify: `workers/orchestrator/src/services/__tests__/task-dispatcher.test.ts`

**Rationale:** On attempt 2+ the worker must see (a) the bullet format it needs to emit, and (b) the exact memory IDs it must acknowledge. Today the prompt only lists the triplet fields, which addresses different checks.

### Step 1: Add failing test — prompt carries block template when acknowledgment is missing

Edit `workers/orchestrator/src/services/__tests__/task-dispatcher.test.ts`. Append inside the existing `describe('buildMissingFieldsPrompt', () => { … })` block, **before** the closing `});`:

```ts
it('includes the acknowledgment block template and injected IDs when memory_acknowledgment is missing', () => {
  const result = buildMissingFieldsPrompt(
    'review',
    ['memory_acknowledgment'],
    rawLogs,
    {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'q',
      matchedMemories: [
        {
          memoryId: 'mem_aaa',
          title: 'First memory',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'x',
          action: 'x',
          avoid: 'x',
          verification: 'x',
        },
        {
          memoryId: 'mem_bbb',
          title: 'Second memory',
          memoryType: 'review_finding',
          score: 0.8,
          appliesWhen: 'y',
          action: 'y',
          avoid: 'y',
          verification: 'y',
        },
      ],
    }
  );

  expect(result).toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
  expect(result).toContain('📋 **Execution Memories Received:**');
  expect(result).toContain('- [<n>] <memoryId> — "<title>" — APPLICABLE|NOT APPLICABLE because');
  expect(result).toContain('mem_aaa');
  expect(result).toContain('mem_bbb');
  expect(result).toContain('start of a new line');
});

it('omits the acknowledgment block template when memory_acknowledgment is NOT missing', () => {
  const result = buildMissingFieldsPrompt(
    'review',
    ['memory_ids_used'],
    rawLogs,
    {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'q',
      matchedMemories: [
        {
          memoryId: 'mem_aaa',
          title: 'First memory',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'x',
          action: 'x',
          avoid: 'x',
          verification: 'x',
        },
      ],
    }
  );

  expect(result).not.toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
  expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
});

it('includes both the block template AND the triplet guidance when both classes of memory field are missing', () => {
  const result = buildMissingFieldsPrompt(
    'review',
    ['memory_acknowledgment', 'memory_ids_used'],
    rawLogs,
    {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'q',
      matchedMemories: [
        {
          memoryId: 'mem_aaa',
          title: 'First',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'x',
          action: 'x',
          avoid: 'x',
          verification: 'x',
        },
      ],
    }
  );

  expect(result).toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
  expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
});

it('accepts missing executionMemoryContext and still mentions acknowledgment when flagged', () => {
  const result = buildMissingFieldsPrompt(
    'review',
    ['memory_acknowledgment'],
    rawLogs
  );
  expect(result).toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
  // No IDs to list, so the generic template still renders.
  expect(result).toContain('📋 **Execution Memories Received:**');
});
```

### Step 2: Run the new tests to verify they fail

Run: `pnpm -F orchestrator test -- task-dispatcher`
Expected: the four new tests fail (`TypeError: buildMissingFieldsPrompt expects 3 arguments` or `expected '…' to contain 'MEMORY ACKNOWLEDGMENT BLOCK MISSING'`). Existing tests still pass.

### Step 3: Update `buildMissingFieldsPrompt` to accept context and emit block guidance

Edit `workers/orchestrator/src/services/task-dispatcher.ts`. Replace the current function (lines 71–110) with:

```ts
export function buildMissingFieldsPrompt(
  agentType: CompletionAgentType,
  missingFields: string[],
  rawLogs: string,
  executionMemoryContext?: ExecutionMemoryPromptContext
): string {
  const transcript = getLast50Lines(rawLogs);
  const hasMemoryFailures = missingFields.some((field) => MEMORY_FIELDS.includes(field));
  const hasAckFailure = missingFields.includes('memory_acknowledgment');

  const triplet = hasMemoryFailures
    ? [
        '',
        'EXECUTION MEMORY REPORTING FAILURE:',
        'You were injected with execution memories but did not properly report their usage.',
        'You MUST include in your final output:',
        '1. memory_ids_used: comma-separated IDs of memories you applied',
        '2. memory_ids_rejected: comma-separated IDs of memories you found irrelevant',
        '3. memory_usage_summary: one sentence about how memories influenced your work',
        'Every injected memory must appear in either used or rejected. No ID may be missing.',
        'If you did not use any memory, put all IDs in memory_ids_rejected.',
      ]
    : [];

  const ackGuidance = hasAckFailure
    ? buildMemoryAcknowledgmentGuidance(executionMemoryContext)
    : [];

  return [
    '[AUTO-CONTINUE ATTEMPT]',
    'Your last response was missing required fields for the completion verifier.',
    '',
    `Missing fields: ${missingFields.join(', ')}`,
    ...ackGuidance,
    ...triplet,
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

function buildMemoryAcknowledgmentGuidance(
  context: ExecutionMemoryPromptContext | undefined
): string[] {
  const idLines =
    context !== undefined && context.matchedMemories.length > 0
      ? [
          'Injected memory IDs you MUST acknowledge (one bullet per ID):',
          ...context.matchedMemories.map(
            (memory, index) =>
              `- [${String(index + 1)}] ${memory.memoryId} — "${memory.title}" — APPLICABLE|NOT APPLICABLE because <one-sentence reason>`
          ),
          '',
        ]
      : [];

  return [
    '',
    'MEMORY ACKNOWLEDGMENT BLOCK MISSING:',
    'The completion verifier requires this exact block, EACH bullet on the start of a new line with no leading characters other than "- ":',
    '',
    '📋 **Execution Memories Received:**',
    'I have received and reviewed <N> execution memories for this task:',
    '- [<n>] <memoryId> — "<title>" — APPLICABLE|NOT APPLICABLE because <one-sentence reason>',
    '',
    'Emit the block verbatim BEFORE your final REVIEW_AGENT_FINAL / PLAN_AGENT_FINAL / (etc.) block.',
    'Do NOT inline the bullets as the value of a field — they must be standalone lines that start with "- [".',
    ...idLines,
  ];
}
```

Add the import at the top of the file, grouping with existing type imports from `./completion-verifier.js`:

```ts
import type { ExecutionMemoryPromptContext } from '../types/execution-memory.js';
```

### Step 4: Run the tests to verify they pass

Run: `pnpm -F orchestrator test -- task-dispatcher`
Expected: all four new tests pass. Existing tests also still pass (they pass `undefined` for the new optional context and never flag `memory_acknowledgment` in their fixtures).

### Step 5: Update the single production caller to forward `task.executionMemoryContext`

Edit `workers/orchestrator/src/services/task-dispatcher.ts:1712-1718`. Current:

```ts
private buildMissingFieldsPrompt(
  agentType: CompletionAgentType,
  missingFields: string[],
  rawLogs: string
): string {
  return buildMissingFieldsPrompt(agentType, missingFields, rawLogs);
}
```

Replace with (keep the method a thin delegator; take the context from the task being processed by hoisting it via a parameter):

```ts
private buildMissingFieldsPrompt(
  agentType: CompletionAgentType,
  missingFields: string[],
  rawLogs: string,
  executionMemoryContext?: ExecutionMemoryPromptContext
): string {
  return buildMissingFieldsPrompt(agentType, missingFields, rawLogs, executionMemoryContext);
}
```

And the only caller (around line 1637) currently reads:

```ts
const resumePrompt = this.buildMissingFieldsPrompt(
  completionAgentType,
  verification.missingFields,
  rawLogs
);
```

Replace with:

```ts
const resumePrompt = this.buildMissingFieldsPrompt(
  completionAgentType,
  verification.missingFields,
  rawLogs,
  task.executionMemoryContext
);
```

### Step 6: Run the orchestrator test file in full to confirm no regressions

Run: `pnpm -F orchestrator test -- task-dispatcher completion-verifier`
Expected: green. The completion-verifier tests are unaffected by this task.

### Step 7: Commit

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/services/__tests__/task-dispatcher.test.ts
git commit -m "$(cat <<'EOF'
fix(orchestrator): make auto-continue prompt actually fix memory_acknowledgment

When the completion verifier flags memory_acknowledgment as missing, the
auto-continue prompt previously told the agent to emit
memory_ids_used/rejected/summary — three different checks that do not
satisfy the acknowledgment gate. Compliant workers therefore produced
fields that still failed, and tasks burned all 3 attempts on bookkeeping
with the real work already complete.

Extend buildMissingFieldsPrompt to take the injected memory context and,
when memory_acknowledgment is flagged, emit the exact bullet template
plus the list of injected IDs the worker must acknowledge.
EOF
)"
```

---

## Task 2: Soft-fail `memory_acknowledgment` when the triplet is consistent

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts:556-614, 866-888`
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

**Rationale:** The triplet (`memory_ids_used`, `memory_ids_rejected`, `memory_usage_summary`) already proves the worker was memory-aware and decided per memory. When it is fully consistent and the only missing field is the acknowledgment block, we log a warning and let the task finalize cleanly. When the triplet is inconsistent (IDs invalid, overlap, unaccounted, or summary empty), the acknowledgment stays a hard failure — matching today's behavior.

### Step 1: Write failing test — soft warning when only the block is missing

Edit `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`. Add the following new test inside the existing `describe('validateMemoryReporting', …)` block (locate it near line 1275 where `accepts the [index] memoryId acknowledgment format …` already lives). Add **after** that test and before the next `describe` / block end:

```ts
it('passes with a soft warning when the acknowledgment block is absent but the triplet is consistent', async () => {
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1874',
        memory_ids_used: '',
        memory_ids_rejected: 'mem_d2999121-0694-413d-adb0-35e45223c8d6',
        memory_usage_summary:
          'No memories were applicable; rejected the migration-testing memory as the PR fixes a timestamp unit bug.',
        summary: 'Reviewed PR.',
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    },
  });

  const verifier = createVerifier();
  const result = await verifier.verify({
    taskId: 'task-soft-warning',
    attempt: 1,
    maxAttempts: 3,
    agentType: 'execution',
    // Raw logs contain NO `Execution Memories Received` block and NO bullet.
    rawLogs: [
      '[claude] started work',
      '[claude] step 2',
      '[claude] step 3',
      '[claude] step 4',
      '[claude] finished work',
    ].join('\n'),
    executionMemoryContext: {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'Digest 500 fix',
      matchedMemories: [
        {
          memoryId: 'mem_d2999121-0694-413d-adb0-35e45223c8d6',
          title: 'Creating complex data migrations without dedicated test coverage',
          memoryType: 'pitfall_pattern',
          score: 0.56,
          appliesWhen: 'Developing a migration',
          action: 'Cover all branches',
          avoid: 'Skipping tests',
          verification: 'Unit-test the migration',
        },
      ],
    },
  });

  expect(result.passed).toBe(true);
  expect(result.missingFields).not.toContain('memory_acknowledgment');
  expect(loggerWarn).toHaveBeenCalledWith(
    expect.objectContaining({
      softWarnings: expect.arrayContaining(['memory_acknowledgment']),
    }),
    expect.stringContaining('soft')
  );
});

it('keeps memory_acknowledgment as a hard failure when the triplet is inconsistent (unaccounted memory)', async () => {
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1874',
        memory_ids_used: '',
        memory_ids_rejected: '', // NOT consistent: injected IDs unaccounted.
        memory_usage_summary: 'No memories applied.',
        summary: 'Reviewed PR.',
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    },
  });

  const verifier = createVerifier();
  const result = await verifier.verify({
    taskId: 'task-hard-failure',
    attempt: 1,
    maxAttempts: 3,
    agentType: 'execution',
    rawLogs: [
      '[claude] started work',
      '[claude] step 2',
      '[claude] step 3',
      '[claude] step 4',
      '[claude] finished work',
    ].join('\n'),
    executionMemoryContext: {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'x',
      matchedMemories: [
        {
          memoryId: 'mem_xxx',
          title: 'X',
          memoryType: 'pitfall_pattern',
          score: 0.56,
          appliesWhen: 'x',
          action: 'x',
          avoid: 'x',
          verification: 'x',
        },
      ],
    },
  });

  expect(result.passed).toBe(false);
  expect(result.missingFields).toContain('memory_acknowledgment');
  expect(result.missingFields).toContain('memory_ids_unaccounted');
});
```

### Step 2: Run the new tests to verify they fail

Run: `pnpm -F orchestrator test -- completion-verifier`
Expected: the `soft warning` test fails (`expected result.passed toBe(true) but was false`). The hard-failure test passes (today's behavior).

### Step 3: Refactor `validateMemoryReporting` to return `{ failures, softWarnings }`

Edit `workers/orchestrator/src/services/completion-verifier.ts`. Replace the existing `validateMemoryReporting` (currently around lines 556–614) with:

```ts
export interface MemoryReportingValidationResult {
  /** Hard failures — the verifier must reject this verdict. */
  failures: string[];
  /** Soft warnings — log only, do not fail. */
  softWarnings: string[];
}

function validateMemoryReporting(
  rawLogs: string,
  executionMemoryContext: ExecutionMemoryPromptContext,
  agentData: {
    memory_ids_used?: string;
    memory_ids_rejected?: string;
    memory_usage_summary?: string;
  }
): MemoryReportingValidationResult {
  const injectedIds = executionMemoryContext.matchedMemories.map((memory) => memory.memoryId);
  if (injectedIds.length === 0) {
    return { failures: [], softWarnings: [] };
  }

  const normalizedLogs = stripDockerHeaders(rawLogs);

  const hasAcknowledgment =
    normalizedLogs.includes('Execution Memories Received') &&
    injectedIds.every((memoryId) =>
      buildMemoryAcknowledgmentPattern(memoryId).test(normalizedLogs)
    );

  /* v8 ignore start -- schema: Zod schema defaults always provide strings; helper stays optional for structural typing across agent variants @preserve */
  const usedIds = normalizeMemoryCsv(agentData.memory_ids_used ?? '');
  const rejectedIds = normalizeMemoryCsv(agentData.memory_ids_rejected ?? '');
  const summary = (agentData.memory_usage_summary ?? '').trim();
  /* v8 ignore stop @preserve */

  const injectedSet = new Set(injectedIds);
  const usedSet = new Set(usedIds);
  const rejectedSet = new Set(rejectedIds);

  const tripletFailures: string[] = [];
  if (summary === '') {
    tripletFailures.push('memory_usage_summary');
  }
  if (usedIds.some((memoryId) => !injectedSet.has(memoryId))) {
    tripletFailures.push('memory_ids_used_invalid');
  }
  if (rejectedIds.some((memoryId) => !injectedSet.has(memoryId))) {
    tripletFailures.push('memory_ids_rejected_invalid');
  }
  if (usedIds.some((memoryId) => rejectedSet.has(memoryId))) {
    tripletFailures.push('memory_ids_overlap');
  }
  const unaccountedIds = injectedIds.filter(
    (memoryId) => !usedSet.has(memoryId) && !rejectedSet.has(memoryId)
  );
  if (unaccountedIds.length > 0) {
    tripletFailures.push('memory_ids_unaccounted');
  }

  // Acknowledgment is a SOFT warning when the triplet is fully consistent —
  // the worker proved memory awareness via the fields, the block is audit sugar.
  // Otherwise it stays a hard failure so the auto-continue prompt can recover.
  const failures: string[] = [...tripletFailures];
  const softWarnings: string[] = [];
  if (!hasAcknowledgment) {
    if (tripletFailures.length === 0) {
      softWarnings.push('memory_acknowledgment');
    } else {
      failures.push('memory_acknowledgment');
    }
  }

  return { failures, softWarnings };
}
```

### Step 4: Update the caller inside `doVerify` to consume the new shape and log warnings

In the same file, locate the existing block (around lines 866-888):

```ts
const agentData = toAgentData(input.agentType, parseResult.data);
const memoryValidationFailures =
  input.executionMemoryContext !== undefined
    ? validateMemoryReporting(input.rawLogs, input.executionMemoryContext, agentData)
    : [];
if (memoryValidationFailures.length > 0) {
  this.logger.warn(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      model: succeededModelName,
      memoryValidationFailures,
    },
    'Completion verifier memory validation failed'
  );
  return {
    passed: false,
    missingFields: memoryValidationFailures,
    verifierFailure: false,
    succeededModelName,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

Replace with:

```ts
const agentData = toAgentData(input.agentType, parseResult.data);
const memoryValidation: MemoryReportingValidationResult =
  input.executionMemoryContext !== undefined
    ? validateMemoryReporting(input.rawLogs, input.executionMemoryContext, agentData)
    : { failures: [], softWarnings: [] };

if (memoryValidation.softWarnings.length > 0) {
  this.logger.warn(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      model: succeededModelName,
      softWarnings: memoryValidation.softWarnings,
    },
    'Completion verifier memory validation soft warning: triplet consistent, block missing'
  );
}

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
    missingFields: memoryValidation.failures,
    verifierFailure: false,
    succeededModelName,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}
```

### Step 5: Run the full verifier test file

Run: `pnpm -F orchestrator test -- completion-verifier`
Expected: green. Both new tests from Step 1 pass, plus every pre-existing test (the legacy tests that drive `validateMemoryReporting` all include triplet *inconsistencies*, so they still hit the hard-failure path).

### Step 6: Commit

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "$(cat <<'EOF'
fix(orchestrator): downgrade memory_acknowledgment to soft warning when triplet is consistent

The memory_ids_used/memory_ids_rejected/memory_usage_summary triplet
proves the worker was memory-aware and judged each injected memory. The
acknowledgment block is audit sugar. When the triplet is fully
consistent (no invalid IDs, no overlap, no unaccounted memory, non-empty
summary), a missing block now logs a warning instead of failing the
task. When the triplet has any defect, the acknowledgment stays a hard
failure so the auto-continue loop can recover.
EOF
)"
```

---

## Task 3: End-to-end regression test for the auto-continue → verifier loop

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

**Rationale:** The drift between the prompt and the verifier regex (INT-1411) and between the auto-continue prompt and the verifier check (this incident) both slipped past unit tests because no test exercised the full loop: verifier rejects → prompt is built → compliant agent response → verifier accepts.

### Step 1: Add an end-to-end fixture test

Append inside the same `describe('validateMemoryReporting', …)` block used in Task 2, **after** the two tests added in Task 2:

```ts
it('end-to-end: prompt from buildMissingFieldsPrompt yields a compliant block that the verifier accepts', async () => {
  const { buildMissingFieldsPrompt } = await import('../task-dispatcher.js');

  // ---- Attempt 1: agent emits only the triplet with an *unaccounted* memory — hard failure ---
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1',
        memory_ids_used: '',
        memory_ids_rejected: '',
        memory_usage_summary: '',
        summary: 'Reviewed.',
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    },
  });

  const memoryContext = {
    applicationId: 'app-1',
    retrievalVersion: 'execution-memory-retrieval@3.0.0',
    querySummary: 'q',
    matchedMemories: [
      {
        memoryId: 'mem_loop_aaa',
        title: 'Loop A',
        memoryType: 'pitfall_pattern' as const,
        score: 0.9,
        appliesWhen: 'x',
        action: 'x',
        avoid: 'x',
        verification: 'x',
      },
    ],
  };

  const verifier = createVerifier();
  const attempt1RawLogs = [
    '[claude] started',
    '[claude] step 2',
    '[claude] step 3',
    '[claude] step 4',
    '[claude] finished',
  ].join('\n');

  const attempt1 = await verifier.verify({
    taskId: 'task-loop',
    attempt: 1,
    maxAttempts: 3,
    agentType: 'execution',
    rawLogs: attempt1RawLogs,
    executionMemoryContext: memoryContext,
  });
  expect(attempt1.passed).toBe(false);
  expect(attempt1.missingFields).toContain('memory_acknowledgment');
  expect(attempt1.missingFields).toContain('memory_ids_unaccounted');

  // ---- buildMissingFieldsPrompt produces instructions for attempt 2 ---
  const resumePrompt = buildMissingFieldsPrompt(
    'execution',
    attempt1.missingFields,
    attempt1RawLogs,
    memoryContext
  );
  expect(resumePrompt).toContain('📋 **Execution Memories Received:**');
  expect(resumePrompt).toContain('mem_loop_aaa');

  // ---- Attempt 2: agent follows the prompt — emits the exact block + consistent triplet ---
  generateMock.mockResolvedValueOnce({
    ok: true,
    value: {
      content: JSON.stringify({
        outcome: 'implemented',
        superpowers_subagent_driven_dev: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/org/repo/pull/1',
        memory_ids_used: '',
        memory_ids_rejected: 'mem_loop_aaa',
        memory_usage_summary: 'Rejected the loop memory as not applicable.',
        summary: 'Reviewed.',
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    },
  });

  const attempt2RawLogs = [
    attempt1RawLogs,
    '[claude] 📋 **Execution Memories Received:**',
    '[claude] I have received and reviewed 1 execution memories for this task:',
    '[claude] - [1] mem_loop_aaa — "Loop A" — NOT APPLICABLE because unrelated',
    '[claude] finalized',
  ].join('\n');

  const attempt2 = await verifier.verify({
    taskId: 'task-loop',
    attempt: 2,
    maxAttempts: 3,
    agentType: 'execution',
    rawLogs: attempt2RawLogs,
    executionMemoryContext: memoryContext,
  });
  expect(attempt2.passed).toBe(true);
  expect(attempt2.missingFields).toEqual([]);
});
```

### Step 2: Run the test to confirm it passes

Run: `pnpm -F orchestrator test -- completion-verifier`
Expected: green. The new end-to-end test should pass on the code produced in Tasks 1-2.

### Step 3: Commit

```bash
git add workers/orchestrator/src/services/__tests__/completion-verifier.test.ts
git commit -m "$(cat <<'EOF'
test(orchestrator): pin the auto-continue -> verifier loop

Exercises the full recovery path: verifier rejects attempt 1,
buildMissingFieldsPrompt generates resume instructions that reference
the exact injected memory IDs and the bullet template, a compliant
attempt-2 response then passes the verifier. Catches future drift
between the auto-continue prompt and the acknowledgment regex.
EOF
)"
```

---

## Task 4: Repository-wide CI, branch, push, and PR

**Files:** none (git operations)

### Step 1: Confirm branch and run tracked CI

Run:

```bash
gh pr status 2>/dev/null | head -5 || true
git status --short
git branch --show-current
```

Then from the repo root:

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked.txt
```

Expected: green. If any failure: fix it before moving on.

### Step 2: Create a feature branch if still on `development`

If `git branch --show-current` prints `development`:

```bash
git checkout -b fix/robust-memory-acknowledgment-recovery
```

If already on a feature branch, skip.

### Step 3: Push the branch

```bash
git push -u origin fix/robust-memory-acknowledgment-recovery
```

### Step 4: Open the PR

```bash
gh pr create --base development \
  --title "fix(orchestrator): robust memory_acknowledgment recovery" \
  --body "$(cat <<'EOF'
## Summary

Prevents the orchestrator from terminally failing review/planning/PR tasks solely because the worker omitted the `📋 Execution Memories Received:` block, when the rest of the work succeeded (PR posted, tracker updated, CI green).

## Motivation

Task `task_7a5ec639-984f-465d-8315-f6df16093c09` (GLM review of PR #1874) completed the real review on attempt 1 but was terminally rejected on all 3 attempts with `Missing fields: memory_acknowledgment`. Investigation is in `docs/superpowers/plans/2026-04-18-robust-memory-acknowledgment-recovery.md`.

Root cause: the auto-continue prompt said "add memory_ids_used/rejected/summary" — three *different* checks from `memory_acknowledgment`. Compliant workers produced fields that still failed the acknowledgment gate. Even with a correct prompt, a finicky worker can drop the block; failing an otherwise-complete task on audit bookkeeping is hostile.

## Changes

1. `buildMissingFieldsPrompt` now takes the injected-memory context. When `memory_acknowledgment` is flagged, the auto-continue prompt includes the exact bullet template **and** the list of injected memory IDs the worker must acknowledge.
2. `validateMemoryReporting` now separates `failures` from `softWarnings`. `memory_acknowledgment` is a soft warning when the triplet (`memory_ids_used ∪ memory_ids_rejected == injectedIds`, no overlap, non-empty `memory_usage_summary`) is consistent. Any triplet defect keeps it a hard failure so the auto-continue loop can recover.
3. End-to-end regression test pinning the loop: verifier rejects → prompt references injected IDs + template → compliant response passes the verifier.

## Evidence referenced

- Failing task doc + logs: `task_7a5ec639-984f-465d-8315-f6df16093c09`
- Verifier regex: `workers/orchestrator/src/services/completion-verifier.ts:551-554`
- Current auto-continue prompt source: `workers/orchestrator/src/services/task-dispatcher.ts:71-110`
- Plan document: `docs/superpowers/plans/2026-04-18-robust-memory-acknowledgment-recovery.md`

## Test plan

- [x] `pnpm -F orchestrator test -- task-dispatcher completion-verifier`
- [x] `pnpm run ci:tracked`
- [ ] Post-merge: watch a freshly dispatched review task with ≥1 injected memory reach `completed` on attempt 1 without `memory_acknowledgment` in orchestrator logs.
EOF
)"
```

### Step 5: Report the PR URL back to the user

The URL is printed by `gh pr create`. Copy it to the final message.

---

## Self-Review

**Spec coverage:**
- Fix #1 (auto-continue prompt gap) → Task 1.
- Fix #2 (soft-fail when triplet consistent) → Task 2.
- Fix #3 (regression test for the loop) → Task 3.
- Commit/push/PR → Task 4.

**Placeholder scan:** no TBD / TODO / placeholder text. Every step has concrete code and concrete commands.

**Type consistency:**
- `ExecutionMemoryPromptContext` used in Task 1 is the same import from `../types/execution-memory.js` as in `completion-verifier.ts`.
- `MemoryReportingValidationResult` is defined in Task 2 Step 3 and consumed in Task 2 Step 4. The end-to-end test in Task 3 does not reference the internal type — it asserts through `result.passed` and `result.missingFields`.
- `buildMemoryAcknowledgmentGuidance` is declared and called inside `buildMissingFieldsPrompt` in the same file.

**Risk / blast radius:**
- `buildMissingFieldsPrompt` adds an optional parameter — backward compatible with every existing caller. Only production caller is updated in Task 1 Step 5.
- `validateMemoryReporting` is a file-local helper, only called from one site (`doVerify`). Changing its return type is a local refactor.
- No behavior change for tasks without injected memories, no behavior change for tasks with triplet defects — the hard-failure path for those cases is preserved.
