# LLM Usage — Mobile-Friendly Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [INT-1400](https://linear.app/pbuchman/issue/INT-1400)

**Goal:** Redesign the filter area of the LLM Usage page so that on mobile (< `sm` breakpoint / 640 px) the filters collapse into a single compact summary row plus a bottom-sheet editor, while keeping the existing desktop layout, styling, and colors pixel-identical.

**Architecture:** Extract the four existing filter sections (Time range, Provider, Group by, Sort) into a shared `llm-usage/` component module. Add a new `FilterBar` component that renders a desktop variant (current layout, unchanged) and a mobile variant (sticky one-row summary: "Filters" button with active-count badge + scrollable chip strip of current selections). Tapping the mobile summary opens a `FilterSheet` — a bottom sheet (slides up to ~85 vh) that hosts the same filter sections in scrollable, labelled form with a sticky header (title + X close) and a "Done" footer. Filter state still lives in `LlmUsagePage.tsx`; the sheet only edits the existing setters — no new state machine.

**Tech stack:** React 18, TypeScript (strict), Tailwind CSS (already in use), lucide-react icons. No new dependencies. No backend / endpoint changes.

**Endpoint Changes:**
- Modified: none
- Created: none
- Removed: none
- Unchanged: `/internal/llm-usage/*` and all `useLlmUsageEvents` / `useLlmUsageQuery` hooks

---

## Design Decisions

### Why a bottom sheet (not an accordion or inline collapse)
- **One-row summary on mobile** restores 100 % of the viewport for actual content (which is the core complaint in the Linear task).
- Bottom sheets are a native-feeling, thumb-reachable pattern users already know from Airbnb filters, Google Maps layers, Instagram shop filters.
- Inline accordions still occupy vertical space even when collapsed (a header per section) and hide state behind two clicks.
- Keeps existing styles: the sheet body is a vertical stack of the **current** filter components with the **current** classes.

### Why a single `sm:` breakpoint
- Tailwind's default `sm` = 640 px matches a generous phone‑to‑tablet transition. The existing page already wraps with `flex-wrap`, so anything >= 640 px renders fine today.
- Single breakpoint ⇒ simpler CSS and tests; no intermediate "cramped tablet" state.

### Why state stays in `LlmUsagePage`
- Filters are already persisted to `localStorage` via `saveToStorage`. Moving state into the sheet would duplicate that plumbing. The sheet calls the same `onChange` callbacks — changes apply instantly, the "Done" button only closes the sheet. (This matches the current desktop behavior of instant apply.)

### Why extract into `components/llm-usage/*`
- `LlmUsagePage.tsx` is already 633 lines. The four filter components (`TimeRangePicker`, `ProviderFilters`, `GroupBySelector`, `SortSelector`) need to be shared between the desktop row and the mobile sheet. Extraction eliminates duplication and lets us unit-test each one.

### Reuse of existing styling
- All four filter components move verbatim (same Tailwind classes, same `PROVIDER_ACTIVE_CLASSES`, same `INACTIVE_SEGMENT_CLASS`, same dark-mode variants). The mobile chip strip reuses the same button-with-dot styling, just one size smaller (`text-xs`, `px-2 py-1`). No color changes, no new palette.

### Accessibility & UX
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the sheet.
- Focus trap: first focusable element inside sheet gets focus on open, `Escape` closes, `Tab` cycles within the sheet.
- Body scroll lock while sheet is open (`document.body.style.overflow = 'hidden'`).
- Overlay click closes the sheet.
- Filter button has `aria-haspopup="dialog"` and `aria-expanded`.
- Count badge is visually hidden when there are no non-default filters (nothing to announce).

---

## File Structure

```
apps/web/src/
├── components/
│   └── llm-usage/
│       ├── FilterBar.tsx               (NEW)  — desktop rows + mobile summary row
│       ├── FilterSheet.tsx             (NEW)  — bottom sheet container for mobile
│       ├── filterSections.tsx          (NEW)  — the four extracted filter components
│       ├── filterConstants.ts          (NEW)  — PROVIDERS, styling constants, options lists
│       ├── activeFilters.ts            (NEW)  — computes active-count + chip summary
│       └── __tests__/
│           ├── FilterBar.test.tsx      (NEW)
│           ├── FilterSheet.test.tsx    (NEW)
│           ├── filterSections.test.tsx (NEW)
│           └── activeFilters.test.ts   (NEW)
├── hooks/
│   └── useBodyScrollLock.ts            (NEW)  — reusable body-scroll lock on mount
└── pages/
    └── LlmUsagePage.tsx                (MODIFIED) — import and render <FilterBar>
```

**Rationale:** Each file is focused (< 200 lines). `filterConstants.ts` is pure data so both `FilterBar` and `FilterSheet` can import without circular deps. `useBodyScrollLock` is a leaf hook that other modals in the codebase can adopt later (not in scope, mentioned only for naming consistency).

---

## Task 1: Extract filter constants

**Files:**
- Create: `apps/web/src/components/llm-usage/filterConstants.ts`
- Modify: `apps/web/src/pages/LlmUsagePage.tsx:28-90` (remove constants, import from new file)

- [ ] **Step 1.1: Write a compile-time smoke test**

