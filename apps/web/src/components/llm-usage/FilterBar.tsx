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
} from './filterSections.js';
import {
  PROVIDER_ACTIVE_CLASSES,
  PROVIDER_DOT_CLASSES,
  INACTIVE_SEGMENT_CLASS,
  type GroupByMode,
  type SortState,
} from './filterConstants.js';
import { computeActiveFilters, type SummaryChip } from './activeFilters.js';
import { FilterSheet } from './FilterSheet.js';

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
        className="sticky top-16 z-40 -mx-4 mb-3 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:hidden dark:border-slate-700 dark:bg-slate-900"
      >
        <button
          type="button"
          aria-label="Open filters"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={(): void => { setSheetOpen(true); }}
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
        onClose={(): void => { setSheetOpen(false); }}
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
