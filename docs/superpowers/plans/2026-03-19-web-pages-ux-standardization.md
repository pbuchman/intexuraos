# Web Pages UX Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each Task Group (TG) is fully independent and can be executed in any order.

**Goal:** Standardize 13 web app pages to match Code Tasks v2 UX patterns: compact rows, filter pills, sort selectors, overlay delete, data-driven status badges, component decomposition.

**Architecture:** Each page is refactored independently. Monoliths (>500 lines) are decomposed into sub-components under `apps/web/src/components/{domain}/`. Smaller pages get in-place improvements. All pages adopt the shared header, filter, sort, and delete patterns documented in the Reference Patterns section.

**Tech Stack:** React 18, TypeScript (strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`), TailwindCSS, Lucide React icons, React Router v6

**Spec:** `docs/superpowers/specs/2026-03-19-web-pages-ux-standardization-design.md`

**Deep-link preservation:** Several pages (Todos, Bookmarks, Notes) use `useSearchParams` to read a `?id=` query param and auto-open a modal for that item. The Inbox page uses `?action=` from the hash query string. When rewriting these pages, you MUST preserve this `useEffect` + `searchParams` logic in the parent page so that direct item links and browser back/forward continue to work.

**Import convention:** This codebase uses `@/` path aliases (mapped to `apps/web/src/`). When importing from extracted component files, always use direct file imports like `import { Foo } from '@/components/todos/TodoRow.js'`. There are NO barrel `index.ts` files in the new component directories — do NOT use directory imports.

**Prerequisite:** INT-992 (Research pages standardization) should be completed first — it creates `apps/web/src/components/ui/ErrorBanner.tsx` and exports it from `apps/web/src/components/ui/index.ts`. If INT-992 is not yet done, the first task group you work on must create `ErrorBanner` (see spec Section "ErrorBanner Usage" for exact code).

---

## Shared Reference Patterns

These exact code patterns are referenced by every task group. An implementer only needs this section + their task group.

### R1. Page Header
```tsx
<div className="mb-6 flex items-center justify-between">
  <div>
    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
    <p className="text-sm text-slate-500 dark:text-slate-400">{dynamicCounts}</p>
  </div>
  <div className="flex items-center gap-2">{/* action buttons */}</div>
</div>
```

### R2. Filter Pills
```tsx
const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

// Each pill:
<button
  onClick={() => toggle(status)}
  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
    isActive ? config.activeClass : INACTIVE_CLASS
  }`}
>
  <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
  {config.label}
  <span className="font-medium">{String(count)}</span>
</button>
```
Wrap in `<div className="mb-4 flex flex-wrap gap-2">`. Persist to localStorage.

### R3. Sort Selector
```tsx
import { ArrowUpDown } from 'lucide-react';

<div className="mb-4 flex items-center gap-2">
  <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
  <div className="flex gap-1.5">
    {options.map(({ key, label }) => (
      <button key={key} onClick={() => setSort(key)}
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
Persist to localStorage.

### R4. Compact Row
```tsx
<div className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${accentShadow}`}>
  <div className="grid grid-cols-[...columns...] items-center gap-2">
    {/* grid cells */}
  </div>
  {/* overlay delete goes here */}
</div>
```
Row spacing: `<div className="space-y-1">`. Accent shadow: `shadow-[inset_3px_0_0_theme(colors.{color}.500)]`.

### R5. Overlay Delete
```tsx
{showDeleteConfirm ? (
  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
    onClick={(e): void => { e.stopPropagation(); }}>
    <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
      <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
      <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Cancel</button>
      <button onClick={onConfirm} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500">Delete</button>
    </div>
  </div>
) : null}
```
Row container needs `relative` class.

### R6. ErrorBanner
```tsx
import { ErrorBanner } from '@/components';
<ErrorBanner message={error} className="mb-6" />
```

### R7. Loading Spinner
```tsx
<div className="flex items-center justify-center py-12">
  <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
</div>
```

### R8. Hover-Reveal Trash Icon
```tsx
<button
  onClick={(e): void => { e.stopPropagation(); setShowDeleteConfirm(true); }}
  className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
  title="Delete"
>
  <Trash2 className="h-3.5 w-3.5" />
</button>
```

---

## TG1: TodosListPage (INT-996)

**Spec section:** Section 1

**Files:**
- Create: `apps/web/src/components/todos/shared.tsx`
- Create: `apps/web/src/components/todos/TodoRow.tsx`
- Create: `apps/web/src/components/todos/TodoModal.tsx`
- Create: `apps/web/src/components/todos/CreateTodoModal.tsx`
- Modify: `apps/web/src/pages/TodosListPage.tsx`

### Task 1: Extract shared config

