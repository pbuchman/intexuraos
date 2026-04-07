import { Play, Pause, Trash2, Zap } from 'lucide-react';
import { formatRelativeNullable } from '@/utils/dateFormat.js';
import type { CronSchedule, CronScheduleStatus } from '@/types';
import { ScheduleStatusBadge } from './ScheduleStatusBadge.js';

interface ScheduleListItemProps {
  schedule: CronSchedule;
  onRowClick: (id: string) => void;
  onPauseResume: (id: string, status: CronScheduleStatus) => void;
  onTrigger: (id: string) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  showDeleteConfirm: boolean;
}

export function ScheduleListItem({
  schedule,
  onRowClick,
  onPauseResume,
  onTrigger,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  showDeleteConfirm,
}: ScheduleListItemProps): React.JSX.Element {
  return (
    <div
      onClick={(): void => {
        onRowClick(schedule.id);
      }}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick(schedule.id);
        }
      }}
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-750"
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: schedule info */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {schedule.name}
            </h3>
            <ScheduleStatusBadge status={schedule.status} />
          </div>

          {/* Schedule summary */}
          {schedule.scheduleSummary !== '' ? (
            <p className="mb-2 truncate text-xs text-slate-500 dark:text-slate-400">
              {schedule.scheduleSummary.length > 120
                ? `${schedule.scheduleSummary.slice(0, 120)}...`
                : schedule.scheduleSummary}
            </p>
          ) : null}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">{schedule.cronExpression}</span>
            <span>{schedule.timezone}</span>
            <span>
              Next: {formatRelativeNullable(schedule.nextExecutionAt)}
            </span>
            <span>
              Last: {formatRelativeNullable(schedule.lastExecutedAt)}
            </span>
            <span>
              {String(schedule.executionCount)} run{schedule.executionCount !== 1 ? 's' : ''}
            </span>
            {schedule.failureCount > 0 ? (
              <span className="text-red-500 dark:text-red-400">
                {String(schedule.failureCount)} failure{schedule.failureCount !== 1 ? 's' : ''}
              </span>
            ) : null}
          </div>

          {/* Service chips */}
          {schedule.action.services.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {schedule.action.services.map((service) => (
                <span
                  key={service}
                  className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                >
                  {service}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right: actions */}
        <div
          className="flex flex-shrink-0 items-center gap-1"
          onClick={(e): void => {
            e.stopPropagation();
          }}
          onKeyDown={(e): void => {
            e.stopPropagation();
          }}
          role="toolbar"
        >
          <button
            type="button"
            onClick={(): void => {
              onPauseResume(schedule.id, schedule.status);
            }}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            title={schedule.status === 'active' ? 'Pause' : 'Resume'}
          >
            {schedule.status === 'active' ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={(): void => {
              onTrigger(schedule.id);
            }}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            title="Trigger now"
          >
            <Zap className="h-4 w-4" />
          </button>
          {showDeleteConfirm ? (
            <>
              <button
                type="button"
                onClick={(): void => {
                  onDeleteConfirm(schedule.id);
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={onDeleteCancel}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(): void => {
                onDeleteRequest(schedule.id);
              }}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
