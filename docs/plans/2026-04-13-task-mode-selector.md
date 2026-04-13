# Task Mode Selector (Planning/Execution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users explicitly choose between "Planning" and "Execution" mode when creating a code task from the UI, replacing the current implicit label-based detection.

**Architecture:** Add a `TaskMode` selector (`'planning' | 'execution'`) to the new-task form (web app), pass it through the `SubmitCodeTaskRequest` to the backend API (`code-agent`), and use it to set `agentType` on the task document — bypassing the current `hasCodeTaskLabel()` heuristic when the user has made an explicit choice. No orchestrator or system-prompt changes are needed because those already branch on `agentType`.

**Tech Stack:** React (TypeScript), Fastify (TypeScript), `@intexuraos/common-core`, Vitest + Testing Library

---

## Current State Analysis

### How `agentType` is determined today

1. **UI** (`CodeTaskNewPage.tsx`): Sends `{ prompt, workerType?, linearIssueId? }` to `POST /code/submit`. There is no field for planning vs execution. When the user selects "Link Existing" and picks an issue, the prompt auto-fills to `EXECUTION_DEFAULT_PROMPT`.

2. **Backend** (`codeRoutes.ts:1809`): After fetching/creating the Linear issue, the backend checks whether the issue has a `code-task` label:
   ```ts
   agentType: hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning',
   ```
   This is the **only** place `agentType` is set for UI-submitted tasks.

3. **Orchestrator** (`system-prompt.ts:1230`): Has a fallback that mirrors the same logic:
   ```ts
   const resolvedAgentType = params.agentType ?? (hasCodeTaskLabel(...) ? 'execution' : 'planning');
   ```
   But since `agentType` is always set at creation, this fallback is not reached for UI-submitted tasks.

### Problem

Users have no direct control. The only way to get `agentType = 'execution'` is to link an issue that happens to carry the `code-task` label. There is no way for a user who wants to skip planning and go straight to execution (e.g., because a merged plan already exists) to express that intent in the UI.

---

## File Structure

| Action     | File                                                            | Responsibility                                                          |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Modify** | `packages/common-core/src/codeTaskAgentTypes.ts` (NEW)          | Export `CODE_TASK_AGENT_TYPES` const array and `CodeTaskAgentType` type |
| **Modify** | `packages/common-core/src/index.ts`                             | Re-export the new module                                                |
| **Modify** | `apps/web/src/types/index.ts`                                   | Add `taskMode` to `SubmitCodeTaskRequest`                               |
| **Modify** | `apps/web/src/pages/CodeTaskNewPage.tsx`                        | Add task-mode toggle (Planning / Execution)                             |
| **Modify** | `apps/web/src/components/ConfirmSubmitModal.tsx`                | Display selected task mode in confirmation                              |
| **Modify** | `apps/code-agent/src/routes/codeRoutes.ts`                      | Accept `taskMode` in body schema, use it for `agentType`                |
| **Modify** | `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`       | Test new `taskMode` field                                               |
| **Modify** | `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`               | Test task-mode toggle UI                                                |
| **Modify** | `apps/web/src/components/__tests__/ConfirmSubmitModal.test.tsx` | Test mode display in modal                                              |

---

## Task 1: Create shared `CodeTaskAgentType` constant in `common-core`

**Files:**
- Create: `packages/common-core/src/codeTaskAgentTypes.ts`
- Modify: `packages/common-core/src/index.ts`
- Test: `packages/common-core/src/__tests__/codeTaskAgentTypes.test.ts`

This mirrors the existing `codeTaskWorkerTypes.ts` pattern for type-safe agent type values.

- [ ] **Step 1: Write the failing test**

