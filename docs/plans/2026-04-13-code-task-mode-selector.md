# Code Task Planning/Execution Mode Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to explicitly choose between "Planning" and "Execution" mode when creating a new code task from the UI, with proper propagation through the API to select the correct agent type and system prompt.

**Architecture:** Add a `taskMode` field (`'planning' | 'execution'`) to the submit form, API request, and backend handler. The UI defaults to "Planning" when creating a new issue and "Execution" when linking an existing issue (with override allowed). The backend uses the explicit `taskMode` from the request instead of inferring from Linear issue labels. The orchestrator's existing prompt routing (planning vs execution based on `agentType`) remains unchanged.

**Tech Stack:** React (apps/web), Fastify (apps/code-agent), TypeScript, TailwindCSS

---

## Current Architecture (Reference)

### How agent type is determined today

1. User submits `{ prompt, workerType, linearIssueId }` from `CodeTaskNewPage.tsx`
2. Backend (`codeRoutes.ts:1809`) calls `hasCodeTaskLabel(issueResult.linearIssueLabels)`:
   - If the linked Linear issue has a `code-task` label → `agentType = 'execution'`
   - Otherwise → `agentType = 'planning'`
3. The orchestrator builds a different system prompt per agent type (`planningPrompt` vs `executionPrompt`)

### Problem

- The user has **no control** over whether a task runs as planning or execution
- The only way to get execution mode is to have a `code-task` label on the Linear issue beforehand
- There is a separate "Implement" button on the task detail page (`POST /code/tasks/:taskId/implement`) but that requires a completed planning task first — no way to go directly to execution from the creation form

### What changes

| Layer          | File                                                             | Change                                                |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Web types      | `apps/web/src/types/index.ts`                                    | Add `taskMode` to `SubmitCodeTaskRequest`             |
| Web UI         | `apps/web/src/pages/CodeTaskNewPage.tsx`                         | Add task mode selector, wire defaults                 |
| Web UI         | `apps/web/src/components/ConfirmSubmitModal.tsx`                 | Show selected task mode in confirmation               |
| API client     | `apps/web/src/services/codeAgentApi.ts`                          | No change needed (already passes full request object) |
| Backend schema | `apps/code-agent/src/routes/codeRoutes.ts`                       | Add `taskMode` to `/code/submit` body schema          |
| Backend logic  | `apps/code-agent/src/routes/codeRoutes.ts`                       | Use explicit `taskMode` to set `agentType`            |
| Tests          | `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`                | Test mode selector behavior and defaults              |
| Tests          | `apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`        | Test `taskMode` parameter handling                    |

### Endpoint Changes

**Modified:**
- `POST /code/submit` — adds optional `taskMode` field to request body

**Created:** none
**Removed:** none
**Unchanged:** `POST /code/tasks/:taskId/implement`, all other endpoints

---

## Task 1: Add `taskMode` to Web Types

**Files:**
- Modify: `apps/web/src/types/index.ts:1226-1230`

- [ ] **Step 1: Add TaskMode type and update SubmitCodeTaskRequest**

In `apps/web/src/types/index.ts`, add the type alias and the new field:

```typescript
// Add near the top of the code task types section (before SubmitCodeTaskRequest)
export type TaskMode = 'planning' | 'execution';

// Update the existing interface
export interface SubmitCodeTaskRequest {
  prompt: string;
  workerType?: CodeTaskWorkerType;
  linearIssueId?: string;
  taskMode?: TaskMode;
}
```