- [ ] **Step 1:** Read `apps/web/src/pages/TodosListPage.tsx`. Locate `STATUS_CONFIG`, `PRIORITY_CONFIG`, `PriorityBadge`, `StatusBadge`, `ItemStatusIcon` components.

- [ ] **Step 2:** Create `apps/web/src/components/todos/shared.tsx`. Move those 5 items into it. Add filter and sort config:

```tsx
// Filter config
export type TodoGroupStatus = 'in_progress' | 'processing' | 'pending' | 'completed' | 'cancelled' | 'draft';

export const TODO_GROUP_STATUSES: TodoGroupStatus[] = ['in_progress', 'processing', 'pending', 'completed', 'cancelled', 'draft'];

export const TODO_FILTER_CONFIG: Record<TodoGroupStatus, { label: string; dotClass: string; activeClass: string }> = {
  in_progress: { label: 'In Progress', dotClass: 'bg-blue-500',   activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400' },
  processing:  { label: 'Processing',  dotClass: 'bg-purple-500', activeClass: 'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400' },
  pending:     { label: 'Pending',     dotClass: 'bg-amber-500',  activeClass: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400' },
  completed:   { label: 'Completed',   dotClass: 'bg-green-500',  activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400' },
  cancelled:   { label: 'Cancelled',   dotClass: 'bg-red-500',    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400' },
  draft:       { label: 'Draft',       dotClass: 'bg-slate-400',  activeClass: 'border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

export function getAccentShadow(status: string): string {
  if (status === 'in_progress') return 'shadow-[inset_3px_0_0_theme(colors.blue.500)]';
  if (status === 'pending') return 'shadow-[inset_3px_0_0_theme(colors.amber.500)]';
  if (status === 'completed') return 'shadow-[inset_3px_0_0_theme(colors.green.500)]';
  if (status === 'cancelled') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  return '';
}

// Sort config
export type TodoSortOption = 'created' | 'priority' | 'updated';
export const TODO_SORT_OPTIONS: { key: TodoSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'priority', label: 'Priority' },
  { key: 'updated', label: 'Updated' },
];
```

Export all existing components (`PriorityBadge`, `StatusBadge`, `ItemStatusIcon`, `STATUS_CONFIG`, `PRIORITY_CONFIG`) and the new config.

- [ ] **Step 3:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 4:** Commit: `git add apps/web/src/components/todos/shared.tsx && git commit -m "feat(web): extract todos shared config and status components"`

### Task 2: Extract TodoModal and CreateTodoModal

- [ ] **Step 1:** Create `apps/web/src/components/todos/TodoModal.tsx`. Move `TodoModal` component (~300 lines) and `TodoItemRow` component (~190 lines) from `TodosListPage.tsx`. Import `PriorityBadge`, `StatusBadge`, `ItemStatusIcon`, `STATUS_CONFIG`, `PRIORITY_CONFIG` from `./shared.js`. Keep all existing state, behavior, and props interfaces.

- [ ] **Step 2:** Create `apps/web/src/components/todos/CreateTodoModal.tsx`. Move `CreateTodoModal` (~160 lines). Import from `./shared.js` as needed. Keep all state.

- [ ] **Step 3:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 4:** Commit: `git add apps/web/src/components/todos/ && git commit -m "feat(web): extract TodoModal and CreateTodoModal"`

### Task 3: Create TodoRow compact row component

- [ ] **Step 1:** Create `apps/web/src/components/todos/TodoRow.tsx`. Replace the current card-based `TodoRow` with a compact row using pattern R4:

```tsx
// Desktop grid
<div className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(todo.status)}`}
  onClick={() => onSelect(todo)}>
  <div className="grid grid-cols-[1fr_auto_auto_140px_80px] items-center gap-2">
    {/* Title */}
    <div className="min-w-0">
      <p className="truncate font-medium text-slate-900 dark:text-slate-100">{todo.title}</p>
    </div>
    {/* Priority badge */}
    <PriorityBadge priority={todo.priority} />
    {/* Status badge */}
    <StatusBadge status={todo.status} />
    {/* Time */}
    <span className="text-xs text-slate-400 dark:text-slate-500">{formatRelative(todo.updatedAt)}</span>
    {/* Actions */}
    <div className="flex items-center justify-end">
      {/* R8 hover-reveal trash */}
    </div>
  </div>
  {/* R5 overlay delete */}
