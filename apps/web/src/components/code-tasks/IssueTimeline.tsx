import { ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CodeTask } from '@/types';
import {
  formatDispatchDiagnosticText,
  formatTaskDuration,
  getDispatchReasonLabel,
  getDispatchRemediationText,
} from '@/utils/taskLifecycle';
import { TaskLifecycleTime } from './TaskLifecycleTime.js';

interface IssueTimelineProps {
  tasks: CodeTask[];
  onCollapse: () => void;
}

// --- Dot color ---

type DotColor = 'green' | 'red' | 'blue' | 'violet' | 'slate' | 'amber';

function getDotColor(task: CodeTask): DotColor {
  const { status, agentType } = task;

  if (status === 'archived' || status === 'cancelled') return 'slate';
  if (status === 'queued') return 'amber';
  if (status === 'dispatched') return 'slate';
  if (status === 'running') return 'blue';
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
  amber: 'bg-amber-500',
};

// --- Action label ---

function getActionLabel(task: CodeTask): string {
  const { agentType, status } = task;

  if (agentType === 'execution') {
    if (status === 'implemented') return 'Execution completed';
    if (status === 'failed') return 'Execution failed';
    if (status === 'running') return 'Execution running';
    if (status === 'dispatched') return 'Execution started';
    if (status === 'queued') return 'Execution queued';
  }

  if (agentType === 'planning') {
    if (status === 'planned') return 'Planning completed';
    if (status === 'failed') return 'Planning failed';
    if (status === 'running') return 'Planning running';
    if (status === 'dispatched') return 'Planning started';
    if (status === 'queued') return 'Planning queued';
  }

  if (agentType === 'pull_request') {
    if (status === 'implemented') return 'PR Task completed';
    if (status === 'failed') return 'PR Task failed';
    if (status === 'running') return 'PR Task running';
    if (status === 'dispatched') return 'PR Task started';
    if (status === 'queued') return 'PR Task queued';
  }

  if (agentType === 'review') {
    if (status === 'reviewed') return 'Review completed';
    if (status === 'failed') return 'Review failed';
    if (status === 'running') return 'Review running';
    if (status === 'dispatched') return 'Review started';
    if (status === 'queued') return 'Review queued';
  }

  if (agentType === 'remediation') {
    if (status === 'implemented') return 'Remediation completed';
    if (status === 'failed') return 'Remediation failed';
    if (status === 'running') return 'Remediation running';
    if (status === 'dispatched') return 'Remediation started';
    if (status === 'queued') return 'Remediation queued';
  }

  // Default: capitalize status
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// --- followUpReason chip ---

interface FollowUpChipProps {
  reason: NonNullable<CodeTask['followUpReason']>;
}

function FollowUpChip({ reason }: FollowUpChipProps): React.JSX.Element | null {
  if (reason === 'execution_implement') return null;

  const chipStyles: Record<string, string> = {
    retry: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    pr_comment: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    user_feedback: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
    merge_conflict: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  };

  const labels: Record<string, string> = {
    retry: 'Retry',
    pr_comment: 'PR Comment',
    user_feedback: 'User Feedback',
    merge_conflict: 'Merge Conflict',
  };

  const style = chipStyles[reason] ?? 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400';
  const label = labels[reason] ?? reason;

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${style}`}>
      {label}
    </span>
  );
}

// --- Inline markdown (compact, text-xs) ---

const MARKDOWN_COMPONENTS: import('react-markdown').Components = {
  p: ({ children }) => <span>{children}</span>,
  a: ({ href, children }) => (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </a>
  ),
};

function InlineMarkdown({ text, className }: { text: string; className: string }): React.JSX.Element {
  return (
    <span className={`text-xs ${className} [&>*]:inline`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </span>
  );
}

// --- Detail line ---

function DetailLine({ task }: { task: CodeTask }): React.JSX.Element | null {
  const prUrl = task.result?.prUrl;
  const summary = task.result?.summary;
  const errorMessage = task.error?.message;
  const dispatchStatus = task.dispatchStatus;
  const terminalCause = dispatchStatus?.terminalCause;
  const displayError = errorMessage === undefined
    ? undefined
    : formatDispatchDiagnosticText(errorMessage);
  const displayDispatchMessage = dispatchStatus === undefined
    || dispatchStatus.message === errorMessage
    ? undefined
    : formatDispatchDiagnosticText(dispatchStatus.message);
  const displayDispatchRemediation = dispatchStatus === undefined
    ? undefined
    : getDispatchRemediationText(dispatchStatus.reason, dispatchStatus.remediation);
  const displayTerminalCauseMessage = terminalCause === undefined
    ? undefined
    : formatDispatchDiagnosticText(terminalCause.message);
  const displayTerminalCauseRemediation = terminalCause === undefined
    ? undefined
    : getDispatchRemediationText(terminalCause.reason, terminalCause.remediation);
  const terminalCauseContext = terminalCause !== undefined
    && (
      terminalCause.reason !== dispatchStatus?.reason
      || displayTerminalCauseMessage !== formatDispatchDiagnosticText(dispatchStatus.message)
    )
    ? `Final cause: ${getDispatchReasonLabel(terminalCause.reason)} — ${displayTerminalCauseMessage ?? ''}`
    : undefined;
  const additionalTerminalRemediation = displayTerminalCauseRemediation !== undefined
    && displayTerminalCauseRemediation !== displayDispatchRemediation
    ? displayTerminalCauseRemediation
    : undefined;
  const dispatchReasonClass = dispatchStatus?.terminal === true
    ? 'text-red-700 dark:text-red-300'
    : dispatchStatus?.severity === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-slate-600 dark:text-slate-400';
  const dispatchMessageClass = dispatchStatus?.terminal === true
    ? 'text-red-600 dark:text-red-400'
    : dispatchStatus?.severity === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-slate-600 dark:text-slate-400';

  // Summary is always shown when available
  const summaryBlock = summary !== undefined
    ? <InlineMarkdown text={summary} className="text-slate-600 dark:text-slate-400" />
    : null;

  if (summaryBlock !== null || prUrl !== undefined || displayError !== undefined || dispatchStatus !== undefined) {
    const truncatedError = displayError !== undefined
      ? displayError.length > 100
        ? displayError.slice(0, 100) + '...'
        : displayError
      : undefined;
    return (
      <div className="flex flex-col gap-1">
        {summaryBlock}
        {prUrl !== undefined ? (
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
        >
          <ExternalLink className="h-3 w-3" />
          {prUrl}
        </a>
        ) : null}
        {truncatedError !== undefined ? (
          <span className="text-xs text-red-600 dark:text-red-400">{truncatedError}</span>
        ) : null}
        {dispatchStatus !== undefined ? (
          <span className={`text-xs font-medium ${dispatchReasonClass}`}>
            {getDispatchReasonLabel(dispatchStatus.reason)}
          </span>
        ) : null}
        {displayDispatchMessage !== undefined ? (
          <span className={`text-xs ${dispatchMessageClass}`}>{displayDispatchMessage}</span>
        ) : null}
        {displayDispatchRemediation !== undefined ? (
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {displayDispatchRemediation}
          </span>
        ) : null}
        {terminalCauseContext !== undefined ? (
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {terminalCauseContext}
          </span>
        ) : null}
        {additionalTerminalRemediation !== undefined ? (
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {additionalTerminalRemediation}
          </span>
        ) : null}
      </div>
    );
  }

  const prompt = task.sanitizedPrompt;
  const words = prompt.split(/\s+/);
  const truncated = words.length > 100 ? words.slice(0, 100).join(' ') + '...' : prompt;
  return <InlineMarkdown text={truncated} className="text-slate-500 dark:text-slate-500" />;
}

// --- Timeline item ---

function TimelineItem({ task }: { task: CodeTask }): React.JSX.Element {
  const dotColor = getDotColor(task);
  const label = getActionLabel(task);
  const isArchived = task.status === 'archived';
  const duration = formatTaskDuration(task);

  return (
    <div className="relative flex gap-3 pb-4 pl-6 last:pb-0">
      {/* Dot on the timeline line */}
      <div className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center">
        <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASSES[dotColor]}`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Clickable area: label + chips + timestamp */}
        <a
          href={`/#/code-tasks/${task.id}`}
          className="block cursor-pointer rounded -mx-1 px-1 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
        >
          {/* First line: label + chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-sm font-medium ${
                isArchived
                  ? 'text-slate-400 line-through dark:text-slate-500'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {label}
            </span>

            {/* Model chip */}
            <span className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
              {task.workerType}
            </span>

            {/* Worker location chip */}
            <span className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
              {task.workerLocation}
            </span>

            {/* followUpReason chip */}
            {task.followUpReason !== undefined ? (
              <FollowUpChip reason={task.followUpReason} />
            ) : null}
          </div>

          {/* Second line: timestamp + duration */}
          <p className="mt-0.5 whitespace-normal text-xs text-slate-500">
            <TaskLifecycleTime status={task.status} at={task.statusChangedAt} />
            <span className="mx-1 text-slate-400 dark:text-slate-600">&middot;</span>
            {duration}
          </p>
        </a>

        {/* Third line: detail */}
        <div className="mt-1 block -mx-1 px-1">
          <DetailLine task={task} />
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

function IssueTimeline({ tasks, onCollapse }: IssueTimelineProps): React.JSX.Element {
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      {/* Vertical timeline */}
      <div className="border-l-2 border-slate-300 pl-2 dark:border-zinc-700">
        {tasks.map((task) => (
          <TimelineItem key={task.id} task={task} />
        ))}
      </div>

      {/* Footer */}
      <button
        type="button"
        onClick={onCollapse}
        className="mt-2 w-full text-center text-xs text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-400"
      >
        {String(tasks.length)} tasks{archivedCount > 0 ? <> &middot; {String(archivedCount)} archived</> : null} &middot; click to collapse
      </button>
    </div>
  );
}

export { IssueTimeline };
export type { IssueTimelineProps };
