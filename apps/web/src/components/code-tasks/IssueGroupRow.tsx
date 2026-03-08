import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Play, RotateCcw, ExternalLink, Check, X, Loader2, Trash2 } from 'lucide-react';
import type { IssueGroup, StepState } from '@/utils/issueGroups';
import { formatElapsedTime, formatRelative } from '@/utils/dateFormat';
import { IssueTimeline } from '@/components/code-tasks/IssueTimeline';

interface IssueGroupRowProps {
  group: IssueGroup;
  onAction: (taskId: string, action: 'delete' | 'retry' | 'implement') => void;
}

// --- Left border accent color ---

function getAccentShadow(status: IssueGroup['aggregateStatus']): string {
  if (status === 'needs-action') return 'shadow-[inset_3px_0_0_theme(colors.green.500)]';
  if (status === 'failed') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  if (status === 'active') return 'shadow-[inset_3px_0_0_theme(colors.blue.500)]';
  return '';
}

// --- Pipeline step rendering ---

interface StepDotProps {
  state: StepState;
}

function StepDot({ state }: StepDotProps): React.JSX.Element {
  if (state === 'completed') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === 'running') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-500">
        <X className="h-3 w-3" />
      </span>
    );
  }
  if (state === 'actionable') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 text-green-500">
        <Play className="h-3 w-3" />
      </span>
    );
  }
  // waiting
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-500/20 text-slate-400">
      <span className="h-2 w-2 rounded-full bg-slate-400" />
    </span>
  );
}

function stepLabel(name: string, state: StepState): string {
  if (state === 'completed') return name;
  if (state === 'running') return `${name}...`;
  if (state === 'failed') return `${name} Failed`;
  if (state === 'actionable') return 'Implement';
  return name;
}

function PipelineConnector(): React.JSX.Element {
  return <span className="mx-1 h-px w-4 flex-shrink-0 bg-slate-500/40" />;
}

interface PipelineStepProps {
  name: string;
  state: StepState;
}

function PipelineStep({ name, state }: PipelineStepProps): React.JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <StepDot state={state} />
      <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
        {stepLabel(name, state)}
      </span>
    </span>
  );
}

function PipelineVisualization({ group }: { group: IssueGroup }): React.JSX.Element {
  const { pipeline } = group;
  const steps: React.JSX.Element[] = [];

  // Planning step
  if (pipeline.planning !== null) {
    steps.push(<PipelineStep key="planning" name="Planning" state={pipeline.planning} />);
  }

  // Execution step
  if (pipeline.execution !== null) {
    if (steps.length > 0) {
      steps.push(<PipelineConnector key="conn-exec" />);
    }
    const execLabel = pipeline.execution === 'failed' && pipeline.failedAttempts > 0
      ? `Execution (${String(pipeline.failedAttempts)})`
      : 'Execution';
    steps.push(
      <PipelineStep
        key="execution"
        name={execLabel}
        state={pipeline.execution}
      />,
    );
  }

  // PR step
  if (pipeline.pr !== null) {
    if (steps.length > 0) {
      steps.push(<PipelineConnector key="conn-pr" />);
    }
    steps.push(
      <span key="pr" className="flex items-center gap-1">
        <StepDot state="completed" />
        <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
          PR #{pipeline.pr.number}
        </span>
      </span>,
    );
  }

  if (steps.length === 0) {
    return <span className="text-xs text-slate-500">--</span>;
  }

  return <span className="flex items-center">{steps}</span>;
}

// --- Text helpers ---

function summaryOrPrompt(task: { result?: { summary?: string }; sanitizedPrompt: string }): string {
  const summary = task.result?.summary;
  if (summary !== undefined) return summary;
  const words = task.sanitizedPrompt.split(/\s+/);
  return words.length > 100 ? words.slice(0, 100).join(' ') + '...' : task.sanitizedPrompt;
}

// --- Duration calculation ---

function computeDurationSeconds(createdAt: string, updatedAt: string, isActive: boolean): number {
  const start = new Date(createdAt).getTime();
  const end = isActive ? Date.now() : new Date(updatedAt).getTime();
  return Math.floor((end - start) / 1000);
}

// --- Main component ---

