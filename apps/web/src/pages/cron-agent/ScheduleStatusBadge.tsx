import type { CronScheduleStatus } from '@/types';

export function ScheduleStatusBadge({
  status,
}: {
  status: CronScheduleStatus;
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        status === 'active'
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          status === 'active' ? 'bg-green-500' : 'bg-yellow-500'
        }`}
      />
      {status}
    </span>
  );
}
