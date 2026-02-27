# Remaining Observability Gaps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close every observability gap identified in the Feb 25 orchestrator incident audit that was deferred from the first observability plan (orchestrator logging) or left unresolved after the deploy mechanism fix.

**Architecture:** Three workstreams: (1) extract duplicated label logic to `common-core` package so both code-agent and orchestrator share one source of truth, (2) send `executionPhase` from code-agent to orchestrator to eliminate silent recalculation divergence, (3) render existing but hidden data in the web UI (labels, phase mismatch alerts). Each workstream is independently shippable. Web UI changes have no coverage threshold enforced but should follow existing patterns.

**Tech Stack:** TypeScript, Vitest, React, TailwindCSS, pino logger

---

## Gap Traceability Matrix

Every gap from the original audit, its resolution status, and which plan task addresses it.

### A. Orchestrator Task Log (web UI visible)

| #   | Gap                                          | Status                                                                                  | Plan Coverage                       |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | Adaptive retry score breakdown missing       | Covered by observability plan Task 1+3                                                  | See `orchestrator-observability.md` |
| 2   | TaskResult details per attempt incomplete    | Covered by observability plan Task 2                                                    | See `orchestrator-observability.md` |
| 3   | previousResult vs currentResult diff         | Covered by observability plan Task 2                                                    | See `orchestrator-observability.md` |
| 4   | Phase mismatch warning absent                | Covered by observability plan Task 5                                                    | See `orchestrator-observability.md` |
| 5   | Resume prompt content not logged             | Covered by observability plan Task 6                                                    | See `orchestrator-observability.md` |
| 6   | No orchestrator code version at startup      | Covered by observability plan Task 4                                                    | See `orchestrator-observability.md` |
| 7   | Verification history state before retry      | Covered by observability plan Task 3 (logger.info includes `verificationHistoryLength`) | See `orchestrator-observability.md` |

### B. Orchestrator Structured Logs (pino)

| #   | Gap                                          | Status                                                                        | Plan Coverage                       |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| 1   | `analyzeRetryDecision` input data not logged | Covered by observability plan Task 3                                          | See `orchestrator-observability.md` |
| 2   | `checkForResult` output not logged to pino   | Covered by observability plan Task 2                                          | See `orchestrator-observability.md` |
| 3   | No tsx watch reload confirmation             | RESOLVED — orchestrator now uses systemd + webhook auto-deploy, not tsx watch | N/A — infrastructure fix            |
| 4   | No deploy hook confirmation                  | RESOLVED — webhook handler logs restarts via stdout                           | N/A — infrastructure fix            |

### C. Web UI

| #   | Gap                                           | Status       | Plan Coverage                                                                                                                                                                 |
| --- | --------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Linear issue labels not shown                 | **NEW**      | **This plan — Task 1**                                                                                                                                                        |
| 2   | Adaptive retry decision not shown per attempt | DEFERRED     | Blocked: requires cross-service API change (orchestrator webhook must send `verificationHistory` back to code-agent, which requires Firestore schema extension in code-agent) |
| 3   | Phase mismatch alert missing                  | **NEW**      | **This plan — Task 2**                                                                                                                                                        |
| 4   | Cost per attempt not shown                    | DEFERRED     | Blocked: depends on turn metrics feature (not yet built)                                                                                                                      |

### D. Code-Agent Dispatch

| #   | Gap                                          | Status       | Plan Coverage                      |
| --- | -------------------------------------------- | ------------ | ---------------------------------- |
| 1   | `executionPhase` not sent to orchestrator    | **NEW**      | **This plan — Task 4**             |

### E. Code Duplication

| #   | Gap                                          | Status       | Plan Coverage                      |
| --- | -------------------------------------------- | ------------ | ---------------------------------- |
| 1   | `hasCodeTaskLabel` duplicated in 4 places    | **NEW**      | **This plan — Task 3**             |

### F. Infrastructure / Deploy

