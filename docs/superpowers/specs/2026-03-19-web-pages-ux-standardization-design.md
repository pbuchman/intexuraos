# Web Pages UX Standardization Design

**Date:** 2026-03-19
**Status:** Draft
**Parent Linear Issue:** INT-995
**Goal:** Standardize all web app list/dashboard pages to match the UX patterns from `CodeTasksPage.tsx`.

## Reference Patterns

Every section below references these exact patterns. An implementer working on a single section needs only this reference block and their section.

### Page Header Pattern
```tsx
<div className="mb-6 flex items-center justify-between">
  <div>
    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
    <p className="text-sm text-slate-500 dark:text-slate-400">{dynamicCounts}</p>
  </div>
  <div className="flex items-center gap-2">
    {/* action buttons */}
  </div>
</div>
```
Key: subtitle uses `text-sm text-slate-500 dark:text-slate-400` (NOT `text-slate-600 dark:text-slate-300`). Counts are dynamic (e.g., "12 items · 3 processing").

### Status Filter Pills Pattern
```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {statuses.map((status) => (
    <button
      key={status}
      onClick={() => toggle(status)}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        isActive ? config.activeClass : INACTIVE_CLASS
      }`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
      {config.label}
      <span className="font-medium">{String(count)}</span>
    </button>
  ))}
</div>
```
Where `INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'`.
Persist selection to localStorage. Counts reflect loaded data only.

### Sort Selector Pattern
```tsx
<div className="mb-4 flex items-center gap-2">
  <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
  <div className="flex gap-1.5">
    {options.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => setSort(key)}
        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
          active === key
            ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
        }`}
      >{label}</button>
    ))}
  </div>
</div>
```
Persist selection to localStorage.

### Compact Row Pattern
```tsx
<div className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${accentShadow}`}>
  <div className="grid grid-cols-[1fr_auto_140px_120px] items-center gap-2">
    {/* columns */}
  </div>
</div>
```
With left accent shadow: `shadow-[inset_3px_0_0_theme(colors.{color}.500)]`. Rows use `space-y-1` spacing (NOT `space-y-4`).

### Overlay Delete Confirmation Pattern
Row container must have `relative` positioning. Overlay:
```tsx
{showDeleteConfirm ? (
  <div
    className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
    onClick={(e) => { e.stopPropagation(); }}
  >
    <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
      <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
      <button onClick={cancel} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Cancel</button>
      <button onClick={confirm} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500">Delete</button>
    </div>
  </div>
) : null}
```

### ErrorBanner Usage
Import from `@/components`:
```tsx
import { ErrorBanner } from '@/components';
// Usage:
<ErrorBanner message={error} className="mb-6" />
```
This component is created as part of INT-992 (Research pages standardization). If INT-992 is not yet complete when working on a section below, create `apps/web/src/components/ui/ErrorBanner.tsx` first:
```tsx
interface ErrorBannerProps { message: string | null; className?: string; }
export function ErrorBanner({ message, className = '' }: ErrorBannerProps): React.JSX.Element | null {
  if (message === null || message === '') return null;
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400 ${className}`}>
      {message}
    </div>
  );
}
```
Export it from `apps/web/src/components/ui/index.ts`.

### Loading Spinner Pattern
```tsx
<div className="flex items-center justify-center py-12">
  <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
