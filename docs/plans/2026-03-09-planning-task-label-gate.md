# Planning-Task Label Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate autonomous planning trigger on `planning-task` label and clean it up after planning completes.

**Architecture:** Add `hasPlanningTaskLabel()` to `common-core` labels, gate `shouldTriggerCodeTask()` so it requires either `planning-task` or `code-task` label, and add `planning-task` to `removeLabels` in all planning completion paths in `webhookRoutes.ts`.

**Tech Stack:** TypeScript, Vitest, common-core labels package, linear-agent, code-agent

---

### Task 1: Add `hasPlanningTaskLabel` to common-core

**Files:**
- Modify: `packages/common-core/src/labels.ts:15-17`
- Modify: `packages/common-core/src/index.ts:49`
- Test: `packages/common-core/src/__tests__/labels.test.ts`

**Step 1: Write the failing test**

In `packages/common-core/src/__tests__/labels.test.ts`, add after the `hasCodeTaskLabel` describe block:

```typescript
describe('hasPlanningTaskLabel', () => {
  it('returns true for exact match', () => {
    expect(hasPlanningTaskLabel(['planning-task'])).toBe(true);
  });

  it('returns true for uppercase label', () => {
    expect(hasPlanningTaskLabel(['PLANNING-TASK'])).toBe(true);
  });

  it('returns true for underscores', () => {
    expect(hasPlanningTaskLabel(['planning_task'])).toBe(true);
  });

  it('returns true for spaces', () => {
    expect(hasPlanningTaskLabel(['planning task'])).toBe(true);
  });

  it('returns true when multiple labels and one matches', () => {
    expect(hasPlanningTaskLabel(['feature', 'planning-task'])).toBe(true);
  });

  it('returns false when no match', () => {
    expect(hasPlanningTaskLabel(['feature', 'code-task'])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasPlanningTaskLabel([])).toBe(false);
  });

  it('returns false for partial match', () => {
    expect(hasPlanningTaskLabel(['planning-task-extra'])).toBe(false);
  });
});
```

Also update the import at line 2:
```typescript
import { normalizeLabel, hasCodeTaskLabel, hasPlanningTaskLabel } from '../labels.js';
```

**Step 2: Run test to verify it fails**

Run: `cd packages/common-core && npx vitest run src/__tests__/labels.test.ts`
Expected: FAIL — `hasPlanningTaskLabel` is not exported

**Step 3: Write minimal implementation**

In `packages/common-core/src/labels.ts`, add after `hasCodeTaskLabel`:

```typescript
export function hasPlanningTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'planning-task');
}
```

In `packages/common-core/src/index.ts`, update the labels export line:
```typescript
export { normalizeLabel, hasCodeTaskLabel, hasPlanningTaskLabel } from './labels.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/common-core && npx vitest run src/__tests__/labels.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/common-core/src/labels.ts packages/common-core/src/index.ts packages/common-core/src/__tests__/labels.test.ts
git commit -m "feat(common-core): add hasPlanningTaskLabel utility"
```

---

### Task 2: Re-export `hasPlanningTaskLabel` from code-agent labelUtils

**Files:**
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts:7-9`

**Step 1: Update import and re-export**

In `apps/code-agent/src/domain/utils/labelUtils.ts`, change line 7:
```typescript
import { normalizeLabel, hasCodeTaskLabel, hasPlanningTaskLabel } from '@intexuraos/common-core';
```

Change line 9:
```typescript
export { hasCodeTaskLabel, hasPlanningTaskLabel };
```

No new tests needed — this is a pure re-export, tested in common-core.

**Step 2: Build to verify**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/code-agent/src/domain/utils/labelUtils.ts
git commit -m "feat(code-agent): re-export hasPlanningTaskLabel from labelUtils"
```

---

### Task 3: Gate `shouldTriggerCodeTask` on label presence

**Files:**
- Modify: `apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts:16-26`
- Test: `apps/linear-agent/src/__tests__/domain/triggerCodeTaskFromAssignment.test.ts`

