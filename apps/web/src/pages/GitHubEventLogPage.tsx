import { useMemo, useState } from 'react';
import { ArrowUpDown, RadioTower, RefreshCw } from 'lucide-react';
import { Button, ErrorBanner, GitHubEventLogTableRow, Layout } from '@/components';
import { useGitHubEventLog } from '@/hooks';
import type { GitHubDecisionOutcome } from '@/types';
import type { GitHubEventLogListRow } from '@/hooks/useGitHubEventLog';

// --- Types ---

type DecisionFilter = 'all' | 'pending' | 'completed';
type SortOption = 'newest' | 'oldest';

const DECISION_FILTERS: DecisionFilter[] = ['all', 'pending', 'completed'];

const DECISION_FILTER_CONFIG: Record<
  DecisionFilter,
  { label: string; dotClass: string; activeClass: string }
> = {
  all: {
    label: 'All',
    dotClass: 'bg-blue-500',
    activeClass:
      'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  pending: {
    label: 'Pending',
    dotClass: 'bg-amber-500',
    activeClass:
      'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-green-500',
    activeClass:
      'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
};

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

const INACTIVE_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

// --- Helpers ---

function getDecisionFilter(
  decisionOutcome: GitHubDecisionOutcome | null,
): DecisionFilter {
  if (decisionOutcome === null) {
    return 'pending';
  }
  return 'completed';
}

function getLocalStorageItem<T>(
  key: string,
  defaultValue: T,
  validate?: (v: unknown) => v is T,
): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return defaultValue;
    }
    const parsed: unknown = JSON.parse(stored);
    if (validate !== undefined && !validate(parsed)) {
      return defaultValue;
    }
    return parsed as T;
  } catch {
    return defaultValue;
  }
}

// Validators for localStorage data shape
const isValidDecisionFilterRecord = (
  v: unknown,
): v is Record<DecisionFilter, boolean> => {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['all'] === 'boolean' &&
    typeof obj['pending'] === 'boolean' &&
    typeof obj['completed'] === 'boolean'
  );
};

const isValidSortOption = (v: unknown): v is SortOption => {
  return v === 'newest' || v === 'oldest';
};

function setLocalStorageItem(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors
  }
}

// --- PageHeader ---