Create `packages/common-core/src/__tests__/codeTaskAgentTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CODE_TASK_AGENT_TYPES, isCodeTaskAgentType } from '../codeTaskAgentTypes.js';

describe('codeTaskAgentTypes', () => {
  it('exports planning and execution types', () => {
    expect(CODE_TASK_AGENT_TYPES).toEqual(['planning', 'execution']);
  });

  it('isCodeTaskAgentType returns true for valid types', () => {
    expect(isCodeTaskAgentType('planning')).toBe(true);
    expect(isCodeTaskAgentType('execution')).toBe(true);
  });

  it('isCodeTaskAgentType returns false for invalid types', () => {
    expect(isCodeTaskAgentType('review')).toBe(false);
    expect(isCodeTaskAgentType('unknown')).toBe(false);
    expect(isCodeTaskAgentType('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter @intexuraos/common-core run test -- --run src/__tests__/codeTaskAgentTypes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/common-core/src/codeTaskAgentTypes.ts`:

```ts
/**
 * User-selectable agent types for code task creation.
 *
 * This is the subset of AgentType that users can choose in the UI.
 * Other agent types (pull_request, review, remediation, ask_agent) are
 * system-assigned and not user-selectable.
 */
export const CODE_TASK_AGENT_TYPES = ['planning', 'execution'] as const;

export type CodeTaskAgentType = (typeof CODE_TASK_AGENT_TYPES)[number];

const CODE_TASK_AGENT_TYPE_SET = new Set<string>(CODE_TASK_AGENT_TYPES);

export function isCodeTaskAgentType(value: string): value is CodeTaskAgentType {
  return CODE_TASK_AGENT_TYPE_SET.has(value);
}
```

- [ ] **Step 4: Add re-export to `packages/common-core/src/index.ts`**

Add these lines (follow the pattern used by `codeTaskWorkerTypes.ts`):

```ts
export { CODE_TASK_AGENT_TYPES, isCodeTaskAgentType } from './codeTaskAgentTypes.js';
export type { CodeTaskAgentType } from './codeTaskAgentTypes.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /repo && pnpm --filter @intexuraos/common-core run test -- --run src/__tests__/codeTaskAgentTypes.test.ts`
Expected: PASS

- [ ] **Step 6: Build common-core to make types available to dependents**

Run: `cd /repo && pnpm --filter @intexuraos/common-core run build`

- [ ] **Step 7: Commit**

```bash
git add packages/common-core/src/codeTaskAgentTypes.ts packages/common-core/src/__tests__/codeTaskAgentTypes.test.ts packages/common-core/src/index.ts
git commit -m "feat(common-core): add CodeTaskAgentType shared constant for task mode selector"
```

---

## Task 2: Add `taskMode` to the web app types and API call

**Files:**
- Modify: `apps/web/src/types/index.ts:1226-1230` (SubmitCodeTaskRequest)
- Modify: `apps/web/src/services/codeAgentApi.ts` (no functional change, just verify)

- [ ] **Step 1: Update `SubmitCodeTaskRequest` in `apps/web/src/types/index.ts`**

Find the `SubmitCodeTaskRequest` interface (line ~1226) and add `taskMode`:

```ts
export interface SubmitCodeTaskRequest {
  prompt: string;
  workerType?: CodeTaskWorkerType;
  linearIssueId?: string;
  taskMode?: 'planning' | 'execution';
}
```

- [ ] **Step 2: Verify `submitCodeTask` in `codeAgentApi.ts` already passes the full request object**

Read `apps/web/src/services/codeAgentApi.ts:81-90`. The function already does:
```ts
body: request,
```
This means `taskMode` will automatically be included in the POST body. No code change needed here.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(web): add taskMode field to SubmitCodeTaskRequest type"
```

---

## Task 3: Add task-mode toggle to `CodeTaskNewPage`

**Files:**
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`
- Test: `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`

The toggle should appear between the "Task Instructions" editor and the "Worker Type" selector. It defaults to `'planning'`. When "Link Existing" is selected, it defaults to `'execution'` (matching current implicit behavior). Users can override in either direction.

- [ ] **Step 1: Write the failing tests**

Add these test cases to `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`:

