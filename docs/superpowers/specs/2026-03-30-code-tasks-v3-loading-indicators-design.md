# Code Tasks V3 — Loading Indicators Design

**Date:** 2026-03-30
**Status:** Approved
**Scope:** Two UX improvements to Code Tasks List V3 feedback during async operations

## Problem

1. **Filter/sort changes have no visual feedback.** When the user toggles a filter pill or changes the sort option, the API call takes 0.5–4 seconds. During this time the list sits unchanged — no indication that anything is happening. On slow responses, users wonder if their click registered.

2. **Archive/delete row actions lack progress indicators.** Archive shows a WaveLoader in the action button area but the row itself has no visual "pending" state. Delete is completely broken — `handleAction` at `CodeTasksPageV3.tsx:274` early-returns before making any API call. After confirmation, the row sits unchanged until the next poll cycle removes it (archive) or forever (delete).

## Decisions

### Filter/Sort: Progress Bar + Row Shimmer (Approach B)

Chosen over an overlay + centered spinner approach. The shimmer is subtle enough to not flicker on sub-second responses, while the progress bar provides a clear signal during 3-4 second waits.

### Row Archive/Delete: Color-Coded Per Action (Approach A)

Chosen over a unified blue WaveLoader approach. Since the user just confirmed a destructive action, showing them exactly what is happening (amber = archive, red = delete) reduces anxiety. The color matches the confirmation button colors already used in the overlay dialogs.

## Design

### 1. Filter/Sort Loading Indicator

**Trigger:** Any change to `activeFilters` or `activeSort` that causes `useIssueGroups` to refetch.

**Visual treatment:**
- A 2px indeterminate progress bar appears between the `ColumnHeader` and the first row
- The bar is a blue gradient (`#3b82f6`) sliding left-to-right on a `#334155` track
- All existing rows simultaneously:
  - Fade to 50% opacity
  - Show a subtle blue shimmer sweep via CSS `::after` pseudo-element
  - Become `pointer-events: none` to prevent stale interactions
- Filter pills and sort pills remain interactive (user can keep changing their mind)
- When fresh data arrives, shimmer and bar disappear instantly (rows re-render with new data)

**State:**
- `refreshing` is already exposed by `useIssueGroups` (line 70 of `useIssueGroups.ts`) but never consumed
- Destructure `refreshing` in `CodeTasksPageV3` and pass it to control the progress bar and shimmer classes
- No new state management needed

**CSS implementation:**
- Progress bar: `translateX` keyframe animation on an absolutely-positioned inner div
- Row shimmer: `background-position` keyframe on `::after` with blue-tinted semi-transparent gradient, `background-size: 200% 100%`
- Row fade: `opacity: 0.5` via Tailwind class toggled by `refreshing`

**No delay needed:** Unlike the rejected overlay approach (which would need a 300ms delay to avoid flicker), the shimmer is subtle enough that fast responses look fine — the shimmer simply appears and immediately resolves.

### 2. Row Archive/Delete Indicators

**Two bugs to fix:**

1. **Delete no-op:** `handleAction` at `CodeTasksPageV3.tsx:274-276` has `if (action === 'delete') { return; }`. Implement actual delete API calls. Create a `handleDeleteGroup` callback mirroring `handleArchiveGroup` (loop through task IDs, call delete API sequentially, then refresh).

2. **Delete confirmation wiring:** `IssueGroupRow.tsx:486-488` calls `onAction(task.id, 'delete')` in a loop. Replace with an `onDeleteGroup(taskIds)` prop mirroring `onArchiveGroup`.

**New state:**

Add `actioningType` alongside existing `actioningTaskId`:
```
actioningTaskId: string | null     (existing)
actioningType: 'archive' | 'delete' | 'implement' | 'retry' | null  (new)
```

Pass both to `IssueGroupRow` so it can render the correct color treatment.

**Visual treatment — Archiving:**
- Left accent border changes to amber (`#f59e0b`)
- Row fades to 50% opacity
- Amber shimmer sweep (same CSS pattern as filter/sort but `rgba(245, 158, 11, *)` tinted)
- Amber WaveLoader replaces action button area (border: `rgba(245, 158, 11, 0.3)`, bg: `rgba(245, 158, 11, 0.1)`, dot gradient: `#f59e0b` to `#fbbf24`)
- "Archiving..." state tag (amber bg, amber text) appears inline next to the issue identifier
- Row becomes `pointer-events: none`

**Visual treatment — Deleting:**
- Left accent border changes to red (`#ef4444`)
- Row fades to 50% opacity
- Red shimmer sweep (`rgba(239, 68, 68, *)` tinted)
- Red WaveLoader replaces action button area (border: `rgba(239, 68, 68, 0.3)`, bg: `rgba(239, 68, 68, 0.1)`, dot gradient: `#ef4444` to `#f87171`)
- "Deleting..." state tag (red bg, red text) appears inline next to the issue identifier
- Row becomes `pointer-events: none`

**After completion:** The row disappears naturally on the next refetch (archive removes from list, delete removes from backend). Rapid polling (3s interval, 30s duration) is already wired for post-action refetches.

**WaveLoader component changes:**
- Accept an optional `variant` prop: `'default' | 'archive' | 'delete'`
- Default preserves existing blue styling
- Archive variant uses amber colors
- Delete variant uses red colors

**IssueGroupRow memo comparator:** Add `actioningType` to the comparison function at line 544.

## Files to Modify

| File                                                   | Change                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/pages/CodeTasksPageV3.tsx`               | Destructure `refreshing`; add progress bar component; pass `refreshing` to row list wrapper; add `actioningType` state; implement `handleDeleteGroup`; add `onDeleteGroup` prop to `IssueGroupRow`                                             |
| `apps/web/src/components/code-tasks/IssueGroupRow.tsx` | Accept `actioningType` and `onDeleteGroup` props; add color-coded row states (opacity, shimmer, accent override); extend `WaveLoader` with `variant` prop; add state tags; update memo comparator; wire delete confirmation to `onDeleteGroup` |
| `apps/web/src/hooks/useIssueGroups.ts`                 | No changes (already exposes `refreshing`)                                                                                                                                                                                                      |
| `apps/web/src/services/codeAgentApi.ts`                | No changes needed — `deleteCodeTask` already exists at line 85 and is used by V1 page                                                                                                                                                          |

## Endpoint Changes

- **Modified:** None
- **Created:** None (delete endpoint already exists at `code-agent/src/routes/codeRoutes.ts:1840`, client function at `codeAgentApi.ts:85`)
- **Removed:** None
- **Unchanged:** `GET /api/issue-groups`, `POST /api/code-tasks/:id/archive`

## Out of Scope

- Optimistic removal (row disappearing before API confirms) — the shimmer + refetch pattern is sufficient for the 1-3s window
- Undo for archive/delete — separate feature
- Mobile layout changes — the same opacity/shimmer treatment applies; WaveLoader already renders in compact mode
- Skeleton loading for initial page load — already handled by the existing full-page spinner
