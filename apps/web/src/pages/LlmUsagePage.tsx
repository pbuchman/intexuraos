/**
 * LLM Usage list page with filtering, sorting, grouping, and pagination.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Layout } from '@/components';
import { useLlmUsageEvents } from '@/hooks/useLlmUsageEvents';
import { useLlmUsageQuery, EMPTY_TOTALS } from '@/hooks/useLlmUsageQuery';
import { resolveTimeRange, type TimeRangeState } from '@/utils/llmUsageTimeRange';
import { loadFromStorage, saveToStorage } from '@/utils/llmUsageStorage';
import { formatRelative, formatDateTime } from '@/utils/dateFormat';
import type { UsageEvent, UsageEventFilters, UsageQueryRow, AggregateMetrics } from '@/types/llmUsage';
import { resolveOpenRouterModelName } from '@/utils/openRouterModelNames';

// --- Types & Constants (re-exported from shared module) ---

import {
  GROUP_BY_MAP,
  GROUP_BY_OPTIONS,
  DEFAULT_GROUP_BY,
  DEFAULT_SORT,
  DEFAULT_TIME_RANGE,
  type GroupByMode,
  type SortState,
} from '@/components/llm-usage/filterConstants.js';
import { FilterBar } from '@/components/llm-usage/FilterBar.js';

const STORAGE_KEY_TIME_RANGE = 'llm-usage-time-range';
const STORAGE_KEY_FILTERS = 'llm-usage-filters';
const STORAGE_KEY_SORT = 'llm-usage-sort';
const STORAGE_KEY_GROUP_BY = 'llm-usage-group-by';

// --- Validators ---

function isTimeRangeState(v: unknown): v is TimeRangeState {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  const preset = obj['preset'];
  return typeof preset === 'string' && ['today', 'yesterday', 'last7days', 'last30days', 'custom'].includes(preset);
}

function isUsageEventFilters(v: unknown): v is UsageEventFilters {
  return typeof v === 'object' && v !== null;
}

function isSortState(v: unknown): v is SortState {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  const field = obj['field'];
  const direction = obj['direction'];
  // Stale 'costUsd' / 'totalTokens' values from localStorage fall through
  // to DEFAULT_SORT after those options were removed from the UI.
  return (
    typeof field === 'string' &&
    typeof direction === 'string' &&
    field === 'occurredAt' &&
    ['asc', 'desc'].includes(direction)
  );
}

function isGroupByMode(v: unknown): v is GroupByMode {
  return typeof v === 'string' && ['none', 'day', 'component', 'service', 'model', 'openrouter-model', 'promptType'].includes(v);
}

// --- Defaults ---

const DEFAULT_FILTERS: UsageEventFilters = {};

// --- Formatting helpers ---

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// --- PageHeader ---

interface PageHeaderProps {
  displayedCount: number;
  totalMatched: number;
  loading: boolean;
}

function PageHeader({ displayedCount, totalMatched, loading }: PageHeaderProps): React.JSX.Element {
  let countText: string;
  if (totalMatched === -1) {
    countText = `Showing ${String(displayedCount)} events`;
  } else {
    countText = `Showing ${String(displayedCount)} of ${String(totalMatched)} events`;
  }
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">LLM Usage</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {loading ? 'Loading...' : countText}
      </p>
    </div>
  );
}

// --- RawEventsList ---

interface RawEventsListProps {
  events: UsageEvent[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onLoadMore: () => void;
}

function RawEventsList({ events, loading, loadingMore, hasMore, error, onLoadMore }: RawEventsListProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500 dark:text-slate-400">
        No usage events found for the selected filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Time</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Status</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Owner</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Provider</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Model</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Component</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Service</th>
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Prompt Type</th>
            <th className="py-2 pr-4 text-right font-medium text-slate-500 dark:text-slate-400">Tokens</th>
            <th className="py-2 text-right font-medium text-slate-500 dark:text-slate-400">Cost</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.eventId} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50">
              <td className="py-2.5 pr-4">
                <Link to={`/llm-usage/${event.eventId}`} className="text-blue-600 hover:underline dark:text-blue-400" title={formatDateTime(event.occurredAt)}>
                  {formatRelative(event.occurredAt)}
                </Link>
              </td>
              <td className="py-2.5 pr-4">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  event.request.success
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {event.request.success ? 'OK' : 'Fail'}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.owner.id}</td>
              <td className="py-2.5 pr-4 text-slate-900 dark:text-slate-100">{event.request.provider}</td>
              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.request.model}</td>
              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.source.component}</td>
              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.source.service}</td>
              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{event.request.promptType ?? '-'}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-slate-700 dark:text-slate-300">{formatTokens(event.usage.totalTokens)}</td>
              <td className="py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">{formatCost(event.cost.billedUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasMore ? (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// --- AggregateTable ---

interface AggregateTableProps {
  rows: UsageQueryRow[];
  totals: AggregateMetrics | null;
  groupBy: GroupByMode;
  loading: boolean;
  error: string | null;
}

function getGroupLabel(row: UsageQueryRow, groupBy: GroupByMode): string {
  if (groupBy === 'openrouter-model') {
    const modelId = row.group['request.model'];
    if (typeof modelId === 'string') return resolveOpenRouterModelName(modelId);
    return 'Unknown';
  }
  const key = GROUP_BY_MAP[groupBy][0];
  if (key === undefined) return 'Unknown';
  const value = row.group[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return 'Unknown';
}

function AggregateTable({ rows, totals, groupBy, loading, error }: AggregateTableProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500 dark:text-slate-400">
        No data for the selected filters.
      </div>
    );
  }

  const resolvedTotals = totals ?? EMPTY_TOTALS;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">
              {GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label ?? groupBy}
            </th>
            <th className="py-2 pr-4 text-right font-medium text-slate-500 dark:text-slate-400">Calls</th>
            <th className="py-2 pr-4 text-right font-medium text-slate-500 dark:text-slate-400">Cost</th>
            <th className="py-2 text-right font-medium text-slate-500 dark:text-slate-400">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={Object.values(row.group).join('|')} className="border-b border-slate-100 dark:border-slate-700/50">
              <td className="py-2.5 pr-4 text-slate-900 dark:text-slate-100">{getGroupLabel(row, groupBy)}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-slate-700 dark:text-slate-300">{String(row.metrics.calls)}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-slate-700 dark:text-slate-300">{formatCost(row.metrics.costUsd)}</td>
              <td className="py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">{formatTokens(row.metrics.totalTokens)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-600">
            <td className="py-2.5 pr-4 text-slate-900 dark:text-slate-100">Total</td>
            <td className="py-2.5 pr-4 text-right font-mono text-slate-900 dark:text-slate-100">{String(resolvedTotals.calls)}</td>
            <td className="py-2.5 pr-4 text-right font-mono text-slate-900 dark:text-slate-100">{formatCost(resolvedTotals.costUsd)}</td>
            <td className="py-2.5 text-right font-mono text-slate-900 dark:text-slate-100">{formatTokens(resolvedTotals.totalTokens)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// --- Main Page ---

export function LlmUsagePage(): React.JSX.Element {
  const [timeRange, setTimeRange] = useState<TimeRangeState>(() =>
    loadFromStorage(STORAGE_KEY_TIME_RANGE, isTimeRangeState, DEFAULT_TIME_RANGE),
  );
  const [filters, setFilters] = useState<UsageEventFilters>(() =>
    loadFromStorage(STORAGE_KEY_FILTERS, isUsageEventFilters, DEFAULT_FILTERS),
  );
  const [sortBy, setSortBy] = useState<SortState>(() =>
    loadFromStorage(STORAGE_KEY_SORT, isSortState, DEFAULT_SORT),
  );
  const [groupBy, setGroupBy] = useState<GroupByMode>(() =>
    loadFromStorage(STORAGE_KEY_GROUP_BY, isGroupByMode, DEFAULT_GROUP_BY),
  );

  // Persist state changes
  useEffect(() => { saveToStorage(STORAGE_KEY_TIME_RANGE, timeRange); }, [timeRange]);
  useEffect(() => { saveToStorage(STORAGE_KEY_FILTERS, filters); }, [filters]);
  useEffect(() => { saveToStorage(STORAGE_KEY_SORT, sortBy); }, [sortBy]);
  useEffect(() => { saveToStorage(STORAGE_KEY_GROUP_BY, groupBy); }, [groupBy]);

  // Stable identity required — resolveTimeRange calls new Date(), which would
  // otherwise tick on every render and defeat the hooks' JSON change guard.
  const resolvedTimeRange = useMemo(() => resolveTimeRange(timeRange), [timeRange]);

  const activeProviders = filters.providers ?? [];

  const handleToggleProvider = useCallback((provider: string): void => {
    setFilters((prev) => {
      const current = prev.providers ?? [];
      const next = current.includes(provider)
        ? current.filter((p) => p !== provider)
        : [...current, provider];
      if (next.length > 0) {
        return { ...prev, providers: next };
      }
      const { providers: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleTimeRangeChange = useCallback((tr: TimeRangeState): void => {
    setTimeRange(tr);
  }, []);

  const handleSortChange = useCallback((sort: SortState): void => {
    setSortBy(sort);
  }, []);

  const handleGroupByChange = useCallback((mode: GroupByMode): void => {
    setGroupBy(mode);
  }, []);

  const isRawMode = groupBy === 'none';

  // Skip fetching when Custom preset is selected but the user has not yet
  // picked both dates — resolveTimeRange would return empty strings, which
  // the backend rejects with a date-time format error.
  const isCustomIncomplete =
    timeRange.preset === 'custom' &&
    (timeRange.customFrom === undefined || timeRange.customTo === undefined);

  // Raw events hook (active when groupBy === 'none')
  const eventsResult = useLlmUsageEvents({
    timeRange: resolvedTimeRange,
    filters,
    sortBy,
    enabled: isRawMode && !isCustomIncomplete,
  });

  // Auto-apply openrouter filter when grouping by openrouter model.
  // Intentionally only used by the aggregate query below — the raw events hook
  // is disabled when groupBy !== 'none', so it never needs effectiveFilters.
  const effectiveFilters = useMemo(() => {
    if (groupBy === 'openrouter-model') {
      return { ...filters, providers: ['openrouter'] };
    }
    return filters;
  }, [groupBy, filters]);

  // Aggregate query hook (active when groupBy !== 'none')
  const queryGroupBy = GROUP_BY_MAP[groupBy];
  const queryResult = useLlmUsageQuery({
    timeRange: resolvedTimeRange,
    filters: effectiveFilters,
    groupBy: queryGroupBy,
    enabled: !isRawMode && !isCustomIncomplete,
  });

  const totalMatched = isRawMode ? eventsResult.totalMatched : (queryResult.totals?.calls ?? 0);
  const displayedCount = isRawMode ? eventsResult.events.length : queryResult.rows.length;
  const isLoading = isRawMode ? eventsResult.loading : queryResult.loading;

  return (
    <Layout>
      <PageHeader displayedCount={displayedCount} totalMatched={totalMatched} loading={isLoading} />
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
    </Layout>
  );
}