```ts
it('renders task mode selector with planning selected by default', async () => {
  render(<CodeTaskNewPage />);
  const planningButton = screen.getByRole('button', { name: /planning/i });
  expect(planningButton).toHaveClass('border-blue-500');
});

it('switches to execution mode when execution button is clicked', async () => {
  render(<CodeTaskNewPage />);
  const executionButton = screen.getByRole('button', { name: /execution/i });
  fireEvent.click(executionButton);
  expect(executionButton).toHaveClass('border-blue-500');
});

it('defaults to execution mode when linear mode is link', async () => {
  render(<CodeTaskNewPage />);
  // Click "Link Existing" to switch linear mode
  const linkButton = screen.getByRole('button', { name: /link existing/i });
  fireEvent.click(linkButton);
  // Task mode should auto-switch to execution
  const executionButton = screen.getByRole('button', { name: /execution/i });
  expect(executionButton).toHaveClass('border-blue-500');
});

it('includes taskMode in submit request', async () => {
  // This test verifies taskMode is included in the request body
  // Exact implementation depends on existing test patterns in this file
});
```

Note: Adjust assertions to match the existing test style and mock patterns already in the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter web run test -- --run src/__tests__/CodeTaskNewPage.test.tsx`
Expected: FAIL — no task mode buttons rendered.

- [ ] **Step 3: Implement the task-mode toggle in `CodeTaskNewPage.tsx`**

**3a. Add imports and constants** (top of file):

Add to imports:
```ts
import { ClipboardList, Rocket } from 'lucide-react';
```

Add type and constant after `type LinearMode`:
```ts
type TaskMode = 'planning' | 'execution';

