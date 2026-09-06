import type { CodeTaskStatus } from '@/types';
import { formatDateTime, formatDateTimeAccessible } from '@/utils/dateFormat';
import { getBrowserTimezone } from '@/utils/scheduledDispatch';
import { formatTaskRelativeTime, getTaskLifecycleVerb } from '@/utils/taskLifecycle';

interface TaskLifecycleTimeProps {
  status: CodeTaskStatus;
  at: string;
  timeTick?: number | undefined;
  className?: string;
}

export function TaskLifecycleTime(props: TaskLifecycleTimeProps): React.JSX.Element {
  const { status, at, timeTick, className } = props;
  void timeTick;

  const timeZone = getBrowserTimezone();
  const verb = getTaskLifecycleVerb(status);
  const exact = formatDateTime(at, timeZone);
  const relative = formatTaskRelativeTime(at);
  const accessible = `${verb} ${formatDateTimeAccessible(at, timeZone)} · ${relative}`;

  return (
    <time
      dateTime={at}
      title={accessible}
      aria-label={accessible}
      className={`whitespace-normal break-words${className === undefined ? '' : ` ${className}`}`}
    >
      {verb} {exact}
      <span aria-hidden="true"> &middot; {relative}</span>
    </time>
  );
}

export type { TaskLifecycleTimeProps };
