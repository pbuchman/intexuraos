# Research Pages UX Standardization

**Date:** 2026-03-19
**Status:** Draft
**Goal:** Bring Research pages (list, detail, new/edit) to the same UX quality bar as Code Tasks pages by adopting proven patterns from the Code Tasks v2 refactor.

## Context

The Code Tasks pages went through a v2 refactor that established strong patterns:
- Data-driven status configuration (`STATUS_MAP` records)
- Component decomposition into focused files (`V2TaskHeader`, `V2LogStream`, `V2TaskActions`, `V2NextSteps`, `shared.tsx`)
- Status filter pills with counts and localStorage persistence
- Sort selector with multiple options
- Compact grid-based list rows with pipeline visualization
- Overlay-based delete confirmation with backdrop blur
- Consistent use of shared `Card`, `Button`, `Layout` components

Research pages were built earlier and never received an equivalent refinement pass. This spec defines the changes needed to standardize them.

## Scope

**In scope:**
- `ResearchListPage.tsx` — list page standardization
- `ResearchDetailPage.tsx` — detail page decomposition and styling
- New shared components extracted from Research detail page
- Shared utilities (status config, error banner)

**Out of scope:**
- `ResearchAgentPage.tsx` (new/edit form) — already well-structured with `Card` components; only minor alignment changes
- Functional changes to research business logic
- New features or capabilities
- Backend API changes

## Changes

### 1. Status Badge — Data-Driven Record

**Problem:** `ResearchDetailPage.tsx:63-127` uses a 60-line if/else chain for `ResearchStatusBadge`. `ResearchListPage.tsx:22-31` has a separate `STATUS_STYLES` record that is not reused in the detail page. Badge sizing differs: list uses `px-2.5 py-0.5`, detail uses `px-2.5 py-1`.

**Solution:** Create `apps/web/src/components/research/shared.tsx` mirroring the Code Tasks `v2/shared.tsx` pattern:
- Define `RESEARCH_STATUS_MAP: Record<ResearchStatus, StatusConfig>` with `{ bg, text, label, icon }` for each status
- Icons per status (matching the current visual behavior):
  - `draft` → `FileText`
  - `pending` → `Clock`
  - `processing` → `Clock`
  - `awaiting_confirmation` → `AlertTriangle`
  - `retrying` → `RefreshCw`
  - `synthesizing` → `Clock`
  - `completed` → `CheckCircle`
  - `failed` → `XCircle`
- Define an `ICON_MAP` for the icon components: `{ Clock, CheckCircle, XCircle, AlertTriangle, FileText, RefreshCw }`
- Export a single `ResearchStatusBadge` component that consumes the record
- Standardize on `px-2.5 py-1 text-sm font-medium` badge sizing (matching Code Tasks)
- Delete `STATUS_STYLES` from `ResearchListPage.tsx` and the if/else chain from `ResearchDetailPage.tsx`

**Files changed:**
- Create: `apps/web/src/components/research/shared.tsx`
- Modify: `ResearchListPage.tsx` — import from shared
- Modify: `ResearchDetailPage.tsx` — import from shared, remove local `ResearchStatusBadge`

### 2. Research List — Compact Row Layout with Filters and Sort

**Problem:** Research list uses full vertical cards (`space-y-4`, ~4x height of Code Task rows), no filtering, no sorting. The subtitle uses `text-slate-600 dark:text-slate-300` (heavier weight) instead of `text-sm text-slate-500 dark:text-slate-400`.

**Solution:**

#### 2a. Status Filter Pills
Add `StatusPipeline` component matching Code Tasks pattern:
- Filter pills for: `processing` (groups pending+processing+retrying+synthesizing), `action-required` (awaiting_confirmation), `completed`, `failed`, `draft`
- Each pill shows count, persists selection to localStorage key `research-status-filter`
- Active filter highlighted with colored border/bg; inactive is slate
- **Note:** Counts reflect loaded researches only (the hook uses cursor-based pagination via `loadMore()`). Counts update as more data is loaded. This is consistent with Code Tasks behavior.