const TASK_MODES: { id: TaskMode; name: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'planning',
    name: 'Planning',
    description: 'Analyze requirements, create a plan with acceptance criteria — no code written',
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    id: 'execution',
    name: 'Execution',
    description: 'Implement code based on the linked Linear issue plan',
    icon: <Rocket className="h-4 w-4" />,
  },
];
```

**3b. Add state** (inside `CodeTaskNewPage` function, near other `useState` calls):

```ts
const [taskMode, setTaskMode] = useState<TaskMode>('planning');
const taskModeManuallySet = useRef(false);
```

**3c. Add `useEffect` to auto-switch mode when linearMode changes** (after the existing `linearMode` effect):

```ts
useEffect(() => {
  if (taskModeManuallySet.current) return;
  if (linearMode === 'link') {
    setTaskMode('execution');
  } else {
    setTaskMode('planning');
  }
}, [linearMode]);
```

**3d. Include `taskMode` in the submit request** (in `handleConfirmSubmit`, update `requestData`):

```ts
const requestData: {
  prompt: string;
  workerType?: CodeTaskWorkerType;
  linearIssueId?: string;
  taskMode?: TaskMode;
} = {
  prompt: prompt.trim(),
  workerType,
  taskMode,
};
```

**3e. Add the UI toggle** (in the JSX, between the Task Instructions section and the Worker Type section — after the closing `</div>` of the markdown editor block and before the `<div>` with label "Worker Type"):

```tsx
<div>
  <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">Task Mode</label>
  <div className="flex flex-wrap gap-3">
    {TASK_MODES.map((mode) => (
      <button
        key={mode.id}
        type="button"
        onClick={(): void => {
          taskModeManuallySet.current = true;
          setTaskMode(mode.id);
        }}
        disabled={submitting}
        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2 ${
          taskMode === mode.id
            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
        } disabled:opacity-50`}
        title={mode.description}
      >
        {mode.icon}
        {mode.name}
      </button>
    ))}
  </div>
  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
    {TASK_MODES.find((m) => m.id === taskMode)?.description}
  </p>
</div>
```

**3f. Update placeholder text** to be mode-aware:

Replace the existing `placeholderText` const:
```ts
const placeholderText = taskMode === 'execution'
  ? 'Describe what you want the selected worker to build or fix...'
  : PLANNING_PLACEHOLDER;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter web run test -- --run src/__tests__/CodeTaskNewPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CodeTaskNewPage.tsx apps/web/src/__tests__/CodeTaskNewPage.test.tsx
git commit -m "feat(web): add task mode selector (planning/execution) to new code task form"
```

---

## Task 4: Update `ConfirmSubmitModal` to show task mode

**Files:**
- Modify: `apps/web/src/components/ConfirmSubmitModal.tsx`
- Modify: `apps/web/src/components/__tests__/ConfirmSubmitModal.test.tsx`
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx` (pass `taskMode` prop)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/components/__tests__/ConfirmSubmitModal.test.tsx`:

```ts
it('displays task mode when provided', () => {
  render(
    <ConfirmSubmitModal
      isOpen={true}
      taskTitle="Test Task"
      workerType="opus"
      taskMode="execution"
      onConfirm={async () => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText('Execution')).toBeTruthy();
});

it('displays Planning mode by default', () => {
  render(
    <ConfirmSubmitModal
      isOpen={true}
      taskTitle="Test Task"
      workerType="opus"
      taskMode="planning"
      onConfirm={async () => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText('Planning')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter web run test -- --run src/components/__tests__/ConfirmSubmitModal.test.tsx`
Expected: FAIL — `taskMode` prop not recognized.

- [ ] **Step 3: Update `ConfirmSubmitModal` component**

In `apps/web/src/components/ConfirmSubmitModal.tsx`:

**3a.** Update the props interface:

```ts
interface ConfirmSubmitModalProps {
  isOpen: boolean;
  taskTitle: string;
  workerType: CodeTaskWorkerType;
  taskMode: 'planning' | 'execution';
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}
```

**3b.** Destructure `taskMode` in the component signature:

```ts
export function ConfirmSubmitModal({
  isOpen,
  taskTitle,
  workerType,
  taskMode,
  onConfirm,
  onCancel,
}: ConfirmSubmitModalProps): React.JSX.Element | null {
```

**3c.** Add a task-mode label constant:

```ts
const taskModeLabel = taskMode === 'execution' ? 'Execution' : 'Planning';
```

**3d.** Update the confirmation text to include mode (after the worker type span):

```tsx
<p className="text-slate-700 dark:text-slate-200">
  Do you want to submit{' '}
  <span className="font-semibold text-slate-900 dark:text-white">
    &quot;{taskTitle}&quot;
  </span>{' '}
  as{' '}
  <span className="font-semibold text-blue-600 dark:text-blue-400">
    {taskModeLabel}
  </span>
  {' '}task using{' '}
  <span className="font-semibold text-blue-600 dark:text-blue-400">
    {workerTypeLabel}
  </span>
  ?
</p>
```

- [ ] **Step 4: Pass `taskMode` from `CodeTaskNewPage.tsx`**

Update the `<ConfirmSubmitModal>` usage in `CodeTaskNewPage.tsx`:

```tsx
<ConfirmSubmitModal
  isOpen={showConfirmModal}
  taskTitle={getTaskTitle()}
  workerType={workerType}
  taskMode={taskMode}
  onConfirm={handleConfirmSubmit}
  onCancel={handleCancelModal}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter web run test -- --run src/components/__tests__/ConfirmSubmitModal.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ConfirmSubmitModal.tsx apps/web/src/components/__tests__/ConfirmSubmitModal.test.tsx apps/web/src/pages/CodeTaskNewPage.tsx
git commit -m "feat(web): show task mode in confirm submit modal"
```

---

## Task 5: Accept `taskMode` in `POST /code/submit` backend endpoint

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:1615-1810`
- Test: `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`:

```ts
it('sets agentType to execution when taskMode is execution', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Implement the feature',
      taskMode: 'execution',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  // Verify the created task has agentType = 'execution'
  const task = await codeTaskRepo.getById(body.data.codeTaskId);
  expect(task?.agentType).toBe('execution');
});

it('sets agentType to planning when taskMode is planning', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Plan the authentication system',
      taskMode: 'planning',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  const task = await codeTaskRepo.getById(body.data.codeTaskId);
  expect(task?.agentType).toBe('planning');
});

it('falls back to label-based detection when taskMode is not provided', async () => {
  // This tests backward compatibility — existing behavior unchanged
  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Do something',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  const task = await codeTaskRepo.getById(body.data.codeTaskId);
  // Without code-task label, defaults to planning
  expect(task?.agentType).toBe('planning');
});

it('taskMode takes precedence over label-based detection', async () => {
  // Even if the linked issue has code-task label, explicit taskMode wins
  // (This test requires linking an issue with code-task label
  //  but sending taskMode='planning')
  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Plan the feature',
      linearIssueId: 'INT-999',
      taskMode: 'planning',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  const task = await codeTaskRepo.getById(body.data.codeTaskId);
  expect(task?.agentType).toBe('planning');
});
```

Note: Adapt these tests to use the exact mock/fake patterns already established in `codeSubmit.test.ts` (e.g., fake Linear client returning labels, fake enqueue service). The above shows the intent — the actual test code must match the existing `beforeEach` setup.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter code-agent run test -- --run src/__tests__/routes/codeSubmit.test.ts`
Expected: FAIL — `taskMode` not accepted / not affecting `agentType`.

- [ ] **Step 3: Update the route handler in `codeRoutes.ts`**

**3a. Update the Fastify schema** (in the `schema.body.properties` at line ~1632):

Add `taskMode` to the body schema properties:

```ts
properties: {
  prompt: { type: 'string', minLength: 1, maxLength: 100000 },
  workerType: workerTypeSchema,
  linearIssueId: { type: 'string' },
  taskMode: { type: 'string', enum: ['planning', 'execution'] },
},
```

**3b. Update the Body type** (line ~1617):

```ts
Body: {
  prompt: string;
  workerType?: WorkerType;
  linearIssueId?: string;
  taskMode?: 'planning' | 'execution';
};
```

**3c. Update the body destructuring** (line ~1751):

```ts
const body = request.body as {
  prompt: string;
  workerType?: WorkerType;
  linearIssueId?: string;
  taskMode?: 'planning' | 'execution';
};
```

**3d. Update the `agentType` assignment** (line ~1809):

Replace:
```ts
agentType: hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning',
```

With:
```ts
agentType: body.taskMode ?? (hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning'),
```

This means:
- If the user explicitly selected a task mode in the UI → use it.
- If not provided (backward compatibility, API callers, etc.) → fall back to existing label-based detection.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter code-agent run test -- --run src/__tests__/routes/codeSubmit.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full code-agent test suite to verify no regressions**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts apps/code-agent/src/__tests__/routes/codeSubmit.test.ts
git commit -m "feat(code-agent): accept taskMode in POST /code/submit to override label-based agent type detection"
```

---

## Task 6: Full CI verification

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS — all workspaces green.

- [ ] **Step 3: Final commit if any lint/type fixes needed**

```bash
git add -A
git commit -m "fix: address CI feedback from task mode selector implementation"
```

---

## Endpoint Changes

### Modified

| Method   | Path           | Change                                         |
| -------- | -------------- | ---------------------------------------------- |
| POST     | `/code/submit` | Added optional `taskMode` field (`'planning' \ | 'execution'`) to request body. When present, it overrides label-based `agentType` detection. When absent, behavior is unchanged (backward compatible). |

### Created

None.

### Removed

None.

### Unchanged

All other endpoints in `codeRoutes.ts` remain unchanged. The orchestrator (`system-prompt.ts`) requires no changes because it already branches on the `agentType` field set at task creation.

---

## Design Decisions

1. **`taskMode` naming**: The field sent from the UI is called `taskMode` (not `agentType`) to distinguish user intent from the internal system concept. The backend maps `taskMode` → `agentType`. This prevents leaking internal agent types (`pull_request`, `review`, `remediation`, `ask_agent`) to the UI.

2. **Backward compatibility**: `taskMode` is optional. When omitted, the existing `hasCodeTaskLabel()` heuristic applies. This means the Linear agent, internal API callers, and any other code paths that create tasks without the UI continue to work unchanged.

3. **Default behavior**: "Planning" is the default mode (matching current behavior for new issues). When the user selects "Link Existing" in the Linear section, the mode auto-switches to "Execution" (matching the current implicit expectation), but the user can override this.

4. **No shared type for `taskMode` in `common-core`**: Although we created `CodeTaskAgentType` in Task 1 for potential reuse, the web app uses a local `TaskMode` type inline. This is intentional — the UI concept (`taskMode`) should not be tightly coupled to backend agent type enums. If future features need the shared type, it is available.

5. **No orchestrator changes**: The orchestrator already reads `agentType` from the task document and branches accordingly. Since we set `agentType` correctly at task creation, no downstream changes are needed.
