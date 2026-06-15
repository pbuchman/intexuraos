import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock, Loader2 } from 'lucide-react';
import { Layout } from '@/components';
import { useDispatchQueue } from '@/hooks';
import { useTimeTick } from '@/hooks';
import { formatAbsoluteDateTime, formatRelative } from '@/utils/dateFormat';
import { getAgentTypeLabel } from '@/utils/issueGroups';

function formatReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function affectedTasksText(count: number): string {
  return count === 1 ? '1 affected task' : `${String(count)} affected tasks`;
}

export function DispatchQueuePage(): React.JSX.Element {
  const { tasks, systemStatuses, totalQueued, maxQueueSize, loading, error } = useDispatchQueue();
  // Re-render every 30s so time-ago labels stay fresh
  useTimeTick(30000);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/code-tasks"
              aria-label="Back to code tasks"
              className="text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                Dispatch Queue
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {String(totalQueued)} / {String(maxQueueSize)} slots used
              </p>
            </div>
          </div>
        </div>

        {/* Error */}
        {error !== null ? (
          <div className="break-words rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </div>
        ) : null}

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : null}

        {/* System status */}
        {!loading && systemStatuses.length > 0 ? (
          <div className="space-y-2">
            {systemStatuses.map((status) => {
              const isCritical = status.severity === 'critical';
              return (
                <div
                  key={status.id}
                  className={isCritical
                    ? 'rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100'
                    : 'rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100'}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <AlertTriangle className={isCritical ? 'mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-300' : 'mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-300'} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          <span>Dispatch blocked</span>
                          <span className="rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium dark:bg-black/20">
                            {status.workerType}
                          </span>
                          <span className="rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium dark:bg-black/20">
                            {formatReason(status.reason)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm">{status.message}</p>
                        <p className="mt-1 text-sm font-medium">{status.remediation}</p>
                        {status.workerNames.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {status.workerNames.map((workerName) => (
                              <span
                                key={workerName}
                                className="rounded bg-white/70 px-1.5 py-0.5 text-xs dark:bg-black/20"
                              >
                                {workerName}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <span className="rounded bg-white/70 px-2 py-1 text-xs font-semibold dark:bg-black/20">
                      {affectedTasksText(status.affectedTaskCount)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Empty state */}
        {!loading && tasks.length === 0 && error === null ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <Clock className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No tasks in the dispatch queue
            </p>
          </div>
        ) : null}

        {/* Queue list */}
        {!loading && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Link
                key={task.id}
                to={`/code-tasks/${task.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Position badge + Linear ID */}
                    <div className="mb-1 flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {String(task.position)}
                      </span>
                      {task.linearIssueId !== undefined ? (
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {task.linearIssueId}
                        </span>
                      ) : null}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {getAgentTypeLabel(task.agentType ?? 'auto')}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {task.workerType}
                      </span>
                    </div>

                    {/* Prompt preview */}
                    <p className="line-clamp-2 text-sm text-slate-700 dark:text-slate-300">
                      {task.prompt}
                    </p>
                  </div>

                  {/* Time info */}
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Queued {formatRelative(task.queuedAt)}
                    </p>
                    {task.dispatchEligibleAt !== undefined ? (
                      <>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Dispatches {formatAbsoluteDateTime(task.dispatchEligibleAt)}
                        </p>
                        {task.dispatchScheduleText !== undefined ? (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            {task.dispatchScheduleText}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