</div>
```

Import `getAccentShadow`, `PriorityBadge`, `StatusBadge` from `./shared.js`. Import `formatRelative` from `@/utils/dateFormat`. Import `Trash2` from `lucide-react`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Commit: `git add apps/web/src/components/todos/TodoRow.tsx && git commit -m "feat(web): create compact TodoRow component"`

### Task 4: Rewrite TodosListPage as composition

- [ ] **Step 1:** Rewrite `apps/web/src/pages/TodosListPage.tsx` (~100 lines). Delete all local component definitions. Import each component directly from its file using `@/` path aliases (e.g., `import { TodoRow } from '@/components/todos/TodoRow.js'`, `import { TodoModal } from '@/components/todos/TodoModal.js'`). Do NOT use barrel imports — there is no `index.ts` in these directories. Add:
  - `PageHeader` with R1 pattern. Subtitle: `"{n} todos · {m} in progress"`.
  - `StatusPipeline` with R2 pattern using `TODO_FILTER_CONFIG`. localStorage key: `todos-status-filter`. Default: all except `cancelled`.
  - `SortSelector` with R3 pattern using `TODO_SORT_OPTIONS`. localStorage key: `todos-sort`. Default: `created`.
  - Filtering/sorting logic in `useMemo`.
  - Error display with R6 `ErrorBanner`.
  - Compose `TodoRow` items in `<div className="space-y-1">`.
  - Keep modals: `TodoModal`, `CreateTodoModal`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Manually verify at `dev.intexuraos.cloud/#/todos` — filter pills, sort, compact rows, overlay delete, modal opens on click.

- [ ] **Step 4:** Commit: `git add apps/web/src/pages/TodosListPage.tsx && git commit -m "feat(web): rewrite TodosListPage with compact rows, filters, sort"`

---

## TG2: BookmarksListPage (INT-997)

**Spec section:** Section 2

**Files:**
- Create: `apps/web/src/components/bookmarks/shared.tsx`
- Create: `apps/web/src/components/bookmarks/BookmarkRow.tsx`
- Create: `apps/web/src/components/bookmarks/BookmarkModal.tsx`
- Create: `apps/web/src/components/bookmarks/CreateBookmarkModal.tsx`
- Create: `apps/web/src/components/bookmarks/FilterBar.tsx`
- Modify: `apps/web/src/pages/BookmarksListPage.tsx`

### Task 1: Extract shared config and helpers

- [ ] **Step 1:** Read `apps/web/src/pages/BookmarksListPage.tsx`. Locate `OG_STATUS_STYLES`, `OgStatusBadge`, and helper functions (`truncateText`, `getHostname`, `getDisplayTitle`, `getDisplayDescription`).

- [ ] **Step 2:** Create `apps/web/src/components/bookmarks/shared.tsx`. Move all located items. Add sort config:
```tsx
export type BookmarkSortOption = 'created' | 'title' | 'updated';
export const BOOKMARK_SORT_OPTIONS: { key: BookmarkSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'title', label: 'Title' },
  { key: 'updated', label: 'Updated' },
];
```

- [ ] **Step 3:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 4:** Commit: `git add apps/web/src/components/bookmarks/shared.tsx && git commit -m "feat(web): extract bookmarks shared config"`

### Task 2: Extract modals

- [ ] **Step 1:** Create `apps/web/src/components/bookmarks/BookmarkModal.tsx`. Move ~270-line `BookmarkModal`. Import from `./shared.js`.

- [ ] **Step 2:** Create `apps/web/src/components/bookmarks/CreateBookmarkModal.tsx`. Move ~180-line modal with duplicate-URL detection.

- [ ] **Step 3:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 4:** Commit: `git add apps/web/src/components/bookmarks/ && git commit -m "feat(web): extract bookmark modals"`

### Task 3: Restyle FilterBar as pills + create compact row

- [ ] **Step 1:** Create `apps/web/src/components/bookmarks/FilterBar.tsx`. Move existing `FilterBar` component. Restyle the archive filter (All/Active/Archived) from `<select>` to 3 pill buttons using R2 pill styling (but without counts — these are mode toggles). Keep the tag `<select>` as-is (too many tags for pills).

- [ ] **Step 2:** Create `apps/web/src/components/bookmarks/BookmarkRow.tsx`. Compact row with R4 pattern:
  - Desktop grid: `grid-cols-[40px_1fr_auto_140px_80px]` — Thumbnail (40x40 `h-10 w-10 rounded`) | Title+hostname | Tag badges | Time | Actions
  - Thumbnail uses ogImage -> favicon -> Globe icon fallback
  - R5 overlay delete, R8 hover-reveal trash

- [ ] **Step 3:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 4:** Commit: `git add apps/web/src/components/bookmarks/ && git commit -m "feat(web): create BookmarkRow and restyle FilterBar"`

### Task 4: Rewrite BookmarksListPage as composition

