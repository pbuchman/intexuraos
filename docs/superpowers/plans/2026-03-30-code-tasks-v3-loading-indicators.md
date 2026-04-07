# Code Tasks V3 Loading Indicators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual loading indicators for filter/sort changes and color-coded row states for archive/delete actions in Code Tasks V3.

**Architecture:** Two independent features on two files. Feature 1 (filter/sort shimmer) touches `CodeTasksPageV3.tsx` only. Feature 2 (row-level indicators) touches both `CodeTasksPageV3.tsx` and `IssueGroupRow.tsx`. Task 1 and Task 2 are fully independent and can run in parallel. Task 3 depends on both.

**Tech Stack:** React, TypeScript (strict mode), Tailwind CSS, CSS keyframe animations

**Spec:** `docs/superpowers/specs/2026-03-30-code-tasks-v3-loading-indicators-design.md`

---

## Parallelism Map

```
Task 1 (IssueGroupRow.tsx) ──────────┐
                                      ├──> Task 3 (CodeTasksPageV3.tsx — wire everything together)
Task 2 (index.css — shimmer CSS) ────┘
```

- **Task 1** and **Task 2** have zero file overlap — run in parallel via separate subagents.
- **Task 3** depends on both completing — it wires the new props and state into the page.

---

### Task 1: Color-Coded WaveLoader + Row States in IssueGroupRow

**Files:**
- Modify: `apps/web/src/components/code-tasks/IssueGroupRow.tsx`

This task adds the `variant` prop to `WaveLoader`, adds `actioningType` and `onDeleteGroup` props to `IssueGroupRow`, and implements the color-coded row states (opacity, accent override, state tags). It also rewires the delete confirmation to call `onDeleteGroup` instead of looping `onAction`.

- [ ] **Step 1: Add `variant` prop to WaveLoader**

In `apps/web/src/components/code-tasks/IssueGroupRow.tsx`, replace the `WaveLoader` function (lines 97-110) with:

```tsx
type WaveLoaderVariant = 'default' | 'archive' | 'delete';

const WAVE_COLORS: Record<WaveLoaderVariant, { border: string; bg: string; trackBg: string; dotClass: string }> = {
  default: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    trackBg: 'bg-blue-500/15',
    dotClass: 'wave-dot',
  },
  archive: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
    trackBg: 'bg-amber-500/15',
    dotClass: 'wave-dot-amber',
  },
  delete: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    trackBg: 'bg-red-500/15',
    dotClass: 'wave-dot-red',
  },
};

function WaveLoader({ compact, variant = 'default' }: { compact?: boolean | undefined; variant?: WaveLoaderVariant | undefined }): React.JSX.Element {
  const px = compact === true ? 'px-2' : 'px-2.5';
  const colors = WAVE_COLORS[variant];
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`${OUTPUT_CHIP} relative inline-flex items-center overflow-hidden rounded-full border ${colors.border} ${colors.bg} ${px} py-1`}
    >
      <span className={`relative h-1 w-full overflow-hidden rounded-full ${colors.trackBg}`}>
        <span className={`${colors.dotClass} absolute top-0 h-full w-[30%] rounded-full`} />
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Add `actioningType` and `onDeleteGroup` to props interface**

Replace the `IssueGroupRowProps` interface (lines 7-14) with:

```tsx
type ActioningType = 'archive' | 'delete' | 'implement' | 'retry' | null;

interface IssueGroupRowProps {
  group: IssueGroup;
  timeTick: number;
  onAction: (taskId: string, action: 'delete' | 'retry' | 'implement' | 'archive') => void;
  onArchiveGroup: (taskIds: string[]) => void;
  onDeleteGroup: (taskIds: string[]) => void;
  onOpenLogs: (taskId: string) => void;
  actioningTaskId?: string | null;
  actioningType?: ActioningType | undefined;
}
```

- [ ] **Step 3: Add `getActionAccentShadow` helper for row state overrides**

Add after the existing `getAccentShadow` function (after line 23):

```tsx
function getActionAccentShadow(actionType: ActioningType | undefined): string | null {
  if (actionType === 'archive') return 'shadow-[inset_3px_0_0_theme(colors.amber.500)]';
  if (actionType === 'delete') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  return null;
}

