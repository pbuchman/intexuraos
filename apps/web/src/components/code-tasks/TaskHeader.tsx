import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import { formatDateTime, formatRelative } from '@/utils/dateFormat';
import { getTaskMergeUrl } from '@/utils/issueGroups.js';
import type { CodeTask, WorkerStatusTag } from '@/types';
import {
  DEFAULT_STATE_STYLE,
  EXECUTION_MEMORY_STATUS_STYLES,
  LINEAR_STATE_STYLES,
  STATUS_MAP,
  WORKER_STATUS_STYLES,
  isActiveStatus,
  type StatusConfig,
} from './shared.js';

const ICON_MAP = { Clock, Loader2, CheckCircle2, XCircle, AlertCircle, Archive } as const;

const FALLBACK_STATUS: StatusConfig = {
  bg: 'bg-slate-100 dark:bg-slate-700',
  text: 'text-slate-600 dark:text-slate-400',
  label: 'Unknown',
  icon: 'AlertCircle',
};

interface TaskHeaderProps {
  task: CodeTask;
  workerStatusTag: WorkerStatusTag | null;
}

export function TaskHeader({ task, workerStatusTag }: TaskHeaderProps): React.JSX.Element {
  // Runtime guard: Firestore data may contain status values outside the CodeTaskStatus union
  const status = (STATUS_MAP[task.status] as StatusConfig | undefined) ?? { ...FALLBACK_STATUS, label: task.status };
  const StatusIcon = ICON_MAP[status.icon];

  // Compute execution memory chip text based on status and candidates
  const getExecutionMemoryChip = (ctx: typeof task.executionMemoryContext): string | null => {
    if (ctx === undefined) return null;
    if (ctx.status === 'matched' || ctx.status === 'none') {
      const candidates = ctx.topCandidates ?? [];
      const injected = candidates.filter((c) => c.passedThreshold).length;
      return candidates.length > 0
        ? `Memory: ${String(injected)} injected, ${String(candidates.length)} shown`
        : 'Memory: none';
    }
    return 'Memory: error';
  };
  const executionMemoryChip = getExecutionMemoryChip(task.executionMemoryContext);

  const executionMemoryTooltip =
    task.executionMemoryContext?.status === 'error'
      ? [task.executionMemoryContext.errorCode, task.executionMemoryContext.errorMessage]
          .filter(Boolean)
          .join(' — ') || undefined
      : undefined;

  const prUrl = getTaskMergeUrl(task);
  const callbackFailureText = task.callbackState?.lastFailure !== undefined
    ? `Callback failed: ${task.callbackState.lastFailure.endpoint} ${task.callbackState.lastFailure.status !== undefined ? String(task.callbackState.lastFailure.status) : ''}`.trim()
    : null;

  return (
    <div className="mb-6">
      <div className="min-h-[2.5rem] mt-1 flex flex-wrap items-center gap-2">
        {task.linearIssueId !== undefined ? (
          task.linearIssue?.url !== undefined ? (
            <a
              href={task.linearIssue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {task.linearIssue.identifier}
            </a>
          ) : (
            <span className="text-lg font-medium text-blue-600 dark:text-blue-400">
              {task.linearIssue?.identifier ?? task.linearIssueId}
            </span>
          )
        ) : null}
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {task.linearIssue?.title ?? 'Code Task'}
        </h2>
        {task.status !== 'queued' ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${status.bg} ${status.text}`}>
            <StatusIcon className={`h-4 w-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
            {status.label}
          </span>
        ) : null}
        {executionMemoryChip !== null && task.executionMemoryContext !== undefined ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${EXECUTION_MEMORY_STATUS_STYLES[task.executionMemoryContext.status]}`}
            title={executionMemoryTooltip}
          >
            {executionMemoryChip}
          </span>
        ) : null}
        {task.executionMemoryPostRun?.status === 'error' ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${EXECUTION_MEMORY_STATUS_STYLES.error}`}
            title={task.executionMemoryPostRun.errorMessage}
          >
            Post-run: error
          </span>
        ) : null}
      </div>

      <div className="min-h-[1.75rem] mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
        <span>Created: {formatDateTime(task.createdAt)}</span>
        {!isActiveStatus(task.status) ? (
          <span>Updated: {formatRelative(task.updatedAt)}</span>
        ) : null}
        {task.agentType === 'planning' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            Planning
          </span>
        ) : task.agentType === 'execution' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            Execution
          </span>
        ) : task.agentType === 'remediation' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            Remediation
          </span>
        ) : null}
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
          {task.workerType}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${workerStatusTag !== null ? WORKER_STATUS_STYLES[workerStatusTag] : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
          {task.workerLocation}
        </span>
        {task.timeoutHours !== undefined ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Custom timeout: {String(task.timeoutHours)}h
          </span>
        ) : null}
        {task.callbackState !== undefined ? (
          <span
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            title={task.callbackState.callbackBaseUrl}
          >
            Callback: {task.callbackState.owner}
          </span>
        ) : null}
        {callbackFailureText !== null && task.callbackState?.lastFailure !== undefined ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
            title={`${task.callbackState.lastFailure.message} (${formatDateTime(task.callbackState.lastFailure.occurredAt)})`}
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {callbackFailureText}
          </span>
        ) : null}
        {task.linearIssue?.state !== undefined ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            LINEAR_STATE_STYLES[task.linearIssue.state.type] ?? DEFAULT_STATE_STYLE
          }`}>
            {task.linearIssue.state.name}
          </span>
        ) : null}
        {task.linearIssue?.labels !== undefined && task.linearIssue.labels.length > 0 ? (
          task.linearIssue.labels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            >
              {label.name}
            </span>
          ))
        ) : null}
        {task.linearIssue?.assignee !== undefined && task.linearIssue.assignee !== null ? (
          <span className="text-xs text-green-600 dark:text-green-400">
            {task.linearIssue.assignee.name}
          </span>
        ) : null}
        {task.linearIssue !== undefined && task.linearIssue.commentCount > 0 ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {String(task.linearIssue.commentCount)} comments
          </span>
        ) : null}

        {task.linearIssue?.url !== undefined ? (
          <a
            href={task.linearIssue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/80"
          >
            {task.linearIssue.identifier}
          </a>
        ) : null}
        {prUrl !== undefined ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80"
          >
            PR #{task.prNumber ?? /\/pull\/(\d+)/.exec(prUrl)?.[1] ?? ''}
          </a>
        ) : null}
      </div>
    </div>
  );
}