- [ ] **Step 1:** Rewrite `apps/web/src/pages/BookmarksListPage.tsx` (~120 lines). Add:
  - R1 header with subtitle `"{n} bookmarks · {m} archived"`.
  - `FilterBar` (restyled).
  - R3 sort selector with `BOOKMARK_SORT_OPTIONS`. localStorage key: `bookmarks-sort`. Default: `created`.
  - Compact `BookmarkRow` items in `<div className="space-y-1">`.
  - R6 `ErrorBanner`.
  - **IMPORTANT: Preserve `useBookmarkChanges()` real-time enrichment flow.** The current page uses `useBookmarkChanges()` with a debounced `refreshBookmarkById()` callback so that OG enrichment updates (titles, images, favicons) land automatically after initial fetch. This hook + debounce timer must remain in the rewritten parent page. Without it, bookmark previews will be stale until manual refresh.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Manually verify at `dev.intexuraos.cloud/#/bookmarks`.

- [ ] **Step 4:** Commit: `git add apps/web/src/pages/BookmarksListPage.tsx && git commit -m "feat(web): rewrite BookmarksListPage with compact rows and sort"`

---

## TG3: InboxPage (INT-998)

**Spec section:** Section 3

**Files:**
- Create: `apps/web/src/components/inbox/CommandItem.tsx`
- Create: `apps/web/src/components/inbox/InboxFilters.tsx`
- Modify: `apps/web/src/pages/InboxPage.tsx`

### Task 1: Extract CommandItem and InboxFilters

- [ ] **Step 1:** Read `apps/web/src/pages/InboxPage.tsx`. Locate `CommandItem` component (~80 lines) and the status filter pill bar section.

- [ ] **Step 2:** Create `apps/web/src/components/inbox/CommandItem.tsx`. Move the component. Keep all props and behavior.

- [ ] **Step 3:** Create `apps/web/src/components/inbox/InboxFilters.tsx`. Extract the status filter section. Restyle pills to match R2 pattern (add colored dot before each label, add count badge). Keep localStorage persistence (`inbox-status-filter`, `inbox-filter-expanded`).

- [ ] **Step 4:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 5:** Commit: `git add apps/web/src/components/inbox/ && git commit -m "feat(web): extract InboxFilters and CommandItem"`

### Task 2: Add sort selector and fix header

- [ ] **Step 1:** Modify `apps/web/src/pages/InboxPage.tsx`:
  - Fix header subtitle to R1 pattern with `text-sm text-slate-500 dark:text-slate-400`. Add counts: `"{n} actions · {m} pending"` for Actions tab, `"{n} commands"` for Commands tab.
  - Replace raw `<button>` refresh with `<Button variant="ghost" size="sm">` from `@/components`.
  - Add R3 sort selector. Actions sort: `created` (desc), `status` (pending first). Commands sort: `created` (desc), `type` (grouped). localStorage keys: `inbox-sort-actions`, `inbox-sort-commands`.
  - Import extracted components from `@/components/inbox/`.
  - Replace inline error banner with R6 `ErrorBanner`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Manually verify at `dev.intexuraos.cloud/#/inbox`.

- [ ] **Step 4:** Commit: `git add apps/web/src/pages/InboxPage.tsx && git commit -m "feat(web): add sort selector and fix InboxPage header"`

---

## TG4: WhatsAppNotesPage (INT-999)

**Spec section:** Section 4

**Files:**
- Create: `apps/web/src/components/whatsapp/shared.tsx`
- Create: `apps/web/src/components/whatsapp/MessageItem.tsx`
- Create: `apps/web/src/components/whatsapp/NoteDetailModal.tsx`
- Create: `apps/web/src/components/whatsapp/TranscriptionDetailModal.tsx`
- Modify: `apps/web/src/pages/WhatsAppNotesPage.tsx`

### Task 1: Extract sub-components

- [ ] **Step 1:** Read `apps/web/src/pages/WhatsAppNotesPage.tsx`.

- [ ] **Step 2:** Create `apps/web/src/components/whatsapp/shared.tsx`. Move `TextWithLinks` component.

- [ ] **Step 3:** Create `apps/web/src/components/whatsapp/MessageItem.tsx`. Move ~310-line `MessageItem`. Keep animated deletion behavior. Rewrite as compact row with R4 pattern:
  - Desktop grid: `grid-cols-[auto_1fr_140px_100px]` — Media type indicator | Content preview (single-line truncate) | Time | Actions (note/transcription/image buttons + R8 hover-reveal trash)
  - **Media type indicator column:** For text messages: `MessageSquare` icon (16x16). For audio: `Mic` icon (16x16). For images: render a small `ImageThumbnail` (32x32 rounded) — NOT just an icon. This preserves the current image preview affordance. Import `ImageThumbnail` from `@/components`. Clicking the thumbnail opens the `ImageModal` (same as current behavior).
  - Keep `deletingIds` Set pattern for animated deletion (scale-95 opacity-50)
  - R5 overlay delete, R8 hover-reveal trash
  - **IMPORTANT:** Preserve the `ImageModal` state (`selectedImageId`) in the parent page. The compact row for image messages must have an onClick handler that sets `selectedImageId` to open the full-size image viewer. Import `ImageModal` from `@/components`.