</div>
```

---

## Section 1: TodosListPage (INT-996)

**File:** `apps/web/src/pages/TodosListPage.tsx` (1150 lines)
**Linear:** INT-996

### Current State
- 1150-line monolith with 8 local components: `PriorityBadge`, `StatusBadge`, `ItemStatusIcon`, `TodoItemRow`, `TodoModal`, `CreateTodoModal`, `TodoRow`, `TodosListPage`
- Status display uses `STATUS_CONFIG` Record (already data-driven) and `PRIORITY_CONFIG` Record
- Delete: inline red box confirmation in both `TodoItemRow` and `TodoModal` footer
- Header subtitle: `text-slate-600 dark:text-slate-300` (wrong weight)
- List: `space-y-4` of `<Card>` components, clicking opens modal
- No filtering, no sorting

### Changes Required

**1. Decompose into sub-components** under `apps/web/src/components/todos/`:
- `apps/web/src/components/todos/TodoModal.tsx` — Extract the ~300-line `TodoModal` component. Include `TodoItemRow` (~190 lines) inside this file since it's only used within the modal. Keep all existing state and behavior.
- `apps/web/src/components/todos/CreateTodoModal.tsx` — Extract the ~160-line `CreateTodoModal`. Keep all existing state.
- `apps/web/src/components/todos/shared.tsx` — Move `STATUS_CONFIG`, `PRIORITY_CONFIG`, `PriorityBadge`, `StatusBadge`, `ItemStatusIcon` here. Export all.
- `apps/web/src/components/todos/TodoRow.tsx` — Extract the row component. Will be rewritten as a compact row (see below).
- Reduce `TodosListPage.tsx` to ~100-line composition.

**2. Add status filter pills.** Statuses to filter: `in_progress`, `pending`, `completed`, `cancelled`, `draft`. Use the filter pills pattern from the Reference section. localStorage key: `todos-status-filter`. Default: all except `cancelled` selected. Compute counts from loaded todos.

**3. Add sort selector.** Sort options: `created` (createdAt desc), `priority` (urgent first), `updated` (updatedAt desc). localStorage key: `todos-sort`. Default: `created`.

**4. Convert to compact rows.** Replace the current `<Card>` layout with the compact row pattern. Desktop grid: `grid-cols-[1fr_auto_auto_140px_80px]` — Title | Priority badge | Status badge | Updated time | Actions (trash, hover-reveal). Left accent shadow: blue=in_progress, amber=pending, green=completed, red=cancelled, slate=draft. Row click opens the `TodoModal`.

**5. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add dynamic counts: `"{n} todos · {m} in progress"`.

**6. Switch delete in `TodoRow` to overlay pattern** (see Reference). Delete in `TodoModal` stays as inline (modal context).

---

## Section 2: BookmarksListPage (INT-997)

**File:** `apps/web/src/pages/BookmarksListPage.tsx` (1135 lines)
**Linear:** INT-997

### Current State
- 1135-line monolith with 6 components: `OgStatusBadge`, `FilterBar`, `BookmarkModal`, `CreateBookmarkModal`, `BookmarkRow`, `BookmarksListPage`
- Status: `OG_STATUS_STYLES` Record for OG fetch status (already data-driven, but badge hidden when `processed`)
- Has filtering already: archive status select + tag select via `FilterBar` component
- Delete: inline red box in both `BookmarkRow` and `BookmarkModal`
- Header subtitle: `text-slate-600 dark:text-slate-300` (wrong weight)
- List: `space-y-4` of `<Card>` with 64x64 thumbnails
- No sorting

### Changes Required

**1. Decompose into sub-components** under `apps/web/src/components/bookmarks/`:
- `apps/web/src/components/bookmarks/BookmarkModal.tsx` — Extract ~270-line modal. Keep all state.
- `apps/web/src/components/bookmarks/CreateBookmarkModal.tsx` — Extract ~180-line modal with duplicate-URL detection.
- `apps/web/src/components/bookmarks/BookmarkRow.tsx` — Extract and rewrite as compact row.
- `apps/web/src/components/bookmarks/shared.tsx` — Move `OG_STATUS_STYLES`, `OgStatusBadge`, helper functions (`truncateText`, `getHostname`, `getDisplayTitle`, `getDisplayDescription`).
- Reduce `BookmarksListPage.tsx` to ~120-line composition.

**2. Preserve existing `FilterBar`** but restyle as filter pills matching the Reference pattern. The archive filter (All/Active/Archived) becomes 3 pill buttons instead of a `<select>`. The tag filter stays as a select (too many tags for pills). Move to `apps/web/src/components/bookmarks/FilterBar.tsx`.

**3. Add sort selector.** Sort options: `created` (createdAt desc), `title` (alphabetical A-Z), `updated` (updatedAt desc). localStorage key: `bookmarks-sort`. Default: `created`.

**4. Convert to compact rows.** Desktop grid: `grid-cols-[40px_1fr_auto_140px_80px]` — Thumbnail (40x40, smaller) | Title+hostname | Tags | Time | Actions. Left accent shadow: none (bookmarks don't have a workflow status). Row click opens `BookmarkModal`. Thumbnail uses ogImage -> favicon -> Globe icon fallback (same logic, just smaller `h-10 w-10 rounded`).

**5. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} bookmarks · {m} archived"`.

