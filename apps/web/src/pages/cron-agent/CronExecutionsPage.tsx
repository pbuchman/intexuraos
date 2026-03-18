import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { useCronExecutions, useTimeTick } from '@/hooks';
import { formatRelative, formatDurationMs } from '@/utils/dateFormat';
import { StatusBadge, TriggerBadge, ExecutionDetails, formatCost } from './ExecutionDetails.js';
import type { CronExecutionStatus } from '@/types';

const STATUS_FILTERS: { label: string; value: CronExecutionStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Success', value: 'success' },
  { label: 'Failure', value: 'failure' },
  { label: 'Running', value: 'running' },
  { label: 'Skipped', value: 'skipped' },
];

const STORAGE_KEY = 'cron-executions-filter';

function getInitialFilter(): CronExecutionStatus | 'all' {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === 'all' ||
      stored === 'success' ||
      stored === 'failure' ||
      stored === 'running' ||
      stored === 'skipped'
    ) {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'all';
}

export function CronExecutionsPage(): React.JSX.Element {
  const [filter, setFilter] = useState<CronExecutionStatus | 'all'>(getInitialFilter);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Re-render every 30s so relative timestamps stay fresh
  useTimeTick(30000);

  const hookOptions = useMemo(
    () => (filter === 'all' ? {} : { status: [filter] }),
    [filter]
  );

  const { executions, loading, loadingMore, error, hasMore, loadMore } = useCronExecutions(
    hookOptions
  );

  const handleFilterChange = useCallback((value: CronExecutionStatus | 'all'): void => {
    setFilter(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const toggleExpanded = useCallback((id: string): void => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Executions
          </h2>
          {!loading ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {String(executions.length)} execution{executions.length !== 1 ? 's' : ''}
            </p>
          ) : null}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const isActive = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={(): void => { handleFilterChange(f.value); }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white dark:bg-blue-500'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Error State */}
        {error !== null ? (
          <div className="flex items-center gap-2 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : null}

        {/* Empty State */}
        {!loading && executions.length === 0 && error === null ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <Clock className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No executions found
            </p>
          </div>
        ) : null}

        {/* Execution List */}
        {!loading && executions.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {/* Table Header */}
            <div className="hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 md:grid md:grid-cols-[1fr_1fr_100px_90px_80px_80px_80px]">
              <span>Time</span>
              <span>Schedule</span>
              <span>Status</span>
              <span>Trigger</span>
              <span>Duration</span>
              <span>Tools</span>
              <span>Cost</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {executions.map((execution) => {
                const isExpanded = expandedId === execution.id;
                return (
                  <div key={execution.id}>
                    <button
                      type="button"
                      onClick={(): void => { toggleExpanded(execution.id); }}
                      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 md:grid md:grid-cols-[1fr_1fr_100px_90px_80px_80px_80px] md:items-center md:gap-0"
                    >
                      {/* Timestamp */}
                      <span className="text-sm text-slate-700 dark:text-slate-300">
                        {formatRelative(execution.startedAt)}
                      </span>

                      {/* Schedule Name */}
                      <span className="text-sm">
                        <Link
                          to={`/cron-agent/${execution.scheduleId}`}
                          onClick={(e): void => { e.stopPropagation(); }}
                          className="text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {execution.scheduleName}
                        </Link>
                      </span>

                      {/* Status */}
                      <span>
                        <StatusBadge status={execution.status} />
                      </span>

                      {/* Trigger */}
                      <span>
                        <TriggerBadge trigger={execution.trigger} />
                      </span>

                      {/* Duration */}
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {formatDurationMs(execution.durationMs)}
                      </span>

                      {/* Tool Calls Count */}
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {String(execution.toolCalls.length)}
                      </span>

                      {/* Cost */}
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {execution.tokenUsage !== null
                          ? formatCost(execution.tokenUsage.totalCost)
                          : '-'}
                      </span>
                    </button>

                    {/* Expanded Details */}
                    {isExpanded ? <ExecutionDetails execution={execution} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Load More */}
        {hasMore && !loading ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={(): void => {
                void loadMore();
              }}
              disabled={loadingMore}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              {loadingMore ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </span>
              ) : (
                'Load more'
              )}
            </button>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