**Step 1: Write the failing tests**

In `triggerCodeTaskFromAssignment.test.ts`, update existing tests and add new ones.

First, update the existing test at line 33 — it currently expects `true` for a label of `['bug']` (no `planning-task` or `code-task`). Change it:

```typescript
it('returns false for new assignment without planning-task or code-task label', () => {
  expect(shouldTriggerCodeTask(createEvent())).toBe(false);
});
```

The `createEvent()` default has `labels: [{ id: 'label-1', name: 'bug' }]`, so this now expects `false`.

Add new tests:

```typescript
it('returns true when issue has planning-task label', () => {
  const event = createEvent();
  event.data.labels = [{ id: 'label-planning', name: 'planning-task' }];
  expect(shouldTriggerCodeTask(event)).toBe(true);
});

it('returns true when issue has code-task label', () => {
  const event = createEvent();
  event.data.labels = [{ id: 'label-code', name: 'code-task' }];
  expect(shouldTriggerCodeTask(event)).toBe(true);
});

it('returns true when issue has planning-task among other labels', () => {
  const event = createEvent();
  event.data.labels = [{ id: 'label-1', name: 'bug' }, { id: 'label-planning', name: 'planning-task' }];
  expect(shouldTriggerCodeTask(event)).toBe(true);
});

it('returns false when labels are empty', () => {
  const event = createEvent();
  event.data.labels = [];
  expect(shouldTriggerCodeTask(event)).toBe(false);
});
```

Also update the `returns true for backlog state` test at line 67 — it uses the default `createEvent()` which has no qualifying label. Add a qualifying label:

```typescript
it('returns true for backlog state with planning-task label', () => {
  const event = createEvent();
  event.data.state = { id: 'state-backlog', name: 'Backlog', type: 'backlog' };
  event.data.labels = [{ id: 'label-planning', name: 'planning-task' }];
  expect(shouldTriggerCodeTask(event)).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/linear-agent && npx vitest run src/__tests__/domain/triggerCodeTaskFromAssignment.test.ts`
Expected: FAIL — the first test now expects `false` but gets `true`

**Step 3: Implement the gate**

In `triggerCodeTaskFromAssignment.ts`, add the label constant and check:

```typescript
const CODE_TASK_LABEL = 'code-task';
const PLANNING_TASK_LABEL = 'planning-task';

export function shouldTriggerCodeTask(event: LinearWebhookEvent): boolean {
  if (event.action !== 'update') return false;
  if (event.updatedFrom === undefined) return false;
  if (event.updatedFrom.assigneeId !== null) return false;
  if (event.data.assignee === null) return false;
  if (event.data.state.type !== 'backlog' && event.data.state.type !== 'unstarted') return false;

  // Require planning-task or code-task label to trigger
  const hasQualifyingLabel = event.data.labels.some(
    (label) => label.name === PLANNING_TASK_LABEL || label.name === CODE_TASK_LABEL
  );
  if (!hasQualifyingLabel) return false;

  return true;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/linear-agent && npx vitest run src/__tests__/domain/triggerCodeTaskFromAssignment.test.ts`
Expected: PASS

**Step 5: Also update the `triggerCodeTaskFromAssignment` integration tests**

The tests for `triggerCodeTaskFromAssignment` (lines 74-158) call `createEvent()` which has `labels: [{ id: 'label-1', name: 'bug' }]`. These tests exercise the prompt selection and dedup logic, not the gate — but since they call the real function via `triggerCodeTaskFromAssignment(createEvent(), ...)`, the event must pass `shouldTriggerCodeTask` first... Actually, looking at the code, `triggerCodeTaskFromAssignment` does NOT call `shouldTriggerCodeTask` — the gate is called separately in `linearWebhookRoutes.ts`. So the `triggerCodeTaskFromAssignment` tests don't need label changes. However, verify by re-reading the test to confirm.

**Step 6: Commit**