| #   | Gap                                          | Status                                                                   | Plan Coverage                  |
| --- | -------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| 1   | tsx watch silently stale after git reset     | RESOLVED — switched to systemd + compiled dist/index.js                  | N/A — completed Feb 25         |
| 2   | Orchestrator absent from webhook handler     | RESOLVED — webhook handler updated with orchestrator detection + restart | N/A — completed Feb 25         |
| 3   | Missing env vars in systemd EnvironmentFile  | RESOLVED — added ZAI_APP_API_KEY + MINIMAX_APP_API_KEY                   | N/A — completed Feb 25         |
| 4   | No sudoers rule for webhook restart          | RESOLVED — `/etc/sudoers.d/intexuraos-orchestrator` created              | N/A — completed Feb 25         |
| 5   | CLAUDE.md incorrect about auto-reload        | RESOLVED — committed fix to development branch                           | N/A — completed Feb 25         |

### Summary

| Category               | Total Gaps | Already Covered | Resolved (infra)  | This Plan | Deferred |
| ---------------------- | ---------- | --------------- | ----------------- | --------- | -------- |
| A. Task Log            | 7          | 7               | 0                 | 0         | 0        |
| B. Structured Logs     | 4          | 2               | 2                 | 0         | 0        |
| C. Web UI              | 4          | 0               | 0                 | 2         | 2        |
| D. Dispatch            | 1          | 0               | 0                 | 1         | 0        |
| E. Code Duplication    | 1          | 0               | 0                 | 1         | 0        |
| F. Infrastructure      | 5          | 0               | 5                 | 0         | 0        |
| **Total**              | **22**     | **9**           | **7**             | **4**     | **2**    |

**Deferred items (with justification):**

| Gap                                     | Why Deferred                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C.2: Retry decision display per attempt | Requires orchestrator to send `verificationHistory` in webhook callback → code-agent must store it in Firestore → web API must serve it. Three services touched, schema migration needed. Separate plan. |
| C.4: Cost per attempt                   | Depends on turn metrics feature that doesn't exist yet. No data source available.                                                                                                                        |

---

## Task 1: Render Linear Issue Labels in Web UI

**Why:** The `linearIssue.labels` array flows from the Linear API all the way to the browser (`types/index.ts:1172`), but no component renders it. Operators can't see at a glance whether a task has `code-task`, `unclear`, or custom labels — information critical for understanding phase decisions.

**Covers gap:** C.1 (Linear issue labels not shown)

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx:287-293` (after Linear state badge, before assignee)

**Step 1: Add label badges after the state badge**

In `CodeTaskViewPage.tsx`, find the `TaskHeader` component. After the Linear state badge (lines 287-293) and before the assignee display (line 294), add:

```tsx
{task.linearIssue?.labels !== undefined && task.linearIssue.labels.length > 0 ? (
  task.linearIssue.labels.map((label) => (
    <span
      key={label.id}
      className="inline-flex items-center rounded-full bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300"
    >
      {label.name}
    </span>
  ))
) : null}
```

This follows the existing badge pattern used for issue type (line 280), state (line 287), phase (line 264), and worker type (line 273). Gray styling distinguishes labels from functional badges.

**Step 2: Verify locally**

Run: `cd apps/web && pnpm dev`
Navigate to a code task that has Linear labels. Verify the labels appear as gray badges after the Linear state badge.

**Step 3: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "Render Linear issue labels in code task header"
```

---

## Task 2: Add Phase Mismatch Alert in Web UI

**Why:** When a task runs as Phase 1 (design-only) but a PR was created, there's a contradiction. The observability plan (Task 5) adds a warning to the orchestrator logs, but the web UI should surface this visually so operators don't need to dig through logs.

**Covers gap:** C.3 (Phase mismatch alert missing)

**Dependencies:** Observability plan Task 5 must be deployed first (the orchestrator needs to emit the warning data). However, the web UI can detect the mismatch independently from data already available: `task.executionPhase` and `task.result?.prUrl`.

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx` (in `TaskHeader`, after the phase badge at line 272)

**Step 1: Add phase mismatch banner**

After the phase badge (line 272), add a conditional warning:

```tsx
{task.executionPhase === 'design' && task.result?.prUrl !== undefined && task.result.prUrl !== '' ? (
  <span className="inline-flex items-center rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs font-medium text-yellow-400">
    Phase mismatch: design task created PR
  </span>
) : null}
```

**Step 2: Verify the `executionPhase` field exists on the web type**

Check `apps/web/src/types/index.ts` for `executionPhase` on the `CodeTask` interface. It should be `'design' | 'execution'`. If it doesn't exist, you need to add it:

```typescript
executionPhase?: 'design' | 'execution';
```

Also check that `result` has `prUrl`:

```typescript
result?: {
  prUrl?: string;
  // ...
};
```

**Step 3: Verify locally**

Run: `cd apps/web && pnpm dev`
Test with a task where `executionPhase === 'design'` and `result.prUrl` is set. Verify the yellow warning badge appears.

**Step 4: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "Show phase mismatch warning when design task creates PR"
```