**6. Switch delete in `BookmarkRow` to overlay pattern.** Delete in `BookmarkModal` stays inline.

---

## Section 3: InboxPage (INT-998)

**File:** `apps/web/src/pages/InboxPage.tsx` (872 lines)
**Linear:** INT-998

### Current State
- 872-line file with `CommandItem` local component, tab layout (Actions + Commands), status filter with checkbox pills (already exists for Actions tab), infinite scroll via IntersectionObserver
- Status filtering: checkbox pills with `selected`/`unselected` states, persisted to localStorage
- Command cards use raw `<div>` (not `<Card>`)
- Refresh: raw `<button>` (not `<Button>`)
- No sort selector

### Changes Required

**1. Decompose into sub-components** under `apps/web/src/components/inbox/`:
- `apps/web/src/components/inbox/CommandItem.tsx` — Extract the ~80-line `CommandItem`. Keep behavior.
- `apps/web/src/components/inbox/InboxFilters.tsx` — Extract the status filter pill bar. Restyle to match the Reference filter pills pattern (currently uses checkbox-style pills, switch to dot+label+count style). Keep localStorage persistence (`inbox-status-filter`).
- Reduce `InboxPage.tsx` to ~200-line composition (this page has complex state with dual tabs and infinite scroll, so it will be larger than a simple list).

**2. Add sort selector** for both tabs. Sort options for Actions: `created` (desc), `status` (pending first). Sort options for Commands: `created` (desc), `type` (grouped). localStorage key: `inbox-sort-actions`, `inbox-sort-commands`. Default: `created`.

**3. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts per tab: `"{n} actions · {m} pending"` or `"{n} commands"`.

**4. Standardize refresh button** — replace raw `<button>` with the shared `<Button variant="ghost" size="sm">` component.

**5. Standardize command cards** — use `<Card>` component or the compact row pattern. Since commands are information-dense (type, status, content preview, metadata), compact rows work: `grid-cols-[auto_1fr_140px_80px]` — Type icon | Content | Time | Actions.

---

## Section 4: WhatsAppNotesPage (INT-999)

**File:** `apps/web/src/pages/WhatsAppNotesPage.tsx` (844 lines)
**Linear:** INT-999

### Current State
- 844-line file with `TextWithLinks`, `NoteDetailModal`, `TranscriptionDetailModal`, `MessageItem` local components
- No status system, no filtering, no sorting
- Message cards use raw `<div>` (not `<Card>`)
- Delete: inline red box with animated deletion (scale-95 opacity-50 with 300ms delay)
- Header subtitle shows `fromNumber` in monospace

### Changes Required

**1. Decompose into sub-components** under `apps/web/src/components/whatsapp/`:
- `apps/web/src/components/whatsapp/MessageItem.tsx` — Extract the ~310-line `MessageItem`. Keep animated deletion behavior.
- `apps/web/src/components/whatsapp/NoteDetailModal.tsx` — Extract ~110-line modal.
- `apps/web/src/components/whatsapp/TranscriptionDetailModal.tsx` — Extract ~100-line modal.
- `apps/web/src/components/whatsapp/shared.tsx` — Move `TextWithLinks` here, export.
- Reduce `WhatsAppNotesPage.tsx` to ~120-line composition.

**2. Add media type filter pills.** Filters: `all`, `text`, `image`, `audio`. Use the Reference filter pills pattern. localStorage key: `whatsapp-media-filter`. Default: `all` selected.

**3. Add sort selector.** Sort options: `newest` (desc), `oldest` (asc). localStorage key: `whatsapp-sort`. Default: `newest`.

**4. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} messages"` plus `"from {fromNumber}"`.

**5. Convert to compact rows.** Desktop grid: `grid-cols-[auto_1fr_140px_80px]` — Media type icon (Image/Mic/MessageSquare) | Content preview (single line truncation) | Time | Actions (note/transcription buttons + hover-reveal trash). Keep the animated deletion behavior (scale-95 opacity-50). Row click opens `NoteDetailModal` or `TranscriptionDetailModal` depending on media type.

