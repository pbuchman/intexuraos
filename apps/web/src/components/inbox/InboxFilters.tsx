import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import type { ActionStatus } from '@/types';

const ALL_ACTION_STATUSES: ActionStatus[] = [
  'pending',
  'awaiting_approval',
  'processing',
  'completed',
  'failed',
  'rejected',
  'archived',
];

const STATUS_LABELS: Record<ActionStatus, string> = {
  pending: 'Pending',
  awaiting_approval: 'Awaiting Approval',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  archived: 'Archived',
};

const STATUS_DOT_CLASSES: Record<ActionStatus, string> = {
  pending: 'bg-amber-500',
  awaiting_approval: 'bg-amber-500',
  processing: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  rejected: 'bg-red-500',
  archived: 'bg-slate-400',
};

const INACTIVE_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

interface InboxFiltersProps {
  statusFilter: ActionStatus[];
  isFilterExpanded: boolean;
  onToggleStatus: (status: ActionStatus) => void;
  onToggleExpanded: () => void;
  onClearAll: () => void;
  actionsCountByStatus: Record<ActionStatus, number>;
}

export function InboxFilters({
  statusFilter,
  isFilterExpanded,
  onToggleStatus,
  onToggleExpanded,
  onClearAll,
  actionsCountByStatus,
}: InboxFiltersProps): React.JSX.Element {
  return (
    <div className="mb-4">
      <button
        onClick={onToggleExpanded}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <Filter className="h-4 w-4" />
        Filter by status
        {statusFilter.length > 0 && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-400">
            {String(statusFilter.length)}
          </span>
        )}
        {isFilterExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isFilterExpanded && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ALL_ACTION_STATUSES.map((status) => {
            const isActive = statusFilter.includes(status);
            const count = actionsCountByStatus[status];

            return (
              <button
                key={status}
                onClick={(): void => {
                  onToggleStatus(status);
                }}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
                    : INACTIVE_CLASS
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASSES[status]}`} />
                {STATUS_LABELS[status]}
                <span className="font-medium">{String(count)}</span>
              </button>
            );
          })}
          {statusFilter.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
