# Research Pages UX Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize Research pages (list and detail) to match the UX quality and patterns established in the Code Tasks v2 refactor.

**Architecture:** Extract shared status configuration and sub-components from the monolithic `ResearchDetailPage.tsx` (1819 lines) into focused files under `apps/web/src/components/research/`. Rewrite `ResearchListPage.tsx` with compact rows, status filter pills, and sort selector matching Code Tasks patterns. Add a shared `ErrorBanner` UI component.

**Tech Stack:** React, TypeScript (strict mode), TailwindCSS, Lucide icons, React Router

**Spec:** `docs/superpowers/specs/2026-03-19-research-pages-ux-standardization-design.md`

---

## File Structure

### New Files
| File                                                    | Responsibility                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/research/shared.tsx`           | `RESEARCH_STATUS_MAP`, `ICON_MAP`, `ResearchStatusBadge`, filter/sort config, accent color helpers                     |
| `apps/web/src/components/research/ResearchHeader.tsx`   | Detail page header: two-row layout, favourite toggle, collapsible links                                                |
| `apps/web/src/components/research/ResearchActions.tsx`  | Action buttons, delete/unshare confirmations, `PartialFailureConfirmation`                                             |
| `apps/web/src/components/research/ResearchResults.tsx`  | Synthesis/single/individual reports, Research Summary card, `LlmResultCard`, `CollapsibleInputContext`, format helpers |
| `apps/web/src/components/research/EnhanceModal.tsx`     | Enhance research modal (model selection, context management)                                                           |
| `apps/web/src/components/research/ProcessingStatus.tsx` | LLM processing status, `StatusDot`, `ErrorDisplay`, input contexts during processing                                   |
| `apps/web/src/components/ui/ErrorBanner.tsx`            | Reusable error banner component                                                                                        |

### Modified Files
| File                                        | Nature of Change                                           |
| ------------------------------------------- | ---------------------------------------------------------- |
| `apps/web/src/pages/ResearchListPage.tsx`   | Major rewrite: compact rows, filters, sort, overlay delete |
| `apps/web/src/pages/ResearchDetailPage.tsx` | Reduce to ~150-line composition of sub-components          |
| `apps/web/src/components/ui/index.ts`       | Export `ErrorBanner`                                       |

---

## Task 1: Create `ErrorBanner` Shared UI Component

**Files:**
- Create: `apps/web/src/components/ui/ErrorBanner.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

- [ ] **Step 1: Create `ErrorBanner.tsx`**

```tsx
// apps/web/src/components/ui/ErrorBanner.tsx

interface ErrorBannerProps {
  message: string | null;
  className?: string;
}

export function ErrorBanner({ message, className = '' }: ErrorBannerProps): React.JSX.Element | null {
  if (message === null || message === '') return null;
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400 ${className}`}>
      {message}
    </div>
  );
}
```

- [ ] **Step 2: Export from `ui/index.ts`**

Add to `apps/web/src/components/ui/index.ts`:
```ts
export { ErrorBanner } from './ErrorBanner.js';
```

- [ ] **Step 3: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds, no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/ErrorBanner.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(web): add shared ErrorBanner UI component"
```

---

## Task 2: Create `research/shared.tsx` — Status Config and Badge

**Files:**
- Create: `apps/web/src/components/research/shared.tsx`

**Reference:** Study `apps/web/src/components/code-tasks/v2/shared.tsx` for the pattern. Read the current `ResearchStatusBadge` at `apps/web/src/pages/ResearchDetailPage.tsx:63-127` and `STATUS_STYLES` at `apps/web/src/pages/ResearchListPage.tsx:22-31` to capture all current styling.

- [ ] **Step 1: Create `shared.tsx`**

