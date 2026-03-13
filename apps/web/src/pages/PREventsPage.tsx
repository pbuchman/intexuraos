import { useState, useMemo, useCallback } from 'react';
import {
  AlertCircle,
  RadioTower,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button, Layout } from '@/components';
import { GitHubEventLogRow } from '@/components/GitHubEventLogRow';
import { useGitHubEventLog } from '@/hooks';
import type { GitHubEventLogListRow } from '@/hooks';

type DecisionFilter = 'all' | 'pending' | 'completed';

const DECISION_FILTERS: { key: DecisionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
];

const INACTIVE_PILL_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

const ACTIVE_PILL_CLASS =
  'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200';

function matchesSearch(row: GitHubEventLogListRow, needle: string): boolean {
  return [
    row.repository,
    row.senderLogin,
    row.reason,
    row.githubEventName,
    row.eventType,
    row.action,
    row.pullRequestNumber !== null ? `#${String(row.pullRequestNumber)}` : null,
  ].some((value) => value?.toLowerCase().includes(needle) === true);
}

// --- PageHeader ---

interface PageHeaderProps {
  totalVisible: number;
  pendingCount: number;
  reviewCount: number;
  listenerHealthy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function PageHeader({
  totalVisible,
  pendingCount,
  reviewCount,
  listenerHealthy,
  refreshing,
  onRefresh,
}: PageHeaderProps): React.JSX.Element {
  const parts: string[] = [`${String(totalVisible)} visible`];
  if (pendingCount > 0) {
    parts.push(`${String(pendingCount)} pending`);
  }
  if (reviewCount > 0) {
    parts.push(`${String(reviewCount)} review requests`);
  }

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
          {parts.join(' \u00B7 ')}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        <span className="ml-2 hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

// --- ColumnHeader ---

function ColumnHeader(): React.JSX.Element {
  return (
    <div className="mb-1 hidden grid-cols-[minmax(0,2.5fr)_minmax(0,1.8fr)_auto] px-4 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500 sm:grid">
      <div>Event</div>
      <div>Decision</div>
      <div>Time</div>
    </div>
  );
}

// --- PREventsPage ---

export function PREventsPage(): React.JSX.Element {
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
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<DecisionFilter>('all');

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (stateFilter !== 'all' && row.decisionState !== stateFilter) {
        return false;
      }
      if (needle === '') {
        return true;
      }
      return matchesSearch(row, needle);
    });
  }, [rows, query, stateFilter]);

  const pendingCount = useMemo(
    () => rows.filter((row) => row.decisionState === 'pending').length,
    [rows],
  );
  const reviewCount = useMemo(
    () => rows.filter((row) => row.decisionOutcome === 'request_review').length,
    [rows],
  );

  const handleToggle = useCallback((rowId: string): void => {
    setExpandedRowId((currentId) => currentId === rowId ? null : rowId);
  }, []);

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
        totalVisible={filteredRows.length}
        pendingCount={pendingCount}
        reviewCount={reviewCount}
        listenerHealthy={listenerHealthy}
        refreshing={refreshing}
        onRefresh={(): void => { void refresh(); }}
      />

      {/* Filter pills + search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {DECISION_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(): void => { setStateFilter(key); }}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                stateFilter === key ? ACTIVE_PILL_CLASS : INACTIVE_PILL_CLASS
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            value={query}
            onChange={(event): void => { setQuery(event.target.value); }}
            placeholder="Search repo, sender, PR, reason…"
            className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </label>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 flex items-center gap-2 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {filteredRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <RadioTower className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No matching events</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No auth-passed GitHub events match the current filters.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <ColumnHeader />

          <div className="space-y-1">
            {filteredRows.map((row) => (
              <GitHubEventLogRow
                key={row.id}
                row={row}
                expanded={expandedRowId === row.id}
                onToggle={handleToggle}
              />
            ))}
          </div>

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={(): void => { void loadMore(); }}
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
