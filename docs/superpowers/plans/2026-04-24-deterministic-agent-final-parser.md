# Deterministic `*_AGENT_FINAL` Parser + Contract Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM-based completion verifier with a deterministic parser that extracts structured fields directly from the agent's own `*_AGENT_FINAL:` block. Align the agent/verifier field-name contract, enforce deliverable fields (`outcome`, `pr`, `summary`) as required, treat memory telemetry as warn-only, and route missing-block cases to `TASK_RUNTIME_HARD_ERROR`.

**Architecture:** Synchronous 3-stage pipeline — `locateFinalBlock` → `parseKeyValues` → `coerceFields`. Single source of truth for the agent contract (`contracts.ts`) consumed by both the prompt builders and the parser. The LLM is fully removed from the verification path; the verifier becomes a pure function. Tier-aware enforcement (Opus/Sonnet/auto = strict, GLM/MiniMax/codex/etc. = lenient) is driven by the existing `WORKER_TYPES.telemetryExpectation` table.

**Tech Stack:** TypeScript, Vitest, pnpm workspace (`@intexuraos/orchestrator`). No new runtime dependencies — pure regex + string parsing. Real production fixtures (130) already staged at `workers/orchestrator/src/__tests__/fixtures/completion-verifier/`.

---

## Why This Plan

### The bug

Production task `task_5946dce4-b1b6-46b2-9576-10f316bfdbd4` (Linear INT-1441) failed with `TASK_COMPLETION_VERIFICATION_FAILED: Missing fields: memory_ids_used, memory_ids_rejected` despite the agent emitting a well-formed `EXECUTION_AGENT_FINAL` block with populated memory fields. Full transcript in fixture `execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.txt`.

### Root cause

Two naming conventions exist for the same fields:

| Surface                      | File                                                                                    | Field name                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Execution agent emission     | `workers/orchestrator/src/services/prompts/execution-prompt.ts:164-166`                 | `execution_memory_ids_used` / `_rejected` / `_usage_summary` |
| Verifier LLM prompt + schema | `workers/orchestrator/src/services/completion-verifier/prompt-builder.ts`, `schemas.ts` | `memory_ids_used` / `_rejected` / `_usage_summary`           |
| Webhook output               | `task-dispatcher/webhook-callbacks.ts:71-73`                                            | `execution_memory_ids_used` (on wire)                        |

All other agents (planning, review, remediation, pull_request) already use the unprefixed names on both sides. Execution is the outlier. A weak verifier LLM (`or:google/gemma-4-31b-it`) is implicitly expected to rename `execution_memory_ids_used` → `memory_ids_used` when producing its JSON verdict. It often fails. After PR #1928 relaxed the verifier schema to `.optional().default('')`, the failure became silent — Zod succeeds with empty strings, and `detectEmptyMemoryFields` then flags the agent as non-compliant.

### The fix, in one sentence

Remove the LLM from the field-extraction role entirely; parse the agent's `*_AGENT_FINAL:` block directly. Structured. Synchronous. Deterministic.

### Scope boundaries

- **In scope:** completion verifier rewrite, contract unification, fixture-driven tests, dispatcher adjustments for the missing-block → hard-error routing.
- **Out of scope:** changing the tiered `required|optional` classification in `WORKER_TYPES` (keep as-is), the `decideCompletionOutcome` state machine (keep as-is), the auto-continue resume-prompt mechanism for *deliverable* misses (keep as-is; only the memory-field branch is removed).
- **Not shipped here:** any change to the webhook output contract. The wire format to external consumers (`execution_memory_ids_used`) is preserved.

---

## Ground-Truth Dataset

The repo now contains 130 real production `*_AGENT_FINAL` blocks harvested from Firestore `code_tasks/<taskId>/log_lines` between 2026-04-20 and 2026-04-24, staged at:

```
workers/orchestrator/src/__tests__/fixtures/completion-verifier/
├── index.json                    # Harvester manifest: taskId, agent, worker, status, error
├── execution/
│   ├── auto/    (9 .txt)
│   ├── glm/     (1 .txt)
│   ├── minimax/ (1 .txt)
│   └── opus/    (25 .txt)
├── planning/
│   ├── auto/    (2 .txt)
│   ├── codex/   (1 .txt)
│   ├── codex-xhigh/ (1 .txt)
│   ├── glm/     (1 .txt)
│   └── opus/    (6 .txt)
├── pull_request/
│   ├── auto/    (2 .txt)
│   └── opus/    (1 .txt)
├── remediation/
│   └── auto/    (13 .txt)
└── review/
    ├── glm/     (46 .txt)
    └── sonnet/  (21 .txt)
```

Each `.txt` is the raw block exactly as it appeared in the transcript, including markdown decoration, log-driver prefixes, and code-fence wrapping where present.

**Every non-trivial assertion in the new test suite is backed by one of these fixtures.** No hand-fabricated expected values. The expected field values are captured via a golden-file workflow (Task 2.9) that freezes the parser's first output on each fixture as `<taskId>.expected.json`, then asserts equality on every subsequent run.

Known adversarial fixtures (covered by dedicated tests):

| Fixture                                                           | Quirk                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.txt`    | The original failing task; baseline regression test                            |
| `execution/minimax/task_24eb987c-361e-4973-90a8-229e7432b645.txt` | `**bold**` wrapping on marker and every value                                  |
| `review/sonnet/task_7c90204e-72fa-4975-bbd1-20376b0c592e.txt`     | Trailing backtick on marker line                                               |
| `review/glm/task_2345c988-1cba-452f-b70a-5822252611eb.txt`        | Literal `none` for all memory fields                                           |
| `execution/auto/task_7a34239f-b458-42e0-a324-244c7cf203ba.txt`    | 15-line multi-bullet summary, multi-line subagents value                       |
| `execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.txt`    | False-positive marker buried inside a test-file diff — parser must reject this |

---

## File Structure

### New files

| Path                                                                                   | Responsibility                                                                                             |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/completion-verifier/contracts.ts`                   | Single source of truth: `AGENT_CONTRACTS`, `TIER_BY_WORKER`, field kinds, required/optional split, aliases |
| `workers/orchestrator/src/services/completion-verifier/block-parser.ts`                | Pure parser: `locateFinalBlock`, `parseKeyValues`, `coerceFields`                                          |
| `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` | Fixture-parametric tests + edge cases                                                                      |
| `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`    | Contract round-trip test (agent prompt ↔ parser contract)                                                  |
| `workers/orchestrator/src/__tests__/fixtures/completion-verifier/**/*.txt`             | 130 real production blocks (already staged by this plan PR)                                                |
| `workers/orchestrator/src/__tests__/fixtures/completion-verifier/**/*.expected.json`   | Golden parser outputs (generated by Task 2.9)                                                              |

### Modified files

| Path                                                                                      | Change                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/prompts/execution-prompt.ts`                           | Rename `execution_memory_*` → `memory_*`                                                                                                              |
| `workers/orchestrator/src/services/__tests__/__snapshots__/execution-prompt.test.ts.snap` | Accept the renamed output                                                                                                                             |
| `workers/orchestrator/src/services/completion-verifier.ts`                                | Rewrite to synchronous parser-only pipeline                                                                                                           |
| `workers/orchestrator/src/services/completion-verifier/schemas.ts`                        | Reduce to pure TypeScript interfaces; delete all Zod                                                                                                  |
| `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`              | Keep `detectEmptyMemoryFields`, `isTelemetryField`, `partitionMissingFields`; delete `validateMemoryReporting` and `buildMemoryAcknowledgmentPattern` |
| `workers/orchestrator/src/services/completion-verifier/types.ts`                          | Drop `verifierFailure`, `succeededModelName`, `trace` fields from `CompletionVerifierVerdict` (parser has no LLM)                                     |
| `workers/orchestrator/src/services/task-dispatcher.ts`                                    | Call verifier synchronously; route `missingFinalBlock` verdicts to `TASK_RUNTIME_HARD_ERROR` classification                                           |
| `workers/orchestrator/src/services/task-dispatcher/prompts.ts`                            | Remove the "EXECUTION MEMORY REPORTING FAILURE" resume-prompt branch                                                                                  |
| `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`                     | Simplify: drop `retry-verifier`/`fail-verifier` outcome variants (no LLM to fail)                                                                     |

### Deleted files

| Path                                                                              | Reason                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------- |
| `workers/orchestrator/src/services/completion-verifier/prompt-builder.ts`         | LLM extraction path removed                        |
| `workers/orchestrator/src/services/completion-verifier/llm-client.ts`             | LLM extraction path removed                        |
| `workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts` | Zod schemas gone; replaced by block-parser.test.ts |

---

## Testing Strategy (Read This Before Writing Code)

1. **Fixture-parametric tests are the spine.** Every fixture in `__tests__/fixtures/completion-verifier/` feeds the parser inside a single `it.each` block. If any real production block stops parsing cleanly, CI fails. This is the only acceptance gate that matters.
2. **Golden `.expected.json` files replace hand-written expected values.** The first run of Task 2.9 writes `.expected.json` next to each `.txt`. Subsequent runs do a deep-equal check. Reviewers read the `.expected.json` files as the "contract in data form". If a parser change intentionally alters output, you regenerate the goldens in one step (Task 2.9's regen command) — the diff in the PR is the semantic change.
3. **No mocks.** The parser is pure (string in, record out). No network, no timers, no filesystem. Integration tests that run the whole verifier pipeline use the parser directly without any LLM stub — because there is no LLM.
4. **Negative fixtures live alongside positives.** `execution/opus/task_536a87b7-*` (false-positive marker inside a diff) is a required negative case: `locateFinalBlock` must return `null` on it.
5. **One test per field kind.** `coerceFields` has cases for `string | url | int | bool01 | csv | enum`. Each kind has a dedicated unit test driving every branch of its coercion logic, plus one fixture that exercises the kind naturally.

---

## Task Index

- **Phase 0 — Seed (fixtures + plan already in this PR).** No tasks; this PR lands the fixtures and the plan. Implementation begins in a follow-up PR.
- **Phase 1 — Contract alignment (behavior-preserving).**
  - Task 1.1: Create `contracts.ts` with the canonical field table.
  - Task 1.2: Rename execution agent's memory fields in `execution-prompt.ts`.
  - Task 1.3: Add `contracts.test.ts` — round-trip guarantee.
- **Phase 2 — Parser (new module).**
  - Task 2.1: Implement `locateFinalBlock`.
  - Task 2.2: Implement `parseKeyValues`.
  - Task 2.3: Implement `coerceFields`.
  - Task 2.4: Fixture golden-file test harness.
- **Phase 3 — Verifier cutover.**
  - Task 3.1: Rewrite `completion-verifier.ts`.
  - Task 3.2: Shrink `schemas.ts` to pure types.
  - Task 3.3: Prune `memory-validation.ts`.
  - Task 3.4: Delete `prompt-builder.ts` and `llm-client.ts`.
  - Task 3.5: Drop `trace`, `verifierFailure`, `succeededModelName` from verdict.
- **Phase 4 — Dispatcher routing.**
  - Task 4.1: Missing-block → `TASK_RUNTIME_HARD_ERROR`.
  - Task 4.2: Remove telemetry-only resume prompt.
  - Task 4.3: Simplify `decideCompletionOutcome`.
- **Phase 5 — Regression guards.**
  - Task 5.1: Replay `task_5946dce4` end-to-end; assert `accepted`.
  - Task 5.2: Replay every fixture through the full verifier path.
- **Phase 6 — Ship.**
  - Task 6.1: Run `pnpm run ci:tracked`; fix any failures root-cause.
  - Task 6.2: Open PR targeting `development`.

---

## Phase 1 — Contract Alignment

### Task 1.1: Create `contracts.ts`

**Files:**
- Create: `workers/orchestrator/src/services/completion-verifier/contracts.ts`

- [ ] **Step 1: Write the failing test first.**

Create `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AGENT_CONTRACTS, TIER_BY_WORKER, type AgentContract } from '../../../services/completion-verifier/contracts.js';
import type { CompletionAgentType } from '../../../services/completion-verifier/schemas.js';