---

## Task 3: Extract `hasCodeTaskLabel` to `common-core`

**Why:** The label normalization + detection logic is duplicated in **four** places with identical behavior but no shared source. If the normalization rule changes (e.g., adding a new label synonym), all four must be updated manually. This has already been flagged as tracked debt in `labelUtils.ts:7`.

**Covers gap:** E.1 (`hasCodeTaskLabel` duplicated in 4 places)

**Current locations (all four):**

| #   | File                                                                           | Type                     |
| --- | ------------------------------------------------------------------------------ | ------------------------ |
| 1   | `apps/code-agent/src/domain/utils/labelUtils.ts:15-17`                         | Exported function        |
| 2   | `workers/orchestrator/src/services/task-dispatcher.ts:1389-1394`               | Private class method     |
| 3   | `workers/orchestrator/src/services/system-prompt.ts:353-355`                   | Inline expression        |
| 4   | `apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts:13-17` | Local function           |

**Files:**
- Create: `packages/common-core/src/labels.ts`
- Create: `packages/common-core/src/__tests__/labels.test.ts`
- Modify: `packages/common-core/src/index.ts` (add export)
- Modify: `apps/code-agent/src/domain/utils/labelUtils.ts` (re-export from common-core)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:1389-1394` (remove private method, import)
- Modify: `workers/orchestrator/src/services/system-prompt.ts:353-355` (import shared function)
- Modify: `apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts:13-17` (import shared function)

**Step 1: Write the failing test**

Create `packages/common-core/src/__tests__/labels.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeLabel, hasCodeTaskLabel } from '../labels.js';

