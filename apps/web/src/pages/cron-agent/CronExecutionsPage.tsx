import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  SkipForward,
  Loader2,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { useCronExecutions } from '@/hooks';
import { useTimeTick } from '@/hooks';
import { formatRelative } from '@/utils/dateFormat';
import type { CronExecution, CronExecutionStatus } from '@/types';

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

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function StatusBadge({ status }: { status: CronExecutionStatus }): React.JSX.Element {
  switch (status) {
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          Success
        </span>
      );
    case 'failure':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Failure
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 animate-pulse dark:bg-blue-900/30 dark:text-blue-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
          <SkipForward className="h-3 w-3" />
          Skipped
        </span>
      );
  }
}

function TriggerBadge({ trigger }: { trigger: 'scheduled' | 'manual' }): React.JSX.Element {
  if (trigger === 'manual') {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        Manual
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
      Scheduled
    </span>
  );
}

function ExecutionDetails({ execution }: { execution: CronExecution }): React.JSX.Element {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = useCallback((index: number): void => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="space-y-4">
        {/* Agent Response */}
        {execution.agentResponse !== null ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Agent Response
            </h4>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {execution.agentResponse}
            </pre>
          </div>
        ) : null}

        {/* Tool Calls */}
        {execution.toolCalls.length > 0 ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tool Calls ({String(execution.toolCalls.length)})
            </h4>
            <div className="space-y-1">
              {execution.toolCalls.map((call, index) => {
                const isExpanded = expandedTools.has(index);
                return (
                  <div
                    key={index}
                    className="rounded-lg border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                  >
                    <button
                      type="button"
                      onClick={(): void => { toggleTool(index); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">
                          {call.toolName}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {formatDuration(call.durationMs)}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                    {isExpanded ? (
                      <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-600">
                        <div className="space-y-2">
                          <div>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              Args:
                            </span>
                            <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {JSON.stringify(call.args, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              Result:
                            </span>
                            <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {truncateString(call.result, 2000)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Token Usage */}
        {execution.tokenUsage !== null ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Token Usage
            </h4>
            <div className="flex gap-4 text-sm">
              <div className="text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Input: </span>
                {String(execution.tokenUsage.inputTokens)}
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Output: </span>
                {String(execution.tokenUsage.outputTokens)}
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Cost: </span>
                {formatCost(execution.tokenUsage.totalCost)}
              </div>
            </div>
          </div>
        ) : null}

        {/* Error */}
        {execution.error !== null ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-500 dark:text-red-400">
              Error
            </h4>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {execution.error}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
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
                        {formatDuration(execution.durationMs)}
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