function getActionShimmerClass(actionType: ActioningType | undefined): string {
  if (actionType === 'archive') return 'shimmer-amber';
  if (actionType === 'delete') return 'shimmer-red';
  return '';
}

function ActionStateTag({ actionType }: { actionType: ActioningType | undefined }): React.JSX.Element | null {
  if (actionType === 'archive') {
    return <span className="ml-1.5 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Archiving…</span>;
  }
  if (actionType === 'delete') {
    return <span className="ml-1.5 inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">Deleting…</span>;
  }
  return null;
}
```

- [ ] **Step 4: Destructure new props and compute row state**

In the `IssueGroupRow` memo function (line 212), add destructuring for `onDeleteGroup` and `actioningType`:

Replace:
```tsx
const IssueGroupRow = memo(function IssueGroupRow({
  group,
  onAction,
  onArchiveGroup,
  onOpenLogs,
  actioningTaskId,
}: IssueGroupRowProps): React.JSX.Element {
```

With:
```tsx
const IssueGroupRow = memo(function IssueGroupRow({
  group,
  onAction,
  onArchiveGroup,
  onDeleteGroup,
  onOpenLogs,
  actioningTaskId,
  actioningType,
}: IssueGroupRowProps): React.JSX.Element {
```

Then after the existing `isActioning` computation (line 227), add:

```tsx
  const activeActionType: ActioningType | undefined = isActioning ? (actioningType ?? null) : undefined;
  const waveVariant: WaveLoaderVariant = activeActionType === 'archive' ? 'archive' : activeActionType === 'delete' ? 'delete' : 'default';
  const actionAccent = getActionAccentShadow(activeActionType);
  const actionShimmer = getActionShimmerClass(activeActionType);
  const isBeingRemoved = activeActionType === 'archive' || activeActionType === 'delete';
```

- [ ] **Step 5: Update `renderActionButton` to use variant**

Replace the first line of `renderActionButton` body:
```tsx
    if (isActioning) return <WaveLoader compact={compact} />;
```
With:
```tsx
    if (isActioning) return <WaveLoader compact={compact} variant={waveVariant} />;
```

- [ ] **Step 6: Apply row state classes to the main row div**

Replace the outer row div class (line 301):

```tsx
        className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(aggregateStatus)}`}
```

With:
```tsx
        className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow dark:border-slate-700 dark:bg-slate-800 ${isBeingRemoved ? `opacity-50 pointer-events-none ${actionShimmer}` : 'hover:shadow-md'} ${actionAccent ?? getAccentShadow(aggregateStatus)}`}
```

- [ ] **Step 7: Add ActionStateTag next to issue identifier — desktop layout**

In the desktop Issue column, after the `IssueIdentifierLink` (line 322), add the state tag. Replace:

```tsx
                  <IssueIdentifierLink
                    linearIssue={group.linearIssue}
                    linkClassName="font-mono text-sm text-blue-500 hover:text-blue-400 hover:underline"
                  />
```

With:
```tsx
                  <span className="inline-flex items-center">
                    <IssueIdentifierLink
                      linearIssue={group.linearIssue}
                      linkClassName="font-mono text-sm text-blue-500 hover:text-blue-400 hover:underline"
                    />
                    <ActionStateTag actionType={activeActionType} />
                  </span>
```

For the non-linear-issue case (line 328), replace:
```tsx
                <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                  {summaryOrPrompt(latestTask)}
                </p>
```

With:
```tsx
                <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                  {summaryOrPrompt(latestTask)}
                  <ActionStateTag actionType={activeActionType} />
                </p>
```

- [ ] **Step 8: Add ActionStateTag — mobile layout**

In the mobile layout, after the `IssueIdentifierLink` (line 410), add the tag. Replace:

```tsx
                  <IssueIdentifierLink
                    linearIssue={group.linearIssue}
                    linkClassName="font-mono text-blue-500 hover:text-blue-400 hover:underline"
                  />
```

With:
```tsx
                  <IssueIdentifierLink
                    linearIssue={group.linearIssue}
                    linkClassName="font-mono text-blue-500 hover:text-blue-400 hover:underline"
                  />
                  <ActionStateTag actionType={activeActionType} />
```

For the non-linear-issue mobile case (line 417), replace:
```tsx
                  <span className="truncate text-slate-600 dark:text-slate-400">
                    {summaryOrPrompt(latestTask)}
                  </span>
```

With:
```tsx
                  <span className="truncate text-slate-600 dark:text-slate-400">
                    {summaryOrPrompt(latestTask)}
                  </span>
                  <ActionStateTag actionType={activeActionType} />
```

- [ ] **Step 9: Wire delete confirmation to `onDeleteGroup`**

Replace the delete confirmation button's onClick (lines 483-489):

```tsx
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  for (const task of group.tasks) {
                    onAction(task.id, 'delete');
                  }
                  setShowDeleteConfirm(false);
                }}