```tsx
// apps/web/src/components/research/shared.tsx
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { PROVIDER_MODELS } from '@/components';
import type { ResearchStatus } from '@/services/researchAgentApi.types';

// --- Status badge config ---

interface StatusConfig {
  bg: string;
  text: string;
  label: string;
  icon: 'Clock' | 'CheckCircle' | 'XCircle' | 'AlertTriangle' | 'FileText' | 'RefreshCw';
}

export const RESEARCH_STATUS_MAP: Record<ResearchStatus, StatusConfig> = {
  draft:                  { bg: 'bg-amber-100 dark:bg-amber-900/50',   text: 'text-amber-700 dark:text-amber-300',   label: 'Draft',           icon: 'FileText' },
  pending:                { bg: 'bg-slate-100 dark:bg-slate-700',      text: 'text-slate-700 dark:text-slate-300',    label: 'Pending',         icon: 'Clock' },
  processing:             { bg: 'bg-blue-100 dark:bg-blue-900/50',     text: 'text-blue-700 dark:text-blue-300',      label: 'Processing',      icon: 'Clock' },
  awaiting_confirmation:  { bg: 'bg-orange-100 dark:bg-orange-900/50', text: 'text-orange-700 dark:text-orange-300',  label: 'Action Required', icon: 'AlertTriangle' },
  retrying:               { bg: 'bg-blue-100 dark:bg-blue-900/50',     text: 'text-blue-700 dark:text-blue-300',      label: 'Retrying',        icon: 'RefreshCw' },
  synthesizing:           { bg: 'bg-purple-100 dark:bg-purple-900/50', text: 'text-purple-700 dark:text-purple-300',  label: 'Synthesizing',    icon: 'Clock' },
  completed:              { bg: 'bg-green-100 dark:bg-green-900/50',   text: 'text-green-700 dark:text-green-300',    label: 'Completed',       icon: 'CheckCircle' },
  failed:                 { bg: 'bg-red-100 dark:bg-red-900/50',       text: 'text-red-700 dark:text-red-300',        label: 'Failed',          icon: 'XCircle' },
};

const ICON_MAP = { Clock, CheckCircle, XCircle, AlertTriangle, FileText, RefreshCw } as const;

export function ResearchStatusBadge({ status }: { status: ResearchStatus }): React.JSX.Element {
  const config = RESEARCH_STATUS_MAP[status];
  const Icon = ICON_MAP[config.icon];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${config.bg} ${config.text}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

// --- Filter config (for list page) ---

export type ResearchGroupStatus = 'processing' | 'action-required' | 'completed' | 'failed' | 'draft';

export const ALL_RESEARCH_GROUP_STATUSES: ResearchGroupStatus[] = [
  'processing', 'action-required', 'completed', 'failed', 'draft',
];

export const RESEARCH_GROUP_STATUS_CONFIG: Record<ResearchGroupStatus, { label: string; dotClass: string; activeClass: string }> = {
  processing: {
    label: 'Processing',
    dotClass: 'bg-blue-500',
    activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  'action-required': {
    label: 'Action Required',
    dotClass: 'bg-orange-500',
    activeClass: 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-900/30 dark:text-orange-400',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-green-500',
    activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
  failed: {
    label: 'Failed',
    dotClass: 'bg-red-500',
    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400',
  },
  draft: {
    label: 'Draft',
    dotClass: 'bg-amber-500',
    activeClass: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400',
  },
};

const INACTIVE_SEGMENT_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

export { INACTIVE_SEGMENT_CLASS };

// --- Sort config ---

export type ResearchSortOption = 'created' | 'completed' | 'favourite';

export const RESEARCH_SORT_OPTIONS: { key: ResearchSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'completed', label: 'Completed' },
  { key: 'favourite', label: 'Favourites' },
];

// --- Shared helpers used by multiple sub-components ---

/** Resolves a model ID to a human-readable display name using PROVIDER_MODELS. */
export function getModelDisplayName(modelId: string): string {
  for (const provider of PROVIDER_MODELS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model !== undefined) {
      return model.name;
    }
  }
  return modelId;
}

// --- Filter helpers ---

export function deriveGroupStatus(status: ResearchStatus): ResearchGroupStatus {
  if (status === 'draft') return 'draft';
  if (status === 'pending' || status === 'processing' || status === 'retrying' || status === 'synthesizing') return 'processing';
  if (status === 'awaiting_confirmation') return 'action-required';
  if (status === 'completed') return 'completed';
  return 'failed';
}

export function getAccentShadow(groupStatus: ResearchGroupStatus): string {
  if (groupStatus === 'processing') return 'shadow-[inset_3px_0_0_theme(colors.blue.500)]';
  if (groupStatus === 'action-required') return 'shadow-[inset_3px_0_0_theme(colors.orange.500)]';
  if (groupStatus === 'completed') return 'shadow-[inset_3px_0_0_theme(colors.green.500)]';
  if (groupStatus === 'failed') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  return '';
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/research/shared.tsx
git commit -m "feat(web): add research shared status config mirroring code-tasks pattern"
```

