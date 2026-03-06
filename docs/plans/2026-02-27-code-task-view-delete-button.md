# Code Task View Page — Delete Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Delete" button with confirmation dialog to the Code Task View page (`CodeTaskViewPage.tsx`), available under the same conditions as "Retry" (i.e., when `task.status` is `failed`, `cancelled`, or `interrupted`).

**Architecture:** The backend `DELETE /code/tasks/:taskId` endpoint and the `deleteCodeTask` API client function already exist. The `useCodeTasks` hook (used on the list page) already has `deleteTask`. We only need to: (1) add `deleteTask` to the `useTaskView` hook, (2) wire up confirmation UI in `TaskActions` within `CodeTaskViewPage.tsx`, and (3) add tests for the new API and hook logic.

**Tech Stack:** React 18, TypeScript strict mode, Vitest, `@testing-library/react`, lucide-react icons.

---

## Context

- `DELETE /code/tasks/:taskId` backend route: `apps/code-agent/src/routes/codeRoutes.ts:1839`
- API client: `apps/web/src/services/codeAgentApi.ts` — `deleteCodeTask()` already exists
- View hook: `apps/web/src/hooks/useTaskView.ts` — **needs `deleteTask` added**
- View page: `apps/web/src/pages/CodeTaskViewPage.tsx` — **needs Delete button in `TaskActions`**
- Delete confirmation pattern: `apps/web/src/pages/CodeTasksPage.tsx:363-393` (reference implementation)
- Condition for Retry (same for Delete): `task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted'` (line 190 of CodeTaskViewPage.tsx)

---

## Task 1: Add `deleteCodeTask` test to `codeAgentApi.test.ts`

**Files:**
- Modify: `apps/web/src/services/__tests__/codeAgentApi.test.ts`

Note: `deleteCodeTask` is already implemented in `codeAgentApi.ts` but not tested in the test file.

**Step 1: Add `deleteCodeTask` to the import at the top of the test file**

In `codeAgentApi.test.ts`, the import block starts at line 7:
```typescript
import {
  listCodeTasks,
  getCodeTask,
  submitCodeTask,
  cancelCodeTask,
  getWorkersStatus,
  deleteCodeTask,   // add this
} from '../codeAgentApi';
```

**Step 2: Add the `deleteCodeTask` describe block after the `cancelCodeTask` describe block (around line 266)**

```typescript
describe('deleteCodeTask', () => {
  it('calls DELETE on /code/tasks/:taskId', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ deleted: true });

    await deleteCodeTask(mockAccessToken, 'task-123');

    expect(apiRequest).toHaveBeenCalledWith(
      'https://code-agent.test',
      '/code/tasks/task-123',
      mockAccessToken,
      { method: 'DELETE' }
    );
  });
});
```

**Step 3: Run the test to verify it passes**

```bash
cd /repo && pnpm --filter web test -- --testPathPattern="codeAgentApi" --run
```

Expected: all tests pass including the new `deleteCodeTask` test.

**Step 4: Commit**

```bash
git add apps/web/src/services/__tests__/codeAgentApi.test.ts
git commit -m "test(web): add deleteCodeTask test to codeAgentApi test suite"
```

---

## Task 2: Add `deleteTask` to `useTaskView.ts`

**Files:**
- Modify: `apps/web/src/hooks/useTaskView.ts`

After the delete, the page should navigate the user back to the task list (`/code-tasks`). The hook doesn't have access to `navigate` — that lives in the page component. Therefore the `deleteTask` function in the hook should only do the API call; navigation happens in the page.

**Step 1: Add API import**

In `useTaskView.ts`, the existing imports from `@/services/codeAgentApi` are on line 14:
```typescript
import {
  getCodeTask as getCodeTaskApi,
  cancelCodeTask as cancelCodeTaskApi,
  retryCodeTask as retryCodeTaskApi,
  sendTaskMessage as sendTaskMessageApi,
  startImplementation as startImplementationApi,
  deleteCodeTask as deleteCodeTaskApi,   // add this
} from '@/services/codeAgentApi';
```

**Step 2: Add `deleting` and `deleteError` state to the `TaskViewState` interface (around line 36)**

```typescript
export interface TaskViewState {
  // ... existing fields ...
  deleting: boolean;
  deleteError: string | null;
  // ... existing action fields ...
  deleteTask: () => Promise<void>;
}
```

**Step 3: Add state variables after the `implementError`/`implementing` declarations (around line 82)**

```typescript
const [deleting, setDeleting] = useState(false);
const [deleteError, setDeleteError] = useState<string | null>(null);
```

**Step 4: Add `deleteTask` callback after `startImplementation` (around line 403)**

