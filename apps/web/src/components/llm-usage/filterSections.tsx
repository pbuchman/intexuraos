/**
 * Shared filter-section components used by both the desktop FilterBar
 * and the mobile FilterSheet. Styling is identical to the previous
 * inline versions in LlmUsagePage.tsx — see INT-1400.
 */

import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
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
} from './filterConstants.js';

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