- [ ] **Step 4:** Create `apps/web/src/components/whatsapp/NoteDetailModal.tsx` (~110 lines) and `TranscriptionDetailModal.tsx` (~100 lines). Move as-is.

- [ ] **Step 5:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 6:** Commit: `git add apps/web/src/components/whatsapp/ && git commit -m "feat(web): extract WhatsApp sub-components with compact rows"`

### Task 2: Rewrite WhatsAppNotesPage as composition

- [ ] **Step 1:** Rewrite `apps/web/src/pages/WhatsAppNotesPage.tsx` (~120 lines):
  - R1 header with subtitle `"{n} messages from {fromNumber}"`.
  - Media type filter pills using R2 pattern: `all` (blue dot), `text` (slate dot), `image` (green dot), `audio` (purple dot). localStorage key: `whatsapp-media-filter`. Default: `all`.
  - R3 sort selector: `newest` (desc), `oldest` (asc). localStorage key: `whatsapp-sort`. Default: `newest`.
  - Compact `MessageItem` rows in `<div className="space-y-1">`.
  - R6 `ErrorBanner`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Manually verify at `dev.intexuraos.cloud/#/whatsapp`.

- [ ] **Step 4:** Commit: `git add apps/web/src/pages/WhatsAppNotesPage.tsx && git commit -m "feat(web): rewrite WhatsAppNotesPage with filters, sort, compact rows"`

---

## TG5: LinearIssuesPage (INT-1000)

**Spec section:** Section 5

**Files:**
- Create: `apps/web/src/components/linear/shared.tsx`
- Create: `apps/web/src/components/linear/IssueCard.tsx`
- Create: `apps/web/src/components/linear/SubIssuesList.tsx`
- Create: `apps/web/src/components/linear/IssueColumn.tsx`
- Create: `apps/web/src/components/linear/NeedsAttentionSection.tsx`
- Modify: `apps/web/src/pages/LinearIssuesPage.tsx`

### Task 1: Extract shared config and sub-components

- [ ] **Step 1:** Read `apps/web/src/pages/LinearIssuesPage.tsx`.

- [ ] **Step 2:** Create `apps/web/src/components/linear/shared.tsx`. Move `PRIORITY_COLORS`, `PRIORITY_LABELS`, `TABS` config. Also extract `getStatusIcon` — note: this is currently defined as a `const` arrow function **inside** the `SubIssuesList` component body (not a top-level function). Refactor it into a standalone exported function that takes a `stateType: string` parameter and returns the appropriate Lucide icon element. It uses `Circle`, `CircleDot`, `CheckCircle2`, `XCircle` from `lucide-react`.

- [ ] **Step 3:** Create individual component files:
  - `IssueCard.tsx` (~55 lines)
  - `SubIssuesList.tsx` (~65 lines)
  - `IssueColumn.tsx` — merge `IssueColumn`, `StackedSection`, `StackedColumn` (~80 lines total)
  - `NeedsAttentionSection.tsx` — includes `FailedIssueCard` (~120 lines total)

- [ ] **Step 4:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 5:** Commit: `git add apps/web/src/components/linear/ && git commit -m "feat(web): extract Linear issue sub-components"`

### Task 2: Rewrite page with filters

- [ ] **Step 1:** Rewrite `apps/web/src/pages/LinearIssuesPage.tsx` (~150 lines):
  - R1 header with subtitle `"{n} issues · {m} in progress"`.
  - Replace raw `<button>` refresh/sync with `<Button variant="ghost" size="sm">`.
  - Add priority filter pills using R2 pattern: Urgent (red dot), High (orange dot), Normal (blue dot), Low (slate dot). localStorage key: `linear-priority-filter`. Default: all selected.
  - Add assignee filter pills: Me (green dot), Unassigned (amber dot), All (blue dot). These filter across all columns. localStorage key: `linear-assignee-filter`. Default: `All`. The "Me" filter matches issues where `assignee?.name` equals the current user (available from `useAuth()` context). Place assignee pills on a second row below priority pills.
  - Keep Kanban layout (do NOT convert to rows).
  - R6 `ErrorBanner`.
  - Import all from `@/components/linear/`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Manually verify at `dev.intexuraos.cloud/#/linear-issues`.

- [ ] **Step 4:** Commit: `git add apps/web/src/pages/LinearIssuesPage.tsx && git commit -m "feat(web): rewrite LinearIssuesPage with filter pills and decomposition"`

---