The field is optional — omitting it preserves backward compatibility (backend falls back to label-based inference).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(web): add TaskMode type to SubmitCodeTaskRequest"
```

---

## Task 2: Add Task Mode Selector to CodeTaskNewPage

**Files:**
- Modify: `apps/web/src/pages/CodeTaskNewPage.tsx`

- [ ] **Step 1: Write the failing test — mode selector renders with two options**

In `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`, add a test (follow existing test patterns in the file):

```typescript
it('renders task mode selector with Planning and Execution options', () => {
  render(<CodeTaskNewPage />);
  expect(screen.getByRole('button', { name: /planning/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /execution/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test -- --run CodeTaskNewPage
```

Expected: FAIL — buttons not found.

- [ ] **Step 3: Add imports and constants for task mode**

At the top of `CodeTaskNewPage.tsx`, add imports and constants:

```typescript
import { ClipboardList, Rocket } from 'lucide-react';
import type { TaskMode } from '@/types';
```

Add the mode definitions after the existing `LINEAR_MODES` array:

```typescript
type TaskModeOption = { id: TaskMode; name: string; description: string; icon: React.ReactNode };

const TASK_MODES: TaskModeOption[] = [
  {
    id: 'planning',
    name: 'Planning',
    description: 'Analyze, design, and create a plan — no code is written',
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    id: 'execution',
    name: 'Execution',
    description: 'Implement code changes, run CI, and create a PR',
    icon: <Rocket className="h-4 w-4" />,
  },
];
```

- [ ] **Step 4: Add state and auto-default logic**

Inside the `CodeTaskNewPage` component function, add state after the existing `linearMode` state:

```typescript
const [taskMode, setTaskMode] = useState<TaskMode>('planning');
```

Update the existing `useEffect` that syncs the default prompt when `linearMode` changes. Replace the current effect (lines ~93-100) with one that also sets the task mode default:

```typescript
// Sync defaults when linearMode changes (only if user hasn't manually edited)
useEffect(() => {
  if (linearMode === 'link') {
    setTaskMode('execution');
    if (!promptManuallyEdited.current) {
      setPrompt(EXECUTION_DEFAULT_PROMPT);
    }
  } else {
    setTaskMode('planning');
    if (!promptManuallyEdited.current) {
      setPrompt('');
    }
  }
}, [linearMode]);
```

This makes the UX intuitive: "Create New" → planning, "Link Existing" → execution. The user can still override.

- [ ] **Step 5: Add task mode selector UI between Worker Type and Linear Issue sections**

Insert the following JSX block after the Worker Type `<div>` (after line ~302, before the `hasNoWorkers` check):

```tsx
<div>
  <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">Task Mode</label>
  <div className="flex flex-wrap gap-3">
    {TASK_MODES.map((mode) => (
      <button
        key={mode.id}
        type="button"
        onClick={(): void => {
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

This follows the exact same pattern as the existing Worker Type selector.

- [ ] **Step 6: Wire taskMode into the submit request**

In the `handleConfirmSubmit` function, update the `requestData` construction (around line ~135-147):

```typescript
const requestData: SubmitCodeTaskRequest = {
  prompt: prompt.trim(),
  workerType,
  taskMode,
};

// Only send linearIssueId if linking to existing issue
if (linearMode === 'link' && selectedIssue !== null) {
  requestData.linearIssueId = selectedIssue.identifier;
}
```

Note: import `SubmitCodeTaskRequest` type from `@/types` (add to existing import at line 10).

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm --filter web test -- --run CodeTaskNewPage
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/CodeTaskNewPage.tsx apps/web/src/__tests__/CodeTaskNewPage.test.tsx
git commit -m "feat(web): add task mode selector to CodeTaskNewPage"
```

---

## Task 3: Write Tests for Task Mode Defaults and Overrides

**Files:**
- Modify: `apps/web/src/__tests__/CodeTaskNewPage.test.tsx`

- [ ] **Step 1: Write test — defaults to Planning when creating new issue**

```typescript
it('defaults to Planning mode when linear mode is Create New', () => {
  render(<CodeTaskNewPage />);
  const planningButton = screen.getByRole('button', { name: /planning/i });
  // Planning should be selected (has blue styling)
  expect(planningButton.className).toContain('border-blue-500');
});
```

- [ ] **Step 2: Write test — switches to Execution when linking an existing issue**

```typescript
it('switches to Execution mode when linking an existing issue', async () => {
  render(<CodeTaskNewPage />);
  
  // Click "Link Existing" button
  await userEvent.click(screen.getByRole('button', { name: /link existing/i }));
  
  // Execution mode should now be selected
  const executionButton = screen.getByRole('button', { name: /execution/i });
  expect(executionButton.className).toContain('border-blue-500');
});
```

- [ ] **Step 3: Write test — user can override task mode after auto-default**

```typescript
it('allows user to override task mode back to Planning after linking issue', async () => {
  render(<CodeTaskNewPage />);
  
  // Click "Link Existing" to switch to execution
  await userEvent.click(screen.getByRole('button', { name: /link existing/i }));
  
  // Override back to planning
  await userEvent.click(screen.getByRole('button', { name: /planning/i }));
  
  const planningButton = screen.getByRole('button', { name: /planning/i });
  expect(planningButton.className).toContain('border-blue-500');
});
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter web test -- --run CodeTaskNewPage
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/__tests__/CodeTaskNewPage.test.tsx
git commit -m "test(web): add tests for task mode selector defaults and overrides"
```

---

## Task 4: Update ConfirmSubmitModal to Show Task Mode

**Files:**
- Modify: `apps/web/src/components/ConfirmSubmitModal.tsx`

- [ ] **Step 1: Write the failing test**

In the existing ConfirmSubmitModal test file (create if needed at `apps/web/src/__tests__/ConfirmSubmitModal.test.tsx`):

```typescript
it('displays task mode in confirmation', () => {
  render(
    <ConfirmSubmitModal
      isOpen={true}
      taskTitle="Test task"
      workerType="auto"
      taskMode="execution"
      onConfirm={async () => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText(/execution/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web test -- --run ConfirmSubmitModal
```

Expected: FAIL — `taskMode` prop not accepted.

- [ ] **Step 3: Add taskMode prop to ConfirmSubmitModal**

Update `apps/web/src/components/ConfirmSubmitModal.tsx`:

```typescript
import type { TaskMode } from '@/types';

interface ConfirmSubmitModalProps {
  isOpen: boolean;
  taskTitle: string;
  workerType: CodeTaskWorkerType;
  taskMode: TaskMode;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}
```

Update the function signature:

```typescript
export function ConfirmSubmitModal({
  isOpen,
  taskTitle,
  workerType,
  taskMode,
  onConfirm,
  onCancel,
}: ConfirmSubmitModalProps): React.JSX.Element | null {
```

Add the mode label constant:

```typescript
const TASK_MODE_LABELS: Record<TaskMode, string> = {
  planning: 'Planning',
  execution: 'Execution',
};
```

Update the confirmation text (the `<p>` inside the overflow-y-auto div) to include the mode:

```tsx
<p className="text-slate-700 dark:text-slate-200">
  Do you want to submit{' '}
  <span className="font-semibold text-slate-900 dark:text-white">
    &quot;{taskTitle}&quot;
  </span>{' '}
  as{' '}
  <span className="font-semibold text-blue-600 dark:text-blue-400">
    {workerTypeLabel}
  </span>
  {' '}in{' '}
  <span className="font-semibold text-blue-600 dark:text-blue-400">
    {TASK_MODE_LABELS[taskMode]}
  </span>
  {' '}mode?
</p>
```

- [ ] **Step 4: Update the caller in CodeTaskNewPage.tsx**

Pass `taskMode` to the modal:

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

```bash
pnpm --filter web test -- --run ConfirmSubmitModal
pnpm --filter web test -- --run CodeTaskNewPage
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ConfirmSubmitModal.tsx apps/web/src/pages/CodeTaskNewPage.tsx apps/web/src/__tests__/ConfirmSubmitModal.test.tsx
git commit -m "feat(web): show task mode in confirmation modal"
```

---

## Task 5: Backend — Accept `taskMode` in `/code/submit`

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts:1623-1881`

- [ ] **Step 1: Write the failing test — taskMode=execution sets agentType to execution**

In the submit code task test file (`apps/code-agent/src/__tests__/routes/codeSubmit.test.ts`):

```typescript
it('uses explicit taskMode=execution to set agentType', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Implement the feature',
      workerType: 'auto',
      taskMode: 'execution',
    },
  });

  expect(response.statusCode).toBe(200);
  
  // Verify the created task has agentType = 'execution'
  const createdTask = fakeCodeTaskRepo.getLastCreated();
  expect(createdTask.agentType).toBe('execution');
});
```

Adapt the test to match the existing test infrastructure (use `setServices`, `fakeCodeTaskRepo`, etc. — read the existing test file first to follow patterns).

- [ ] **Step 2: Write the failing test — taskMode=planning sets agentType to planning**

```typescript
it('uses explicit taskMode=planning to set agentType even when issue has code-task label', async () => {
  // Setup: stub linearIssueService to return labels including 'code-task'
  fakeLinearIssueService.setLabels(['code-task']);

  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Plan this feature',
      workerType: 'auto',
      taskMode: 'planning',
      linearIssueId: 'INT-999',
    },
  });

  expect(response.statusCode).toBe(200);
  
  // Even though issue has code-task label, explicit taskMode overrides
  const createdTask = fakeCodeTaskRepo.getLastCreated();
  expect(createdTask.agentType).toBe('planning');
});
```

- [ ] **Step 3: Write the failing test — omitted taskMode falls back to label-based inference**

```typescript
it('falls back to label-based inference when taskMode is omitted', async () => {
  fakeLinearIssueService.setLabels(['code-task']);

  const response = await app.inject({
    method: 'POST',
    url: '/code/submit',
    headers: { authorization: 'Bearer valid-token' },
    payload: {
      prompt: 'Do something',
      workerType: 'auto',
      // No taskMode — should fall back to label check
    },
  });

  expect(response.statusCode).toBe(200);
  const createdTask = fakeCodeTaskRepo.getLastCreated();
  expect(createdTask.agentType).toBe('execution'); // because label says code-task
});
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
pnpm --filter code-agent test -- --run codeRoutes.submit
```

Expected: FAIL — `taskMode` not recognized in schema / not used in logic.

- [ ] **Step 5: Add `taskMode` to the Fastify body schema**

In `codeRoutes.ts`, update the `/code/submit` route schema body (around line 1631-1638):

```typescript
body: {
  type: 'object',
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 100000 },
    workerType: workerTypeSchema,
    linearIssueId: { type: 'string' },
    taskMode: { type: 'string', enum: ['planning', 'execution'] },
  },
  required: ['prompt'],
},
```

- [ ] **Step 6: Update the handler to use explicit taskMode**

In the handler function (around line 1744), update the body type:

```typescript
const body = request.body as {
  prompt: string;
  workerType?: WorkerType;
  linearIssueId?: string;
  taskMode?: 'planning' | 'execution';
};
```

Then update the `agentType` line (line 1809) to prefer explicit `taskMode`:

```typescript
agentType: body.taskMode ?? (hasCodeTaskLabel(issueResult.linearIssueLabels) ? 'execution' : 'planning'),
```

This is the critical change: explicit `taskMode` from the UI takes priority; when absent, the existing label-based inference is preserved as a fallback.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter code-agent test -- --run codeRoutes.submit
```

Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts apps/code-agent/src/__tests__/routes/codeSubmit.test.ts
git commit -m "feat(code-agent): accept explicit taskMode in /code/submit endpoint"
```

---

## Task 6: Full CI Verification

**Files:** none (verification only)

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 2: Run full tracked CI**

```bash
pnpm run ci:tracked
```

Expected: All checks pass (lint, type-check, tests, coverage).

- [ ] **Step 3: Fix any issues found**

If any test or type error, fix it. Common things to watch for:

- Other tests that render `<ConfirmSubmitModal>` without the new `taskMode` prop — update them
- TypeScript strict mode errors from missing `taskMode` in test fixtures
- Snapshot tests that need updating

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: address CI issues from task mode feature"
```

---

## Design Decisions

| Decision                                | Rationale                                                                                                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskMode` field name (not `agentType`) | `agentType` has 6 values internally (`planning`, `execution`, `pull_request`, `review`, `remediation`, `ask_agent`). Exposing only 2 user-facing choices as a distinct `taskMode` field keeps the API clean and prevents users from setting internal-only agent types. |
| Optional field with fallback            | Backward compatibility — existing callers (WhatsApp integration, linear-agent triggers) don't need to change.                                                                                                                                                          |
| Auto-default based on Linear mode       | "Create New" → planning (design-first flow) and "Link Existing" → execution (issue already exists, user wants implementation) matches the natural user mental model.                                                                                                   |
| User can override the auto-default      | The user knows best — if they want to re-plan an existing issue or execute a new one, they can.                                                                                                                                                                        |
| No changes to orchestrator              | The orchestrator already routes on `agentType` which the backend sets. The new `taskMode` → `agentType` mapping happens entirely in `codeRoutes.ts`.                                                                                                                   |