**6. Switch delete to overlay pattern.** Keep the deletion animation on the row after confirmation.

---

## Section 5: LinearIssuesPage (INT-1000)

**File:** `apps/web/src/pages/LinearIssuesPage.tsx` (811 lines)
**Linear:** INT-1000

### Current State
- 811-line file with Kanban-style 3-column layout (mobile: tabs, desktop: grid)
- 7 local components: `IssueCard`, `SubIssuesList`, `IssueColumn`, `StackedSection`, `StackedColumn`, `FailedIssueCard`, `NeedsAttentionSection`
- Priority uses `PRIORITY_COLORS` + `PRIORITY_LABELS` Records (data-driven)
- Labels use inline styles from API `label.color`
- No filtering (tabs are category navigation), no sorting
- Polling at 60s intervals

### Changes Required

**1. Keep Kanban layout** — this is a specialized view where the column layout serves the workflow visualization. Do NOT convert to compact rows.

**2. Decompose into sub-components** under `apps/web/src/components/linear/`:
- `apps/web/src/components/linear/IssueCard.tsx` — Extract ~55-line card.
- `apps/web/src/components/linear/SubIssuesList.tsx` — Extract ~65-line sub-issues.
- `apps/web/src/components/linear/IssueColumn.tsx` — Extract column + stacked column components (~80 lines total).
- `apps/web/src/components/linear/NeedsAttentionSection.tsx` — Extract ~60-line section with `FailedIssueCard`.
- `apps/web/src/components/linear/shared.tsx` — Move `PRIORITY_COLORS`, `PRIORITY_LABELS`, `TABS` config, `getStatusIcon`.
- Reduce `LinearIssuesPage.tsx` to ~150-line composition.

**3. Add filter pills** above the Kanban columns. Filters: `priority` (Urgent, High, Normal, Low), `assignee` (Me, Unassigned, All). These filter across all columns. localStorage key: `linear-filter`. Default: all selected.

**4. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} issues · {m} in progress"`.

**5. Standardize refresh/sync buttons** — replace raw `<button>` elements with `<Button variant="ghost" size="sm">`.

---

## Section 6: MobileNotificationsListPage (INT-1001)

**File:** `apps/web/src/pages/MobileNotificationsListPage.tsx` (782 lines)
**Linear:** INT-1001

### Current State
- 782-line file with `Badge`, `NotificationCard`, `MultiSelectDropdown` local components
- Rich multi-dimension filtering already exists: app (multi-select), source (select), title (text), saved filters
- Notification cards use raw `<div>` (not `<Card>`)
- Delete: inline red box with animated deletion (same as WhatsApp)
- No sort selector

### Changes Required

**1. Decompose into sub-components** under `apps/web/src/components/notifications/`:
- `apps/web/src/components/notifications/NotificationCard.tsx` — Extract ~75-line card. Keep animated deletion.
- `apps/web/src/components/notifications/MultiSelectDropdown.tsx` — Extract ~75-line reusable dropdown.
- `apps/web/src/components/notifications/NotificationFilters.tsx` — Extract the filter section (~150 lines) including saved filters CRUD.
- `apps/web/src/components/notifications/shared.tsx` — Move `Badge` component, filter helper functions.
- Reduce `MobileNotificationsListPage.tsx` to ~150-line composition.

**2. Add sort selector.** Sort options: `newest` (desc), `oldest` (asc), `app` (grouped by app name). localStorage key: `notifications-sort`. Default: `newest`.

**3. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} notifications"` plus active filter summary if any.

**4. Standardize refresh button** — replace raw `<button>` with `<Button variant="ghost" size="sm">`.

**5. Convert to compact rows.** Desktop grid: `grid-cols-[auto_1fr_auto_140px_60px]` — App icon/name | Content preview | Source badge | Time | Actions (hover-reveal trash). Keep animated deletion. Row spacing: `space-y-1`.

**6. Switch delete to overlay pattern.** Keep deletion animation after confirmation.

---

## Section 7: WorkerSettingsPage (INT-1003)

**File:** `apps/web/src/pages/WorkerSettingsPage.tsx` (724 lines)
**Linear:** INT-1003