```typescript
const deleteTask = useCallback(async (): Promise<void> => {
  if (task === null) return;
  setDeleting(true);
  setDeleteError(null);
  try {
    const token = await getAccessTokenRef.current();
    await deleteCodeTaskApi(token, task.id);
  } catch (err) {
    if (isMountedRef.current) {
      setDeleteError(getErrorMessage(err, 'Failed to delete task'));
    }
    throw err;
  } finally {
    if (isMountedRef.current) {
      setDeleting(false);
    }
  }
}, [task]);
```

**Step 5: Add to the return object (after `startImplementation`)**

```typescript
return {
  // ... existing fields ...
  deleting,
  deleteError,
  deleteTask,
};
```

**Step 6: Run typecheck to verify**

```bash
cd /repo && pnpm --filter web exec tsc --noEmit
```

Expected: no errors.

**Step 7: Commit**

```bash
git add apps/web/src/hooks/useTaskView.ts
git commit -m "feat(web): add deleteTask to useTaskView hook"
```

---

## Task 3: Wire up Delete button in `CodeTaskViewPage.tsx`

**Files:**
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx`

The Delete button appears alongside Retry in `TaskActions`. It shows an inline confirmation (matching the pattern in `CodeTasksPage.tsx`).

**Step 1: Add `Trash2` to lucide-react imports (line 3)**

```typescript
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  Play,
  RotateCcw,
  Send,
  StopCircle,
  Trash2,        // add this
  WifiOff,
  XCircle,
} from 'lucide-react';
```

**Step 2: Destructure the new hook values in `CodeTaskViewPage` (around line 125)**

```typescript
const {
  task, logs, loading, error,
  listenerHealthy,
  cancelling, cancelError, retrying, retryError,
  sending, sendError, messageStatus,
  implementing, implementError, startImplementation,
  deleting, deleteError, deleteTask,     // add these
  cancelTask, retryTask, sendMessage,
} = useTaskView(id ?? '');
```

**Step 3: Add `showDeleteConfirm` state and `handleDelete` callback after `showImplementDropdown` (around line 138)**

```typescript
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

const handleDelete = useCallback(async (): Promise<void> => {
  try {
    await deleteTask();
    void navigate('/code-tasks');
  } catch {
    // deleteTask already sets deleteError state
  }
}, [deleteTask, navigate]);
```

**Step 4: Pass new props to `MemoTaskActions` (around line 244)**

```typescript
<MemoTaskActions
  isActive={isActive}
  cancelling={cancelling}
  cancelError={cancelError}
  onCancel={cancelTask}
  isRetryable={isRetryable}
  retrying={retrying}
  retryError={retryError}
  selectedWorkerType={selectedWorkerType}
  showDropdown={showRetryDropdown}
  onToggleDropdown={(): void => { setShowRetryDropdown(!showRetryDropdown); }}
  onSelectWorkerType={(type): void => { void handleRetryWithWorkerType(type); }}
  isRetryable={isRetryable}
  deleting={deleting}
  deleteError={deleteError}
  showDeleteConfirm={showDeleteConfirm}
  onShowDeleteConfirm={(): void => { setShowDeleteConfirm(true); }}
  onCancelDeleteConfirm={(): void => { setShowDeleteConfirm(false); }}
  onConfirmDelete={(): void => { void handleDelete(); }}
