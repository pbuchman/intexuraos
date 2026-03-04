# Orchestrator Prompt Versioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CI-enforced semantic versioning to the 4 orchestrator system prompts, keeping them co-located in the orchestrator worker.

**Architecture:** Define a local `PromptBuilder` interface in the orchestrator (no external package dependency). Convert the 4 bare `build*Prompt()` functions into `PromptBuilder` typed exports. Extend the existing CI verification script to search `workers/` in addition to `packages/llm-prompts/src` and `apps/`.

**Tech Stack:** TypeScript, Vitest, existing `verify-prompt-versions.mjs` CI script

---

### Task 1: Add local PromptBuilder interface to orchestrator

**Files:**
- Create: `workers/orchestrator/src/services/prompt-builder.ts`

**Step 1: Create the interface file**

```typescript
/**
 * Local PromptBuilder interface for orchestrator system prompts.
 * Mirrors the pattern from packages/llm-prompts/src/types.ts but kept
 * local to avoid coupling orchestrator to the llm-prompts package.
 *
 * CI enforcement: scripts/verify-prompt-versions.mjs detects PromptBuilder<
 * typed exports and validates version fields + bump-on-change.
 */
export interface PromptBuilder<TInput> {
  readonly name: string;
  readonly description: string;
  /**
   * Semantic version (MAJOR.MINOR.PATCH).
   * - MAJOR: Behavior change (agent routing, output format, new mandatory sections)
   * - MINOR: Refined instructions, new examples, added edge cases
   * - PATCH: Typo fixes, formatting, comment clarifications
   */
  readonly version: string;
  build(input: TInput): string;
}
```

**Step 2: Commit**

```bash
git add workers/orchestrator/src/services/prompt-builder.ts
git commit -m "feat(orchestrator): add local PromptBuilder interface for prompt versioning"
```

---

### Task 2: Convert system-prompt.ts functions to PromptBuilder objects

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts`

**Step 1: Write the failing test — verify each prompt has a valid semver version**

Add to the top of `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`, inside the existing `describe('system-prompt', ...)`:

```typescript
import {
  planningPrompt,
  executionPrompt,
  pullRequestPrompt,
  prReviewOverlayPrompt,
} from '../system-prompt.js';

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