---

## Task 3: Extract `ProcessingStatus.tsx`

**Files:**
- Create: `apps/web/src/components/research/ProcessingStatus.tsx`

**Reference:** Read `apps/web/src/pages/ResearchDetailPage.tsx:1434-1550` for the current `ProcessingStatus`, `StatusDot`, and `ErrorDisplay` components. Also read lines 1006-1019 for the "Input Contexts during processing" section.

- [ ] **Step 1: Create `ProcessingStatus.tsx`**

Extract the following from `ResearchDetailPage.tsx` into a new file:
- `StatusDot` component (lines 1526-1536)
- `ErrorDisplay` component (lines 1538-1550)
- `ProcessingStatus` component (lines 1434-1524)
- `CollapsibleInputContext` component (lines 1776-1818) — shared between processing view and results view

Export `StatusDot` since it's also needed by `LlmResultCard` in `ResearchResults.tsx`.
Export `CollapsibleInputContext` since it's used in both processing and results views.

Keep all imports, props interfaces, and helper functions intact. Use the same code — this is a pure extraction, no logic changes.

- [ ] **Step 2: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds (file not yet imported anywhere)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/research/ProcessingStatus.tsx
git commit -m "feat(web): extract ProcessingStatus into research sub-component"
```

---

## Task 4: Extract `ResearchResults.tsx`

**Files:**
- Create: `apps/web/src/components/research/ResearchResults.tsx`

**Reference:** Read `apps/web/src/pages/ResearchDetailPage.tsx:948-991` (Research Summary card), lines 1031-1198 (main report section IIFE), lines 1145-1150 (synthesis error), lines 1152-1198 (individual LLM results IIFE), lines 1567-1675 (`LlmResultCard`), lines 1552-1565 (`formatTokenCount`, `formatCost`, `formatNumber`).

- [ ] **Step 1: Create `ResearchResults.tsx`**

Extract into a new file:
- `formatTokenCount`, `formatCost`, `formatNumber` helpers
- `LlmResultCard` component
- A new `ResearchResults` component that composes:
  - Research Summary card (token usage, duration, cost)
  - Synthesis report card OR single-model report card
  - Synthesis error banner
  - Individual LLM Results section with `LlmResultCard`s and `CollapsibleInputContext`s
- Import `StatusDot` from `./ProcessingStatus.js`
- Import `CollapsibleInputContext` from `./ProcessingStatus.js`
- Import `MarkdownContent` from `@/components` (NOT a local copy)
- Import `getModelDisplayName` from `./shared.js` (NOT from a local function)
- Accept `research` and `copiedSection`/`onCopy` as props

- [ ] **Step 2: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/research/ResearchResults.tsx
git commit -m "feat(web): extract ResearchResults into research sub-component"
```

---

## Task 5: Extract `ResearchHeader.tsx`

**Files:**
- Create: `apps/web/src/components/research/ResearchHeader.tsx`

**Reference:** Read `apps/web/src/pages/ResearchDetailPage.tsx:541-563` (header), lines 830-908 (collapsible links). Study `apps/web/src/components/code-tasks/v2/V2TaskHeader.tsx` for the two-row pattern with `min-h` guards.

- [ ] **Step 1: Create `ResearchHeader.tsx`**

Extract into a new file with a two-row layout:
- Row 1 (`min-h-[2.5rem]`): Title (`text-2xl font-bold`) + `ResearchStatusBadge` from `./shared.js` + favourite star button
- Row 2 (`min-h-[1.75rem]`): Timestamp (Started/Finished relative), model provider chips (as `rounded-full px-2 py-0.5 text-xs` pills), synthesis model chip
- Below rows: Collapsible links section (share URL, Notion URL with copy buttons) — preserve existing UX with `ChevronDown` toggle
- Own state: `linksExpanded` (initialized with `window.matchMedia('(min-width: 640px)').matches` matching current behavior at `ResearchDetailPage.tsx:218-220`)
- Props: `research`, `togglingFavourite`, `onToggleFavourite`, `copiedSection`, `onCopyToClipboard`
- Import `ResearchStatusBadge` from `./shared.js`
- Import `getProviderForModel` from `@/services/researchAgentApi.types`
- Import `formatRelative` from `@/utils/dateFormat`