## TG6: MobileNotificationsListPage (INT-1001)

**Spec section:** Section 6

**Files:**
- Create: `apps/web/src/components/notifications/shared.tsx`
- Create: `apps/web/src/components/notifications/NotificationCard.tsx`
- Create: `apps/web/src/components/notifications/MultiSelectDropdown.tsx`
- Create: `apps/web/src/components/notifications/NotificationFilters.tsx`
- Modify: `apps/web/src/pages/MobileNotificationsListPage.tsx`

### Task 1: Extract sub-components

- [ ] **Step 1:** Read `apps/web/src/pages/MobileNotificationsListPage.tsx`.

- [ ] **Step 2:** Create `apps/web/src/components/notifications/shared.tsx`. Move `Badge` component, `hasActiveFilters`, `arraysEqual`, `filtersMatchSaved` helpers.

- [ ] **Step 3:** Create `apps/web/src/components/notifications/MultiSelectDropdown.tsx` (~75 lines). Move as-is.

- [ ] **Step 4:** Create `apps/web/src/components/notifications/NotificationFilters.tsx` (~150 lines). Move the filter section including saved filters CRUD.

- [ ] **Step 5:** Create `apps/web/src/components/notifications/NotificationCard.tsx` (~75 lines). Rewrite as compact row with R4:
  - Desktop grid: `grid-cols-[auto_1fr_auto_140px_60px]` — App badge | Content preview (truncate) | Source badge | Time | Actions (R8 hover-reveal trash)
  - Keep animated deletion (scale-95 opacity-50)
  - R5 overlay delete

- [ ] **Step 6:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 7:** Commit: `git add apps/web/src/components/notifications/ && git commit -m "feat(web): extract notification sub-components with compact rows"`

### Task 2: Rewrite page as composition

- [ ] **Step 1:** Rewrite `apps/web/src/pages/MobileNotificationsListPage.tsx` (~150 lines):
  - R1 header with subtitle `"{n} notifications"`. Replace raw `<button>` refresh with `<Button variant="ghost" size="sm">`.
  - R3 sort selector: `newest` (desc), `oldest` (asc), `app` (grouped). localStorage key: `notifications-sort`. Default: `newest`.
  - Keep `NotificationFilters` component (it has its own rich filtering).
  - Compact `NotificationCard` rows in `<div className="space-y-1">`.
  - R6 `ErrorBanner`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Manually verify at `dev.intexuraos.cloud/#/notifications`.

- [ ] **Step 4:** Commit: `git add apps/web/src/pages/MobileNotificationsListPage.tsx && git commit -m "feat(web): rewrite MobileNotificationsListPage with sort and compact rows"`

---

## TG7: WorkerSettingsPage (INT-1003)

**Spec section:** Section 7

**Files:**
- Create: `apps/web/src/components/workers/shared.tsx`
- Create: `apps/web/src/components/workers/WorkerRow.tsx`
- Create: `apps/web/src/components/workers/AddWorkerForm.tsx`
- Create: `apps/web/src/components/workers/DefaultReviewWorkerTypeCard.tsx`
- Modify: `apps/web/src/pages/WorkerSettingsPage.tsx`

### Task 1: Extract sub-components

- [ ] **Step 1:** Read `apps/web/src/pages/WorkerSettingsPage.tsx`.

- [ ] **Step 2:** Create `apps/web/src/components/workers/shared.tsx`. Move `WORKER_TYPE_METADATA` Record.

- [ ] **Step 3:** Create `apps/web/src/components/workers/WorkerRow.tsx` (~340 lines). Move with all editing, testing, and context menu state. This is the largest single component extraction — it includes inline editing form fields, test execution, context menu dropdown, delete confirmation, and move-up/down controls.

- [ ] **Step 4:** Create `apps/web/src/components/workers/AddWorkerForm.tsx` (~100 lines). Move as-is.

- [ ] **Step 5:** Create `apps/web/src/components/workers/DefaultReviewWorkerTypeCard.tsx` (~60 lines). Move as-is.

- [ ] **Step 6:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 7:** Commit: `git add apps/web/src/components/workers/ && git commit -m "feat(web): extract worker settings sub-components"`

### Task 2: Rewrite page as composition

- [ ] **Step 1:** Rewrite `apps/web/src/pages/WorkerSettingsPage.tsx` (~120 lines):
  - R1 header with subtitle `"{n} workers configured"` in `text-sm text-slate-500 dark:text-slate-400`.
  - No filter/sort (settings page).
  - Import and compose extracted components.
  - R6 `ErrorBanner`.

- [ ] **Step 2:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 3:** Commit: `git add apps/web/src/pages/WorkerSettingsPage.tsx && git commit -m "feat(web): rewrite WorkerSettingsPage as composition"`