/>
```

**Step 5: Update the `TaskActions` function signature and body (around line 387)**

Add new props to the destructure and type:
```typescript
function TaskActions({
  isActive, cancelling, cancelError, onCancel,
  isRetryable, retrying, retryError,
  selectedWorkerType, showDropdown, onToggleDropdown, onSelectWorkerType,
  deleting, deleteError, showDeleteConfirm,
  onShowDeleteConfirm, onCancelDeleteConfirm, onConfirmDelete,
}: {
  isActive: boolean;
  cancelling: boolean;
  cancelError: string | null;
  onCancel: () => Promise<void>;
  isRetryable: boolean;
  retrying: boolean;
  retryError: string | null;
  selectedWorkerType: WorkerType;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  onSelectWorkerType: (type: WorkerType) => void;
  deleting: boolean;
  deleteError: string | null;
  showDeleteConfirm: boolean;
  onShowDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onConfirmDelete: () => void;
}): React.JSX.Element | null {
  if (!isActive && !isRetryable && cancelError === null && retryError === null && deleteError === null) return null;
  // ...
```

**Step 6: Add Delete button UI inside `TaskActions` — after the Retry block and before the error displays**

```tsx
{isRetryable ? (
  !showDeleteConfirm ? (
    <Button
      variant="ghost"
      onClick={onShowDeleteConfirm}
      disabled={deleting || retrying}
      className="text-slate-600 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
    >
      <Trash2 className="h-4 w-4 sm:mr-2" />
      <span className="hidden sm:inline">Delete</span>
    </Button>
  ) : (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30">
      <p className="mb-3 text-sm text-red-800 dark:text-red-400">
        Delete this task permanently?
      </p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          onClick={onConfirmDelete}
          disabled={deleting}
          isLoading={deleting}
          loadingText="Deleting..."
        >
          Delete
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancelDeleteConfirm}
          disabled={deleting}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
) : null}
{deleteError !== null ? (
  <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
) : null}
```

**Step 7: Run typecheck to verify**

```bash
cd /repo && pnpm --filter web exec tsc --noEmit
```

Expected: no errors.

**Step 8: Run lint**

```bash
cd /repo && pnpm --filter web lint
```

Expected: no errors.

**Step 9: Commit**

```bash
git add apps/web/src/pages/CodeTaskViewPage.tsx
git commit -m "feat(web): add Delete button with confirmation to CodeTaskViewPage"
```

---

## Task 4: Add `deleteTask` tests to `useCodeTasks.test.ts`

**Files:**
- Modify: `apps/web/src/hooks/__tests__/useCodeTasks.test.ts`

The `useCodeTasks` hook already has `deleteTask` but it's not tested. Add coverage.

**Step 1: Add `mockDeleteCodeTask` to the mock setup (around line 28)**

```typescript
const mockDeleteCodeTask = vi.fn();
```

**Step 2: Add `deleteCodeTask` to the `vi.mock` for `codeAgentApi.js` (around line 31)**

```typescript
vi.mock('../../services/codeAgentApi.js', () => ({
  listCodeTasks: (...args: unknown[]): unknown => mockListCodeTasks(...args),
  submitCodeTask: (...args: unknown[]): unknown => mockSubmitCodeTask(...args),
  deleteCodeTask: (...args: unknown[]): unknown => mockDeleteCodeTask(...args),
  getWorkersStatus: (...args: unknown[]): unknown => mockGetWorkersStatus(...args),
}));
```

**Step 3: Add test cases in the `useCodeTasks` describe block, after the existing `submitTask` test**

```typescript
it('deletes a task and removes it from the list', async () => {
  mockListCodeTasks.mockResolvedValue({
    tasks: [mockTask],
    nextCursor: undefined,
  });
  mockDeleteCodeTask.mockResolvedValue(undefined);

  const { result } = renderHook(() => useCodeTasks());

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  await act(async () => {
    await result.current.deleteTask('task-123');
  });

  expect(mockDeleteCodeTask).toHaveBeenCalledWith('test-token', 'task-123');
  expect(result.current.tasks).toHaveLength(0);
});

it('propagates deleteTask errors', async () => {
  mockListCodeTasks.mockResolvedValue({
    tasks: [mockTask],
    nextCursor: undefined,
  });
  mockDeleteCodeTask.mockRejectedValue(new Error('Delete failed'));

  const { result } = renderHook(() => useCodeTasks());

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });

  await expect(
    act(async () => {
      await result.current.deleteTask('task-123');
    })
  ).rejects.toThrow('Delete failed');

  // Task should remain in list since delete failed
  expect(result.current.tasks).toHaveLength(1);
});
```

**Step 4: Run tests**

```bash
cd /repo && pnpm --filter web test -- --testPathPattern="useCodeTasks" --run
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add apps/web/src/hooks/__tests__/useCodeTasks.test.ts
git commit -m "test(web): add deleteTask tests to useCodeTasks hook"
```

---

## Task 5: Full CI verification

**Step 1: Run full CI**

```bash
cd /repo && pnpm run ci:tracked
```

Expected: all checks pass.

**Step 2: If any failures, fix them before committing**

---

## Acceptance Criteria

- [ ] "Delete" button appears on the task view page when task status is `failed`, `cancelled`, or `interrupted` (same condition as "Retry")
- [ ] Clicking "Delete" shows an inline confirmation (matches the pattern in `CodeTasksPage.tsx`)
- [ ] Confirming delete calls `DELETE /code/tasks/:taskId` and navigates to `/code-tasks` on success
- [ ] Cancel dismisses the confirmation without any API call
- [ ] During deletion, the button shows a loading state ("Deleting...")
- [ ] If deletion fails, an error message is shown in the same area as other errors
- [ ] `deleteCodeTask` API function has a test in `codeAgentApi.test.ts`
- [ ] `deleteTask` in `useCodeTasks` hook has tests covering success and failure paths
- [ ] Full CI passes

---

## Endpoint Changes

No new endpoints. Existing endpoint used:

| Service      | Method   | Path                      | Change      |
| ------------ | -------- | ------------------------- | ----------- |
| code-agent   | DELETE   | `/code/tasks/:taskId`     | Unchanged   |