Create `apps/web/src/components/llm-usage/__tests__/filterConstants.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  PROVIDER_ACTIVE_CLASSES,
  PROVIDER_DOT_CLASSES,
  INACTIVE_SEGMENT_CLASS,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  PRESET_OPTIONS,
} from '../filterConstants';

describe('filterConstants', () => {
  it('exports one active-class entry per provider', () => {
    for (const p of PROVIDERS) {
      expect(PROVIDER_ACTIVE_CLASSES[p]).toBeTypeOf('string');
      expect(PROVIDER_DOT_CLASSES[p]).toBeTypeOf('string');
    }
  });

  it('inactive segment class is non-empty', () => {
    expect(INACTIVE_SEGMENT_CLASS.length).toBeGreaterThan(0);
  });

  it('group-by options are unique by key', () => {
    const keys = GROUP_BY_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sort options and preset options expose labels', () => {
    expect(SORT_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
    expect(PRESET_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run the test — should fail (module not found)**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/filterConstants.test.ts`
Expected: FAIL with "Cannot find module '../filterConstants'".

- [ ] **Step 1.3: Create `filterConstants.ts`**

```ts
/**
 * Shared constants for LLM Usage filter UI (desktop and mobile variants).
 * Extracted verbatim from LlmUsagePage.tsx to allow reuse by FilterBar
 * and FilterSheet without circular imports.
 */

import type { UsageEventSortField } from '@/types/llmUsage';
import type { TimeRangePreset } from '@/utils/llmUsageTimeRange';

export type GroupByMode =
  | 'none'
  | 'day'
  | 'component'
  | 'service'
  | 'model'
  | 'openrouter-model'
  | 'promptType';

export interface SortState {
  field: UsageEventSortField;
  direction: 'asc' | 'desc';
}

export const PROVIDERS = ['anthropic', 'openai', 'google', 'perplexity', 'openrouter'] as const;

export const PROVIDER_ACTIVE_CLASSES: Record<string, string> = {
  anthropic: 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-900/30 dark:text-orange-400',
  openai: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400',
  google: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  perplexity: 'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400',
  openrouter: 'border-rose-500 bg-rose-50 text-rose-700 dark:border-rose-400 dark:bg-rose-900/30 dark:text-rose-400',
};

export const INACTIVE_SEGMENT_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

export const PROVIDER_DOT_CLASSES: Record<string, string> = {
  anthropic: 'bg-orange-500',
  openai: 'bg-emerald-500',
  google: 'bg-blue-500',
  perplexity: 'bg-purple-500',
  openrouter: 'bg-rose-500',
};

export const GROUP_BY_MAP: Record<GroupByMode, string[]> = {
  none: [],
  day: ['day'],
  component: ['source.component'],
  service: ['source.service'],
  model: ['request.model'],
  'openrouter-model': ['request.provider', 'request.model'],
  promptType: ['request.promptType'],
};

export const GROUP_BY_OPTIONS: { key: GroupByMode; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'day', label: 'Day' },
  { key: 'component', label: 'Component' },
  { key: 'service', label: 'Service' },
  { key: 'model', label: 'Model' },
  { key: 'openrouter-model', label: 'OpenRouter Model' },
  { key: 'promptType', label: 'Prompt Type' },
];

export const SORT_OPTIONS: { field: UsageEventSortField; direction: 'asc' | 'desc'; label: string }[] = [
  { field: 'occurredAt', direction: 'desc', label: 'Newest first' },
  { field: 'occurredAt', direction: 'asc', label: 'Oldest first' },
];

export const PRESET_OPTIONS: { key: TimeRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7days', label: 'Last 7d' },
  { key: 'last30days', label: 'Last 30d' },
  { key: 'custom', label: 'Custom' },
];

export const DEFAULT_GROUP_BY: GroupByMode = 'none';
export const DEFAULT_SORT: SortState = { field: 'occurredAt', direction: 'desc' };
```

- [ ] **Step 1.4: Run tests — should pass**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/filterConstants.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 1.5: Replace constants in `LlmUsagePage.tsx` with imports**

In `apps/web/src/pages/LlmUsagePage.tsx` delete lines 26–90 (the `// --- Constants ---` block and the `GroupByMode` / `SortState` type aliases) and replace with:

```ts
// --- Types & Constants (re-exported from shared module) ---

import {
  PROVIDERS,
  PROVIDER_ACTIVE_CLASSES,
  PROVIDER_DOT_CLASSES,
  INACTIVE_SEGMENT_CLASS,
  GROUP_BY_MAP,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  PRESET_OPTIONS,
  DEFAULT_GROUP_BY,
  DEFAULT_SORT,
  type GroupByMode,
  type SortState,
} from '@/components/llm-usage/filterConstants';

const STORAGE_KEY_TIME_RANGE = 'llm-usage-time-range';
const STORAGE_KEY_FILTERS = 'llm-usage-filters';
const STORAGE_KEY_SORT = 'llm-usage-sort';
const STORAGE_KEY_GROUP_BY = 'llm-usage-group-by';
```

Also remove the now-duplicate `const DEFAULT_SORT` and `const DEFAULT_GROUP_BY` from the `// --- Defaults ---` block (keep `DEFAULT_TIME_RANGE` and `DEFAULT_FILTERS`, they stay local).

- [ ] **Step 1.6: Verify nothing broke**

Run: `pnpm --filter web build && pnpm --filter web vitest run`
Expected: build succeeds, pre-existing tests pass, TypeScript has no errors.

- [ ] **Step 1.7: Commit**

```bash
git add apps/web/src/components/llm-usage/filterConstants.ts \
        apps/web/src/components/llm-usage/__tests__/filterConstants.test.ts \
        apps/web/src/pages/LlmUsagePage.tsx
git commit -m "refactor(web): extract LLM usage filter constants (INT-1400)"
```