```

With:
```tsx
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  onDeleteGroup(group.tasks.map((t) => t.id));
                  setShowDeleteConfirm(false);
                }}
```

- [ ] **Step 10: Update memo comparator**

Add `actioningType` and `onDeleteGroup` to the memo comparator. After `prev.actioningTaskId === next.actioningTaskId` (line 562), add:

```tsx
  prev.actioningType === next.actioningType &&
  prev.onDeleteGroup === next.onDeleteGroup &&
```

- [ ] **Step 11: Verify build**

Run: `cd /Users/p.buchman/personal/intexuraos-2 && pnpm run verify:workspace:tracked web`

Expected: Build passes (there will be TypeScript errors from `CodeTasksPageV3.tsx` not yet passing the new props — this is expected and will be resolved in Task 3). If the build fails on IssueGroupRow itself, fix the errors.

Note: The build may fail because `CodeTasksPageV3.tsx` doesn't pass `onDeleteGroup` and `actioningType` yet. That's fine — Task 3 will wire those. If the error is ONLY about missing props at the call site, that's expected. If there are errors within IssueGroupRow.tsx itself, fix those.

---

### Task 2: CSS Shimmer Animations

**Files:**
- Modify: `apps/web/src/styles/index.css`

This task adds the CSS keyframe animations for the shimmer effects: blue (filter/sort refresh), amber (archive), and red (delete). Also adds the amber and red wave-dot variants.

- [ ] **Step 1: Add shimmer keyframes and classes**

In `apps/web/src/styles/index.css`, after the existing `.wave-dot` rule (after line 255), add:

```css
/* Archive wave animation (amber) */
.wave-dot-amber {
  left: 0;
  background: radial-gradient(ellipse at center, rgba(245, 158, 11, 0.9) 0%, rgba(251, 191, 36, 0.5) 60%, transparent 100%);
  animation: wave-travel 1.4s ease-in-out infinite;
}

/* Delete wave animation (red) */
.wave-dot-red {
  left: 0;
  background: radial-gradient(ellipse at center, rgba(239, 68, 68, 0.9) 0%, rgba(248, 113, 113, 0.5) 60%, transparent 100%);
  animation: wave-travel 1.4s ease-in-out infinite;
}

/* Filter/sort refresh shimmer (blue) */
@keyframes shimmer-blue {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.shimmer-refresh {
  position: relative;
}

.shimmer-refresh::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.5rem;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(59, 130, 246, 0.06) 40%,
    rgba(59, 130, 246, 0.12) 50%,
    rgba(59, 130, 246, 0.06) 60%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer-blue 1.8s ease-in-out infinite;
  pointer-events: none;
}

/* Archive row shimmer (amber) */
@keyframes shimmer-amber-kf {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.shimmer-amber {
  position: relative;
}

.shimmer-amber::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.5rem;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(245, 158, 11, 0.05) 40%,
    rgba(245, 158, 11, 0.10) 50%,
    rgba(245, 158, 11, 0.05) 60%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer-amber-kf 1.8s ease-in-out infinite;
  pointer-events: none;
}

/* Delete row shimmer (red) */
@keyframes shimmer-red-kf {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.shimmer-red {
  position: relative;
}

.shimmer-red::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.5rem;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(239, 68, 68, 0.05) 40%,
    rgba(239, 68, 68, 0.10) 50%,
    rgba(239, 68, 68, 0.05) 60%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer-red-kf 1.8s ease-in-out infinite;
  pointer-events: none;
}