- [ ] **Step 2: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/research/ResearchHeader.tsx
git commit -m "feat(web): extract ResearchHeader with two-row layout"
```

---

## Task 6: Extract `ResearchActions.tsx`

**Files:**
- Create: `apps/web/src/components/research/ResearchActions.tsx`

**Reference:** Read `apps/web/src/pages/ResearchDetailPage.tsx:572-790` (action buttons, confirmations), lines 1677-1768 (`PartialFailureConfirmation`). Study `apps/web/src/components/code-tasks/v2/V2TaskActions.tsx` for the action section pattern.

- [ ] **Step 1: Create `ResearchActions.tsx`**

Extract into a new file:
- `PartialFailureConfirmation` component (moved here from inline)
- Main `ResearchActions` component with props for all action states and handlers:
  - `research` (for status-driven rendering)
  - `approving`, `approveError`, `onApprove`
  - `retrying`, `retryError`, `onRetry`
  - `deleting`, `deleteError`, `showDeleteConfirm`, `onShowDeleteConfirm`, `onCancelDeleteConfirm`, `onConfirmDelete`
  - `unsharing`, `unshareError`, `showUnshareConfirm`, `onShowUnshareConfirm`, `onCancelUnshareConfirm`, `onConfirmUnshare`
  - `exporting`, `exportError`, `exportSuccess`, `onExportToNotion`
  - `onShowEnhanceModal`, `onShare`, `onEditDraft`
  - `confirming`, `confirmError`, `onConfirmPartialFailure`
- Use `ErrorBanner` from `@/components` for all error states, passing `className="mt-4"` to match current spacing
- `exportSuccess` banner remains custom (green, contains Notion link) — do NOT consolidate it
- Button layout uses `flex flex-wrap gap-3` matching current pattern

- [ ] **Step 2: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/research/ResearchActions.tsx
git commit -m "feat(web): extract ResearchActions with ErrorBanner consolidation"
```

---

## Task 7: Extract `EnhanceModal.tsx`

**Files:**
- Create: `apps/web/src/components/research/EnhanceModal.tsx`

**Reference:** Read `apps/web/src/pages/ResearchDetailPage.tsx:1200-1414`.

- [ ] **Step 1: Create `EnhanceModal.tsx`**

Extract the enhance modal into a self-contained component:
- Move `SYNTHESIS_CAPABLE_MODELS` constant (currently at `ResearchDetailPage.tsx:173`) into this file
- Move `getExistingProviders` logic (currently at `ResearchDetailPage.tsx:480-483`) — derive it internally from the `research` prop: `new Set(research.selectedModels.map(getProviderForModel))`
- Own `useState` for `enhanceModelSelections`, `enhanceContexts`, `removeContextIds`, `enhanceSynthesisModel`, `enhanceError`, `enhancing`
- Props: `research`, `configuredProviders`, `failedProviders`, `onEnhance` (callback), `onClose`
- The `onEnhance` callback signature:
  ```tsx
  onEnhance: (params: {
    additionalModels?: SupportedModel[];
    additionalContexts?: { content: string }[];
    removeContextIds?: string[];
    synthesisModel?: SupportedModel;
  }) => Promise<void>;
  ```
  The parent page handles the API call and navigation; the modal just collects selections and calls `onEnhance` with the params.
- Import `ModelSelector`, `getSelectedModelsList`, `PROVIDER_MODELS` from `@/components`
- Import `Button` from `@/components`
- Import `getModelDisplayName` from `./shared.js`
- Import `getProviderForModel` from `@/services/researchAgentApi.types`