---

## TG8: NotesListPage (INT-1002)

**Spec section:** Section 8

**Files:**
- Create: `apps/web/src/components/notes/shared.tsx`
- Create: `apps/web/src/components/notes/NoteModal.tsx`
- Create: `apps/web/src/components/notes/CreateNoteModal.tsx`
- Create: `apps/web/src/components/notes/NoteRow.tsx`
- Modify: `apps/web/src/pages/NotesListPage.tsx`

### Task 1: Extract shared and modals

- [ ] **Step 1:** Read `apps/web/src/pages/NotesListPage.tsx`. Locate the `truncateContent` helper function (uses `stripMarkdown` from `@/utils`).

- [ ] **Step 2:** Create `apps/web/src/components/notes/shared.tsx`. Move `truncateContent` here. Import `stripMarkdown` from `@/utils`. Export the function — it's used by both `NoteRow` and `NoteModal`.

- [ ] **Step 3:** Create `apps/web/src/components/notes/NoteModal.tsx` (~200 lines). Move as-is. Import `truncateContent` from `./shared.js` if used.

- [ ] **Step 4:** Create `apps/web/src/components/notes/CreateNoteModal.tsx` (~80 lines). Move as-is.

- [ ] **Step 5:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 6:** Commit: `git add apps/web/src/components/notes/ && git commit -m "feat(web): extract note shared, modals"`

### Task 2: Create compact row and rewrite page

- [ ] **Step 1:** Create `apps/web/src/components/notes/NoteRow.tsx`. Compact row with R4:
  - Desktop grid: `grid-cols-[1fr_auto_140px_60px]` — Title+preview (truncate) | Tag badges | Time | Actions (R8 hover-reveal trash)
  - R5 overlay delete
  - Row click opens `NoteModal`

- [ ] **Step 2:** Rewrite `apps/web/src/pages/NotesListPage.tsx` (~80 lines):
  - R1 header with subtitle `"{n} notes"`.
  - Tag filter pills: extract unique tags from notes, display with R2 pattern. Add "All" pill. localStorage key: `notes-tag-filter`. Default: all.
  - R3 sort selector: `updated` (desc), `created` (desc), `title` (A-Z). localStorage key: `notes-sort`. Default: `updated`.
  - Compact `NoteRow` in `<div className="space-y-1">`.
  - R6 `ErrorBanner`.

- [ ] **Step 3:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 4:** Manually verify at `dev.intexuraos.cloud/#/notes`.

- [ ] **Step 5:** Commit: `git add apps/web/src/components/notes/NoteRow.tsx apps/web/src/pages/NotesListPage.tsx && git commit -m "feat(web): rewrite NotesListPage with compact rows, tag filters, sort"`

---

## TG9: VisualizationsListPage (INT-1004)

**Spec section:** Section 9

**Files:**
- Modify: `apps/web/src/pages/VisualizationsListPage.tsx`

### Task 1: Add filters, sort, and fix status badges

- [ ] **Step 1:** Read `apps/web/src/pages/VisualizationsListPage.tsx`.

- [ ] **Step 2:** Replace `StatusBadge` if/else with data-driven record:
```tsx
type VizStatus = 'pending' | 'refreshing' | 'ready' | 'error';

const VIZ_STATUS_MAP: Record<VizStatus, { bg: string; text: string; label: string }> = {
  pending:    { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Computing...' },
  refreshing: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Refreshing...' },
  ready:      { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', label: 'Ready' },
  error:      { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'Error' },
};
// Usage: VIZ_STATUS_MAP[status as VizStatus] — safe because the Visualization type
// constrains status to these 4 values. Using a union-type key avoids noUncheckedIndexedAccess issues.
```

- [ ] **Step 3:** Fix header subtitle to R1 pattern: `"{n} visualizations · {m} computing"`.

- [ ] **Step 4:** Add status filter pills with R2 pattern: `computing` (blue, groups pending+refreshing), `ready` (green), `error` (red). localStorage key: `viz-status-filter`. Default: all.

- [ ] **Step 5:** Add R3 sort selector: `created` (desc), `name` (A-Z). localStorage key: `viz-sort`. Default: `created`.

- [ ] **Step 6:** Change list spacing from `space-y-6` to `space-y-4`. Keep card layout (visualizations contain charts).

- [ ] **Step 7:** Switch delete to R5 overlay pattern. Card needs `relative` class.

- [ ] **Step 8:** Replace inline error banner with R6 `ErrorBanner`.

- [ ] **Step 9:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 10:** Commit: `git add apps/web/src/pages/VisualizationsListPage.tsx && git commit -m "feat(web): add filters, sort, overlay delete to VisualizationsListPage"`

---

## TG10: CompositeFeedsListPage (INT-1005)