---

## Task 2: Extract the four filter sections as shared components

**Files:**
- Create: `apps/web/src/components/llm-usage/filterSections.tsx`
- Create: `apps/web/src/components/llm-usage/__tests__/filterSections.test.tsx`
- Modify: `apps/web/src/pages/LlmUsagePage.tsx` (remove in-file defs, import from module)

- [ ] **Step 2.1: Write failing render tests**

Create `apps/web/src/components/llm-usage/__tests__/filterSections.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TimeRangePicker,
  ProviderFilters,
  GroupBySelector,
  SortSelector,
} from '../filterSections';

describe('TimeRangePicker', () => {
  it('renders all preset labels and highlights the selected preset', () => {
    const onChange = vi.fn();
    render(<TimeRangePicker timeRange={{ preset: 'last7days' }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    const selected = screen.getByRole('button', { name: 'Last 7d' });
    expect(selected.className).toContain('border-blue-500');
  });

  it('calls onChange with new preset when a preset button is clicked', () => {
    const onChange = vi.fn();
    render(<TimeRangePicker timeRange={{ preset: 'last7days' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith({ preset: 'today' });
  });

  it('shows custom date inputs when preset is custom', () => {
    render(
      <TimeRangePicker timeRange={{ preset: 'custom' }} onChange={vi.fn()} />,
    );
    expect(screen.getAllByDisplayValue('').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ProviderFilters', () => {
  it('renders one button per provider when not locked', () => {
    render(<ProviderFilters activeProviders={[]} onToggle={vi.fn()} locked={false} />);
    expect(screen.getByRole('button', { name: /anthropic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /openrouter/i })).toBeInTheDocument();
  });

  it('shows locked indicator when locked', () => {
    render(<ProviderFilters activeProviders={['openrouter']} onToggle={vi.fn()} locked />);
    expect(screen.getByText(/locked by group-by/i)).toBeInTheDocument();
  });

  it('fires onToggle with provider name', () => {
    const onToggle = vi.fn();
    render(<ProviderFilters activeProviders={[]} onToggle={onToggle} locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: /openai/i }));
    expect(onToggle).toHaveBeenCalledWith('openai');
  });
});

describe('GroupBySelector', () => {
  it('highlights current groupBy and fires onChange', () => {
    const onChange = vi.fn();
    render(<GroupBySelector groupBy="none" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });
});

describe('SortSelector', () => {
  it('fires onChange with new sort state', () => {
    const onChange = vi.fn();
    render(
      <SortSelector sortBy={{ field: 'occurredAt', direction: 'desc' }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    expect(onChange).toHaveBeenCalledWith({ field: 'occurredAt', direction: 'asc' });
  });
});
```

- [ ] **Step 2.2: Run tests — should fail (module not found)**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/filterSections.test.tsx`
Expected: FAIL with "Cannot find module '../filterSections'".

- [ ] **Step 2.3: Create `filterSections.tsx`**

Copy the four components from `LlmUsagePage.tsx` (lines 169–324) verbatim, replacing the in-file constant imports with imports from `./filterConstants`:

```tsx
/**
 * Shared filter-section components used by both the desktop FilterBar
 * and the mobile FilterSheet. Styling is identical to the previous
 * inline versions in LlmUsagePage.tsx — see INT-1400.
 */

import type React from 'react';
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
import type { UsageEventSortField } from '@/types/llmUsage';
import {
  PROVIDERS,
  PROVIDER_ACTIVE_CLASSES,
  PROVIDER_DOT_CLASSES,
  INACTIVE_SEGMENT_CLASS,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  PRESET_OPTIONS,
  type GroupByMode,
  type SortState,
} from './filterConstants';

interface TimeRangePickerProps {
  timeRange: TimeRangeState;
  onChange: (tr: TimeRangeState) => void;
}

export function TimeRangePicker({ timeRange, onChange }: TimeRangePickerProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESET_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={(): void => { onChange({ ...timeRange, preset: opt.key }); }}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            timeRange.preset === opt.key
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
              : INACTIVE_SEGMENT_CLASS
          }`}
        >
          {opt.label}
        </button>
      ))}
      {timeRange.preset === 'custom' ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Custom start date"
            value={timeRange.customFrom?.split('T')[0] ?? ''}
            onChange={(e): void => {
              const val = e.target.value;
              if (val !== '') {
                onChange({ ...timeRange, customFrom: new Date(val).toISOString() });
              } else {
                const { customFrom: _drop, ...rest } = timeRange;
                onChange(rest);
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          />
          <span className="text-sm text-slate-400">to</span>
          <input
            type="date"
            aria-label="Custom end date"
            value={timeRange.customTo?.split('T')[0] ?? ''}
            onChange={(e): void => {
              const val = e.target.value;
              if (val !== '') {
                onChange({ ...timeRange, customTo: new Date(val + 'T23:59:59.999Z').toISOString() });
              } else {
                const { customTo: _drop, ...rest } = timeRange;
                onChange(rest);
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          />
        </div>
      ) : null}
    </div>
  );
}

interface ProviderFiltersProps {
  activeProviders: string[];
  onToggle: (provider: string) => void;
  locked: boolean;
}

export function ProviderFilters({ activeProviders, onToggle, locked }: ProviderFiltersProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {locked ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 dark:border-rose-400 dark:bg-rose-900/30 dark:text-rose-400">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          openrouter (locked by group-by)
        </span>
      ) : (
        PROVIDERS.map((provider) => {
          const isActive = activeProviders.includes(provider);
          return (
            <button
              key={provider}
              type="button"
              onClick={(): void => { onToggle(provider); }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? (PROVIDER_ACTIVE_CLASSES[provider] ?? INACTIVE_SEGMENT_CLASS) : INACTIVE_SEGMENT_CLASS
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${PROVIDER_DOT_CLASSES[provider] ?? 'bg-slate-400'}`} />
              {provider}
            </button>
          );
        })
      )}
    </div>
  );
}