describe('prompt versioning', () => {
  it.each([
    { name: 'planningPrompt', prompt: planningPrompt },
    { name: 'executionPrompt', prompt: executionPrompt },
    { name: 'pullRequestPrompt', prompt: pullRequestPrompt },
    { name: 'prReviewOverlayPrompt', prompt: prReviewOverlayPrompt },
  ])('$name has valid semver version', ({ prompt }) => {
    expect(prompt.version).toMatch(SEMVER_REGEX);
  });

  it.each([
    { name: 'planningPrompt', prompt: planningPrompt },
    { name: 'executionPrompt', prompt: executionPrompt },
    { name: 'pullRequestPrompt', prompt: pullRequestPrompt },
    { name: 'prReviewOverlayPrompt', prompt: prReviewOverlayPrompt },
  ])('$name has required metadata fields', ({ prompt }) => {
    expect(prompt.name).toBeTruthy();
    expect(prompt.description).toBeTruthy();
    expect(typeof prompt.build).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/p.buchman/personal/intexuraos-1 && pnpm --filter @intexuraos/orchestrator test -- --reporter verbose 2>&1 | tail -20
```

Expected: FAIL — `planningPrompt` is not exported from `system-prompt.ts`.

**Step 3: Convert the 4 functions to PromptBuilder exports**

In `workers/orchestrator/src/services/system-prompt.ts`:

1. Add import at top:
```typescript
import type { PromptBuilder } from './prompt-builder.js';
```

2. Convert each function to a PromptBuilder export. The template string body stays identical — only the wrapping changes:

```typescript
// BEFORE:
function buildPlanningPrompt(params: SystemPromptParams): string {
  const { taskId, linearIssueId, linearIssueTitle, taskUrl, workerType } = params;
  return `...`;
}

// AFTER:
export const planningPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-planning',
  description: 'Planning agent system prompt for autonomous code task planning',
  version: '1.0.0',
  build(params: SystemPromptParams): string {
    const { taskId, linearIssueId, linearIssueTitle, taskUrl, workerType } = params;
    /* v8 ignore start -- source-map: template conditional branches are misattributed after bundling/source-map transforms @preserve */
    return `...`;
    // (template string body stays IDENTICAL)
  },
};
```

Apply same pattern for all 4:

| Old function               | New export              | `name`                           | Version |
| -------------------------- | ----------------------- | -------------------------------- | ------- |
| `buildPlanningPrompt()`    | `planningPrompt`        | `orchestrator-planning`          | `1.0.0` |
| `buildExecutionPrompt()`   | `executionPrompt`       | `orchestrator-execution`         | `1.0.0` |
| `buildPullRequestPrompt()` | `pullRequestPrompt`     | `orchestrator-pull-request`      | `1.0.0` |
| `buildPRReviewOverlay()`   | `prReviewOverlayPrompt` | `orchestrator-pr-review-overlay` | `1.0.0` |

3. Update `buildSystemPrompt()` to use `.build()`:

```typescript
export function buildSystemPrompt(params: SystemPromptParams): string {
  const isPRComment = params.linearIssueLabels.some(
    (label) => label.trim().toLowerCase() === 'pr-comment'
  );
  if (isPRComment) {
    return pullRequestPrompt.build(params);
  }

  const resolvedAgentType =
    params.agentType ?? (hasCodeTaskLabel(params.linearIssueLabels) ? 'execution' : 'planning');

  const overlay = prReviewOverlayPrompt.build(params);

  if (resolvedAgentType === 'planning') {
    return planningPrompt.build(params) + overlay;
  }

  return executionPrompt.build(params) + overlay;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/p.buchman/personal/intexuraos-1 && pnpm --filter @intexuraos/orchestrator test -- --reporter verbose 2>&1 | tail -30
```

Expected: ALL PASS — new versioning tests pass AND all existing routing/content tests still pass (public API unchanged).

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts
git commit -m "feat(orchestrator): convert system prompts to versioned PromptBuilder pattern"
```

---

### Task 3: Extend CI verification script to search workers/

**Files:**
- Modify: `scripts/verify-prompt-versions.mjs`

**Step 1: Write the failing test — verify CI detects orchestrator prompts**

Run the verification script and confirm it does NOT currently find orchestrator prompts:

```bash
cd /Users/p.buchman/personal/intexuraos-1 && node scripts/verify-prompt-versions.mjs 2>&1 | head -20
```

Expected: Output shows only `packages/llm-prompts/src` and `apps` files. No `workers/` files listed.

**Step 2: Add `workers/` to searchDirs**

In `scripts/verify-prompt-versions.mjs`, line 299:

```javascript
// BEFORE:
const searchDirs = [join(repoRoot, 'packages/llm-prompts/src'), join(repoRoot, 'apps')];

// AFTER:
const searchDirs = [
  join(repoRoot, 'packages/llm-prompts/src'),
  join(repoRoot, 'apps'),
  join(repoRoot, 'workers'),
];
```

**Step 3: Run verification to confirm orchestrator prompts are detected**

```bash
cd /Users/p.buchman/personal/intexuraos-1 && node scripts/verify-prompt-versions.mjs 2>&1
```

Expected: Output includes `workers/orchestrator/src/services/system-prompt.ts` with versions `1.0.0, 1.0.0, 1.0.0, 1.0.0`. All checks pass.

**Step 4: Commit**

```bash
git add scripts/verify-prompt-versions.mjs
git commit -m "feat(ci): extend prompt version verification to workers/ directory"
```

---

### Task 4: Update prompt-versioning documentation

**Files:**
- Modify: `docs/patterns/prompt-versioning.md`

**Step 1: Update "Where Versions Live" section**

Add `workers/*/src/` to the list of prompt file locations:

```markdown
Prompt files are located in:

- `packages/llm-prompts/src/` — shared prompts used across services
- `apps/*/src/` — service-specific prompts
- `workers/*/src/` — worker-specific prompts (e.g., orchestrator system prompts)
```

**Step 2: Update "Out of Scope" section**

Replace the blanket exclusion with a narrower note:

```markdown
## Out of Scope

Bare `build*Prompt()` functions (not using `PromptBuilder`) that serve as simple, stable templates
(e.g., repair prompts, context inference prompts) are not versioned. If a bare function controls
significant agent behavior, it should be converted to the `PromptBuilder` pattern.
```

**Step 3: Commit**

```bash
git add docs/patterns/prompt-versioning.md
git commit -m "docs: update prompt-versioning to include workers/ scope"
```

---

### Task 5: Run full CI and verify

**Step 1: Run ci:tracked**

```bash
cd /Users/p.buchman/personal/intexuraos-1 && pnpm run ci:tracked
```

Expected: ALL phases pass including `prompt-versions` verification showing the 4 orchestrator prompts.

**Step 2: Verify prompt version bump detection works**

To confirm Check B works, temporarily change a word in one of the prompt templates WITHOUT bumping the version, then run the verify script:

```bash
cd /Users/p.buchman/personal/intexuraos-1 && node scripts/verify-prompt-versions.mjs 2>&1
```

Expected: FAIL with `Content changed but version was not bumped`. Revert the test change.

---

## Summary of all files touched

| File                                                                | Action | Purpose                                         |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `workers/orchestrator/src/services/prompt-builder.ts`               | Create | Local `PromptBuilder` interface                 |
| `workers/orchestrator/src/services/system-prompt.ts`                | Modify | Convert 4 functions → 4 `PromptBuilder` objects |
| `workers/orchestrator/src/services/__tests__/system-prompt.test.ts` | Modify | Add versioning metadata tests                   |
| `scripts/verify-prompt-versions.mjs`                                | Modify | Add `workers/` to search scope (1 line)         |
| `docs/patterns/prompt-versioning.md`                                | Modify | Update locations + out-of-scope note            |

## What does NOT change

- No prompts move out of orchestrator
- No new package dependency added
- `buildSystemPrompt()` public API stays identical — callers (`task-dispatcher.ts`) unaffected
- No changes to other apps, workers, or packages
- No duplicated CI scripts — same script, wider search scope