**Spec section:** Section 10

**Files:**
- Modify: `apps/web/src/pages/CompositeFeedsListPage.tsx`

### Task 1: Convert to compact rows and overlay delete

- [ ] **Step 1:** Read `apps/web/src/pages/CompositeFeedsListPage.tsx`.

- [ ] **Step 2:** Fix header subtitle to R1 pattern: `"{n} feeds"`.

- [ ] **Step 3:** Rewrite `CompositeFeedRow` as compact row with R4:
  - Desktop grid: `grid-cols-[1fr_auto_140px_60px]` — Name+truncated purpose | Source count badge (`"{n} sources"` in `rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300`) | Updated time | Actions (R8 hover-reveal trash)
  - Row click navigates to `/data-insights/${feed.id}`
  - R5 overlay delete

- [ ] **Step 4:** Change list spacing to `<div className="space-y-1">`.

- [ ] **Step 5:** Replace inline error banner with R6 `ErrorBanner`.

- [ ] **Step 6:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 7:** Commit: `git add apps/web/src/pages/CompositeFeedsListPage.tsx && git commit -m "feat(web): convert CompositeFeedsListPage to compact rows"`

---

## TG11: DataSourcesListPage (INT-1006)

**Spec section:** Section 11

**Files:**
- Modify: `apps/web/src/pages/DataSourcesListPage.tsx`

### Task 1: Convert to compact rows and overlay delete

- [ ] **Step 1:** Read `apps/web/src/pages/DataSourcesListPage.tsx`.

- [ ] **Step 2:** Fix header subtitle to R1 pattern: `"{n} data sources"`.

- [ ] **Step 3:** Rewrite `DataSourceRow` as compact row with R4:
  - Desktop grid: `grid-cols-[1fr_140px_60px]` — Title+content preview (truncate) | Updated time | Actions (R8 hover-reveal trash)
  - Row click navigates to `/data-insights/static-sources/${dataSource.id}`
  - R5 overlay delete

- [ ] **Step 4:** Change list spacing to `<div className="space-y-1">`.

- [ ] **Step 5:** Replace inline error banner with R6 `ErrorBanner`.

- [ ] **Step 6:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 7:** Commit: `git add apps/web/src/pages/DataSourcesListPage.tsx && git commit -m "feat(web): convert DataSourcesListPage to compact rows"`

---

## TG12: PREventsPage (INT-1007)

**Spec section:** Section 12

**Files:**
- Modify: `apps/web/src/pages/PREventsPage.tsx`

### Task 1: Restyle filter pills and add sort

- [ ] **Step 1:** Read `apps/web/src/pages/PREventsPage.tsx`.

- [ ] **Step 2:** Verify header subtitle uses `text-sm text-slate-500 dark:text-slate-400`. Fix if not.

- [ ] **Step 3:** Restyle the 3 decision filter pills (All/Pending/Completed) to match R2 pattern. Add colored dot before label: All (blue dot), Pending (amber dot), Completed (green dot). Add count badge after each label.

- [ ] **Step 4:** Add R3 sort selector: `newest` (desc), `oldest` (asc). localStorage key: `pr-events-sort`. Default: `newest`.

- [ ] **Step 5:** Replace inline error banner with R6 `ErrorBanner`.

- [ ] **Step 6:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 7:** Commit: `git add apps/web/src/pages/PREventsPage.tsx && git commit -m "feat(web): restyle PREventsPage filter pills and add sort"`

---

## TG13: LlmCostsPage (INT-1008)

**Spec section:** Section 13

**Files:**
- Modify: `apps/web/src/pages/LlmCostsPage.tsx`

### Task 1: Fix header and standardize refresh

- [ ] **Step 1:** Read `apps/web/src/pages/LlmCostsPage.tsx`.

- [ ] **Step 2:** Fix header subtitle to R1 pattern: `"Last 90 days · ${totalCost}"` in `text-sm text-slate-500 dark:text-slate-400`.

- [ ] **Step 3:** Replace raw `<button>` refresh with `<Button variant="ghost" size="sm">` from `@/components`.

- [ ] **Step 4:** Replace inline error banner with R6 `ErrorBanner`.

- [ ] **Step 5:** Verify build: `pnpm run verify:workspace:tracked -- web`

- [ ] **Step 6:** Commit: `git add apps/web/src/pages/LlmCostsPage.tsx && git commit -m "feat(web): standardize LlmCostsPage header and refresh button"`

---

## Final Verification

After all task groups are complete:

- [ ] Run `pnpm run ci:tracked` from repo root. All checks must pass.
- [ ] Verify `packages/*/dist/` exists.
- [ ] Commit any lint/format fixes: `git commit -m "fix(web): lint fixes for UX standardization"`