interface PageHeaderProps {
  totalCount: number;
  filteredCount: number;
  listenerHealthy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function PageHeader({
  totalCount,
  filteredCount,
  listenerHealthy,
  refreshing,
  onRefresh,
}: PageHeaderProps): React.JSX.Element {
  const showFiltered = filteredCount !== totalCount;
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            GitHub Event Log
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              listenerHealthy
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}
          >
            <RadioTower className="h-3 w-3" />
            {listenerHealthy ? 'Live' : 'Polling'}
          </span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {showFiltered ? `${String(filteredCount)} of ${String(totalCount)} events` : `${String(totalCount)} events`}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        <span className="ml-2 hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

// --- ColumnHeader ---

function ColumnHeader(): React.JSX.Element {
  return (
    <div className="mb-1 hidden grid-cols-[24px_80px_160px_120px_100px_1fr_220px] gap-2 px-3 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500 lg:grid">
      <div />
      <div>Time</div>
      <div>Event</div>
      <div>Action</div>
      <div>Decision</div>
      <div>Reason</div>
      <div>Entity</div>
    </div>
  );
}

// --- DecisionFilterPills ---

interface DecisionFilterPillsProps {
  activeFilters: Record<DecisionFilter, boolean>;
  toggleFilter: (filter: DecisionFilter) => void;
  counts: Record<DecisionFilter, number>;
}

function DecisionFilterPills({
  activeFilters,
  toggleFilter,
  counts,
}: DecisionFilterPillsProps): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {DECISION_FILTERS.map((filter) => {
        const config = DECISION_FILTER_CONFIG[filter];
        const isActive = activeFilters[filter];
        return (
          <button
            key={filter}
            onClick={() => { toggleFilter(filter); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? config.activeClass : INACTIVE_CLASS
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
            {config.label}
            <span className="font-medium">{String(counts[filter])}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- SortSelector ---

interface SortSelectorProps {
  activeSort: SortOption;
  onSortChange: (sort: SortOption) => void;
}

function SortSelector({
  activeSort,
  onSortChange,
}: SortSelectorProps): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2">
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">
        Sort
      </span>
      <div className="flex gap-1.5">
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { onSortChange(key); }}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              activeSort === key
                ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- GitHubEventLogPage ---

export function GitHubEventLogPage(): React.JSX.Element {
  const {
    rows,
    loading,
    refreshing,
    loadingMore,
    error,
    listenerHealthy,
    hasMore,
    refresh,
    loadMore,
  } = useGitHubEventLog();

  // Filter state - using object instead of Set for proper JSON serialization
  const [activeFilters, setActiveFilters] = useState<Record<DecisionFilter, boolean>>(() => {
    return getLocalStorageItem<Record<DecisionFilter, boolean>>(
      'pr-events-decision-filter',
      { all: true, pending: false, completed: false },
      isValidDecisionFilterRecord,
    );
  });

  // Sort state
  const [activeSort, setActiveSort] = useState<SortOption>(() => {
    return getLocalStorageItem<SortOption>('pr-events-sort', 'newest', isValidSortOption);
  });

  const toggleFilter = (filter: DecisionFilter): void => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      if (filter === 'all') {
        next.all = true;
        next.pending = false;
        next.completed = false;
      } else {
        next.all = false;
        next[filter] = !prev[filter];
        // If nothing selected, fall back to 'all'
        if (!next.pending && !next.completed) {
          next.all = true;
        }
      }
      setLocalStorageItem('pr-events-decision-filter', next);
      return next;
    });
  };

  const handleSortChange = (sort: SortOption): void => {
    setActiveSort(sort);
    setLocalStorageItem('pr-events-sort', sort);
  };

  // Combined filter and sort - single pass through rows for efficiency
  const { filteredAndSortedRows, counts } = useMemo(() => {
    const countsResult: Record<DecisionFilter, number> = { all: 0, pending: 0, completed: 0 };
    const pendingRows: GitHubEventLogListRow[] = [];
    const completedRows: GitHubEventLogListRow[] = [];

    // Single pass: categorize rows and compute counts
    for (const row of rows) {
      const filter = getDecisionFilter(row.decisionOutcome);
      countsResult.all++;
      if (filter === 'pending') {
        countsResult.pending++;
        pendingRows.push(row);
      } else {
        countsResult.completed++;
        completedRows.push(row);
      }
    }

    // Determine which rows to show based on filters
    let rowsToSort: GitHubEventLogListRow[];
    if (activeFilters.all) {
      rowsToSort = rows;
    } else {
      rowsToSort = [];
      if (activeFilters.pending) {
        rowsToSort.push(...pendingRows);
      }
      if (activeFilters.completed) {
        rowsToSort.push(...completedRows);
      }
    }

    // Pre-compute timestamps for efficient sorting
    const rowsWithTime = rowsToSort.map((row) => ({
      row,
      timestamp: Date.parse(row.authPassedAt),
    }));

    // Sort by timestamp
    rowsWithTime.sort((a, b) => {
      if (activeSort === 'newest') {
        return b.timestamp - a.timestamp;
      }
      return a.timestamp - b.timestamp;
    });

    const sortedRows = rowsWithTime.map((item) => item.row);

    return { filteredAndSortedRows: sortedRows, counts: countsResult };
  }, [rows, activeFilters, activeSort]);

  if (loading && rows.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        totalCount={rows.length}
        filteredCount={filteredAndSortedRows.length}
        listenerHealthy={listenerHealthy}
        refreshing={refreshing}
        onRefresh={(): void => {
          void refresh();
        }}
      />

      <ErrorBanner message={error} className="mb-6" />

      {rows.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <RadioTower className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No events yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              GitHub webhook events will appear here as they arrive.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <DecisionFilterPills
            activeFilters={activeFilters}
            toggleFilter={toggleFilter}
            counts={counts}
          />
          <SortSelector activeSort={activeSort} onSortChange={handleSortChange} />
          <ColumnHeader />

          <div className="space-y-0.5">
            {filteredAndSortedRows.map((row) => (
              <GitHubEventLogTableRow key={row.id} row={row} />
            ))}
          </div>

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={(): void => {
                  void loadMore();
                }}
                disabled={loadingMore}
                isLoading={loadingMore}
                loadingText="Loading…"
              >
                Load older events
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