- [ ] **Step 2: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/research/EnhanceModal.tsx
git commit -m "feat(web): extract EnhanceModal into research sub-component"
```

---

## Task 8: Rewrite `ResearchDetailPage.tsx` as Composition

**Files:**
- Modify: `apps/web/src/pages/ResearchDetailPage.tsx`

**Reference:** Study `apps/web/src/pages/CodeTaskViewPageV2.tsx` for the composition pattern — it imports sub-components, creates memo wrappers, and composes them in a clean render.

- [ ] **Step 1: Rewrite the page**

Replace the 1819-line file with a ~150-line composition:

**Hooks kept in parent:**
- `useParams`, `useNavigate` (route)
- `useResearch(id)` — provides `research`, `loading`, `error`, `refresh`
- `useLlmKeys()` — provides `keys`, `loading: keysLoading`
- `useAuth()` — provides `getAccessToken`

**State kept in parent** (shared across sub-components or used for navigation):
- `copiedSection` / `setCopiedSection` — shared by header and results copy buttons
- `showEnhanceModal` — toggled by actions, consumed by modal
- `showDeleteConfirm`, `showUnshareConfirm` — toggled by actions
- `shareToast` — floating notification rendered in parent
- Action loading/error states: `approving`, `approveError`, `deleting`, `deleteError`, `retrying`, `retryError`, `confirming`, `confirmError`, `unsharing`, `unshareError`, `exporting`, `exportError`, `exportSuccess`, `togglingFavourite`

**Computed values kept in parent:**
- `configuredProviders` and `failedProviders` — derived from `useLlmKeys`, passed as props to `EnhanceModal`

**Handler functions that STAY in parent** (they coordinate navigation or cross-component state):
- `handleApprove` — calls API, calls `refresh()`
- `handleDelete` — calls API, navigates to `/research`
- `handleRetry` — calls API, calls `refresh()`
- `handleConfirm` — calls `confirmPartialFailure` API, calls `refresh()`
- `handleUnshare` — calls API, calls `refresh()`
- `handleExportToNotion` — calls API, calls `refresh()`
- `handleToggleFavourite` — calls API, calls `refresh()`
- `handleEnhance` — receives params from `EnhanceModal`, calls API, navigates to new research
- `copyToClipboard` — updates `copiedSection` state

**Handler functions that MOVE to sub-components:**
- `handleShare`, `handleCopyShareUrl` → `ResearchHeader.tsx` (share/copy logic is self-contained)
- `handleEnhanceModelChange`, `toggleRemoveContext`, `resetEnhanceModal` → `EnhanceModal.tsx` (modal owns its own form state)

**Delete:** local `MarkdownContent`, `renderPromptWithLinks`, `ResearchStatusBadge`, `ProcessingStatus`, `StatusDot`, `ErrorDisplay`, `LlmResultCard`, `CollapsibleInputContext`, `PartialFailureConfirmation`, `formatTokenCount`, `formatCost`, `formatNumber`, `getModelDisplayName`, `SYNTHESIS_CAPABLE_MODELS`

**Import and compose:** `ResearchHeader`, `ResearchActions`, `ResearchResults`, `ProcessingStatus`, `EnhanceModal`

**Import `MarkdownContent`** from `@/components` for the "Research Topic" prompt card (stays in parent — it's small and central to the page layout)

**Render `shareToast`** floating notification in parent (lines 1416-1420)

- [ ] **Step 2: Verify the app builds and the page renders**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds, no TypeScript errors

- [ ] **Step 3: Manually verify the detail page renders correctly**

Open a research detail page in the browser at `dev.intexuraos.cloud/#/research/{id}`. Verify:
- Header shows title, status badge, favourite star, timestamp, model chips
- Action buttons appear correctly for the research status
- Results/synthesis render with markdown formatting
- Enhance modal opens and closes
- No console errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ResearchDetailPage.tsx
git commit -m "refactor(web): compose ResearchDetailPage from extracted sub-components"
```

---

## Task 9: Rewrite `ResearchListPage.tsx` — Compact Rows, Filters, Sort

**Files:**
- Modify: `apps/web/src/pages/ResearchListPage.tsx`

**Reference:** Study `apps/web/src/pages/CodeTasksPage.tsx` closely — replicate `PageHeader`, `StatusPipeline`, `SortSelector`, `ColumnHeader` patterns. Study `apps/web/src/components/code-tasks/IssueGroupRow.tsx` for the compact row and delete overlay pattern.

- [ ] **Step 1: Implement `PageHeader`**

Replace the current header. Match Code Tasks pattern:
```tsx
function PageHeader({ researches }: { researches: Research[] }): React.JSX.Element {
  const total = researches.length;
  const processing = researches.filter((r) => deriveGroupStatus(r.status) === 'processing').length;
  const parts: string[] = [`${String(total)} research${total !== 1 ? 'es' : ''}`];
  if (processing > 0) parts.push(`${String(processing)} processing`);
  // ...
}
```
- Title: `text-2xl font-bold`
- Subtitle: `text-sm text-slate-500 dark:text-slate-400` with dynamic counts
- Right side: "New Research" button (keep existing Link)

- [ ] **Step 2: Implement `StatusPipeline`**

Filter pills matching Code Tasks. Import `ALL_RESEARCH_GROUP_STATUSES`, `RESEARCH_GROUP_STATUS_CONFIG`, `INACTIVE_SEGMENT_CLASS`, `deriveGroupStatus` from `@/components/research/shared.js`.
- Compute counts from loaded researches using `deriveGroupStatus`
- Toggle filters, persist to localStorage key `research-status-filter`
- Default: all except `draft` selected

- [ ] **Step 3: Implement `SortSelector`**

Import `RESEARCH_SORT_OPTIONS` from `@/components/research/shared.js`.
- Persist to localStorage key `research-sort`
- Default: `created`
- Sort logic:
  - `created`: `startedAt` desc (drafts without `startedAt` sort at end)
  - `completed`: `completedAt` desc (researches without `completedAt` sort at end)
  - `favourite`: favourites first, then by `startedAt` desc

- [ ] **Step 4: Implement compact `ResearchRow`**

Replace `ResearchCard` with a compact row:
- Desktop: `grid-cols-[1fr_auto_140px_120px]` with `group relative` for hover effects
- Left accent shadow via `getAccentShadow(deriveGroupStatus(research.status))`
- Title column: research title (or truncated `stripMarkdown` prompt), single-line truncation
- Status+Models column: `ResearchStatusBadge` + provider chips
- Time column: `formatRelative(research.startedAt)` in `text-xs text-slate-400`
- Actions column: favourite star + hover-reveal trash icon
- Row click: `navigate(\`/research/${research.id}\`)`
- Mobile layout: stacked (title + time on top, status + models below)

- [ ] **Step 5: Implement delete overlay**

Replace inline delete confirm with overlay pattern from Code Tasks:
```tsx
{showDeleteConfirm ? (
  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
    onClick={(e): void => { e.stopPropagation(); }}>
    <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
      <p className="text-sm text-slate-700 dark:text-slate-200">Delete this research?</p>
      <button onClick={cancel} className="...">Cancel</button>
      <button onClick={confirm} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white ...">Delete</button>
    </div>
  </div>
) : null}
```

- [ ] **Step 6: Wire up filtering and sorting**

```tsx
const filteredResearches = useMemo(() => {
  let filtered = activeFilters.size === 0
    ? researches
    : researches.filter((r) => activeFilters.has(deriveGroupStatus(r.status)));
  return sortResearches(filtered, activeSort);
}, [researches, activeFilters, activeSort]);
```

Implement `sortResearches` function.

- [ ] **Step 7: Clean up old code and imports**

- Delete the `STATUS_STYLES` record (lines 22-31) and the old `ResearchCard` memo component
- Replace the inline error banner (lines 79-83) with `ErrorBanner` from `@/components`
- Replace `formatDateTime` import with `formatRelative` from `@/utils/dateFormat`
- All status rendering now uses `ResearchStatusBadge` from `@/components/research/shared.js`
- No `ColumnHeader` row is needed — research rows are simpler than code task rows (no pipeline column), so column labels would add noise without value. The row layout is self-explanatory.

- [ ] **Step 8: Verify build**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds

- [ ] **Step 9: Manually verify the list page**

Open `dev.intexuraos.cloud/#/research`. Verify:
- Filter pills show with correct counts
- Sort selector works (created, completed, favourites)
- Compact rows with left accent color
- Row click navigates to detail page
- Delete overlay appears on trash click, doesn't shift layout
- Favourite toggle works
- Load More works
- Mobile layout stacks correctly

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/ResearchListPage.tsx
git commit -m "feat(web): rewrite ResearchListPage with compact rows, filters, and sort"
```

---

## Task 10: Final CI Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass

- [ ] **Step 2: Verify `packages/*/dist/` exists**

Run: `ls packages/*/dist/ | head -20`
Expected: All package dist directories exist

- [ ] **Step 3: Commit any lint/format fixes if needed**

If CI revealed formatting issues, fix and commit:
```bash
git add -u
git commit -m "fix(web): lint and format fixes for research standardization"
```
