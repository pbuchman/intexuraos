import { ExternalLink } from 'lucide-react';
import type { CodeTask, CodeTaskStatus } from '@/types';
import { formatDateTime, formatElapsedTime } from '@/utils/dateFormat';

interface IssueTimelineProps {
  tasks: CodeTask[];
  referenceLocation: string;
  onCollapse: () => void;
}

// --- Dot color ---

type DotColor = 'green' | 'red' | 'blue' | 'violet' | 'slate';

function getDotColor(task: CodeTask): DotColor {
  const { status, agentType } = task;

  if (status === 'archived' || status === 'cancelled') return 'slate';
  if (status === 'running' || status === 'dispatched' || status === 'queued') return 'blue';
  if (status === 'failed' || status === 'interrupted') return 'red';
  if (status === 'planned' && agentType === 'planning') return 'violet';
  // planned (non-planning) or implemented
  return 'green';
}

const DOT_CLASSES: Record<DotColor, string> = {
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-500',
};

// --- Action label ---

function getActionLabel(task: CodeTask): string {
  const { agentType, status } = task;

  if (agentType === 'execution') {
    if (status === 'implemented') return 'Execution completed';
    if (status === 'failed') return 'Execution failed';
    if (status === 'running' || status === 'dispatched' || status === 'queued') return 'Execution running';
  }

  if (agentType === 'planning') {
    if (status === 'planned') return 'Planning completed';
    if (status === 'failed') return 'Planning failed';
    if (status === 'running' || status === 'dispatched' || status === 'queued') return 'Planning running';
  }

  // Default: capitalize status
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// --- Duration calculation ---

const TERMINAL_STATUSES: ReadonlySet<CodeTaskStatus> = new Set<CodeTaskStatus>([
  'implemented',
  'planned',
  'failed',
  'interrupted',
  'cancelled',
  'archived',
]);

function computeDuration(task: CodeTask): number {
  const start = new Date(task.createdAt).getTime();
  const isTerminal = TERMINAL_STATUSES.has(task.status);
  const end = isTerminal ? new Date(task.updatedAt).getTime() : Date.now();
  return Math.floor((end - start) / 1000);
}

// --- followUpReason chip ---

interface FollowUpChipProps {
  reason: NonNullable<CodeTask['followUpReason']>;
}

function FollowUpChip({ reason }: FollowUpChipProps): React.JSX.Element | null {
  if (reason === 'execution_implement') return null;

  const chipStyles: Record<string, string> = {
    retry: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    pr_comment: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    user_feedback: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  };

  const labels: Record<string, string> = {
    retry: 'Retry',
    pr_comment: 'PR Comment',
    user_feedback: 'User Feedback',
  };

  const style = chipStyles[reason] ?? 'border-slate-500/30 bg-slate-500/10 text-slate-400';
  const label = labels[reason] ?? reason;

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${style}`}>
      {label}
    </span>
  );
}

// --- Detail line ---

function DetailLine({ task }: { task: CodeTask }): React.JSX.Element | null {
  const prUrl = task.result?.prUrl;
  if (prUrl !== undefined) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        {prUrl}
      </a>
    );
  }

  const errorMessage = task.error?.message;
  if (errorMessage !== undefined) {
    const truncated = errorMessage.length > 100
      ? errorMessage.slice(0, 100) + '...'
      : errorMessage;
    return (
      <span className="text-xs text-red-400">{truncated}</span>
    );
  }

  const summary = task.result?.summary;
  if (summary !== undefined) {
    return <span className="text-xs text-slate-400">{summary}</span>;
  }

  const prompt = task.sanitizedPrompt;
  const words = prompt.split(/\s+/);
  const truncated = words.length > 100 ? words.slice(0, 100).join(' ') + '...' : prompt;
  return (
    <span className="text-xs text-slate-500">{truncated}</span>
  );
}

// --- Timeline item ---

function TimelineItem({ task, referenceLocation }: { task: CodeTask; referenceLocation: string }): React.JSX.Element {
  const dotColor = getDotColor(task);
  const label = getActionLabel(task);
  const isArchived = task.status === 'archived';
  const duration = computeDuration(task);

  return (
    <div className="relative flex gap-3 pb-4 pl-6 last:pb-0">
      {/* Dot on the timeline line */}
      <div className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center">
        <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASSES[dotColor]}`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* First line: label + chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm font-medium ${
              isArchived
                ? 'text-slate-500 line-through'
                : 'text-slate-300'
            }`}
          >
            {label}
          </span>

          {/* Model chip */}
          <span className="rounded border border-slate-600 px-1.5 py-0.5 font-mono text-xs text-slate-400">
            {task.workerType}
          </span>

          {/* Worker location chip (only if different from group's latest task) */}
          {task.workerLocation !== referenceLocation ? (
            <span className="rounded border border-slate-600 px-1.5 py-0.5 text-xs text-slate-400">
              {task.workerLocation}
            </span>
          ) : null}

          {/* followUpReason chip */}
          {task.followUpReason !== undefined ? (
            <FollowUpChip reason={task.followUpReason} />
          ) : null}
        </div>

        {/* Second line: timestamp + duration */}
        <p className="mt-0.5 text-xs text-slate-500">
          {formatDateTime(task.updatedAt)}
          <span className="mx-1 text-slate-600">&middot;</span>
          {formatElapsedTime(duration)}
        </p>

        {/* Third line: detail */}
        <div className="mt-1">
          <DetailLine task={task} />
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

function IssueTimeline({ tasks, referenceLocation, onCollapse }: IssueTimelineProps): React.JSX.Element {
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  return (
    <div className="border-t border-zinc-700 bg-zinc-900/50 px-4 py-3">
      {/* Vertical timeline */}
      <div className="border-l-2 border-zinc-700 pl-2">
        {tasks.map((task) => (
          <TimelineItem key={task.id} task={task} referenceLocation={referenceLocation} />
        ))}
      </div>

      {/* Footer */}
      <button
        type="button"
        onClick={onCollapse}
        className="mt-2 w-full text-center text-xs text-slate-500 transition-colors hover:text-slate-400"
      >
        {String(tasks.length)} tasks{archivedCount > 0 ? <> &middot; {String(archivedCount)} archived</> : null} &middot; click to collapse
      </button>
    </div>
  );
}

export { IssueTimeline };
export type { IssueTimelineProps };