describe('labels', () => {
  describe('normalizeLabel', () => {
    it('lowercases and replaces underscores and spaces with dashes', () => {
      expect(normalizeLabel('Code_Task')).toBe('code-task');
      expect(normalizeLabel('  Code Task  ')).toBe('code-task');
      expect(normalizeLabel('CODE_TASK')).toBe('code-task');
    });
  });

  describe('hasCodeTaskLabel', () => {
    it('returns true for exact match', () => {
      expect(hasCodeTaskLabel(['code-task'])).toBe(true);
    });

    it('returns true for uppercase label', () => {
      expect(hasCodeTaskLabel(['CODE-TASK'])).toBe(true);
    });

    it('returns true for underscores', () => {
      expect(hasCodeTaskLabel(['code_task'])).toBe(true);
    });

    it('returns true for spaces', () => {
      expect(hasCodeTaskLabel(['code task'])).toBe(true);
    });

    it('returns true for mixed case with spaces', () => {
      expect(hasCodeTaskLabel(['Code Task'])).toBe(true);
    });

    it('returns true when multiple labels and one matches', () => {
      expect(hasCodeTaskLabel(['feature', 'code-task'])).toBe(true);
    });

    it('returns false when no match', () => {
      expect(hasCodeTaskLabel(['feature', 'unclear'])).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(hasCodeTaskLabel([])).toBe(false);
    });

    it('returns false for partial match', () => {
      expect(hasCodeTaskLabel(['code-task-extra'])).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/common-core && pnpm vitest run src/__tests__/labels.test.ts`
Expected: FAIL — `../labels.js` module not found

**Step 3: Create `packages/common-core/src/labels.ts`**

```typescript
/**
 * Linear issue label utilities.
 *
 * Canonical home for label normalization and detection. Previously duplicated in:
 * - apps/code-agent/src/domain/utils/labelUtils.ts
 * - workers/orchestrator/src/services/task-dispatcher.ts (private method)
 * - workers/orchestrator/src/services/system-prompt.ts (inline)
 * - apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts (local function)
 */

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

export function hasCodeTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'code-task');
}
```

**Step 4: Add export to `packages/common-core/src/index.ts`**

Add at the end of the file:

```typescript
export { normalizeLabel, hasCodeTaskLabel } from './labels.js';
```

**Step 5: Run test to verify it passes**

Run: `cd packages/common-core && pnpm vitest run src/__tests__/labels.test.ts`
Expected: ALL PASS

**Step 6: Build packages**

Run: `pnpm build`

This is required because consumers import from `@intexuraos/common-core` which resolves to `dist/`.

**Step 7: Update consumer 1 — code-agent `labelUtils.ts`**

Replace the local implementation with a re-export. In `apps/code-agent/src/domain/utils/labelUtils.ts`:

Replace the `normalizeLabel` and `hasCodeTaskLabel` functions (lines 11-17) with:

```typescript
export { normalizeLabel, hasCodeTaskLabel } from '@intexuraos/common-core';
```

Keep `hasUnclearLabel` and `getWorkerTypeFromLabels` local — they use `normalizeLabel` which is now imported. Update them to import it:

```typescript
import { normalizeLabel, hasCodeTaskLabel } from '@intexuraos/common-core';

export { hasCodeTaskLabel };

export function hasUnclearLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'unclear');
}
```

Remove the old `normalizeLabel` function definition and the old `hasCodeTaskLabel` function definition.

Update the comment at the top of the file to remove the duplication tracking note (lines 1-9).

**Step 8: Update consumer 2 — orchestrator `task-dispatcher.ts`**

Add import at the top of `workers/orchestrator/src/services/task-dispatcher.ts`:

```typescript
import { hasCodeTaskLabel } from '@intexuraos/common-core';
```

Remove the private method at lines 1389-1394:

```typescript
// DELETE this entire method:
private hasCodeTaskLabel(labels: string[]): boolean {
  return labels.some((label) => {
    const normalized = label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
    return normalized === 'code-task';
  });
}
```

Replace all `this.hasCodeTaskLabel(` calls with `hasCodeTaskLabel(` (2 occurrences at lines 252 and 646).

**Step 9: Update consumer 3 — orchestrator `system-prompt.ts`**

In `workers/orchestrator/src/services/system-prompt.ts`, add import:

```typescript
import { hasCodeTaskLabel } from '@intexuraos/common-core';
```

Replace the inline expression at lines 353-355:

```typescript
// BEFORE (lines 353-355):
const hasCodeTaskLabel = linearIssueLabels.some(
  (label) => label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-') === 'code-task'
);

// AFTER — rename the variable to avoid shadowing the import:
const isCodeTask = hasCodeTaskLabel(linearIssueLabels);
```

Update line 357 to use the new variable name:

```typescript
// BEFORE:
if (!hasCodeTaskLabel) {

// AFTER:
if (!isCodeTask) {
```

**Step 10: Update consumer 4 — linear-agent `triggerCodeTaskFromAssignment.ts`**

In `apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts`, add import:

```typescript
import { hasCodeTaskLabel } from '@intexuraos/common-core';
```

Remove the local function at lines 13-17:

```typescript
// DELETE:
function hasCodeTaskLabel(labels: string[]): boolean {
  return labels.some((label) => {
    const normalized = label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
    return normalized === 'code-task';
  });
}
```

The usage at line 26 (`hasCodeTaskLabel(event.data.labels.map(l => l.name))`) remains unchanged.

**Step 11: Run all affected tests**

```bash
pnpm build
pnpm run verify:workspace:tracked -- common-core
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- orchestrator
pnpm run verify:workspace:tracked -- linear-agent
```

Expected: ALL PASS

**Step 12: Commit**

```bash
git add packages/common-core/src/labels.ts packages/common-core/src/__tests__/labels.test.ts packages/common-core/src/index.ts apps/code-agent/src/domain/utils/labelUtils.ts workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/services/system-prompt.ts apps/linear-agent/src/domain/useCases/triggerCodeTaskFromAssignment.ts
git commit -m "Extract hasCodeTaskLabel to common-core, remove 4 duplicates"
```

---

## Task 4: Send `executionPhase` from Code-Agent to Orchestrator

**Why:** Code-agent computes `executionPhase` from labels (via `hasCodeTaskLabel`) and stores it in Firestore, but never sends it to the orchestrator. The orchestrator independently recalculates the phase from the same labels using its own (now-shared) `hasCodeTaskLabel`. If the timing or label state ever diverges, the two services silently disagree on phase. Sending `executionPhase` explicitly eliminates this class of bugs and makes the orchestrator's phase decision auditable.

**Covers gap:** D.1 (`executionPhase` not sent to orchestrator)

**Current flow:**
```
Code-Agent                              Orchestrator
───────────                             ────────────
1. hasCodeTaskLabel(labels) → phase
2. Store executionPhase in Firestore
3. Build dispatch (NO phase)  ──────→   4. Receive CreateTaskRequest (NO phase)
                                        5. hasCodeTaskLabel(labels) → recalculate
```

**Target flow:**
```
Code-Agent                              Orchestrator
───────────                             ────────────
1. hasCodeTaskLabel(labels) → phase
2. Store executionPhase in Firestore
3. Build dispatch (WITH phase) ─────→   4. Receive CreateTaskRequest (WITH phase)
                                        5. Use received phase (no recalculation)
```

**Files:**
- Modify: `workers/orchestrator/src/types/api.ts:5-24` (add `executionPhase` to `CreateTaskRequest`)
- Modify: `workers/orchestrator/src/types/task.ts:22-72` (add `executionPhase` to `Task`)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:250-254,644-648` (use stored phase instead of recalculating)
- Modify: `workers/orchestrator/src/services/system-prompt.ts:353-358` (use stored phase)
- Modify: `workers/orchestrator/src/routes.ts` (map request field to task)
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts:28-48` (add `executionPhase` to `DispatchRequest`)
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:1350-1383` (include `executionPhase` in dispatch)
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts:273-277` (include `executionPhase` in dispatch)
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts:218-223` (include `executionPhase` in dispatch)
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts:213-217` (include `executionPhase` in dispatch)
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Test: `apps/code-agent/src/__tests__/` (existing dispatch tests)

**Step 1: Add `executionPhase` to orchestrator API type**

In `workers/orchestrator/src/types/api.ts`, add to `CreateTaskRequest` (after `retriedFrom`):

```typescript
/** Execution phase determined by code-agent from label analysis. */
executionPhase?: 'design' | 'execution';
```

Optional (`?:`) for backwards compatibility — existing in-flight tasks won't have it. The orchestrator falls back to recalculating from labels if absent.

**Step 2: Add `executionPhase` to orchestrator `Task` type**

In `workers/orchestrator/src/types/task.ts`, add to `Task` (after `linearIssueLabels`):

```typescript
/** Execution phase from code-agent. When set, used instead of recalculating from labels. */
executionPhase?: 'design' | 'execution';
```

**Step 3: Map the field in route handler**

Find where `CreateTaskRequest` is mapped to `Task` in the orchestrator routes (likely `workers/orchestrator/src/routes.ts` or in `task-dispatcher.ts` `addTask` method). Add:

```typescript
executionPhase: request.executionPhase,
```

**Step 4: Write the failing test**

In `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`, add a test:

```typescript
it('uses executionPhase from request when available instead of recalculating', async () => {
  // Create a task WITH executionPhase='execution' but WITHOUT code-task label
  // (would normally be phase1/design if recalculated from labels)
  const task = createTestTask({
    linearIssueLabels: ['feature'],  // No code-task label
    executionPhase: 'execution',     // But phase says execution
  });

  // Verify the system prompt uses Phase 2 (execution), not Phase 1 (design)
  // Assert based on the prompt content or logged phase
});
```

Adapt this test to match the existing test patterns in the file.

**Step 5: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts -t "uses executionPhase from request"`
Expected: FAIL — `executionPhase` not recognized

**Step 6: Update phase determination in `task-dispatcher.ts`**

Replace the phase calculation at lines 250-254:

```typescript
// BEFORE:
const phase = isPRComment
  ? 'PR Comment'
  : this.hasCodeTaskLabel(task.linearIssueLabels)
    ? 'Phase 2'
    : 'Phase 1';

// AFTER:
const phase = isPRComment
  ? 'PR Comment'
  : task.executionPhase === 'execution'
    ? 'Phase 2'
    : task.executionPhase === 'design'
      ? 'Phase 1'
      : hasCodeTaskLabel(task.linearIssueLabels)
        ? 'Phase 2'
        : 'Phase 1';
```

Similarly update lines 644-648:

```typescript
// BEFORE:
const phase = isPRComment
  ? 'pr-comment'
  : this.hasCodeTaskLabel(task.linearIssueLabels)
    ? 'phase2'
    : 'phase1';

// AFTER:
const phase = isPRComment
  ? 'pr-comment'
  : task.executionPhase === 'execution'
    ? 'phase2'
    : task.executionPhase === 'design'
      ? 'phase1'
      : hasCodeTaskLabel(task.linearIssueLabels)
        ? 'phase2'
        : 'phase1';
```

**Step 7: Update `system-prompt.ts`**

In `workers/orchestrator/src/services/system-prompt.ts`, the function that builds system prompts needs to accept `executionPhase` as an optional parameter. Find the function signature and add it.

Update the phase check (currently at line 353-358):

```typescript
// BEFORE:
const isCodeTask = hasCodeTaskLabel(linearIssueLabels);
if (!isCodeTask) {
  return buildPhase1Prompt(params);
}

// AFTER:
const isCodeTask = executionPhase !== undefined
  ? executionPhase === 'execution'
  : hasCodeTaskLabel(linearIssueLabels);
if (!isCodeTask) {
  return buildPhase1Prompt(params);
}
```

**Step 8: Add `executionPhase` to code-agent `DispatchRequest`**

In `apps/code-agent/src/domain/services/taskDispatcher.ts`, add to `DispatchRequest` (after `retriedFrom`):

```typescript
/** Execution phase determined from label analysis. */
executionPhase: 'design' | 'execution';
```

Note: NOT optional in code-agent — it always has this information at dispatch time.

**Step 9: Include `executionPhase` in all dispatch call sites**

The field is already computed at all four call sites. It's currently stored in Firestore but not included in the dispatch payload. Add it:

1. `apps/code-agent/src/routes/codeRoutes.ts:1350-1383` — add `executionPhase` to `dispatchInput` (the value is already computed at line 1233)
2. `apps/code-agent/src/domain/usecases/retryTask.ts:273-277` — already computed at line 275
3. `apps/code-agent/src/domain/usecases/processCodeAction.ts:218-223` — already computed at line 222
4. `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts:213-217` — already computed at line 215

For each, ensure `executionPhase` is included in the dispatch object sent to the orchestrator.

**Step 10: Run all tests**

```bash
pnpm build
pnpm run verify:workspace:tracked -- orchestrator
pnpm run verify:workspace:tracked -- code-agent
```

Expected: ALL PASS

**Step 11: Commit**

```bash
git add workers/orchestrator/src/types/api.ts workers/orchestrator/src/types/task.ts workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/routes.ts apps/code-agent/src/domain/services/taskDispatcher.ts apps/code-agent/src/routes/codeRoutes.ts apps/code-agent/src/domain/usecases/retryTask.ts apps/code-agent/src/domain/usecases/processCodeAction.ts apps/code-agent/src/domain/usecases/submitTaskFeedback.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "Send executionPhase from code-agent to orchestrator"
```

---

## Final Verification

After all tasks are complete:

```bash
pnpm run ci:tracked
```

Must pass before any PR is created.

---

## Deferred Items (Future Plans)

| Gap                                     | What's Needed                                                                                                                                                                 | Effort |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C.2: Retry decision display per attempt | 1. Add `verificationHistory` to orchestrator webhook payload. 2. Code-agent webhook handler stores it. 3. Code-agent API exposes it. 4. Web UI renders per-attempt breakdown. | High   |
| C.4: Cost per attempt                   | 1. Build turn metrics feature (cost tracking per API call). 2. Aggregate per attempt. 3. Web UI renders cost column.                                                          | High   |