#### 2b. Sort Selector
Add `SortSelector` matching Code Tasks pattern:
- Sort options: `created` (startedAt desc), `completed` (completedAt desc), `favourite` (favourites first, then by date)
- For drafts where `startedAt` is undefined, use the research `id` as a tiebreaker (Firestore IDs are chronologically ordered) or sort them at the end
- Persists to localStorage key `research-sort`

#### 2c. Compact Row Layout
Replace the `ResearchCard` vertical cards with a compact horizontal row:
- Desktop grid: `grid-cols-[1fr_auto_140px_120px]` — Title/prompt | Status+Models | Time | Actions
- Left border accent shadow matching Code Tasks pattern (blue=processing, orange=action-required, green=completed, red=failed)
- Title is the research title (or truncated prompt), truncated to single line
- Model chips shown inline as compact pills (provider names)
- Time shows `formatRelative(startedAt)`
- Actions column: favourite star + delete (hover-reveal trash icon matching Code Tasks)
- Clicking the row navigates to detail page (unlike Code Tasks which expands — Research doesn't have an equivalent to the task timeline)
- Mobile layout: stacked with title + relative time + status badge, model chips below

#### 2d. Page Header
- Subtitle: change to `text-sm text-slate-500 dark:text-slate-400` matching Code Tasks
- Add dynamic counts: `"{n} researches · {m} processing"` pattern

**Files changed:**
- Modify: `ResearchListPage.tsx` — major rewrite of list layout
- Create: `apps/web/src/components/research/shared.tsx` (add filter/sort config alongside status config)

### 3. Research Detail Page — Component Decomposition

**Problem:** `ResearchDetailPage.tsx` is 1819 lines with ~20 `useState` calls, 10+ handler functions, and several inline sub-components. This contrasts with Code Tasks' focused decomposition.

**Solution:** Extract into sub-components under `apps/web/src/components/research/`:

#### 3a. `ResearchHeader.tsx`
Extracted from current header section (lines 541-563) and the collapsible links section (lines 830-908). Two-row layout matching `V2TaskHeader`:
- Row 1: Title + `ResearchStatusBadge` + favourite star
- Row 2: Timestamp, model provider chips, synthesis model chip
- The collapsible links section (share URL, Notion URL with copy buttons) is preserved as-is within this component. It renders below the two header rows when share/notion info exists. The existing collapsible UX with `ChevronDown` toggle is kept — it works well for URLs that can be long.
- Uses `min-h-[2.5rem]` and `min-h-[1.75rem]` guards matching Code Tasks

#### 3b. `ResearchActions.tsx`
Extracted from lines 572-790. Handles all action buttons and confirmation dialogs:
- Processing state: no actions (just status)
- Failed state: Retry + Delete buttons
- Completed state: Enhance + Export to Notion + Share/Unshare + Delete buttons
- Draft state: Start + Edit + Discard buttons
- Delete/Unshare confirmation uses inline pattern (matching existing research pattern — NOT changing to overlay here since the detail page delete is a page-level action, not a row-level action)
- Includes `PartialFailureConfirmation` (currently at lines 1677-1768) — this fits naturally here since it renders based on research status and triggers action callbacks (`onConfirm` with proceed/retry/cancel)
- All error banners consolidated using `ErrorBanner` (see change 5)

#### 3c. `ResearchResults.tsx`
Extracted from lines 1031-1198. Renders the main report section:
- Synthesis report card (with copy button)
- Single-model report card
- Individual LLM Results section
- Moves `LlmResultCard`, `CollapsibleInputContext` into this file
- Moves helper functions used by these components: `formatTokenCount`, `formatCost`, `formatNumber`
- Research Summary card (token usage, duration, cost — lines 948-991) is also included here since it is closely related to the results display
- Synthesis error banner (lines 1145-1150) included here

#### 3d. `EnhanceModal.tsx`
Extracted from lines 1200-1414. Self-contained modal component:
- Model selection, synthesis model selection, context management
- Own state for model selections, contexts, remove-context IDs

#### 3e. `ProcessingStatus.tsx`
Extracted from lines 1434-1524. Also includes:
- `StatusDot` helper (lines 1526-1536) — only used by ProcessingStatus and LlmResultCard
- `ErrorDisplay` helper (lines 1538-1550) — only used by ProcessingStatus
- "Input Contexts during processing" section (lines 1006-1019) — rendered when `isProcessing && research.inputContexts` exist. This moves here since it is part of the processing UI.

Note: `StatusDot` is also used by `LlmResultCard` in `ResearchResults.tsx`, so it should be exported from `ProcessingStatus.tsx` and imported by `ResearchResults.tsx`.

#### 3f. Parent `ResearchDetailPage.tsx` Composition
After decomposition, the parent page (~150 lines) handles:
- Route params, `useResearch` hook, `useWorkersStatus` if needed
- State that must be shared across sub-components (e.g., `copiedSection`)
- `shareToast` floating notification rendering (lines 1416-1420) stays in the parent
- Draft redirect logic (lines 485-489)
- Loading/error states
- Composition of all sub-components with prop passing

**Files changed:**
- Create: `apps/web/src/components/research/ResearchHeader.tsx`
- Create: `apps/web/src/components/research/ResearchActions.tsx`
- Create: `apps/web/src/components/research/ResearchResults.tsx`
- Create: `apps/web/src/components/research/EnhanceModal.tsx`
- Create: `apps/web/src/components/research/ProcessingStatus.tsx`
- Modify: `ResearchDetailPage.tsx` — compose from sub-components, reduce to ~150 lines

### 4. Duplicate MarkdownContent Removal

**Problem:** `ResearchDetailPage.tsx:133-141` defines a local `MarkdownContent` function identical to the shared `@/components/MarkdownContent` (which already includes `rehypeHighlight`).

**Solution:** Delete the local definition, import from `@/components`.

Also delete the local `renderPromptWithLinks` function (lines 147-171) — it does manual URL detection, but the shared `MarkdownContent` with `remarkGfm` already auto-links raw URLs via GFM.

**Intentional rendering change:** The research prompt in the "Research Topic" card will be rendered as markdown instead of plain text. This matches how Code Tasks renders its prompt card (using `MarkdownContent` at `CodeTaskViewPageV2.tsx:311`). This means markdown syntax in prompts (e.g., `*bold*`, `# heading`) will now render as formatted content rather than literal text. This is the desired behavior for consistency.

**Files changed:**
- Modify: `ResearchDetailPage.tsx` (or `ResearchResults.tsx` / `ResearchHeader.tsx` after decomposition, depending on where the prompt card lands — the prompt card stays in the parent `ResearchDetailPage.tsx` composition)

### 5. Error Banner Consolidation

**Problem:** `ResearchDetailPage.tsx` has 4 error banners (lines 792-815) for `approveError`, `deleteError`, `retryError`, `exportError`, plus a separate `unshareError` banner at line 566. Additionally, there is a success banner for `exportSuccess` (lines 816-828) which is structurally different (green, contains a Notion link) and should NOT be consolidated into the error component.

**Solution:** Create a small `ErrorBanner` component in the shared UI:

```tsx
// apps/web/src/components/ui/ErrorBanner.tsx
export function ErrorBanner({ message }: { message: string | null }): React.JSX.Element | null {
  if (message === null || message === '') return null;
  return (
    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
      {message}
    </div>
  );
}
```

The `exportSuccess` banner remains custom since it has different styling (green) and contains an anchor link to Notion.

Use `ErrorBanner` in Research pages. Code Tasks `V2TaskActions.tsx` can optionally adopt it too but is not required for this spec.

**Files changed:**
- Create: `apps/web/src/components/ui/ErrorBanner.tsx`
- Modify: `apps/web/src/components/ui/index.ts` — export ErrorBanner
- Modify: `ResearchActions.tsx` — use ErrorBanner for all error states

### 6. Delete Confirmation — Overlay Pattern on List Page

**Problem:** `ResearchListPage.tsx` uses inline expand for delete confirmation (shifts layout), while Code Tasks `IssueGroupRow.tsx` uses an absolute-positioned overlay with backdrop blur (no layout shift).

**Solution:** Adopt the overlay pattern from Code Tasks for delete confirmations on the research list page. The detail page keeps its inline pattern since it's a page-level action with more context.

Pattern to adopt:
```tsx
<div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80">
  <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
    ...confirm/cancel buttons...
  </div>
</div>
```

The row container must have `relative` positioning for this to work.

**Files changed:**
- Modify: `ResearchListPage.tsx` — update delete confirm UI in the compact row component

## File Inventory

### New Files (7)
| File                                                    | Purpose                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/web/src/components/research/shared.tsx`           | Status config, filter/sort config, `ResearchStatusBadge`             |
| `apps/web/src/components/research/ResearchHeader.tsx`   | Detail page header (two-row layout + collapsible links)              |
| `apps/web/src/components/research/ResearchActions.tsx`  | Action buttons, confirmations, `PartialFailureConfirmation`          |
| `apps/web/src/components/research/ResearchResults.tsx`  | Report rendering, Research Summary, `LlmResultCard`, helpers         |
| `apps/web/src/components/research/EnhanceModal.tsx`     | Enhance research modal                                               |
| `apps/web/src/components/research/ProcessingStatus.tsx` | LLM processing status, `StatusDot`, input contexts during processing |
| `apps/web/src/components/ui/ErrorBanner.tsx`            | Reusable error banner                                                |

### Modified Files (3)
| File                                  | Nature of Change                                           |
| ------------------------------------- | ---------------------------------------------------------- |
| `ResearchListPage.tsx`                | Major rewrite: compact rows, filters, sort, overlay delete |
| `ResearchDetailPage.tsx`              | Reduce to ~150-line composition of sub-components          |
| `apps/web/src/components/ui/index.ts` | Export ErrorBanner                                         |

### Deleted Code
| Location                         | What                                | Why                                                     |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `ResearchDetailPage.tsx:63-127`  | `ResearchStatusBadge` if/else chain | Replaced by data-driven record in `research/shared.tsx` |
| `ResearchDetailPage.tsx:133-141` | Local `MarkdownContent`             | Duplicate of shared `@/components/MarkdownContent`      |
| `ResearchDetailPage.tsx:147-171` | `renderPromptWithLinks`             | `MarkdownContent` with GFM handles auto-linking         |
| `ResearchListPage.tsx:22-31`     | `STATUS_STYLES` record              | Moved to `research/shared.tsx`                          |

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All — this is a frontend-only refactor

## Testing Strategy

This is a UI refactoring with no business logic changes. Per CLAUDE.md, web app coverage is not enforced and tests are optional for UI components.

However, if any utility functions are extracted (e.g., status filtering logic), they should have unit tests.

The primary verification is visual: each page should render identically to its current state after the refactor, with the following intentional visual differences:
- Research list page: compact rows instead of cards, filter pills, sort selector
- Research detail header: two-row layout instead of single-row
- Research prompt card: markdown rendering instead of plain text
- Delete confirmation on list: overlay instead of inline expand

## Migration Notes

- No database changes
- No API changes
- No routing changes (all existing routes preserved)
- No breaking changes to any exported types or interfaces
- `ResearchAgentPage.tsx` (new/edit form) is untouched except for importing `ResearchStatusBadge` from shared if it uses one (it doesn't currently)