```bash
git add apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts apps/linear-agent/src/__tests__/domain/triggerCodeTaskFromAssignment.test.ts
git commit -m "feat(linear-agent): gate shouldTriggerCodeTask on planning-task or code-task label"
```

---

### Task 4: Clean up `planning-task` label on planning completion

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (lines 257-258, 307, 362-363, 388-389, 416-417)
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

There are 5 places where labels are manipulated after planning completes. Add `'planning-task'` to the `removeLabels` arrays in each:

**Step 1: Write failing tests**

In `webhooks.test.ts`, find assertions that check `removeLabels` in planning outcome paths and add `'planning-task'` to the expected arrays. The relevant assertions are:

1. **Complex planned (subtask URL path)** — line ~766-767: `removeLabels: ['unclear', 'code-task']` → `removeLabels: ['unclear', 'code-task', 'planning-task']`
2. **Complex planned (subtask normalize)** — line ~1178: `removeLabels: ['planned', 'unclear']` → `removeLabels: ['planned', 'unclear', 'planning-task']` (and similar at 1181, 1483, 1486, 1489)
3. **Simple planned (normalize)** — line ~1585-1586: `removeLabels: ['unclear', 'planned']` → `removeLabels: ['unclear', 'planned', 'planning-task']`
4. **Simple planned (stamp code-task)** — line ~1594-1595: `removeLabels: ['unclear']` → `removeLabels: ['unclear', 'planning-task']`
5. **Unclear outcome** — line ~417: `removeLabels: ['planned', 'code-task']` → `removeLabels: ['planned', 'code-task', 'planning-task']`
6. **Routed execution stamp** — line ~1861: `removeLabels: ['unclear']` → `removeLabels: ['unclear', 'planning-task']`

Search test file for each `removeLabels` assertion in the planning enforcement section and update.

**Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/routes/webhooks.test.ts`
Expected: FAIL — `removeLabels` arrays don't include `'planning-task'` yet

**Step 3: Update the implementation**

In `apps/code-agent/src/routes/webhookRoutes.ts`, add `'planning-task'` to every `removeLabels` array in the planning enforcement logic:

Line ~258 (complex planned, parent labels):
```typescript
removeLabels: isComplex ? ['unclear', 'code-task', 'planning-task'] : ['unclear', 'planned', 'planning-task'],
```

Line ~307 (complex planned, subtask normalize via URL path):
```typescript
removeLabels: ['planned', 'unclear', 'planning-task'],
```

Line ~362 (complex planned, subtask normalize via tree fallback):
```typescript
removeLabels: ['planned', 'unclear', 'planning-task'],
```

Line ~389 (simple planned, stamp code-task):
```typescript
removeLabels: ['unclear', 'planning-task'],
```

Line ~417 (unclear outcome):
```typescript
removeLabels: ['planned', 'code-task', 'planning-task'],
```

Line ~525 (routed execution stamp):
```typescript
removeLabels: ['unclear', 'planning-task'],
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/routes/webhooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "feat(code-agent): remove planning-task label on planning completion"
```

---

### Task 5: Run full CI and verify

**Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

**Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS — all workspaces green

**Step 3: Commit any remaining fixes if needed**

---

### Task 6: Audit for any other references

**Step 1: Search for hardcoded `'code-task'` label checks that might need `'planning-task'` awareness**

Run grep for label checks in the trigger/dispatch path that might need updating. Key files to verify:
- `apps/code-agent/src/domain/usecases/processCodeAction.ts:232` — uses `hasCodeTaskLabel` for `agentType` determination. This runs AFTER the trigger, so it correctly determines planning vs execution based on `code-task` presence. No change needed.
- `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts:241` — validates `code-task` label before execution. No change needed.
- `apps/code-agent/src/domain/usecases/retryTask.ts:284` — uses `hasCodeTaskLabel` for retry dispatch. No change needed.
- `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts:218` — same pattern. No change needed.

None of these need `planning-task` awareness — they operate after the initial trigger.

**Step 2: Commit if any audit findings**
