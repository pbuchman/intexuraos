import { Loader2 } from 'lucide-react';
import { Card } from '@/components';
import { formatDateTime, formatDurationMs } from '@/utils/dateFormat';
import type { CronExecution } from '@/types';

function executionStatusColor(status: CronExecution['status']): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'success':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'failure':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'skipped':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400';
  }
}

export function RecentExecutionsTable({
  executions,
  loading,
  error,
  onRowClick,
}: {
  executions: CronExecution[];
  loading: boolean;
  error: string | null;
  onRowClick: () => void;
}): React.JSX.Element {
  return (
    <Card className="mb-6">
      <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
        Recent Executions
      </h3>

      {loading && executions.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      ) : error !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : executions.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          No executions yet
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="pb-2 pr-4">Timestamp</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Duration</th>
                <th className="pb-2 pr-4">Trigger</th>
                <th className="pb-2">Tool Calls</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((execution) => (
                <tr
                  key={execution.id}
                  onClick={onRowClick}
                  className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50"
                >
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-600 dark:text-slate-300">
                    {formatDateTime(execution.startedAt)}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${executionStatusColor(execution.status)}`}
                    >
                      {execution.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-600 dark:text-slate-300">
                    {formatDurationMs(execution.durationMs)}
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-500 dark:text-slate-400">
                    {execution.trigger}
                  </td>
                  <td className="py-2 text-xs text-slate-600 dark:text-slate-300">
                    {String(execution.toolCalls.length)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