### Current State
- 724-line file with `DefaultReviewWorkerTypeCard`, `AddWorkerForm`, `WorkerRow` local components
- Uses `<Card>` component throughout
- Worker type uses `WORKER_TYPE_METADATA` Record (data-driven)
- Delete: inline red box via context menu
- No filtering (settings page), no sorting (manual reorder)

### Changes Required

**1. Decompose only** (this is a settings page, not a list page — no filter/sort/compact-row patterns needed):
- `apps/web/src/components/workers/WorkerRow.tsx` — Extract the ~245-line `WorkerRow` with all its editing, testing, and context menu state.
- `apps/web/src/components/workers/AddWorkerForm.tsx` — Extract ~100-line form.
- `apps/web/src/components/workers/DefaultReviewWorkerTypeCard.tsx` — Extract ~60-line card.
- `apps/web/src/components/workers/shared.tsx` — Move `WORKER_TYPE_METADATA` Record.
- Reduce `WorkerSettingsPage.tsx` to ~120-line composition.

**2. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add count: `"{n} workers configured"`.

---

## Section 8: NotesListPage (INT-1002)

**File:** `apps/web/src/pages/NotesListPage.tsx` (588 lines)
**Linear:** INT-1002

### Current State
- 588-line file with `NoteModal`, `CreateNoteModal`, `NoteRow` local components
- No status system, no filtering, no sorting
- Delete: inline red box in both `NoteRow` and `NoteModal`
- List: `space-y-4` of `<Card>` components
- Header subtitle: `text-slate-600 dark:text-slate-300` (wrong weight)

### Changes Required

**1. Decompose into sub-components** under `apps/web/src/components/notes/`:
- `apps/web/src/components/notes/NoteModal.tsx` — Extract ~200-line modal with editing and delete.
- `apps/web/src/components/notes/CreateNoteModal.tsx` — Extract ~80-line modal.
- `apps/web/src/components/notes/NoteRow.tsx` — Extract and rewrite as compact row.
- Reduce `NotesListPage.tsx` to ~80-line composition.

**2. Add tag filter pills.** Extract unique tags from loaded notes, display as filter pills. Add an "All" pill. localStorage key: `notes-tag-filter`. Default: all selected.

**3. Add sort selector.** Sort options: `updated` (updatedAt desc), `created` (createdAt desc), `title` (alphabetical). localStorage key: `notes-sort`. Default: `updated`.

**4. Convert to compact rows.** Desktop grid: `grid-cols-[1fr_auto_140px_60px]` — Title+preview | Tag badges | Time | Actions (hover-reveal trash). Row click opens `NoteModal`. Row spacing: `space-y-1`.

**5. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} notes"`.

**6. Switch delete in `NoteRow` to overlay pattern.** Delete in `NoteModal` stays inline.

---

## Section 9: VisualizationsListPage (INT-1004)

**File:** `apps/web/src/pages/VisualizationsListPage.tsx` (271 lines)
**Linear:** INT-1004

### Current State
- 271-line file with `StatusBadge`, `InlineVegaChart`, `VisualizationCard` local components
- Status: 4 values (`pending`, `refreshing`, `ready`, `error`) via inline if/else in `StatusBadge`
- Delete: inline red box
- List: `space-y-6` of `<Card>` components with inline Vega charts
- Has `<DataInsightsTabs />` above header

### Changes Required

**1. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} visualizations · {m} computing"`.

**2. Add status filter pills.** Filters: `computing` (pending+refreshing), `ready`, `error`. Use Reference pattern. localStorage key: `viz-status-filter`. Default: all selected.

**3. Add sort selector.** Sort options: `created` (createdAt desc), `name` (alphabetical). localStorage key: `viz-sort`. Default: `created`.

**4. Convert `StatusBadge` to data-driven record:**
```tsx
const VIZ_STATUS_MAP: Record<string, { bg: string; text: string; label: string }> = {
  pending:    { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Computing...' },
  refreshing: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Refreshing...' },
  ready:      { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', label: 'Ready' },
  error:      { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'Error' },
};
```

**5. Keep card layout** — visualizations contain inline Vega charts that need vertical space. Do NOT convert to compact rows. But switch to `space-y-4` (from `space-y-6`) for consistency.

