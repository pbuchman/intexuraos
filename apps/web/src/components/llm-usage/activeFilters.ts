import type { TimeRangeState } from '@/utils/llmUsageTimeRange';
import type { UsageEventFilters } from '@/types/llmUsage';
import {
  PRESET_OPTIONS,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  DEFAULT_GROUP_BY,
  DEFAULT_SORT,
  DEFAULT_TIME_RANGE,
  type GroupByMode,
  type SortState,
} from './filterConstants.js';

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

function formatDateShort(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '?';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function computeActiveFilters({ timeRange, filters, groupBy, sortBy }: Input): ActiveFiltersResult {
  const chips: SummaryChip[] = [];
  let count = 0;

  // Time range chip — always shown, marked "active" when non-default.
  const isCustom = timeRange.preset === 'custom';
  const hasBothCustomDates =
    isCustom &&
    timeRange.customFrom !== undefined &&
    timeRange.customFrom !== '' &&
    timeRange.customTo !== undefined &&
    timeRange.customTo !== '';
  const timeLabel = isCustom
    ? (hasBothCustomDates
        ? `${formatDateShort(timeRange.customFrom)} \u2013 ${formatDateShort(timeRange.customTo)}`
        : 'Custom')
    : (PRESET_OPTIONS.find((p) => p.key === timeRange.preset)?.label ?? timeRange.preset);
  const timeIsDefault = timeRange.preset === DEFAULT_TIME_RANGE.preset;
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