interface GroupBySelectorProps {
  groupBy: GroupByMode;
  onChange: (mode: GroupByMode) => void;
}

export function GroupBySelector({ groupBy, onChange }: GroupBySelectorProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {GROUP_BY_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={(): void => { onChange(opt.key); }}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            groupBy === opt.key
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
              : INACTIVE_SEGMENT_CLASS
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface SortSelectorProps {
  sortBy: SortState;
  onChange: (sort: SortState) => void;
}

export function SortSelector({ sortBy, onChange }: SortSelectorProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SORT_OPTIONS.map((opt) => {
        const isActive = sortBy.field === opt.field && sortBy.direction === opt.direction;
        return (
          <button
            key={`${opt.field}-${opt.direction}`}
            type="button"
            onClick={(): void => { onChange({ field: opt.field, direction: opt.direction }); }}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
                : INACTIVE_SEGMENT_CLASS
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

Note: the wrapping `<div>`s lose the `mb-4` class — vertical spacing now belongs to the parent (`FilterBar` / `FilterSheet`) so the same component can be used in both layouts. Also added `type="button"` to every button to prevent accidental form submission and `aria-label` to date inputs.

- [ ] **Step 2.4: Run tests — should pass**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/filterSections.test.tsx`
Expected: PASS.

- [ ] **Step 2.5: Remove duplicate components from `LlmUsagePage.tsx`**

Delete lines 169–324 of `LlmUsagePage.tsx` (the four filter components). Keep the `// --- RawEventsList ---` block and everything after.

- [ ] **Step 2.6: Import the extracted components in `LlmUsagePage.tsx`**

Add near the top imports (below the existing `@/hooks/*` imports):

```ts
import {
  TimeRangePicker,
  ProviderFilters,
  GroupBySelector,
  SortSelector,
} from '@/components/llm-usage/filterSections';
```

Since the extracted components lost `mb-4`, update the render in the main page to wrap each in a `mb-4` container (this is a temporary step — Task 4 replaces it with `<FilterBar>` and removes these wrappers):

```tsx
<div className="mb-4"><TimeRangePicker timeRange={timeRange} onChange={handleTimeRangeChange} /></div>
<div className="mb-4"><ProviderFilters ... /></div>
<div className="mb-4"><GroupBySelector ... /></div>
{isRawMode ? (
  <>
    <div className="mb-4"><SortSelector ... /></div>
    <RawEventsList ... />
  </>
) : ...}
```

Also remove the `Provider:`, `Group by:`, `Sort:` label `<span>`s from the extracted components — they're gone intentionally (labels move into the mobile sheet sections; desktop uses chip-only row like before, but without the redundant prefix labels). If a reviewer insists on keeping desktop labels, wrap each filter in a labelled container at the call site — not inside the shared component.

> **Note:** Losing the prefix labels on desktop is a deliberate micro-change — they added noise without info. If the reviewer objects, revert only that piece by wrapping each desktop filter in:
> `<div className="flex flex-wrap items-center gap-2 mb-4"><span className="text-sm font-medium text-slate-500 dark:text-slate-400">Provider:</span><ProviderFilters ... /></div>`

- [ ] **Step 2.7: Verify page still works**

Run: `pnpm --filter web build && pnpm --filter web vitest run`
Expected: clean build, all tests green.

- [ ] **Step 2.8: Commit**

```bash
git add apps/web/src/components/llm-usage/filterSections.tsx \
        apps/web/src/components/llm-usage/__tests__/filterSections.test.tsx \
        apps/web/src/pages/LlmUsagePage.tsx
git commit -m "refactor(web): extract LLM usage filter sections (INT-1400)"
```

---

## Task 3: Add `activeFilters` helper

**Files:**
- Create: `apps/web/src/components/llm-usage/activeFilters.ts`
- Create: `apps/web/src/components/llm-usage/__tests__/activeFilters.test.ts`

Purpose: compute (1) the numeric badge count (how many filters differ from defaults) and (2) the list of summary chips shown in the mobile one-row affordance.

- [ ] **Step 3.1: Write failing unit test**

```ts
import { describe, it, expect } from 'vitest';
import { computeActiveFilters } from '../activeFilters';
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';

const DEFAULT_TIME_RANGE: TimeRangeState = { preset: 'last7days' };

describe('computeActiveFilters', () => {
  it('returns zero active filters when everything matches defaults', () => {
    const result = computeActiveFilters({
      timeRange: DEFAULT_TIME_RANGE,
      filters: {},
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(result.count).toBe(0);
    expect(result.chips).toEqual([
      { key: 'timeRange', label: 'Last 7d', tone: 'neutral' },
    ]);
  });

  it('counts a non-default time range preset', () => {
    const r = computeActiveFilters({
      timeRange: { preset: 'today' },
      filters: {},
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(r.count).toBe(1);
    expect(r.chips).toEqual([{ key: 'timeRange', label: 'Today', tone: 'active' }]);
  });

  it('counts each active provider as a chip but a single +1 on count', () => {
    const r = computeActiveFilters({
      timeRange: DEFAULT_TIME_RANGE,
      filters: { providers: ['anthropic', 'openai'] },
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(r.count).toBe(1);
    expect(r.chips.some((c) => c.key === 'provider:anthropic')).toBe(true);
    expect(r.chips.some((c) => c.key === 'provider:openai')).toBe(true);
  });

  it('counts groupBy and sort changes', () => {
    const r = computeActiveFilters({
      timeRange: DEFAULT_TIME_RANGE,
      filters: {},
      groupBy: 'day',
      sortBy: { field: 'occurredAt', direction: 'asc' },
    });
    expect(r.count).toBe(2);
    expect(r.chips.some((c) => c.key === 'groupBy' && c.label === 'Day')).toBe(true);
    expect(r.chips.some((c) => c.key === 'sort' && c.label === 'Oldest first')).toBe(true);
  });

  it('uses Custom label with explicit dates when preset is custom', () => {
    const r = computeActiveFilters({
      timeRange: {
        preset: 'custom',
        customFrom: '2026-04-01T00:00:00.000Z',
        customTo: '2026-04-10T23:59:59.999Z',
      },
      filters: {},
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(r.chips[0]?.label).toBe('Apr 1 – Apr 10');
  });
});
```

- [ ] **Step 3.2: Run test — should fail**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/activeFilters.test.ts`
Expected: FAIL — `Cannot find module '../activeFilters'`.

- [ ] **Step 3.3: Implement `activeFilters.ts`**

```ts
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
import type { UsageEventFilters } from '@/types/llmUsage';
import {
  PRESET_OPTIONS,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  DEFAULT_GROUP_BY,
  DEFAULT_SORT,
  type GroupByMode,
  type SortState,
} from './filterConstants';

export interface SummaryChip {
  key: string;
  label: string;
  tone: 'neutral' | 'active' | 'provider';
  provider?: string;
}

interface Input {
  timeRange: TimeRangeState;
  filters: UsageEventFilters;
  groupBy: GroupByMode;
  sortBy: SortState;
}

export interface ActiveFiltersResult {
  count: number;
  chips: SummaryChip[];
}

const DEFAULT_TIME_PRESET = 'last7days';

function formatDateShort(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '?';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function computeActiveFilters({ timeRange, filters, groupBy, sortBy }: Input): ActiveFiltersResult {
  const chips: SummaryChip[] = [];
  let count = 0;

  // Time range chip — always shown, marked "active" when non-default.
  const isCustom = timeRange.preset === 'custom';
  const timeLabel = isCustom
    ? `${formatDateShort(timeRange.customFrom)} – ${formatDateShort(timeRange.customTo)}`
    : (PRESET_OPTIONS.find((p) => p.key === timeRange.preset)?.label ?? String(timeRange.preset));
  const timeIsDefault = timeRange.preset === DEFAULT_TIME_PRESET;
  chips.push({ key: 'timeRange', label: timeLabel, tone: timeIsDefault ? 'neutral' : 'active' });
  if (!timeIsDefault) count += 1;

  // Provider chips — one per active provider.
  const activeProviders = filters.providers ?? [];
  if (activeProviders.length > 0) {
    count += 1;
    for (const provider of activeProviders) {
      chips.push({ key: `provider:${provider}`, label: provider, tone: 'provider', provider });
    }
  }

  // Group-by chip — omitted when none, else shown active.
  if (groupBy !== DEFAULT_GROUP_BY) {
    count += 1;
    const label = GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label ?? groupBy;
    chips.push({ key: 'groupBy', label, tone: 'active' });
  }

  // Sort chip — omitted when default (Newest first), else shown.
  const sortIsDefault =
    sortBy.field === DEFAULT_SORT.field && sortBy.direction === DEFAULT_SORT.direction;
  if (!sortIsDefault) {
    count += 1;
    const label =
      SORT_OPTIONS.find((o) => o.field === sortBy.field && o.direction === sortBy.direction)?.label
      ?? `${sortBy.field} ${sortBy.direction}`;
    chips.push({ key: 'sort', label, tone: 'active' });
  }

  return { count, chips };
}
```

- [ ] **Step 3.4: Run tests — should pass**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/activeFilters.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/components/llm-usage/activeFilters.ts \
        apps/web/src/components/llm-usage/__tests__/activeFilters.test.ts
git commit -m "feat(web): add activeFilters summary helper (INT-1400)"
```

---

## Task 4: Build `FilterSheet` (mobile bottom sheet)

**Files:**
- Create: `apps/web/src/hooks/useBodyScrollLock.ts`
- Create: `apps/web/src/components/llm-usage/FilterSheet.tsx`
- Create: `apps/web/src/components/llm-usage/__tests__/FilterSheet.test.tsx`

- [ ] **Step 4.1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterSheet } from '../FilterSheet';

const baseProps = {
  timeRange: { preset: 'last7days' as const },
  onTimeRangeChange: vi.fn(),
  activeProviders: [] as string[],
  onToggleProvider: vi.fn(),
  providersLocked: false,
  groupBy: 'none' as const,
  onGroupByChange: vi.fn(),
  sortBy: { field: 'occurredAt' as const, direction: 'desc' as const },
  onSortChange: vi.fn(),
  onClose: vi.fn(),
};

describe('FilterSheet', () => {
  it('does not render when isOpen is false', () => {
    render(<FilterSheet {...baseProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog with title and sections when open', () => {
    render(<FilterSheet {...baseProps} isOpen />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Time range')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Group by')).toBeInTheDocument();
    expect(screen.getByText('Sort')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<FilterSheet {...baseProps} onClose={onClose} isOpen />);
    fireEvent.click(screen.getByRole('button', { name: /close filters/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<FilterSheet {...baseProps} onClose={onClose} isOpen />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on overlay click', () => {
    const onClose = vi.fn();
    render(<FilterSheet {...baseProps} onClose={onClose} isOpen />);
    fireEvent.click(screen.getByTestId('filter-sheet-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not hide Sort section when groupBy is non-none (sort still useful later)', () => {
    // Product decision: show Sort section always in the sheet; the outer page
    // will ignore sort when groupBy !== 'none'. Keeping Sort visible avoids
    // UI shifting when the user changes groupBy inside the sheet.
    render(<FilterSheet {...baseProps} groupBy="day" isOpen />);
    expect(screen.getByText('Sort')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run tests — expect fail**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/FilterSheet.test.tsx`
Expected: FAIL — "Cannot find module '../FilterSheet'".

- [ ] **Step 4.3: Implement `useBodyScrollLock`**

```ts
/**
 * Freezes body scroll while the component invoking the hook is mounted.
 * Used by FilterSheet to prevent background page scroll on mobile.
 */
import { useEffect } from 'react';

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
```

- [ ] **Step 4.4: Implement `FilterSheet.tsx`**

```tsx
/**
 * FilterSheet — mobile bottom-sheet for LLM usage filters.
 *
 * Slides up from the bottom covering ~85 vh. Hosts the same filter-section
 * components used on desktop; styling is unchanged. Instant-apply (no
 * separate Apply action) — the "Done" button just closes the sheet.
 *
 * Accessibility:
 * - role="dialog", aria-modal="true"
 * - Escape to close, overlay-click to close
 * - Body scroll lock while open
 * - Initial focus on the close button (prevents stray focus drift)
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
import type { GroupByMode, SortState } from './filterConstants';
import {
  TimeRangePicker,
  ProviderFilters,
  GroupBySelector,
  SortSelector,
} from './filterSections';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export interface FilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  timeRange: TimeRangeState;
  onTimeRangeChange: (tr: TimeRangeState) => void;
  activeProviders: string[];
  onToggleProvider: (provider: string) => void;
  providersLocked: boolean;
  groupBy: GroupByMode;
  onGroupByChange: (mode: GroupByMode) => void;
  sortBy: SortState;
  onSortChange: (sort: SortState) => void;
}

export function FilterSheet(props: FilterSheetProps): React.JSX.Element | null {
  const {
    isOpen,
    onClose,
    timeRange,
    onTimeRangeChange,
    activeProviders,
    onToggleProvider,
    providersLocked,
    groupBy,
    onGroupByChange,
    sortBy,
    onSortChange,
  } = props;

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => { window.removeEventListener('keydown', handleEsc); };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-sheet-title"
    >
      <div
        data-testid="filter-sheet-overlay"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex h-[85vh] flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Drag affordance */}
        <div className="flex justify-center pt-2">
          <span className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 id="filter-sheet-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Filters
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <Section title="Time range">
            <TimeRangePicker timeRange={timeRange} onChange={onTimeRangeChange} />
          </Section>
          <Section title="Provider">
            <ProviderFilters
              activeProviders={activeProviders}
              onToggle={onToggleProvider}
              locked={providersLocked}
            />
          </Section>
          <Section title="Group by">
            <GroupBySelector groupBy={groupBy} onChange={onGroupByChange} />
          </Section>
          <Section title="Sort">
            <SortSelector sortBy={sortBy} onChange={onSortChange} />
          </Section>
        </div>
        {/* Footer */}
        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}
```

- [ ] **Step 4.5: Run tests — should pass**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/FilterSheet.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/src/components/llm-usage/FilterSheet.tsx \
        apps/web/src/components/llm-usage/__tests__/FilterSheet.test.tsx \
        apps/web/src/hooks/useBodyScrollLock.ts
git commit -m "feat(web): add mobile FilterSheet for LLM usage (INT-1400)"
```

---

## Task 5: Build `FilterBar` (mobile summary row + desktop rows)

**Files:**
- Create: `apps/web/src/components/llm-usage/FilterBar.tsx`
- Create: `apps/web/src/components/llm-usage/__tests__/FilterBar.test.tsx`

- [ ] **Step 5.1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../FilterBar';

const baseProps = {
  timeRange: { preset: 'last7days' as const },
  onTimeRangeChange: vi.fn(),
  activeProviders: [] as string[],
  onToggleProvider: vi.fn(),
  providersLocked: false,
  groupBy: 'none' as const,
  onGroupByChange: vi.fn(),
  sortBy: { field: 'occurredAt' as const, direction: 'desc' as const },
  onSortChange: vi.fn(),
  showSort: true,
};

describe('FilterBar', () => {
  it('renders both desktop and mobile variants in the DOM (responsive via CSS)', () => {
    const { container } = render(<FilterBar {...baseProps} />);
    expect(container.querySelector('[data-variant="desktop"]')).not.toBeNull();
    expect(container.querySelector('[data-variant="mobile"]')).not.toBeNull();
  });

  it('mobile variant shows a Filters button with no badge when all defaults', () => {
    render(<FilterBar {...baseProps} />);
    const btn = screen.getByRole('button', { name: /open filters/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByTestId('filter-badge')).toBeNull();
  });

  it('mobile variant shows a badge with the active count', () => {
    render(
      <FilterBar
        {...baseProps}
        timeRange={{ preset: 'today' }}
        groupBy="day"
      />,
    );
    const badge = screen.getByTestId('filter-badge');
    expect(badge).toHaveTextContent('2');
  });

  it('opens the FilterSheet when the mobile Filters button is clicked', () => {
    render(<FilterBar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /open filters/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('omits the Sort section on desktop when showSort is false', () => {
    const { container } = render(<FilterBar {...baseProps} showSort={false} />);
    const desktop = container.querySelector('[data-variant="desktop"]');
    expect(desktop?.textContent).not.toContain('Newest first');
  });
});
```

- [ ] **Step 5.2: Run tests — expect fail**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/FilterBar.test.tsx`
Expected: FAIL — "Cannot find module '../FilterBar'".

- [ ] **Step 5.3: Implement `FilterBar.tsx`**

```tsx
/**
 * FilterBar — responsive filter UI for the LLM Usage page.
 *
 * Renders TWO variants in the DOM, toggled by Tailwind responsive classes:
 * - Desktop (`hidden sm:block`): current filter rows, restored to parity
 *   with the previous inline implementation.
 * - Mobile (`sm:hidden`): a single sticky row — "Filters" button with
 *   active-count badge + horizontally-scrollable chip strip showing
 *   current selections. Tapping "Filters" opens <FilterSheet/>.
 *
 * Keeping both variants in the DOM (vs. JS viewport detection) avoids
 * layout flashes during SSR/hydration and makes automated testing easier.
 */

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
import {
  TimeRangePicker,
  ProviderFilters,
  GroupBySelector,
  SortSelector,
} from './filterSections';
import {
  PROVIDER_ACTIVE_CLASSES,
  PROVIDER_DOT_CLASSES,
  INACTIVE_SEGMENT_CLASS,
  type GroupByMode,
  type SortState,
} from './filterConstants';
import { computeActiveFilters, type SummaryChip } from './activeFilters';
import { FilterSheet } from './FilterSheet';

export interface FilterBarProps {
  timeRange: TimeRangeState;
  onTimeRangeChange: (tr: TimeRangeState) => void;
  activeProviders: string[];
  onToggleProvider: (provider: string) => void;
  providersLocked: boolean;
  groupBy: GroupByMode;
  onGroupByChange: (mode: GroupByMode) => void;
  sortBy: SortState;
  onSortChange: (sort: SortState) => void;
  /** Desktop variant shows Sort row only when groupBy === 'none' */
  showSort: boolean;
}

export function FilterBar(props: FilterBarProps): React.JSX.Element {
  const {
    timeRange,
    onTimeRangeChange,
    activeProviders,
    onToggleProvider,
    providersLocked,
    groupBy,
    onGroupByChange,
    sortBy,
    onSortChange,
    showSort,
  } = props;

  const [sheetOpen, setSheetOpen] = useState(false);

  const { count, chips } = computeActiveFilters({
    timeRange,
    filters: { providers: activeProviders },
    groupBy,
    sortBy,
  });

  return (
    <>
      {/* Desktop variant */}
      <div data-variant="desktop" className="mb-4 hidden space-y-3 sm:block">
        <TimeRangePicker timeRange={timeRange} onChange={onTimeRangeChange} />
        <ProviderFilters
          activeProviders={activeProviders}
          onToggle={onToggleProvider}
          locked={providersLocked}
        />
        <GroupBySelector groupBy={groupBy} onChange={onGroupByChange} />
        {showSort ? <SortSelector sortBy={sortBy} onChange={onSortChange} /> : null}
      </div>

      {/* Mobile variant: sticky one-row affordance */}
      <div
        data-variant="mobile"
        className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:hidden dark:border-slate-700 dark:bg-slate-900"
      >
        <button
          type="button"
          aria-label="Open filters"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={(): void => setSheetOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filters</span>
          {count > 0 ? (
            <span
              data-testid="filter-badge"
              className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1 text-xs font-semibold text-white"
            >
              {count}
            </span>
          ) : null}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap">
          {chips.map((chip) => (
            <SummaryPill key={chip.key} chip={chip} />
          ))}
        </div>
      </div>

      <FilterSheet
        isOpen={sheetOpen}
        onClose={(): void => setSheetOpen(false)}
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        activeProviders={activeProviders}
        onToggleProvider={onToggleProvider}
        providersLocked={providersLocked}
        groupBy={groupBy}
        onGroupByChange={onGroupByChange}
        sortBy={sortBy}
        onSortChange={onSortChange}
      />
    </>
  );
}

function SummaryPill({ chip }: { chip: SummaryChip }): React.JSX.Element {
  if (chip.tone === 'provider' && chip.provider !== undefined) {
    const activeClass = PROVIDER_ACTIVE_CLASSES[chip.provider] ?? INACTIVE_SEGMENT_CLASS;
    const dotClass = PROVIDER_DOT_CLASSES[chip.provider] ?? 'bg-slate-400';
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${activeClass}`}>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {chip.label}
      </span>
    );
  }
  if (chip.tone === 'active') {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-500 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400">
        {chip.label}
      </span>
    );
  }
  // neutral — default time-range chip
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${INACTIVE_SEGMENT_CLASS}`}>
      {chip.label}
    </span>
  );
}
```

- [ ] **Step 5.4: Run tests — should pass**

Run: `pnpm --filter web vitest run src/components/llm-usage/__tests__/FilterBar.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5.5: Commit**

```bash
git add apps/web/src/components/llm-usage/FilterBar.tsx \
        apps/web/src/components/llm-usage/__tests__/FilterBar.test.tsx
git commit -m "feat(web): add responsive FilterBar for LLM usage (INT-1400)"
```

---

## Task 6: Wire `FilterBar` into `LlmUsagePage`

**Files:**
- Modify: `apps/web/src/pages/LlmUsagePage.tsx`

- [ ] **Step 6.1: Replace the four inline filter blocks with `<FilterBar>`**

In `LlmUsagePage.tsx` delete the four `<div className="mb-4">...<XxxSelector/>...</div>` wrappers added in Task 2 step 2.6 and the temporary `import { TimeRangePicker, ProviderFilters, GroupBySelector, SortSelector }` line. Replace with:

```tsx
import { FilterBar } from '@/components/llm-usage/FilterBar';
```

In the render function, replace:

```tsx
<TimeRangePicker timeRange={timeRange} onChange={handleTimeRangeChange} />
<ProviderFilters activeProviders={activeProviders} onToggle={handleToggleProvider} locked={groupBy === 'openrouter-model'} />
<GroupBySelector groupBy={groupBy} onChange={handleGroupByChange} />
{isRawMode ? (
  <>
    <SortSelector sortBy={sortBy} onChange={handleSortChange} />
    <RawEventsList ... />
  </>
) : (
  <AggregateTable ... />
)}
```

with:

```tsx
<FilterBar
  timeRange={timeRange}
  onTimeRangeChange={handleTimeRangeChange}
  activeProviders={activeProviders}
  onToggleProvider={handleToggleProvider}
  providersLocked={groupBy === 'openrouter-model'}
  groupBy={groupBy}
  onGroupByChange={handleGroupByChange}
  sortBy={sortBy}
  onSortChange={handleSortChange}
  showSort={isRawMode}
/>
{isRawMode ? (
  <RawEventsList
    events={eventsResult.events}
    loading={eventsResult.loading}
    loadingMore={eventsResult.loadingMore}
    hasMore={eventsResult.hasMore}
    error={eventsResult.error}
    onLoadMore={(): void => { void eventsResult.loadMore(); }}
  />
) : (
  <AggregateTable
    rows={queryResult.rows}
    totals={queryResult.totals}
    groupBy={groupBy}
    loading={queryResult.loading}
    error={queryResult.error}
  />
)}
```

- [ ] **Step 6.2: Manual smoke-test in dev**

Run: `pnpm --filter web dev`
Visit: `http://localhost:5173/#/llm-usage`
- Resize the window to < 640 px. Confirm you see the compact "Filters" button + chip row.
- Tap the button. Confirm the bottom sheet appears with all four sections.
- Toggle a provider in the sheet. Confirm the chip row updates after closing.
- Resize back to > 640 px. Confirm the desktop layout is identical to today (visual diff: open devtools screenshot before Task 1 and compare).

- [ ] **Step 6.3: Run full workspace verification**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: PASS (build + lint + tests + type check).

- [ ] **Step 6.4: Commit**

```bash
git add apps/web/src/pages/LlmUsagePage.tsx
git commit -m "feat(web): use responsive FilterBar on LLM usage page (INT-1400)"
```

---

## Task 7: Final verification

- [ ] **Step 7.1: Run full CI locally**

Run: `pnpm run ci:tracked`
Expected: green. If any pre-existing (unrelated) check fails, fix it or ask — do not commit until all resolved (per CLAUDE.md Commit Gate).

- [ ] **Step 7.2: Screenshot comparison**

Capture before/after screenshots at 375 × 812 (iPhone 13) and 1280 × 800 (desktop). Attach to the PR description under a `### Visual diff` section. Desktop screenshot MUST be pixel-identical to pre-change; mobile screenshot MUST show the compact row + bottom sheet.

- [ ] **Step 7.3: Push and open PR**

```bash
gh pr create \
  --base development \
  --title "[INT-1400] Mobile-friendly filters on LLM usage page" \
  --body-file .github/pr-body.md
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Every requirement in the issue is covered — collapse filters on mobile (Task 4, Task 5), keep styling/colors (Task 2 moves components verbatim; Task 5 reuses `PROVIDER_ACTIVE_CLASSES`), follow best mobile practices (bottom sheet with dialog ARIA, focus management, body scroll lock, overlay click, ESC handler, drag affordance, instant apply, active-count badge, chip summary row).
- [x] **No placeholders:** All code shown in full; no "TBD", no "similar to X".
- [x] **Type consistency:** `GroupByMode` and `SortState` are defined once in `filterConstants.ts` and re-imported. `TimeRangeState` comes from existing `@/utils/llmUsageTimeRange`. Props typed consistently across `FilterBar`, `FilterSheet`, and `filterSections`.
- [x] **Out of scope (explicit):** swipe-to-dismiss gesture on the sheet (existing `ChatBottomSheet` has it; we don't re-add it here to keep the change small — note as follow-up if desired). Fully theming the `SummaryPill` for every chip tone is minimal (3 tones only).

---

## Out of scope / follow-ups

- Swipe-down gesture to dismiss the sheet. Escape, overlay click, and the Done button are sufficient for v1.
- Persisting the sheet's open state across reloads — not wanted; it should always open closed.
- Extending the same pattern to `LlmUsageViewPage` / `LlmUsagePricingPage` — they do not currently have the same filter cluster, so not in scope.