/* Indeterminate progress bar */
@keyframes progress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
```

- [ ] **Step 2: Verify CSS parses**

Run: `cd /Users/p.buchman/personal/intexuraos-2 && pnpm --filter web build`

Expected: Build passes (CSS is valid, no parse errors).

---

### Task 3: Wire Everything in CodeTasksPageV3

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPageV3.tsx`

**Depends on:** Task 1 (IssueGroupRow has new props), Task 2 (CSS classes exist)

This task destructures `refreshing`, adds `actioningType` state, implements `handleDeleteGroup`, adds the progress bar, adds shimmer classes to the row list wrapper, and passes all new props to `IssueGroupRow`.

- [ ] **Step 1: Add `deleteCodeTask` import**

In `apps/web/src/pages/CodeTasksPageV3.tsx`, update the import on line 22:

Replace:
```tsx
import { startImplementation, retryCodeTask, archiveCodeTask } from '@/services/codeAgentApi';
```

With:
```tsx
import { startImplementation, retryCodeTask, archiveCodeTask, deleteCodeTask } from '@/services/codeAgentApi';
```

- [ ] **Step 2: Add `ActioningType` type and `actioningType` state**

After the existing `lastActionRef` (line 230), add:

```tsx
  type ActioningType = 'archive' | 'delete' | 'implement' | 'retry' | null;
```

Wait — type aliases can't be inside function bodies in this position cleanly. Instead, add it at file-level before the `CodeTasksPageV3` function. After the `ColumnHeader` component (after line 218), add:

```tsx
type ActioningType = 'archive' | 'delete' | 'implement' | 'retry' | null;
```

Then inside the `CodeTasksPageV3` function, after line 230:

```tsx
  const [actioningType, setActioningType] = useState<ActioningType>(null);
```

- [ ] **Step 3: Destructure `refreshing` from `useIssueGroups`**

Update the destructuring (lines 233-246). Add `refreshing` to the destructured values:

Replace:
```tsx
  const {
    groups,
    counts,
    totalGroups,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  } = useIssueGroups({
```

With:
```tsx
  const {
    groups,
    counts,
    totalGroups,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    loadMore,
    refresh,
  } = useIssueGroups({
```

- [ ] **Step 4: Update `handleAction` to set `actioningType` and remove delete early-return**

Replace the entire `handleAction` callback (lines 272-304) with:

```tsx
  const handleAction = useCallback(
    async (taskId: string, action: 'delete' | 'retry' | 'implement' | 'archive') => {
      if (action === 'delete') {
        return;
      }
      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      lastActionRef.current = { taskId, action };
      setActioningTaskId(taskId);
      setActioningType(action);
      try {
        const token = await getAccessToken();
        if (action === 'implement') {
          await startImplementation(token, taskId);
        } else if (action === 'archive') {
          await archiveCodeTask(token, taskId);
        } else {
          await retryCodeTask(token, { taskId });
        }
        await refresh(false);
        lastActionRef.current = null;
      } catch (err: unknown) {
        setActioningTaskId(null);
        setActioningType(null);
        setActionError(
          err instanceof ApiError
            ? err
            : new ApiError('UNKNOWN', err instanceof Error ? err.message : 'An unexpected error occurred', 0),
        );
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [getAccessToken, refresh, setActioningTaskId],
  );
```

Note: The `if (action === 'delete') { return; }` is kept because delete now goes through `handleDeleteGroup` instead. `handleAction` is for single-task actions.

- [ ] **Step 5: Update `handleArchiveGroup` to set `actioningType`**

In the `handleArchiveGroup` callback, add `setActioningType('archive')` after `setActioningTaskId(firstId)`:

Replace:
```tsx
        const firstId = taskIds[0];
        if (firstId !== undefined) {
          setActioningTaskId(firstId);
        }
```

With:
```tsx
        const firstId = taskIds[0];
        if (firstId !== undefined) {
          setActioningTaskId(firstId);
          setActioningType('archive');
        }
```

And in the catch block, add `setActioningType(null)` after `setActioningTaskId(null)`:

Replace:
```tsx
        } catch (err: unknown) {
          setActioningTaskId(null);
```

With:
```tsx
        } catch (err: unknown) {
          setActioningTaskId(null);
          setActioningType(null);
```

- [ ] **Step 6: Add `handleDeleteGroup` callback**

After the `handleArchiveGroup` callback (after line 341), add:

```tsx
  const handleDeleteGroup = useCallback(
    (taskIds: string[]): void => {
      void (async (): Promise<void> => {
        if (actionInFlightRef.current) return;
        actionInFlightRef.current = true;
        const firstId = taskIds[0];
        if (firstId !== undefined) {
          setActioningTaskId(firstId);
          setActioningType('delete');
        }
        try {
          const token = await getAccessToken();
          for (const taskId of taskIds) {
            await deleteCodeTask(token, taskId);
          }
          await refresh(false);
        } catch (err: unknown) {
          setActioningTaskId(null);
          setActioningType(null);
          setActionError(
            err instanceof ApiError
              ? err
              : new ApiError('UNKNOWN', err instanceof Error ? err.message : 'An unexpected error occurred', 0),
          );
        } finally {
          actionInFlightRef.current = false;
        }
      })();
    },
    [getAccessToken, refresh, setActioningTaskId],
  );
```

- [ ] **Step 7: Add progress bar and shimmer wrapper to the list rendering**

Replace the list rendering block (lines 411-448):

```tsx
        <div>
          <ColumnHeader />

          <div className="space-y-1">
            {groups.map((group) => (
              <IssueGroupRow
                key={group.linearIssueId ?? group.latestTask.id}
                group={group}
                timeTick={timeTick}
                onAction={fireAction}
                onArchiveGroup={handleArchiveGroup}
                onOpenLogs={setPreviewTaskId}
                actioningTaskId={actioningTaskId}
              />
            ))}
          </div>

          {hasMore ? (
```

With:

```tsx
        <div>
          <ColumnHeader />

          {refreshing ? (
            <div className="mb-2 h-0.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-transparent via-blue-500 to-transparent" style={{ animation: 'progress-slide 1.5s ease-in-out infinite' }} />
            </div>
          ) : null}

          <div className={`space-y-1 ${refreshing ? 'opacity-50 pointer-events-none' : ''}`}>
            {groups.map((group) => (
              <IssueGroupRow
                key={group.linearIssueId ?? group.latestTask.id}
                group={group}
                timeTick={timeTick}
                onAction={fireAction}
                onArchiveGroup={handleArchiveGroup}
                onDeleteGroup={handleDeleteGroup}
                onOpenLogs={setPreviewTaskId}
                actioningTaskId={actioningTaskId}
                actioningType={actioningType}
              />
            ))}
          </div>

          {hasMore ? (
```

Note: The shimmer effect on individual rows during filter/sort refresh is handled by the row-level `shimmer-refresh` CSS class. But for the filter/sort case, the simpler approach is to apply opacity to the wrapper div (all rows fade together) plus the progress bar. The row-level shimmer CSS classes (`shimmer-amber`, `shimmer-red`) are only used for archive/delete actions. This matches the approved design — the filter/sort uses "progress bar + row fade", not per-row shimmer.

- [ ] **Step 8: Clear `actioningType` when `actioningTaskId` is cleared by rapid poll**

The `useRapidPoll` hook auto-clears `actioningTaskId` but doesn't know about `actioningType`. Add an effect to sync. After the `useRapidPoll` call (after line 249), add:

```tsx
  // Sync actioningType when rapid poll clears actioningTaskId
  useEffect(() => {
    if (actioningTaskId === null) {
      setActioningType(null);
    }
  }, [actioningTaskId]);
```

- [ ] **Step 9: Verify build**

Run: `cd /Users/p.buchman/personal/intexuraos-2 && pnpm run verify:workspace:tracked web`

Expected: Build passes with no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/CodeTasksPageV3.tsx apps/web/src/components/code-tasks/IssueGroupRow.tsx apps/web/src/styles/index.css
git commit -m "feat: add loading indicators for filter/sort and color-coded archive/delete row states (Code Tasks V3)"
```