**6. Switch delete to overlay pattern.**

---

## Section 10: CompositeFeedsListPage (INT-1005)

**File:** `apps/web/src/pages/CompositeFeedsListPage.tsx` (204 lines)
**Linear:** INT-1005

### Current State
- 204-line file with `CompositeFeedRow` local component
- No status system, no filtering, no sorting
- Delete: inline red box
- List: `space-y-4` of `<Card>` components
- Has `<DataInsightsTabs />` above header
- Row click navigates via `<Link to="/data-insights/${feed.id}">`

### Changes Required

**1. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} feeds"`.

**2. Convert to compact rows.** Desktop grid: `grid-cols-[1fr_auto_140px_60px]` — Name+purpose | Source count badge | Updated time | Actions (hover-reveal trash). Row click navigates to detail. Row spacing: `space-y-1`.

**3. Switch delete to overlay pattern.**

**4. No filter/sort needed** — these pages typically have very few items. Adding filter/sort would be over-engineering.

---

## Section 11: DataSourcesListPage (INT-1006)

**File:** `apps/web/src/pages/DataSourcesListPage.tsx` (166 lines)
**Linear:** INT-1006

### Current State
- 166-line file with `DataSourceRow` local component
- No status system, no filtering, no sorting
- Delete: inline red box
- List: `space-y-4` of `<Card>` components
- Has `<DataInsightsTabs />` above header
- Row click navigates via `<Link to="/data-insights/static-sources/${dataSource.id}">`

### Changes Required

**1. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} data sources"`.

**2. Convert to compact rows.** Desktop grid: `grid-cols-[1fr_140px_60px]` — Title+content preview | Updated time | Actions (hover-reveal trash). Row click navigates to detail. Row spacing: `space-y-1`.

**3. Switch delete to overlay pattern.**

**4. No filter/sort needed** — same rationale as CompositeFeedsListPage.

---

## Section 12: PREventsPage (INT-1007)

**File:** `apps/web/src/pages/PREventsPage.tsx` (242 lines)
**Linear:** INT-1007

### Current State
- 242-line file with `PageHeader` extracted component
- Already has decision filter pills (All/Pending/Completed) and search input
- Already has dynamic counts in subtitle
- Uses `space-y-0.5` tight row layout (compact)
- Rows rendered by external `<GitHubEventLogRow>` component
- No delete, no sort

### Changes Required

**1. Fix header subtitle** — already uses dynamic counts. Verify it matches `text-sm text-slate-500 dark:text-slate-400` pattern. Current subtitle text class: verify and fix if needed.

**2. Restyle filter pills** to match Reference pattern. Current pills use `rounded-full border px-3 py-1.5 text-xs` which is close but lacks the colored dot indicator. Add `<span className="inline-block h-2 w-2 rounded-full {dotClass}" />` before each label and add count badges.

**3. Add sort selector.** Sort options: `newest` (desc), `oldest` (asc). localStorage key: `pr-events-sort`. Default: `newest`.

**4. Already compact** — no row layout changes needed. The `space-y-0.5` spacing and external `<GitHubEventLogRow>` component are fine.

---

## Section 13: LlmCostsPage (INT-1008)

**File:** `apps/web/src/pages/LlmCostsPage.tsx` (296 lines)
**Linear:** INT-1008

### Current State
- 296-line dashboard page with `ProgressBar`, `SummaryCard`, `MonthlyBreakdown`, `ModelBreakdown`, `CallTypeBreakdown` local components
- Not a list page — analytics dashboard with cards and progress bars
- Header uses raw `<button>` for refresh
- No filtering, no sorting

### Changes Required

**1. Fix header subtitle** to `text-sm text-slate-500 dark:text-slate-400`. Show total cost in subtitle: `"Last 90 days · ${totalCost}"`.

**2. Standardize refresh button** — replace raw `<button>` with `<Button variant="ghost" size="sm">`.

**3. No filter/sort/compact-rows** — this is a dashboard, not a list. The current layout (summary cards grid + breakdown sections) is appropriate.

**4. Lightweight** — this page is 296 lines and well-structured. No decomposition needed.

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All — this is a frontend-only refactor across all sections