const IssueGroupRow = memo(function IssueGroupRow({
  group,
  onAction,
}: IssueGroupRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { latestTask, pipeline, aggregateStatus } = group;
  const isActive = aggregateStatus === 'active';
  const durationSec = computeDurationSeconds(latestTask.createdAt, latestTask.updatedAt, isActive);

  const handleRowClick = (): void => {
    setExpanded((prev) => !prev);
  };

  return (
    <div>
      {/* Collapsed row */}
      <div
        className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(aggregateStatus)}`}
        onClick={handleRowClick}
      >
        <div className="hidden grid-cols-[1fr_1fr_140px_120px] items-center gap-2 lg:grid">
          {/* Issue column */}
          <div className="flex items-center gap-2 overflow-hidden">
            <button
              className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <div className="min-w-0">
              {group.linearIssue !== undefined ? (
                <>
                  <a
                    href={group.linearIssue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e): void => { e.stopPropagation(); }}
                    className="font-mono text-sm text-blue-500 hover:text-blue-400 hover:underline"
                  >
                    {group.linearIssue.identifier}
                  </a>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {group.linearIssue.title}
                  </p>
                </>
              ) : (
                <p className="truncate text-sm text-slate-300 dark:text-slate-400">
                  {summaryOrPrompt(latestTask)}
                </p>
              )}
            </div>
          </div>

          {/* Pipeline column */}
          <div className="overflow-hidden">
            <PipelineVisualization group={group} />
          </div>

          {/* Time column */}
          <div className="text-xs">
            <p className="text-slate-400 dark:text-slate-500">
              {formatRelative(latestTask.updatedAt)}
            </p>
            <p className="text-slate-500 dark:text-slate-600">
              {formatElapsedTime(durationSec)}
            </p>
          </div>

          {/* Output column */}
          <div className="flex items-center justify-end gap-2">
            {pipeline.execution === 'actionable' ? (
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  onAction(latestTask.id, 'implement');
                }}
                className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-green-500"
              >
                <Play className="h-3 w-3" />
                Implement
              </button>
            ) : pipeline.pr !== null ? (
              <a
                href={pipeline.pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e): void => { e.stopPropagation(); }}
                className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20"
              >
                <ExternalLink className="h-3 w-3" />
                PR #{pipeline.pr.number}
              </a>
            ) : aggregateStatus === 'failed' ? (
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  onAction(latestTask.id, 'retry');
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:border-slate-200 hover:text-slate-300 dark:border-slate-600 dark:hover:border-slate-500"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            ) : aggregateStatus === 'active' ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            ) : null}
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile layout (< lg) */}
        <div className="flex flex-col gap-2 lg:hidden">
          <div className="flex items-center gap-2">
            <button
              className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              {group.linearIssue !== undefined ? (
                <a
                  href={group.linearIssue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e): void => { e.stopPropagation(); }}
                  className="font-mono text-sm text-blue-500 hover:text-blue-400 hover:underline"
                >
                  {group.linearIssue.identifier}
                </a>
              ) : (
                <span className="truncate text-sm text-slate-300 dark:text-slate-400">
                  {summaryOrPrompt(latestTask)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {pipeline.execution === 'actionable' ? (
                <button
                  onClick={(e): void => {
                    e.stopPropagation();
                    onAction(latestTask.id, 'implement');
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-500"
                >
                  <Play className="h-3 w-3" />
                  Implement
                </button>
              ) : aggregateStatus === 'active' ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              ) : null}
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 pl-6 text-xs text-slate-500 dark:text-slate-400">
            <PipelineVisualization group={group} />
            <span>{formatRelative(latestTask.updatedAt)}</span>
          </div>
        </div>

        {/* Delete confirmation overlay */}
        {showDeleteConfirm ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-slate-900/80 backdrop-blur-sm"
            onClick={(e): void => { e.stopPropagation(); }}
          >
            <div className="flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-3 shadow-lg">
              <p className="text-sm text-slate-200">
                {group.tasks.length > 1
                  ? `Delete all ${String(group.tasks.length)} tasks for ${group.linearIssue?.identifier ?? 'this group'}?`
                  : 'Delete task?'}
              </p>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  setShowDeleteConfirm(false);
                }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  for (const task of group.tasks) {
                    onAction(task.id, 'delete');
                  }
                  setShowDeleteConfirm(false);
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Expanded timeline */}
      {expanded ? (
        <IssueTimeline
          tasks={group.tasks}
          onCollapse={(): void => { setExpanded(false); }}
        />
      ) : null}
    </div>
  );
}, (prev, next) =>
  prev.group.linearIssueId === next.group.linearIssueId &&
  prev.group.aggregateStatus === next.group.aggregateStatus &&
  prev.group.latestTask.updatedAt === next.group.latestTask.updatedAt &&
  prev.group.tasks.length === next.group.tasks.length &&
  prev.group.pipeline.planning === next.group.pipeline.planning &&
  prev.group.pipeline.execution === next.group.pipeline.execution &&
  prev.group.pipeline.pr?.number === next.group.pipeline.pr?.number &&
  prev.group.pipeline.failedAttempts === next.group.pipeline.failedAttempts &&
  prev.onAction === next.onAction,
);

export { IssueGroupRow };
export type { IssueGroupRowProps };