describe('contracts — canonical field table', () => {
  const expectedAgents: CompletionAgentType[] = [
    'planning',
    'execution',
    'review',
    'remediation',
    'pull_request',
  ];

  it('has a contract for every verifiable agent type', () => {
    for (const agent of expectedAgents) {
      expect(AGENT_CONTRACTS[agent], `missing contract for ${agent}`).toBeDefined();
    }
  });

  it('every contract has a unique marker', () => {
    const markers = expectedAgents.map((a) => AGENT_CONTRACTS[a].marker);
    expect(new Set(markers).size).toBe(markers.length);
  });

  it('every contract requires outcome, pr (or linear_url for planning), and summary as deliverable fields', () => {
    for (const agent of expectedAgents) {
      const c: AgentContract = AGENT_CONTRACTS[agent];
      const requiredNames = c.fields.filter((f) => f.required).map((f) => f.name);
      expect(requiredNames).toContain('summary');
      if (agent === 'planning') {
        expect(requiredNames).toContain('linear_url');
      } else if (agent === 'review') {
        expect(requiredNames).toContain('pr');
        expect(requiredNames).toContain('review_id');
      } else {
        expect(requiredNames).toContain('outcome');
        expect(requiredNames).toContain('pr');
      }
    }
  });

  it('memory fields are NEVER required (telemetry-only, warn-only)', () => {
    for (const agent of expectedAgents) {
      const c = AGENT_CONTRACTS[agent];
      const memoryFields = c.fields.filter((f) =>
        ['memory_ids_used', 'memory_ids_rejected', 'memory_usage_summary'].includes(f.name)
      );
      for (const f of memoryFields) {
        expect(f.required, `${agent}.${f.name} must not be required`).toBe(false);
      }
    }
  });

  it('tier table covers every known WorkerType', () => {
    const workerTypes = [
      'opus',
      'sonnet',
      'auto',
      'glm',
      'minimax',
      'codex',
      'codex-xhigh',
      'kimi',
      'qwen',
      'mimo-pro',
      'openrouter-free',
    ] as const;
    for (const w of workerTypes) {
      expect(TIER_BY_WORKER[w], `missing tier for ${w}`).toMatch(/^(required|optional)$/);
    }
    expect(TIER_BY_WORKER.opus).toBe('required');
    expect(TIER_BY_WORKER.sonnet).toBe('required');
    expect(TIER_BY_WORKER.auto).toBe('required');
    expect(TIER_BY_WORKER.glm).toBe('optional');
  });

  it('execution contract accepts `execution_memory_*` aliases for dual-read compatibility', () => {
    const exec = AGENT_CONTRACTS.execution;
    const used = exec.fields.find((f) => f.name === 'memory_ids_used');
    expect(used?.alias).toContain('execution_memory_ids_used');
    const rejected = exec.fields.find((f) => f.name === 'memory_ids_rejected');
    expect(rejected?.alias).toContain('execution_memory_ids_rejected');
    const summary = exec.fields.find((f) => f.name === 'memory_usage_summary');
    expect(summary?.alias).toContain('execution_memory_usage_summary');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm --filter @intexuraos/orchestrator test -- contracts.test.ts
```

Expected: FAIL — module `../../../services/completion-verifier/contracts.js` not found.

- [ ] **Step 3: Create the canonical contract module.**

Write `workers/orchestrator/src/services/completion-verifier/contracts.ts`:

```typescript
import type { CompletionAgentType } from './schemas.js';
import type { WorkerType } from '../isolation/types.js';

/** A field in an AGENT_FINAL block. */
export interface FieldSpec {
  /** Canonical field name (agent emits this AND parser reads this). */
  name: string;
  /** Legacy names still accepted during dual-read migration windows. */
  alias?: readonly string[];
  /** How to coerce the raw string value. */
  kind: 'string' | 'url' | 'int' | 'bool01' | 'csv' | 'enum';
  /**
   * Required = part of the deliverable contract. Missing required fields on a
   * tier=required worker produce a hard verification failure. Missing required
   * fields on a tier=optional worker still complete as `accept` with warnings.
   */
  required: boolean;
  /** For kind='enum'. Case-insensitive match. */
  enumValues?: readonly string[];
  /** Values treated as "empty". Default: ['', 'none', 'None', 'N/A', 'n/a']. */
  emptyAliases?: readonly string[];
}

export interface AgentContract {
  /** Literal header line the agent emits, including the trailing colon. */
  marker: string;
  /** Field list in canonical order. */
  fields: readonly FieldSpec[];
}

const DEFAULT_EMPTY_ALIASES = ['', 'none', 'None', 'N/A', 'n/a'] as const;

const MEMORY_FIELDS_STANDARD: readonly FieldSpec[] = [
  { name: 'memory_ids_used', kind: 'csv', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
  { name: 'memory_ids_rejected', kind: 'csv', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
  { name: 'memory_usage_summary', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
];

const MEMORY_FIELDS_EXECUTION: readonly FieldSpec[] = [
  {
    name: 'memory_ids_used',
    alias: ['execution_memory_ids_used'],
    kind: 'csv',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
  {
    name: 'memory_ids_rejected',
    alias: ['execution_memory_ids_rejected'],
    kind: 'csv',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
  {
    name: 'memory_usage_summary',
    alias: ['execution_memory_usage_summary'],
    kind: 'string',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
];

export const AGENT_CONTRACTS: Record<CompletionAgentType, AgentContract> = {
  planning: {
    marker: 'PLANNING_AGENT_FINAL:',
    fields: [
      { name: 'outcome', kind: 'enum', required: true, enumValues: ['planned', 'unclear'] },
      { name: 'superpowers_writing_plans', kind: 'bool01', required: false },
      { name: 'linear_url', kind: 'url', required: true },
      { name: 'is_complex', kind: 'bool01', required: false },
      { name: 'has_plan_doc', kind: 'bool01', required: false },
      { name: 'subtask_urls', kind: 'csv', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'pr_url', kind: 'url', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'unclear_clarification', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'summary', kind: 'string', required: true },
    ],
  },
  execution: {
    marker: 'EXECUTION_AGENT_FINAL:',
    fields: [
      { name: 'outcome', kind: 'enum', required: true, enumValues: ['implemented', 'already_completed', 'failed'] },
      { name: 'pr', alias: ['gh_pr_url', 'PR'], kind: 'url', required: true, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'ci_evidence', alias: ['CI evidence'], kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'linear_issue', alias: ['Linear issue'], kind: 'url', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'review_iterations', alias: ['Review iterations'], kind: 'int', required: false },
      ...MEMORY_FIELDS_EXECUTION,
      { name: 'superpowers_subagent_driven_dev_used', kind: 'bool01', required: false },
      { name: 'superpowers_requesting_code_review_used', kind: 'bool01', required: false },
      { name: 'trivial_task', kind: 'bool01', required: false },
      { name: 'subagents', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'skill_sequence_proof', alias: ['Skill sequence proof'], kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'failure_reason', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  review: {
    marker: 'REVIEW_AGENT_FINAL:',
    fields: [
      { name: 'pr', alias: ['gh_pr_url', 'PR'], kind: 'url', required: true },
      { name: 'review_id', kind: 'string', required: true },
      { name: 'review_comments_posted', kind: 'int', required: false },
      { name: 'review_types', kind: 'csv', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'requirements_tracker_updated', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'gh_actions_status', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'needs_remediation', kind: 'bool01', required: false },
      { name: 'review_body', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      { name: 'review_inline_comments', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  remediation: {
    marker: 'REMEDIATION_AGENT_FINAL:',
    fields: [
      { name: 'outcome', kind: 'enum', required: true, enumValues: ['implemented', 'already_completed'] },
      { name: 'pr', alias: ['gh_pr_url', 'PR'], kind: 'url', required: true },
      { name: 'requires_re_review', kind: 'bool01', required: true },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  pull_request: {
    marker: 'PULL_REQUEST_AGENT_FINAL:',
    fields: [
      { name: 'pr', alias: ['gh_pr_url', 'PR'], kind: 'url', required: true },
      { name: 'comments_replied', kind: 'enum', required: false, enumValues: ['yes', 'no'] },
      { name: 'tracking_comment_id', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  ask_agent: {
    // ask_agent does not emit an AGENT_FINAL block; kept for type exhaustiveness.
    marker: '',
    fields: [],
  },
};

export type TelemetryExpectation = 'required' | 'optional';

export const TIER_BY_WORKER: Record<WorkerType, TelemetryExpectation> = {
  opus: 'required',
  sonnet: 'required',
  auto: 'required',
  glm: 'optional',
  minimax: 'optional',
  codex: 'optional',
  'codex-xhigh': 'optional',
  kimi: 'optional',
  qwen: 'optional',
  'mimo-pro': 'optional',
  'openrouter-free': 'optional',
};
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm --filter @intexuraos/orchestrator test -- contracts.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add workers/orchestrator/src/services/completion-verifier/contracts.ts \
        workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): add canonical AGENT_FINAL contract module

Single source of truth for agent-emitted field schema, accepted aliases
(dual-read for execution's legacy execution_memory_* prefix), and
worker-type tier classification. Not yet consumed; consumers added in
follow-up tasks.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 1.2: Rename execution agent's memory fields

**Files:**
- Modify: `workers/orchestrator/src/services/prompts/execution-prompt.ts:164-166`
- Modify: `workers/orchestrator/src/services/__tests__/__snapshots__/execution-prompt.test.ts.snap`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts:517-519` (references the legacy names)

- [ ] **Step 1: Read the current execution-prompt template to confirm exact lines.**

```bash
sed -n '155,175p' workers/orchestrator/src/services/prompts/execution-prompt.ts
```

Expected to show:
```
EXECUTION_AGENT_FINAL:
...
- execution_memory_ids_used: <comma-separated list or "none">
- execution_memory_ids_rejected: <comma-separated list or "none">
- execution_memory_usage_summary: <brief note, or "none">
```

- [ ] **Step 2: Add a failing regression test in `contracts.test.ts`.**

Append to `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts`:

```typescript
import { buildExecutionPrompt } from '../../../services/prompts/execution-prompt.js';

describe('contracts — round-trip with prompt builder', () => {
  it('execution prompt emits canonical memory_ids_* names (no execution_ prefix)', () => {
    const prompt = buildExecutionPrompt({
      continuationPrNumber: undefined,
      linearIssueId: 'INT-0001',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
    });
    expect(prompt).toContain('- memory_ids_used:');
    expect(prompt).toContain('- memory_ids_rejected:');
    expect(prompt).toContain('- memory_usage_summary:');
    expect(prompt).not.toContain('- execution_memory_ids_used:');
    expect(prompt).not.toContain('- execution_memory_ids_rejected:');
    expect(prompt).not.toContain('- execution_memory_usage_summary:');
  });
});
```

(If `buildExecutionPrompt`'s signature differs, open `execution-prompt.ts` and match the real export. The pattern above is one PromptBuilder call; adapt to the actual API.)

- [ ] **Step 3: Run the test to verify it fails.**

```bash
pnpm --filter @intexuraos/orchestrator test -- contracts.test.ts
```

Expected: FAIL — prompt still contains `execution_memory_ids_used:`.

- [ ] **Step 4: Apply the rename in `execution-prompt.ts:164-166`.**

```typescript
// Change from:
- execution_memory_ids_used: <comma-separated list or "none">
- execution_memory_ids_rejected: <comma-separated list or "none">
- execution_memory_usage_summary: <brief note, or "none">
// To:
- memory_ids_used: <comma-separated list or "none">
- memory_ids_rejected: <comma-separated list or "none">
- memory_usage_summary: <brief note, or "none">
```

- [ ] **Step 5: Bump the PromptBuilder version.**

In the same file, locate the `version:` field on the PromptBuilder declaration and bump minor (new examples/behavior change). E.g. `version: '1.3.0'` → `version: '1.4.0'`. Rule per CLAUDE.md: "major = behavior change, minor = new examples, patch = typos." Rename is a behavior change for downstream consumers that pattern-match the field names — **bump major**. Confirm current version with `grep -n "version:" workers/orchestrator/src/services/prompts/execution-prompt.ts`.

- [ ] **Step 6: Regenerate the execution-prompt snapshot.**

```bash
pnpm --filter @intexuraos/orchestrator test -- execution-prompt.test.ts -u
```

Review the regenerated `__snapshots__/execution-prompt.test.ts.snap` diff: the only changes should be the three renamed lines. Anything else means you touched more than the rename — revert and redo.

- [ ] **Step 7: Update `system-prompt.test.ts` assertions.**

In `workers/orchestrator/src/services/__tests__/system-prompt.test.ts:517-519`, change:

```typescript
// From:
expect(finalBlock).toContain('- execution_memory_ids_used: <comma-separated list or "none">');
expect(finalBlock).toContain(
  '- execution_memory_ids_rejected: <comma-separated list or "none">'
);
// To:
expect(finalBlock).toContain('- memory_ids_used: <comma-separated list or "none">');
expect(finalBlock).toContain('- memory_ids_rejected: <comma-separated list or "none">');
```

- [ ] **Step 8: Run the full orchestrator test suite.**

```bash
pnpm --filter @intexuraos/orchestrator test
```

Expected: all tests pass. Any failure in `task-dispatcher.test.ts` or `webhook-callbacks.test.ts` that still references `execution_memory_*` is expected here — the webhook-callbacks code still reads `agentData.memory_ids_used` (the property, not the wire name), so only tests that hand-construct agent transcripts containing `execution_memory_ids_used` lines need updating. Leave the webhook output wire format unchanged.

- [ ] **Step 9: Commit.**

```bash
git add workers/orchestrator/src/services/prompts/execution-prompt.ts \
        workers/orchestrator/src/services/__tests__/__snapshots__/execution-prompt.test.ts.snap \
        workers/orchestrator/src/services/__tests__/system-prompt.test.ts \
        workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): rename execution_memory_* → memory_* in execution prompt

Aligns the execution agent's emitted field names with planning/review/
remediation/pull_request (which already use memory_ids_used etc.). The
parser (contracts.ts) dual-reads the legacy execution_memory_* alias for
backward compatibility during a 2-release window.

Wire format on the webhook output (execution_memory_ids_used) is
unchanged — this only touches the agent-facing prompt and downstream
parsing.

Bumps execution prompt version (behavior change for pattern-matching
consumers).

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 1.3: Contracts round-trip test (guards against future drift)

**Files:**
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts` (extend)

- [ ] **Step 1: Add the round-trip test at the bottom of `contracts.test.ts`.**

```typescript
import {
  buildPlanningPrompt,
  buildExecutionPrompt,
  buildReviewPrompt,
  buildRemediationPrompt,
  buildPullRequestPrompt,
} from '../../../services/prompts/index.js'; // or the actual barrel — adapt.

/**
 * For every agent contract, the generated system prompt must contain
 * the marker line AND every non-aliased field name. This is the regression
 * guard that would have caught the original execution_memory_* /
 * memory_ids_used split.
 */
describe('contracts — round-trip with every agent prompt', () => {
  const cases: Array<{ agent: string; build: () => string }> = [
    { agent: 'planning', build: () => buildPlanningPrompt({ /* minimal valid args */ } as never) },
    { agent: 'execution', build: () => buildExecutionPrompt({ continuationPrNumber: undefined, linearIssueId: 'INT-0001', repository: 'pbuchman/intexuraos', baseBranch: 'development' } as never) },
    { agent: 'review', build: () => buildReviewPrompt({ /* minimal valid args */ } as never) },
    { agent: 'remediation', build: () => buildRemediationPrompt({ /* minimal valid args */ } as never) },
    { agent: 'pull_request', build: () => buildPullRequestPrompt({ /* minimal valid args */ } as never) },
  ];

  it.each(cases)('$agent prompt contains the marker and every contract field', ({ agent, build }) => {
    const prompt = build();
    const contract = AGENT_CONTRACTS[agent as keyof typeof AGENT_CONTRACTS];
    expect(prompt).toContain(contract.marker);
    for (const field of contract.fields) {
      // The prompt template writes "- <name>:" somewhere in the block.
      expect(prompt, `${agent} prompt missing field ${field.name}`).toMatch(
        new RegExp(`- ${field.name}:`)
      );
    }
  });
});
```

**Note to implementer:** the exact arguments to each `build*Prompt` function must match the current signatures. Before writing this test, open each prompt module and copy a minimal valid argument set from its existing tests in `workers/orchestrator/src/services/__tests__/`.

- [ ] **Step 2: Run the test.**

```bash
pnpm --filter @intexuraos/orchestrator test -- contracts.test.ts
```

Expected: PASS. If any field in a contract isn't emitted by the corresponding prompt, this test fails and points to the drift.

- [ ] **Step 3: If any field fails the round-trip, fix it.**

There are two legal fixes:
1. The contract has a field that shouldn't exist → remove it from `contracts.ts`.
2. The prompt template is missing a field the contract declares → add it to the prompt template.

A third, illegal "fix": ignoring the failure. Do not weaken the assertion.

- [ ] **Step 4: Commit.**

```bash
git add workers/orchestrator/src/__tests__/services/completion-verifier/contracts.test.ts
git commit -m "$(cat <<'EOF'
test(orchestrator): add round-trip guard for agent prompt ↔ contract

Every agent contract's marker and field names must appear in the
generated system prompt. This would have caught the original
execution_memory_* / memory_ids_used naming split the day either side
was renamed.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

## Phase 2 — Parser

### Task 2.1: `locateFinalBlock`

**Files:**
- Create: `workers/orchestrator/src/services/completion-verifier/block-parser.ts`
- Create: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateFinalBlock } from '../../../services/completion-verifier/block-parser.js';

const FIXTURE_ROOT = join(__dirname, '../../fixtures/completion-verifier');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURE_ROOT, relPath), 'utf8');
}

describe('locateFinalBlock', () => {
  it('finds EXECUTION_AGENT_FINAL in the clean opus fixture', () => {
    const txt = readFixture('execution/opus/task_46355056-c73e-49a6-9778-4cb71366dcf5.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
  });

  it('finds the marker despite trailing markdown emphasis (minimax)', () => {
    const txt = readFixture('execution/minimax/task_24eb987c-361e-4973-90a8-229e7432b645.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome:');
  });

  it('finds the marker despite trailing backtick (review/sonnet)', () => {
    const txt = readFixture('review/sonnet/task_7c90204e-72fa-4975-bbd1-20376b0c592e.txt');
    const block = locateFinalBlock(txt, 'REVIEW_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- review_id:');
  });

  it('rejects false-positive marker buried in a diff line (task_536a87b7)', () => {
    const txt = readFixture('execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    // Fixture captures a line containing `PULL_REQUEST_AGENT_FINAL:` inside a
    // test-file diff — it's not a real emitted block. Parser must reject.
    expect(block).toBeNull();
  });

  it('returns null when marker is absent', () => {
    expect(locateFinalBlock('no agent block here\nmore text', 'EXECUTION_AGENT_FINAL:')).toBeNull();
  });

  it('takes the LAST marker when multiple exist (agents sometimes draft one before finalizing)', () => {
    const txt = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: failed',
      '- summary: first draft',
      '',
      'wait, trying again',
      '',
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: final version',
    ].join('\n');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
    expect(block).not.toContain('first draft');
  });

  it('strips log-driver prefix like "[claude] " from the marker detection', () => {
    const txt = '[claude] EXECUTION_AGENT_FINAL:\n[claude] - Outcome: implemented\n[claude] - summary: ok';
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `locateFinalBlock`.**

Create `workers/orchestrator/src/services/completion-verifier/block-parser.ts`:

```typescript
import { stripDockerHeaders } from '../log-formatter.js';

/**
 * Locate the last standalone `<MARKER>` line in the transcript and return
 * everything from that line to the end of the block, stripped of log-driver
 * prefixes. The marker must be the dominant content of its own line
 * (optionally wrapped in markdown emphasis, backticks, or a leading
 * log-driver prefix). Markers buried inside diffs or code blocks are
 * ignored.
 *
 * Returns null if no standalone-line marker is present.
 */
export function locateFinalBlock(transcript: string, marker: string): string | null {
  const normalized = stripDockerHeaders(transcript);
  const lines = normalized.split('\n');

  // Match a line whose trimmed content is MARKER, optionally wrapped in:
  //   - leading opening fence: ```  or ```<lang>
  //   - leading markdown emphasis: *, _, `, **, __
  //   - trailing markdown emphasis/backtick/colon artifact: **, *, `, _
  // The marker already contains its trailing `:`.
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    // prettier-ignore
    `^\\s*(?:\`{3}[a-zA-Z_-]*\\s*)?[*_\`]*\\s*${escaped}[*_\`:]*\\s*$`
  );

  let lastMatchIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i] ?? '')) {
      lastMatchIdx = i;
    }
  }
  if (lastMatchIdx < 0) {
    return null;
  }

  // Body = from the marker line through end-of-block.
  // End-of-block triggers (take the first one hit):
  //   - closing code fence ``` on its own line
  //   - another *_AGENT_FINAL: line
  //   - EOF
  const body: string[] = [];
  const anyAgentFinalPattern = /^\s*(?:\[[^\]]+\]\s+)?[*_`]*\s*[A-Z_]+_AGENT_FINAL:[*_`:]*\s*$/;
  for (let i = lastMatchIdx; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (i > lastMatchIdx) {
      if (/^\s*`{3}\s*$/.test(line)) break;
      if (anyAgentFinalPattern.test(line)) break;
    }
    body.push(line);
  }
  return body.join('\n').trimEnd();
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit.**

```bash
git add workers/orchestrator/src/services/completion-verifier/block-parser.ts \
        workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): add locateFinalBlock parser

Standalone-line-only marker detection with log-driver prefix tolerance
and markdown-emphasis tolerance. Rejects false-positive markers buried
inside diffs (fixture: execution/opus/task_536a87b7-...).

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 2.2: `parseKeyValues`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/block-parser.ts` (add)
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` (add)

- [ ] **Step 1: Write the failing tests.**

Append to `block-parser.test.ts`:

```typescript
import { parseKeyValues } from '../../../services/completion-verifier/block-parser.js';

describe('parseKeyValues', () => {
  it('parses simple "- key: value" pairs', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: ok',
    ].join('\n');
    expect(parseKeyValues(block)).toEqual({
      Outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
    });
  });

  it('preserves case in keys (does not normalize)', () => {
    const block = ['EXECUTION_AGENT_FINAL:', '- Outcome: implemented', '- CI evidence: ok'].join('\n');
    expect(parseKeyValues(block)).toHaveProperty('CI evidence', 'ok');
    expect(parseKeyValues(block)).toHaveProperty('Outcome', 'implemented');
  });

  it('strips paired markdown emphasis from values (**, *, `, _)', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: **implemented**',
      '- pr: `https://github.com/x/y/pull/1`',
      '- summary: _ok_',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed.Outcome).toBe('implemented');
    expect(parsed.pr).toBe('https://github.com/x/y/pull/1');
    expect(parsed.summary).toBe('ok');
  });

  it('joins continuation lines (indented under a key) into the value', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- summary:',
      '  * first bullet',
      '  * second bullet',
      '- pr: https://github.com/x/y/pull/1',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed.summary).toBe('\n  * first bullet\n  * second bullet');
    expect(parsed.pr).toBe('https://github.com/x/y/pull/1');
  });

  it('ignores lines that are not "- key: value"', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '',
      'Some narrative in the middle',
      '',
      '- pr: https://github.com/x/y/pull/1',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed.Outcome).toBe('implemented');
    expect(parsed.pr).toBe('https://github.com/x/y/pull/1');
  });

  it('handles the minimax bold-every-value fixture', () => {
    const txt = readFixture('execution/minimax/task_24eb987c-361e-4973-90a8-229e7432b645.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:')!;
    const parsed = parseKeyValues(block);
    expect(parsed.Outcome).toBe('implemented');
    expect(parsed.PR).toBe('https://github.com/pbuchman/intexuraos/pull/1925');
    expect(parsed.execution_memory_ids_used).toMatch(/^mem_463bb567/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: FAIL — `parseKeyValues` not exported.

- [ ] **Step 3: Implement `parseKeyValues`.**

Append to `block-parser.ts`:

```typescript
/**
 * Parse the body of an AGENT_FINAL block into a flat key-value record.
 * Lines matching `^\s*-\s+<key>:\s*<value>$` start a new entry. Indented
 * continuation lines are appended with `\n`. Values have paired outer
 * markdown emphasis (**...**, *...*, `...`, _..._) stripped once.
 *
 * Keys are preserved as-written (case, spaces, underscores all kept).
 * Callers that want canonical lookup should use the alias-aware
 * resolution in coerceFields.
 */
export function parseKeyValues(block: string): Record<string, string> {
  const lines = block.split('\n');
  const result: Record<string, string> = {};
  let currentKey: string | null = null;

  const keyLinePattern = /^\s*-\s+([^:]+?)\s*:\s*(.*)$/;

  for (const line of lines) {
    const match = keyLinePattern.exec(line);
    if (match && !/^\s{2,}/.test(line)) {
      currentKey = match[1]!;
      result[currentKey] = match[2] ?? '';
    } else if (currentKey !== null && /^\s{2,}/.test(line)) {
      // Indented continuation of current key's value.
      result[currentKey] = `${result[currentKey] ?? ''}\n${line}`;
    } else if (currentKey !== null && line.trim() === '') {
      // Blank inside a multi-line value — keep going; terminator is the
      // next keyed line or end of block.
      continue;
    } else {
      // Non-indented line that isn't a key → ends the current value.
      currentKey = null;
    }
  }

  // Strip paired outer emphasis from each final value.
  for (const key of Object.keys(result)) {
    result[key] = stripOuterEmphasis((result[key] ?? '').trim());
  }
  return result;
}

function stripOuterEmphasis(value: string): string {
  let v = value;
  // Peel one layer of ** / __ / * / _ / ` if paired.
  const pairs: [string, string][] = [
    ['**', '**'],
    ['__', '__'],
    ['`', '`'],
    ['*', '*'],
    ['_', '_'],
  ];
  for (const [open, close] of pairs) {
    if (v.startsWith(open) && v.endsWith(close) && v.length >= open.length + close.length) {
      v = v.slice(open.length, v.length - close.length).trim();
      break;
    }
  }
  return v;
}
```

- [ ] **Step 4: Run to verify passing.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: PASS. If the minimax fixture test fails, investigate whether the emphasis-stripping rule needs a second pass (some values are `** **mem_463bb... **`). Do not hide the failure — fix it.

- [ ] **Step 5: Commit.**

```bash
git add workers/orchestrator/src/services/completion-verifier/block-parser.ts \
        workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): add parseKeyValues to block-parser

Parses AGENT_FINAL bodies into flat key-value records. Handles
indented multi-line values (e.g. summary bullet lists, multi-entry
subagents field) and strips one layer of markdown emphasis from values
(covers minimax fixture, which wraps every value in **bold**).

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 2.3: `coerceFields`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/block-parser.ts` (add)
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` (add)

- [ ] **Step 1: Write the failing tests.**

Append to `block-parser.test.ts`:

```typescript
import { coerceFields } from '../../../services/completion-verifier/block-parser.js';
import { AGENT_CONTRACTS } from '../../../services/completion-verifier/contracts.js';

describe('coerceFields', () => {
  it('returns empty-alias coercion for memory csv (none/None/N/A/empty)', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      memory_ids_used: 'none',
      memory_ids_rejected: 'None',
      memory_usage_summary: '',
    };
    const { data, missingRequired, warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toEqual([]);
    expect(warnings).toEqual([]);
    expect(data.memory_ids_used).toEqual([]);
    expect(data.memory_ids_rejected).toEqual([]);
    expect(data.memory_usage_summary).toBe('');
  });

  it('reports missing required fields when absent', () => {
    const record = { outcome: 'implemented', summary: 'ok' }; // no pr
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toContain('pr');
  });

  it('does NOT report pr as missing when outcome=failed (pr is deliverable-optional for failed)', () => {
    const record = { outcome: 'failed', summary: 'interrupted', pr: '' };
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    // Contract marks pr as required, but coerceFields treats empty pr as
    // acceptable when outcome is 'failed'. If the contract doesn't codify
    // this, the test fails and we add an outcome-aware exception.
    expect(missingRequired).not.toContain('pr');
  });

  it('resolves aliases (execution_memory_ids_used → memory_ids_used)', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      execution_memory_ids_used: 'mem_a,mem_b',
      execution_memory_ids_rejected: 'none',
    };
    const { data, warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(data.memory_ids_used).toEqual(['mem_a', 'mem_b']);
    expect(warnings.some((w) => w.includes('execution_memory_ids_used') && w.includes('alias'))).toBe(true);
  });

  it('coerces bool01 from multiple accepted formats', () => {
    const cases: Array<[string, boolean]> = [
      ['0', false],
      ['1', true],
      ['yes', true],
      ['no', false],
      ['true', true],
      ['false', false],
      ['used', true],
      ['not used', false],
      ['not_used', false],
    ];
    for (const [input, expected] of cases) {
      const record = {
        outcome: 'implemented',
        pr: 'https://github.com/x/y/pull/1',
        summary: 'ok',
        trivial_task: input,
      };
      const { data } = coerceFields(record, AGENT_CONTRACTS.execution);
      expect(data.trivial_task, `input ${input}`).toBe(expected);
    }
  });

  it('emits warning (not failure) for malformed int', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      review_iterations: 'two',
    };
    const { data, warnings, missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toEqual([]);
    expect(data.review_iterations).toBeNull();
    expect(warnings.some((w) => w.includes('review_iterations'))).toBe(true);
  });

  it('rejects enum values case-insensitively but reports in canonical case', () => {
    const record = {
      outcome: 'IMPLEMENTED',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
    };
    const { data, missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toEqual([]);
    expect(data.outcome).toBe('implemented');
  });

  it('fails when url field is non-http', () => {
    const record = {
      outcome: 'implemented',
      pr: 'not-a-url',
      summary: 'ok',
    };
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toContain('pr');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: FAIL — `coerceFields` not exported.

- [ ] **Step 3: Implement `coerceFields`.**

Append to `block-parser.ts`:

```typescript
import type { AgentContract, FieldSpec } from './contracts.js';

/** Result of coercing a raw key-value record against an AgentContract. */
export interface CoercionResult {
  /** Typed field values keyed by canonical field name. */
  data: Record<string, unknown>;
  /** Required fields that were absent or failed coercion. */
  missingRequired: string[];
  /** Non-fatal issues (malformed optional values, alias usage, unknown keys). */
  warnings: string[];
}

const BOOL_TRUE = new Set(['1', 'yes', 'true', 'used']);
const BOOL_FALSE = new Set(['0', 'no', 'false', 'not used', 'not_used']);

export function coerceFields(
  record: Readonly<Record<string, string>>,
  contract: AgentContract
): CoercionResult {
  const data: Record<string, unknown> = {};
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  // Resolve the canonical value for each field (check name then aliases).
  const rawFor = (field: FieldSpec): { raw: string | undefined; sourceKey?: string } => {
    if (Object.prototype.hasOwnProperty.call(record, field.name)) {
      return { raw: record[field.name], sourceKey: field.name };
    }
    for (const alias of field.alias ?? []) {
      if (Object.prototype.hasOwnProperty.call(record, alias)) {
        warnings.push(
          `field ${field.name} was read from deprecated alias ${alias}; rename the emitter`
        );
        return { raw: record[alias], sourceKey: alias };
      }
    }
    return { raw: undefined };
  };

  const emptyAliases = (field: FieldSpec): readonly string[] =>
    field.emptyAliases ?? ['', 'none', 'None', 'N/A', 'n/a'];

  const isEmpty = (field: FieldSpec, raw: string | undefined): boolean => {
    if (raw === undefined) return true;
    return emptyAliases(field).includes(raw.trim());
  };

  for (const field of contract.fields) {
    const { raw } = rawFor(field);

    if (isEmpty(field, raw)) {
      // Default values per kind.
      switch (field.kind) {
        case 'csv':
          data[field.name] = [];
          break;
        case 'int':
          data[field.name] = null;
          break;
        case 'bool01':
          data[field.name] = null;
          break;
        default:
          data[field.name] = '';
      }
      if (field.required) {
        // Exception: execution.pr may be empty when outcome='failed'.
        if (
          field.name === 'pr' &&
          contract.marker === 'EXECUTION_AGENT_FINAL:' &&
          (record.outcome ?? '').trim().toLowerCase() === 'failed'
        ) {
          continue;
        }
        missingRequired.push(field.name);
      }
      continue;
    }

    const trimmed = (raw ?? '').trim();

    switch (field.kind) {
      case 'string': {
        data[field.name] = trimmed;
        break;
      }
      case 'url': {
        if (!/^https?:\/\//.test(trimmed)) {
          if (field.required) missingRequired.push(field.name);
          else warnings.push(`field ${field.name} is not an http(s) URL: ${trimmed}`);
          data[field.name] = '';
        } else {
          data[field.name] = trimmed;
        }
        break;
      }
      case 'int': {
        const n = Number.parseInt(trimmed, 10);
        if (Number.isFinite(n) && String(n) === trimmed.replace(/^0+/, (m) => (m.length === trimmed.length ? '0' : ''))) {
          data[field.name] = n;
        } else {
          data[field.name] = null;
          warnings.push(`field ${field.name} not a valid int: ${trimmed}`);
        }
        break;
      }
      case 'bool01': {
        const lower = trimmed.toLowerCase();
        if (BOOL_TRUE.has(lower)) data[field.name] = true;
        else if (BOOL_FALSE.has(lower)) data[field.name] = false;
        else {
          data[field.name] = null;
          warnings.push(`field ${field.name} not a valid bool: ${trimmed}`);
        }
        break;
      }
      case 'csv': {
        data[field.name] = trimmed
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '');
        break;
      }
      case 'enum': {
        const values = field.enumValues ?? [];
        const canonical = values.find((v) => v.toLowerCase() === trimmed.toLowerCase());
        if (canonical === undefined) {
          if (field.required) missingRequired.push(field.name);
          else warnings.push(`field ${field.name} not in enum: ${trimmed}`);
          data[field.name] = '';
        } else {
          data[field.name] = canonical;
        }
        break;
      }
    }
  }

  // Note keys in record but not in contract → unknown-key warning, not an error.
  const knownNames = new Set<string>();
  for (const f of contract.fields) {
    knownNames.add(f.name);
    for (const a of f.alias ?? []) knownNames.add(a);
  }
  for (const key of Object.keys(record)) {
    if (!knownNames.has(key)) {
      warnings.push(`unknown key in AGENT_FINAL block: ${key}`);
    }
  }

  return { data, missingRequired, warnings };
}
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add workers/orchestrator/src/services/completion-verifier/block-parser.ts \
        workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): add coerceFields with alias resolution

Typed coercion per field kind (string/url/int/bool01/csv/enum) with
contract-defined empty-aliases (none/None/N/A/empty), deprecated-alias
support for execution_memory_* legacy names, and an outcome=failed
exception that lets execution.pr be empty for terminal failures.

Missing required fields populate missingRequired (used by the verifier
for hard-gating). Malformed optional values populate warnings only.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 2.4: Fixture-parametric golden-file test harness

**Files:**
- Modify: `workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts` (add)
- Create: `workers/orchestrator/src/__tests__/fixtures/completion-verifier/**/*.expected.json` (generated)

- [ ] **Step 1: Write the fixture-parametric test.**

Append to `block-parser.test.ts`:

```typescript
import { readdirSync, writeFileSync, existsSync } from 'node:fs';

interface FixtureDescriptor {
  agentType: keyof typeof AGENT_CONTRACTS;
  workerType: string;
  taskId: string;
  txtPath: string;
  expectedPath: string;
}

function discoverFixtures(): FixtureDescriptor[] {
  const out: FixtureDescriptor[] = [];
  const agentTypes = ['execution', 'planning', 'review', 'remediation', 'pull_request'] as const;
  for (const agentType of agentTypes) {
    const agentDir = join(FIXTURE_ROOT, agentType);
    if (!existsSync(agentDir)) continue;
    for (const workerType of readdirSync(agentDir)) {
      const workerDir = join(agentDir, workerType);
      for (const file of readdirSync(workerDir)) {
        if (!file.endsWith('.txt')) continue;
        const taskId = file.replace(/\.txt$/, '');
        out.push({
          agentType,
          workerType,
          taskId,
          txtPath: join(workerDir, file),
          expectedPath: join(workerDir, `${taskId}.expected.json`),
        });
      }
    }
  }
  return out;
}

const REGEN = process.env.REGEN_FIXTURES === '1';

describe('fixture golden-file parser replay', () => {
  const fixtures = discoverFixtures();
  expect(fixtures.length).toBeGreaterThan(100); // sanity

  it.each(fixtures)(
    '$agentType/$workerType/$taskId',
    ({ agentType, txtPath, expectedPath }) => {
      const contract = AGENT_CONTRACTS[agentType];
      const transcript = readFileSync(txtPath, 'utf8');
      const block = locateFinalBlock(transcript, contract.marker);
      expect(block, `no block located in ${txtPath}`).not.toBeNull();
      const record = parseKeyValues(block!);
      const { data, missingRequired, warnings } = coerceFields(record, contract);
      const actual = { data, missingRequired, warnings };

      if (REGEN || !existsSync(expectedPath)) {
        writeFileSync(expectedPath, JSON.stringify(actual, null, 2) + '\n');
      }
      const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as typeof actual;
      expect(actual).toEqual(expected);
    }
  );
});
```

- [ ] **Step 2: Generate the golden files on first run.**

```bash
REGEN_FIXTURES=1 pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: PASS for every fixture. 130 new `.expected.json` files appear under `workers/orchestrator/src/__tests__/fixtures/completion-verifier/**/`.

- [ ] **Step 3: Audit the golden files manually.**

This is the one manual-review step in the whole plan. Open each of these six fixtures' `.expected.json` and confirm the values match the block's visible content:

- `execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.expected.json` (the failing task — must show `missingRequired: []`, memory arrays populated)
- `execution/minimax/task_24eb987c-*.expected.json` (markdown emphasis stripped)
- `review/sonnet/task_7c90204e-*.expected.json` (trailing backtick handled)
- `review/glm/task_2345c988-*.expected.json` (`memory_ids_used: []` from literal `none`)
- `execution/auto/task_7a34239f-*.expected.json` (multi-line summary preserved)
- `remediation/auto/task_29f6da78-*.expected.json` (standard remediation block)

If any of these has `missingRequired` non-empty OR obviously-wrong values (e.g. `pr: ''` when the block clearly has a URL), the parser has a bug. Fix it and regenerate. **Do not commit the goldens without this manual audit — they are the contract.**

- [ ] **Step 4: Verify replay without regen passes.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: PASS (no `REGEN_FIXTURES` → deep-equals against stored goldens).

- [ ] **Step 5: Check for false-positive fixture.**

The `execution/opus/task_536a87b7-*` fixture captured a transcript containing `PULL_REQUEST_AGENT_FINAL:` inside a test-file diff (not a real emitted block). The parametric test will fail on it because `locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:')` returns null. **Exclude it from the parametric loop** by renaming its fixture file to end in `.negative.txt` instead of `.txt`, and add a dedicated negative test.

Rename:

```bash
mv workers/orchestrator/src/__tests__/fixtures/completion-verifier/execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.txt \
   workers/orchestrator/src/__tests__/fixtures/completion-verifier/execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.negative.txt
```

The `discoverFixtures` helper already filters `.txt` only, so `.negative.txt` is skipped.

Add a dedicated negative test in `block-parser.test.ts`:

```typescript
it('negative fixture: task_536a87b7 has no real EXECUTION_AGENT_FINAL block', () => {
  const txt = readFixture('execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.negative.txt');
  expect(locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:')).toBeNull();
});
```

- [ ] **Step 6: Run the full parser suite one more time.**

```bash
pnpm --filter @intexuraos/orchestrator test -- block-parser.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add workers/orchestrator/src/__tests__/fixtures/completion-verifier/ \
        workers/orchestrator/src/__tests__/services/completion-verifier/block-parser.test.ts
git commit -m "$(cat <<'EOF'
test(orchestrator): fixture-parametric golden-file harness for parser

Every real production AGENT_FINAL block in __tests__/fixtures/
completion-verifier/ is parsed and compared to a pinned .expected.json
golden. Regenerate with REGEN_FIXTURES=1 pnpm ... test.

Includes one negative fixture (task_536a87b7, marker inside a test-file
diff) that must NOT be parsed as a real block.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

## Phase 3 — Verifier Cutover

### Task 3.1: Rewrite `completion-verifier.ts`

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/types.ts`
- Modify: `workers/orchestrator/src/__tests__/completion-verifier.test.ts`

- [ ] **Step 1: Write a failing integration test for the new sync verifier.**

Create or extend `workers/orchestrator/src/__tests__/completion-verifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCompletion } from '../services/completion-verifier.js';

const FIXTURE_ROOT = join(__dirname, 'fixtures/completion-verifier');

describe('verifyCompletion — synchronous pipeline', () => {
  it('accepts task_5946dce4 (the original regression)', () => {
    const transcript = readFileSync(
      join(FIXTURE_ROOT, 'execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.txt'),
      'utf8'
    );
    const verdict = verifyCompletion({
      transcript,
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: {
        status: 'matched',
        matchedMemories: [
          { memoryId: 'mem_e5089b28-f805-49cb-a2e5-eb4aeb5e932b' } as never,
          { memoryId: 'mem_9e4de081-6568-465e-8a98-6492041bfa7c' } as never,
          { memoryId: 'mem_bd838570-5194-4f6f-ae63-b676b0f7dba9' } as never,
        ],
      } as never,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
    expect((verdict.data.memory_ids_used as string[]).length).toBeGreaterThan(0);
    expect((verdict.data.memory_ids_rejected as string[]).length).toBeGreaterThan(0);
  });

  it('returns kind=hard-error when no AGENT_FINAL block is present', () => {
    const verdict = verifyCompletion({
      transcript: 'some unrelated transcript with no marker at all',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('hard-error');
    if (verdict.kind !== 'hard-error') return;
    expect(verdict.code).toBe('TASK_RUNTIME_HARD_ERROR');
  });

  it('returns kind=hard-error for fatal exit codes (137 SIGKILL, 139 SIGSEGV)', () => {
    const verdict = verifyCompletion({
      transcript: 'EXECUTION_AGENT_FINAL:\n- Outcome: implemented\n- pr: https://x/y/1\n- summary: ok',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 137,
    });
    expect(verdict.kind).toBe('hard-error');
  });

  it('is synchronous (returns a plain object, not a Promise)', () => {
    const result = verifyCompletion({
      transcript: 'no block',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(result).not.toBeInstanceOf(Promise);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts
```

Expected: FAIL — `verifyCompletion` is a class method returning a Promise; the sync free-function does not exist yet.

- [ ] **Step 3: Define the new Verdict type in `types.ts`.**

Replace the contents of `workers/orchestrator/src/services/completion-verifier/types.ts`:

```typescript
import type { CompletionAgentType } from './schemas.js';
import type { WorkerType } from '../isolation/types.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';

/** Input to the synchronous completion verifier. */
export interface CompletionVerifierInput {
  transcript: string;
  agentType: CompletionAgentType;
  workerType: WorkerType;
  executionMemoryContext: ExecutionMemoryPromptContext | undefined; // @allow-undefined-type -- positional optional, undefined means "no memory injected"
  /** Docker worker exit code; 137/139 short-circuit to hard-error. */
  lastExitCode: number | undefined; // @allow-undefined-type -- positional optional
}

/** Discriminated verdict returned by verifyCompletion. */
export type CompletionVerifierVerdict =
  | {
      kind: 'parsed';
      data: Record<string, unknown>;
      missingRequired: string[];
      telemetryMissing: string[];
      warnings: string[];
    }
  | {
      kind: 'hard-error';
      code: 'TASK_RUNTIME_HARD_ERROR';
      message: string;
    };

// No verifier-LLM failure mode anymore; the verifier is pure.
```

- [ ] **Step 4: Rewrite `completion-verifier.ts` to a thin sync function.**

Replace the contents of `workers/orchestrator/src/services/completion-verifier.ts`:

```typescript
import { locateFinalBlock, parseKeyValues, coerceFields } from './completion-verifier/block-parser.js';
import { AGENT_CONTRACTS } from './completion-verifier/contracts.js';
import { detectEmptyMemoryFields } from './completion-verifier/memory-validation.js';
import type { CompletionVerifierInput, CompletionVerifierVerdict } from './completion-verifier/types.js';

export * from './completion-verifier/contracts.js';
export * from './completion-verifier/schemas.js';
export * from './completion-verifier/types.js';
export { locateFinalBlock, parseKeyValues, coerceFields } from './completion-verifier/block-parser.js';
export { detectEmptyMemoryFields, isTelemetryField, partitionMissingFields } from './completion-verifier/memory-validation.js';

/**
 * Deterministic completion verifier.
 *
 * 1. Fatal exit codes (137/139) → hard-error immediately.
 * 2. Locate the agent's AGENT_FINAL block. Absent → hard-error (routes to
 *    TASK_RUNTIME_HARD_ERROR upstream).
 * 3. Parse and coerce the block against the agent's contract.
 * 4. Check injected memories vs the agent's reported memory_ids_*.
 *
 * No network calls. No LLM. Returns synchronously.
 */
export function verifyCompletion(input: CompletionVerifierInput): CompletionVerifierVerdict {
  const { transcript, agentType, executionMemoryContext, lastExitCode } = input;

  if (lastExitCode === 137 || lastExitCode === 139) {
    return {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: `Fatal worker exit code: ${String(lastExitCode)}`,
    };
  }

  const contract = AGENT_CONTRACTS[agentType];
  if (contract.marker === '') {
    // ask_agent or other non-verifying agent — accept trivially.
    return {
      kind: 'parsed',
      data: {},
      missingRequired: [],
      telemetryMissing: [],
      warnings: [`agent ${agentType} has no contract — verification skipped`],
    };
  }

  const block = locateFinalBlock(transcript, contract.marker);
  if (block === null) {
    return {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: `No ${contract.marker} block in transcript`,
    };
  }

  const record = parseKeyValues(block);
  const { data, missingRequired, warnings } = coerceFields(record, contract);

  const telemetryMissing = detectEmptyMemoryFields(agentType, executionMemoryContext, data) ?? [];

  return {
    kind: 'parsed',
    data,
    missingRequired,
    telemetryMissing,
    warnings,
  };
}
```

- [ ] **Step 5: Run the new test.**

```bash
pnpm --filter @intexuraos/orchestrator test -- completion-verifier.test.ts
```

Expected: PASS (4 tests). Other tests referencing the removed `OrchestratorCompletionVerifier` class will fail — that's Task 3.2's scope.

- [ ] **Step 6: Commit (tests may still be broken elsewhere; fix in 3.2).**

Do not commit yet. Continue to Task 3.2 first; commit the verifier rewrite together with the deletions.

---

### Task 3.2: Delete `prompt-builder.ts`, `llm-client.ts`, Zod from `schemas.ts`

**Files:**
- Delete: `workers/orchestrator/src/services/completion-verifier/prompt-builder.ts`
- Delete: `workers/orchestrator/src/services/completion-verifier/llm-client.ts`
- Delete: `workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/schemas.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`

- [ ] **Step 1: Delete the LLM-era modules.**

```bash
git rm workers/orchestrator/src/services/completion-verifier/prompt-builder.ts \
       workers/orchestrator/src/services/completion-verifier/llm-client.ts \
       workers/orchestrator/src/__tests__/services/completion-verifier/schemas.test.ts
```

- [ ] **Step 2: Rewrite `schemas.ts` to pure types only.**

Replace contents of `workers/orchestrator/src/services/completion-verifier/schemas.ts`:

```typescript
/** Canonical list of agent types the verifier recognizes. */
export type CompletionAgentType =
  | 'planning'
  | 'execution'
  | 'pull_request'
  | 'review'
  | 'remediation'
  | 'ask_agent';
```

All the `*AgentData` interfaces and `*_SCHEMA` exports disappear. Consumers reference the typed output of `coerceFields` instead (which returns `Record<string, unknown>` per the contract; a downstream helper in `contracts.ts` can narrow per agent if we later want stricter typing, but it's not required to ship).

- [ ] **Step 3: Prune `memory-validation.ts`.**

Open `workers/orchestrator/src/services/completion-verifier/memory-validation.ts`. Delete:
- `validateMemoryReporting` function (defense against LLM misreads — obsolete).
- `buildMemoryAcknowledgmentPattern` function (only used by `validateMemoryReporting`).
- `MemoryReportingValidationResult` interface.

Keep:
- `detectEmptyMemoryFields` — update signature to accept coerced data (`Record<string, unknown>`) instead of raw `parsed: unknown`.
- `isTelemetryField`, `partitionMissingFields`, `TELEMETRY_FIELD_NAMES` — still useful for the dispatcher's missing-fields partitioning.

Rewrite `detectEmptyMemoryFields`:

```typescript
/**
 * Returns ['memory_ids_used', 'memory_ids_rejected'] when memories were
 * injected but the agent reported neither using nor rejecting any.
 * Returns undefined when no enforcement is needed.
 *
 * Reads from coerced data (arrays), not raw record (strings).
 */
export function detectEmptyMemoryFields(
  _agentType: CompletionAgentType,
  executionMemoryContext: ExecutionMemoryPromptContext | undefined, // @allow-undefined-type -- positional optional
  data: Record<string, unknown>
): string[] | undefined {
  const hasInjectedMemories =
    executionMemoryContext !== undefined && executionMemoryContext.matchedMemories.length > 0;
  if (!hasInjectedMemories) return undefined;

  const used = Array.isArray(data.memory_ids_used) ? (data.memory_ids_used as string[]) : [];
  const rejected = Array.isArray(data.memory_ids_rejected) ? (data.memory_ids_rejected as string[]) : [];
  if (used.length === 0 && rejected.length === 0) {
    return ['memory_ids_used', 'memory_ids_rejected'];
  }
  return undefined;
}
```

- [ ] **Step 4: Update the memory-validation test.**

Open `workers/orchestrator/src/__tests__/services/completion-verifier/memory-validation.test.ts`. Delete all tests that exercise `validateMemoryReporting` or `buildMemoryAcknowledgmentPattern`. Keep `detectEmptyMemoryFields` tests, but update them to pass coerced data (arrays) instead of raw parsed objects.

Target shape:

```typescript
describe('detectEmptyMemoryFields', () => {
  it('returns undefined when no memories were injected', () => {
    expect(detectEmptyMemoryFields('execution', undefined, { memory_ids_used: [], memory_ids_rejected: [] })).toBeUndefined();
    expect(detectEmptyMemoryFields('execution', { status: 'no-memories', matchedMemories: [] } as never, {})).toBeUndefined();
  });

  it('returns the two field names when memories injected but neither field populated', () => {
    expect(
      detectEmptyMemoryFields(
        'execution',
        { status: 'matched', matchedMemories: [{ memoryId: 'mem_a' } as never] } as never,
        { memory_ids_used: [], memory_ids_rejected: [] }
      )
    ).toEqual(['memory_ids_used', 'memory_ids_rejected']);
  });

  it('returns undefined when at least one memory field is populated', () => {
    expect(
      detectEmptyMemoryFields(
        'execution',
        { status: 'matched', matchedMemories: [{ memoryId: 'mem_a' } as never] } as never,
        { memory_ids_used: ['mem_a'], memory_ids_rejected: [] }
      )
    ).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the test suite.**

```bash
pnpm --filter @intexuraos/orchestrator test
```

Expected: any test still importing from `prompt-builder.ts` / `llm-client.ts` fails. Follow the failures; in most cases the fix is one of:
1. Delete the test (it was testing the LLM path, no longer relevant).
2. Replace the mock-LLM setup with a direct call to `verifyCompletion`.

- [ ] **Step 6: Commit.**

```bash
git add -A workers/orchestrator/src/services/completion-verifier/ \
           workers/orchestrator/src/__tests__/services/completion-verifier/ \
           workers/orchestrator/src/__tests__/completion-verifier.test.ts \
           workers/orchestrator/src/services/completion-verifier.ts
git commit -m "$(cat <<'EOF'
refactor(orchestrator): cut over completion verifier to deterministic parser

- Delete prompt-builder.ts, llm-client.ts (LLM extraction path gone)
- Delete schemas.test.ts (Zod schemas replaced by contracts.ts)
- Shrink schemas.ts to the CompletionAgentType union only
- Prune memory-validation.ts: keep detectEmptyMemoryFields (updated to
  read coerced arrays), delete validateMemoryReporting +
  buildMemoryAcknowledgmentPattern
- Rewrite completion-verifier.ts as sync verifyCompletion(input) →
  { kind: 'parsed', ... } | { kind: 'hard-error', ... }
- Fatal exit codes 137/139 short-circuit to hard-error
- Missing AGENT_FINAL block routes to TASK_RUNTIME_HARD_ERROR

Fixture-parametric tests (Task 2.4) pin the parser against 130 real
production blocks. Regression fixture task_5946dce4 now accepts.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

## Phase 4 — Dispatcher Routing

### Task 4.1: Route missing-block → `TASK_RUNTIME_HARD_ERROR`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Locate the verifier call site.**

```bash
rg -n "completionVerifier\.verify|verifyCompletion\(" workers/orchestrator/src/services/task-dispatcher.ts | head
```

Expected: one `await completionVerifier.verify({ ... })` call. Note the surrounding function name — likely in the `runAttempt` / `runVerificationAndClassify` region around line 1450-1500.

- [ ] **Step 2: Write a failing integration test.**

In `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`, add a new test in the most relevant describe block:

```typescript
it('classifies missing AGENT_FINAL block as TASK_RUNTIME_HARD_ERROR', async () => {
  // Build a dispatcher invocation where the worker returns zero exit and
  // a transcript that has no EXECUTION_AGENT_FINAL marker.
  const { finalize, /* ... existing test harness helpers ... */ } = await dispatchFakeExecutionTask({
    workerStdout: 'some narrative without any agent-final block',
    workerExitCode: 0,
  });
  expect(finalize.status).toBe('failed');
  expect(finalize.error?.code).toBe('TASK_RUNTIME_HARD_ERROR');
  expect(finalize.error?.message).toMatch(/No EXECUTION_AGENT_FINAL: block/);
});
```

(The exact harness function `dispatchFakeExecutionTask` may not exist verbatim — open `task-dispatcher.test.ts` and adapt to the test-suite's existing fake-dispatch utility. Many tests in that file already construct transcripts and invoke the dispatcher end-to-end.)

- [ ] **Step 3: Run to verify failure.**

```bash
pnpm --filter @intexuraos/orchestrator test -- task-dispatcher.test.ts -t "missing AGENT_FINAL"
```

Expected: FAIL — either the wrong error code, or the test harness returns `retry` on a missing block.

- [ ] **Step 4: Update the dispatcher.**

In `task-dispatcher.ts`, replace the `await completionVerifier.verify(...)` call with a synchronous call to `verifyCompletion`:

```typescript
// Previously:
const verdict = await completionVerifier.verify({
  taskId, attempt, agentType, rawLogs, executionMemoryContext, lastExitCode,
});

// After:
const verdict = verifyCompletion({
  transcript: rawLogs,
  agentType,
  workerType,
  executionMemoryContext,
  lastExitCode,
});
```

Then branch on the new discriminator:

```typescript
if (verdict.kind === 'hard-error') {
  logger.warn({ taskId, code: verdict.code, message: verdict.message }, 'Verifier hard error');
  await finalizeTask({
    taskId,
    status: 'failed',
    error: { code: verdict.code, message: verdict.message },
  });
  return;
}
// verdict.kind === 'parsed' — feed into decideCompletionOutcome as before.
const outcome = decideCompletionOutcome({
  verdict: {
    passed: verdict.missingRequired.length === 0,
    missingFields: verdict.missingRequired,
    telemetryMissingFields: verdict.telemetryMissing,
    agentData: verdict.data,
    // verifierFailure always false; removed in Task 4.3
  } as CompletionVerifierVerdict,
  tier: TIER_BY_WORKER[workerType],
  exitCode: lastExitCode,
  attempt,
  maxAttempts: 3,
});
```

Remove the constructor injection of `completionVerifier` if it's now only a free-function call site — check `task-dispatcher.ts` constructor parameters and delete the `completionVerifier` parameter plus its bootstrap wiring (`workers/orchestrator/src/bootstrap/*`).

- [ ] **Step 5: Run the test.**

```bash
pnpm --filter @intexuraos/orchestrator test -- task-dispatcher.test.ts
```

Expected: PASS for the new test. Existing tests that mocked `completionVerifier.verify` must be rewritten to pass the fake transcript directly to the dispatcher (the dispatcher now calls `verifyCompletion` internally). Do this rewrite — do not reintroduce the class just to keep tests passing.

- [ ] **Step 6: Commit.**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts \
        workers/orchestrator/src/bootstrap/ \
        workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "$(cat <<'EOF'
refactor(orchestrator): inline sync verifyCompletion call in dispatcher

The completion verifier is no longer an injectable class — it's a pure
sync function. The dispatcher calls it directly, removing the bootstrap
wiring, the class, and the mock setup in tests.

Missing AGENT_FINAL blocks now classify as TASK_RUNTIME_HARD_ERROR
(joining the infra-failed path from INT-1455) instead of retrying.
This matches the operational reality: agents that don't emit a block
have exited abnormally (rate limits, SIGKILL, container setup failures)
and retrying the same container will produce the same non-emission.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 4.2: Remove the telemetry-only resume prompt

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/prompts.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/prompts.test.ts`

- [ ] **Step 1: Locate the resume prompt.**

```bash
rg -n "EXECUTION MEMORY REPORTING FAILURE|memory_ids_used_invalid" workers/orchestrator/src/services/task-dispatcher/prompts.ts
```

- [ ] **Step 2: Write a failing test asserting the prompt is gone.**

In `workers/orchestrator/src/__tests__/services/task-dispatcher/prompts.test.ts`:

```typescript
it('resume prompt does NOT mention EXECUTION MEMORY REPORTING FAILURE', () => {
  const prompt = buildResumePrompt({
    missingFields: ['memory_ids_used', 'memory_ids_rejected'],
    agentType: 'execution',
  } as never);
  // Telemetry-only retries are gone — the only resume prompt is for
  // deliverable misses (outcome / pr / summary). Telemetry misses are
  // warn-only and never trigger a retry.
  expect(prompt).not.toContain('EXECUTION MEMORY REPORTING FAILURE');
  expect(prompt).not.toContain('memory_ids_used');
});
```

- [ ] **Step 3: Run to verify failure.**

```bash
pnpm --filter @intexuraos/orchestrator test -- prompts.test.ts
```

Expected: FAIL — the old prompt still contains these strings.

- [ ] **Step 4: Remove the branch.**

In `workers/orchestrator/src/services/task-dispatcher/prompts.ts`, delete the block that emits "EXECUTION MEMORY REPORTING FAILURE" and the enumeration of memory fields. The remaining resume prompt only handles deliverable misses (`outcome`, `pr`, `summary`, `linear_url`, etc.).

Also remove the `memory_ids_used_invalid` / `memory_ids_rejected_invalid` entries from whichever set/array enumerates telemetry field names in this file — those were consumed by `validateMemoryReporting`, which no longer exists.

- [ ] **Step 5: Run the test.**

```bash
pnpm --filter @intexuraos/orchestrator test -- prompts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add workers/orchestrator/src/services/task-dispatcher/prompts.ts \
        workers/orchestrator/src/__tests__/services/task-dispatcher/prompts.test.ts
git commit -m "$(cat <<'EOF'
refactor(orchestrator): remove telemetry-only resume-prompt branch

Telemetry misses (memory_ids_used / memory_ids_rejected) are now
warn-only. The resume prompt no longer auto-continues a session to
harass the agent about memory acknowledgment — the agent already
emitted them in its AGENT_FINAL block, or it didn't, and either way
re-running won't change the outcome.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 4.3: Simplify `decideCompletionOutcome`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/decide-outcome.test.ts`

- [ ] **Step 1: Drop the `retry-verifier` / `fail-verifier` outcome variants.**

There's no verifier LLM to fail. In `decide-outcome.ts`:
- Delete `retry-verifier` and `fail-verifier` from the `CompletionOutcome` union.
- Delete the block that checks `verdict.verifierFailure` (the field no longer exists after Task 3.5).
- Delete `verifierFailure` from the `CompletionVerifierVerdict` interface in `types.ts` (which was partially staged in Task 3.1 but may need a second pass here).

Simplified `decideCompletionOutcome`:

```typescript
export function decideCompletionOutcome(input: CompletionOutcomeInput): CompletionOutcome {
  const { verdict, tier, exitCode } = input;
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 3;

  // Fatal exit → terminal.
  const fatalField = findFatalExitField(verdict.missingFields);
  if (fatalField !== undefined) {
    return { kind: 'fail-fatal-exit', field: fatalField };
  }

  // Non-zero exit → override.
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'fail-exit-override', exitCode };
  }

  // Clean pass.
  if (verdict.passed && verdict.agentData !== undefined) {
    return { kind: 'accept', telemetryAccepted: false };
  }

  // Telemetry-only miss + tier=optional → accept with flag.
  const blocking = verdict.missingFields;
  const telemetry = verdict.telemetryMissingFields;
  if (
    blocking.length === 0 &&
    telemetry.length > 0 &&
    verdict.agentData !== undefined &&
    tier === 'optional'
  ) {
    return { kind: 'accept', telemetryAccepted: true };
  }

  // NEW: telemetry-only miss + tier=required → warn + accept.
  // Previous behavior retried 3× and failed. New behavior matches the
  // "skip > fail" principle: the agent did emit a valid deliverable,
  // memory telemetry is optional by policy.
  if (
    blocking.length === 0 &&
    telemetry.length > 0 &&
    verdict.agentData !== undefined &&
    tier === 'required'
  ) {
    return { kind: 'accept', telemetryAccepted: true };
  }

  const allMissing = [...blocking, ...telemetry];
  if (allMissing.length > 0) {
    if (attempt < maxAttempts) {
      return { kind: 'retry', missingFields: allMissing };
    }
    return { kind: 'fail', missingFields: allMissing };
  }

  return { kind: 'fail', missingFields: [] };
}
```

- [ ] **Step 2: Update `decide-outcome.test.ts`.**

The file has 17+ unit tests from #1928. For each:
- Tests asserting `kind: 'retry-verifier'` or `kind: 'fail-verifier'` → delete (outcome is gone).
- Tests asserting tier=required + telemetry-only → change expectation from `retry` to `accept` with `telemetryAccepted: true`.

Add a new explicit test:

```typescript
it('tier=required with only telemetry missing → accept with telemetryAccepted=true', () => {
  const outcome = decideCompletionOutcome({
    verdict: {
      passed: false,
      missingFields: [],
      telemetryMissingFields: ['memory_ids_used', 'memory_ids_rejected'],
      agentData: { outcome: 'implemented' } as never,
    },
    tier: 'required',
    exitCode: 0,
  });
  expect(outcome).toEqual({ kind: 'accept', telemetryAccepted: true });
});
```

- [ ] **Step 3: Run the test suite.**

```bash
pnpm --filter @intexuraos/orchestrator test -- decide-outcome.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add workers/orchestrator/src/services/task-dispatcher/decide-outcome.ts \
        workers/orchestrator/src/__tests__/services/task-dispatcher/decide-outcome.test.ts \
        workers/orchestrator/src/services/completion-verifier/types.ts
git commit -m "$(cat <<'EOF'
refactor(orchestrator): simplify decideCompletionOutcome

- Drop retry-verifier / fail-verifier variants (no LLM to fail)
- Drop verifierFailure field from CompletionVerifierVerdict
- Tier=required + telemetry-only miss → accept with
  telemetryAccepted=true (was: retry 3× then fail). Matches the
  "skip > fail" principle: the agent emitted a valid deliverable; the
  memory fields are optional policy, not a hard gate.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

## Phase 5 — Regression Guards

### Task 5.1: End-to-end replay of `task_5946dce4`

**Files:**
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Add the replay test.**

Append to `task-dispatcher.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('regression — task_5946dce4 (INT-1441) accepts with new verifier', async () => {
  const transcript = readFileSync(
    join(__dirname, 'fixtures/completion-verifier/execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.txt'),
    'utf8'
  );
  const { finalize } = await dispatchFakeExecutionTask({
    workerStdout: transcript,
    workerExitCode: 0,
    workerType: 'opus',
    executionMemoryContext: {
      status: 'matched',
      matchedMemories: [
        { memoryId: 'mem_e5089b28-f805-49cb-a2e5-eb4aeb5e932b' },
        { memoryId: 'mem_9e4de081-6568-465e-8a98-6492041bfa7c' },
        { memoryId: 'mem_bd838570-5194-4f6f-ae63-b676b0f7dba9' },
      ],
    },
  });
  expect(finalize.status).toBe('implemented');
  expect(finalize.error).toBeUndefined();
  // Memory fields populated (this would have been reported "missing" under the old LLM verifier).
  expect(finalize.agentData?.memory_ids_used).toContain('mem_e5089b28-f805-49cb-a2e5-eb4aeb5e932b');
});
```

- [ ] **Step 2: Run.**

```bash
pnpm --filter @intexuraos/orchestrator test -- task-dispatcher.test.ts -t "task_5946dce4"
```

Expected: PASS. If it fails, do not work around — the whole point of this refactor is that this task must accept. Investigate.

- [ ] **Step 3: Commit.**

```bash
git add workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "$(cat <<'EOF'
test(orchestrator): regression test for task_5946dce4 (INT-1441)

The original failing task's raw transcript, replayed through the new
sync dispatcher end-to-end, must accept with populated memory arrays.
This test would have failed before this refactor and would have caught
the regression pre-merge if it had existed when PR #1928 landed.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

### Task 5.2: Replay every fixture through the dispatcher

**Files:**
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Add the parametric end-to-end replay.**

```typescript
describe('full-dispatcher fixture replay', () => {
  const fixtures = discoverFixtures(); // reuse helper from block-parser.test.ts, or duplicate inline
  it.each(fixtures)(
    '$agentType/$workerType/$taskId dispatches without hard-error',
    async ({ agentType, workerType, txtPath, expectedPath }) => {
      const transcript = readFileSync(txtPath, 'utf8');
      const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
      const hasDeliverable = expected.missingRequired.length === 0;
      const { finalize } = await dispatchFakeTask({
        agentType,
        workerType,
        workerStdout: transcript,
        workerExitCode: 0,
      });
      if (hasDeliverable) {
        expect(finalize.status).not.toBe('failed');
      } else {
        // Blocks with missing required fields should produce either retry
        // (not terminal) or a failed-terminal with matching missingFields,
        // NOT a TASK_RUNTIME_HARD_ERROR.
        expect(finalize.error?.code).not.toBe('TASK_RUNTIME_HARD_ERROR');
      }
    }
  );
});
```

- [ ] **Step 2: Run. Fix per-fixture regressions by investigating root cause.**

```bash
pnpm --filter @intexuraos/orchestrator test -- task-dispatcher.test.ts -t "fixture replay"
```

Any failure means a real production block now rejects. Fix the parser or contract, not the fixture. Regenerate goldens only after root-cause analysis.

- [ ] **Step 3: Commit.**

```bash
git add workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "$(cat <<'EOF'
test(orchestrator): full-dispatcher replay of all 130 fixtures

Every real production AGENT_FINAL block dispatched end-to-end through
the orchestrator must either accept or cleanly fail with
missingFields — never TASK_RUNTIME_HARD_ERROR (which is reserved for
transcripts with no block at all).

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

---

## Phase 6 — Ship

### Task 6.1: Full CI gate

**Files:** n/a (verification only)

- [ ] **Step 1: Run the full tracked CI from the repo root.**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-deterministic-parser.txt
```

- [ ] **Step 2: Inspect failures.**

```bash
rg "error|FAIL" /tmp/ci-output-deterministic-parser.txt -C3 | head -200
```

- [ ] **Step 3: Fix any failure root-cause.**

Per CLAUDE.md §Commit Gate: if anything in any workspace fails, fix it or ask the user. Do not commit until ALL resolved. Common failure shapes to expect:
- **Coverage under 100%** on `block-parser.ts` — add tests for uncovered branches (likely the `isEmpty` false-path for an unknown kind — should be unreachable; mark with `/* v8 ignore next */` only if unreachable by construction, with a concrete `ts-type` justification).
- **`noUncheckedIndexedAccess` complaint** on array access in the parser — add `?? ''` fallbacks.
- **Snapshot drift** in any unrelated service — a sign the rename in Task 1.2 had side-effects; read the diff and either revert the unintended change or update the snapshot with justification.

- [ ] **Step 4: Re-run until green.**

```bash
pnpm run ci:tracked
```

Expected: all phases green.

---

### Task 6.2: Open PR

**Files:** n/a (git + gh)

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feature/deterministic-agent-final-parser
```

- [ ] **Step 2: Open the PR.**

Per the user's directive and CLAUDE.md: do NOT create a Linear issue manually — the GitHub→Linear webhook creates one automatically when the PR opens.

```bash
gh pr create --base development --title "Deterministic AGENT_FINAL parser + contract alignment" --body "$(cat <<'EOF'
## Summary
- Removes the LLM from completion verification. The verifier now deterministically parses the agent's own `*_AGENT_FINAL:` block in three synchronous stages: `locateFinalBlock` → `parseKeyValues` → `coerceFields`.
- Aligns agent/verifier field names: rename `execution_memory_*` → `memory_*` in the execution agent prompt (dual-read alias kept for 2 releases). Every other agent already used the unprefixed form.
- Introduces `contracts.ts` as the single source of truth for agent contracts (required vs optional fields, tier-by-worker table). Enforced by a prompt↔contract round-trip test that would have caught the original drift.
- Regression fixture `execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.txt` (INT-1441) now accepts with populated memory arrays. Before: `TASK_COMPLETION_VERIFICATION_FAILED: Missing fields: memory_ids_used, memory_ids_rejected`. After: `accept`.

## Why
Production task INT-1441 failed with 3-attempt retry + terminal fail despite the agent emitting a well-formed `EXECUTION_AGENT_FINAL` block with populated `execution_memory_ids_used` and `execution_memory_ids_rejected`. The weak verifier LLM (`google/gemma-4-31b-it`) was implicitly asked to rename `execution_memory_*` → `memory_*` when producing its JSON verdict and silently failed. PR #1928's relaxation to `.optional().default('')` turned the rename failure into "agent forgot telemetry", masking the real bug.

## Key decisions
- **LLM fully removed from verification path.** Missing `AGENT_FINAL` block → `TASK_RUNTIME_HARD_ERROR` (joins the INT-1455 infra-failed classification). No LLM fallback; if the agent didn't emit a block, it infra-failed.
- **`summary` is now a required deliverable field** for every agent. Every one of the 130 harvested fixtures has a non-empty summary; no retroactive failures.
- **Telemetry misses are warn-only for both tiers.** The LLM miscount failure mode is gone, so empty memory fields can only mean the agent omitted them — rare on Opus/Sonnet, not worth retrying. Decision codified in `decideCompletionOutcome`.
- **130 real production fixtures** are the test spine. Every bucket of `(agentType, workerType)` is represented with at least one fixture. Golden `.expected.json` files capture the parser contract in data form; regenerate with `REGEN_FIXTURES=1`.

## Test plan
- [x] `pnpm --filter @intexuraos/orchestrator test` — all orchestrator tests pass (baseline + 130 fixture-parametric tests + regression test for `task_5946dce4`).
- [x] `pnpm run ci:tracked` — all phases green (typecheck, lint, tests, coverage, v8-ignore, static validation, build, format).
- [ ] Manual (post-merge): dispatch an Opus execution task that emits a clean `EXECUTION_AGENT_FINAL` block → verify `status=implemented`, no retry, no LLM call in orchestrator logs.
- [ ] Manual (post-merge): dispatch a GLM review task that emits a clean `REVIEW_AGENT_FINAL` → verify `status=reviewed`.
- [ ] Manual (post-merge): verify no `TASK_COMPLETION_VERIFICATION_FAILED` in prod for a full week after merge.

## Alias removal schedule
The `execution_memory_*` alias in `contracts.ts` is retained for 2 releases. A follow-up PR will drop the alias list + any execution-prompt legacy fallback once usage logs confirm no agent is still emitting the deprecated names.

Architected with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
EOF
)"
```

- [ ] **Step 3: Return the PR URL to the user.**

---

## Self-Review Checklist

Before declaring this plan complete, run through this list:

- [x] **Spec coverage:** Every decision from the brainstorm (LLM-free, required `summary`, auto=required tier) is embodied in a concrete task. Verified.
- [x] **Placeholder scan:** No `TBD`, no `fill in`, no `similar to Task N`. Every code block is complete.
- [x] **Type consistency:** `verifyCompletion`, `CompletionVerifierVerdict`, `AgentContract`, `FieldSpec`, `CoercionResult` all appear in both defining and consuming tasks with matching names.
- [x] **File-path consistency:** Every file mentioned in "File Structure" appears in at least one task.
- [x] **Commit granularity:** Each task ends with a commit; no task is so large that a reviewer can't follow it in a single diff.
- [x] **Real-data grounding:** Every non-trivial assertion traces back to a fixture in `workers/orchestrator/src/__tests__/fixtures/completion-verifier/`.
- [x] **No fabricated expected values:** Goldens generated from the parser itself (Task 2.9) then manually audited on 6 representative fixtures. No hand-written expected JSON.

---

## Open Follow-ups (not in this plan)

1. **Alias removal PR (2 releases after this one):** delete the `execution_memory_*` alias in `contracts.ts` once no agent is still emitting the old names.
2. **Per-agent narrow typing:** `coerceFields` returns `Record<string, unknown>`. A follow-up can add a generic narrowing helper so consumers get typed access (`data.pr: string`, `data.memory_ids_used: string[]`) without runtime cost.
3. **Fixture auto-harvest cron:** the `scripts-tmp/harvest-final-blocks.cjs` script used to build the initial corpus could run weekly to catch new format quirks from newly-supported worker models.
