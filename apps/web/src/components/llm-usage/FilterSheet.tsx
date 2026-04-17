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
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
import type { GroupByMode, SortState } from './filterConstants.js';
import {
  TimeRangePicker,
  ProviderFilters,
  GroupBySelector,
  SortSelector,
} from './filterSections.js';
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
    return (): void => { window.removeEventListener('keydown', handleEsc); };
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

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}
