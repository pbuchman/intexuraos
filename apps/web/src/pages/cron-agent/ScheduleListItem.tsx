import { Play, Pause, Trash2, Zap } from 'lucide-react';
import { formatRelativeNullable } from '@/utils/dateFormat.js';
import type { CronSchedule, CronScheduleStatus } from '@/types';

interface ScheduleListItemProps {
  schedule: CronSchedule;
  onRowClick: (id: string) => void;
  onPauseResume: (id: string, status: CronScheduleStatus) => void;
  onTrigger: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

export function ScheduleListItem({
  schedule,
  onRowClick,
  onPauseResume,
  onTrigger,
  onDelete,
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
            {/* Status badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                schedule.status === 'active'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  schedule.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'
                }`}
              />
              {schedule.status}
            </span>
          </div>

          {/* Description */}
          {schedule.description !== '' ? (
            <p className="mb-2 truncate text-xs text-slate-500 dark:text-slate-400">
              {schedule.description.length > 120
                ? `${schedule.description.slice(0, 120)}...`
                : schedule.description}
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
          <button
            type="button"
            onClick={(): void => {
              onDelete(schedule.id, schedule.name);
            }}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
