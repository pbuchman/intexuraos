import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Play, RotateCcw, ExternalLink, Check, X, Loader2, Clock, ScrollText, Trash2, GitMerge, Archive } from 'lucide-react';
import type { ActioningType, IssueGroup, StepState } from '@/types/issueGroups';
import { formatRelative } from '@/utils/dateFormat';
import { IssueTimeline } from '@/components/code-tasks/IssueTimeline';

interface IssueGroupRowProps {
  group: IssueGroup;
  timeTick: number;
  onAction: (taskId: string, action: 'delete' | 'retry' | 'implement' | 'archive') => void;
  onArchiveGroup: (taskIds: string[]) => void;
  onDeleteGroup: (taskIds: string[]) => void;
  onOpenLogs: (taskId: string) => void;
  actioningTaskId?: string | null;
  actioningType?: ActioningType | undefined;
  isSelected?: boolean;
  isSelectable?: boolean;
  isBatchActioning?: boolean;
  onToggleSelection?: ((groupKey: string) => void) | undefined;
  groupKey?: string;
}

// --- Left border accent color ---

function getAccentShadow(status: IssueGroup['aggregateStatus']): string {
  if (status === 'needs-action') return 'shadow-[inset_3px_0_0_theme(colors.green.500)]';
  if (status === 'failed') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  if (status === 'active') return 'shadow-[inset_3px_0_0_theme(colors.blue.500)]';
  return '';
}

function getActionAccentShadow(actionType: ActioningType | undefined): string | null {
  if (actionType === 'archive') return 'shadow-[inset_3px_0_0_theme(colors.amber.500)]';
  if (actionType === 'delete') return 'shadow-[inset_3px_0_0_theme(colors.red.500)]';
  return null;
}

function getRemovalStateClasses(actionType: ActioningType | undefined): string {
  if (actionType === 'archive') return 'pointer-events-none shimmer-amber bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800';
  if (actionType === 'delete') return 'pointer-events-none shimmer-red bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800';
  return '';
}

function ActionStateTag({ actionType }: { actionType: ActioningType | undefined }): React.JSX.Element | null {
  if (actionType === 'archive') {
    return <span className="ml-1.5 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Archiving…</span>;
  }
  if (actionType === 'delete') {
    return <span className="ml-1.5 inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">Deleting…</span>;
  }
  return null;
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
  if (state === 'dispatched') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-500/20 text-slate-400">
        <Clock className="h-3 w-3" />
      </span>
    );
  }
  if (state === 'queued') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
        <Clock className="h-3 w-3" />
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
  // waiting
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-500/20 text-slate-400">
      <span className="h-2 w-2 rounded-full bg-slate-400" />
    </span>
  );
}

const compactNames: Record<string, string> = {
  Planning: 'Plan',
  Execution: 'Exec',
  Review: 'Rev',
  'PR Task': 'PR',
};

function stepLabel(name: string, state: StepState, compact?: boolean): string {
  if (compact === true) {
    const short = compactNames[name] ?? name.slice(0, 4);
    return short;
  }
  if (state === 'completed') return name;
  if (state === 'running') return `${name}...`;
  if (state === 'dispatched') return `${name} (dispatched)`;
  if (state === 'queued') return `${name} (queued)`;
  if (state === 'failed') return `${name} Failed`;
  return name;
}

const OUTPUT_CHIP = 'min-w-[4.5rem] h-[26px] justify-center';

type WaveLoaderVariant = 'default' | 'archive' | 'delete';

const WAVE_COLORS: Record<WaveLoaderVariant, { border: string; bg: string; trackBg: string; dotClass: string }> = {
  default: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    trackBg: 'bg-blue-500/15',
    dotClass: 'wave-dot',
  },
  archive: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
    trackBg: 'bg-amber-500/15',
    dotClass: 'wave-dot-amber',
  },
  delete: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    trackBg: 'bg-red-500/15',
    dotClass: 'wave-dot-red',
  },
};

function WaveLoader({ compact, variant = 'default' }: { compact?: boolean | undefined; variant?: WaveLoaderVariant | undefined }): React.JSX.Element {
  const px = compact === true ? 'px-2' : 'px-2.5';
  const colors = WAVE_COLORS[variant];
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`${OUTPUT_CHIP} relative inline-flex items-center overflow-hidden rounded-full border ${colors.border} ${colors.bg} ${px} py-1`}
    >
      <span className={`relative h-1 w-full overflow-hidden rounded-full ${colors.trackBg}`}>
        <span className={`${colors.dotClass} absolute top-0 h-full w-[30%] rounded-full`} />
      </span>
    </span>
  );
}

function PipelineConnector(): React.JSX.Element {
  return <span className="mx-1 h-px w-4 flex-shrink-0 bg-slate-500/40" />;
}

interface PipelineStepProps {
  name: string;
  state: StepState;
  compact?: boolean | undefined;
}

function PipelineStep({ name, state, compact }: PipelineStepProps): React.JSX.Element {
  return (
    <span className={compact === true ? 'flex w-14 items-center gap-1' : 'flex items-center gap-1'}>
      <StepDot state={state} />
      <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
        {stepLabel(name, state, compact)}
      </span>
    </span>
  );
}

function PipelineVisualization({ group, compact }: { group: IssueGroup; compact?: boolean }): React.JSX.Element {
  const { pipeline } = group;
  const visibleSteps = pipeline.steps.filter((s) => s.state !== 'actionable');
  if (visibleSteps.length === 0) {
    return <span className="text-xs text-slate-500">--</span>;
  }

  const elements: React.JSX.Element[] = [];

  for (let i = 0; i < visibleSteps.length; i++) {
    const step = visibleSteps[i];
    if (step === undefined) continue;

    if (i > 0) {
      elements.push(
        <PipelineConnector key={`conn-${String(i)}`} />,
      );
    }

    const displayLabel = step.state === 'failed' && step.agentType === 'execution' && pipeline.failedAttempts > 0
      ? `${step.label} (${String(pipeline.failedAttempts)})`
      : step.label;

    elements.push(
      <PipelineStep
        key={step.agentType}
        name={displayLabel}
        state={step.state}
        compact={compact}
      />,
    );
  }

  return (
    <span className="flex items-center">
      {elements}
    </span>
  );
}

// --- Text helpers ---

function summaryOrPrompt(task: { result?: { summary?: string }; sanitizedPrompt: string }): string {
  const summary = task.result?.summary;
  if (summary !== undefined) return summary;
  const words = task.sanitizedPrompt.split(/\s+/);
  return words.length > 100 ? words.slice(0, 100).join(' ') + '...' : task.sanitizedPrompt;
}

function IssueIdentifierLink({
  linearIssue,
  linkClassName,
}: {
  linearIssue: NonNullable<IssueGroup['linearIssue']>;
  linkClassName: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center">
      {linearIssue.parentIdentifier !== null && linearIssue.parentIdentifier !== undefined ? (
        <span className="font-mono text-sm text-slate-400">
          {linearIssue.parentIdentifier}
          <span className="mx-1 text-slate-500">→</span>
        </span>
      ) : null}
      <a
        href={linearIssue.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e): void => { e.stopPropagation(); }}
        className={linkClassName}
      >
        {linearIssue.identifier}
      </a>
    </span>
  );
}

// --- Selection checkbox ---

function SelectionCheckbox({
  isSelected,
  groupKey,
  identifier,
  onToggle,
  extraClass,
}: {
  isSelected: boolean;
  groupKey: string;
  identifier: string;
  onToggle: (key: string) => void;
  extraClass?: string;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      checked={isSelected}
      onChange={(e): void => {
        e.stopPropagation();
        onToggle(groupKey);
      }}
      onClick={(e): void => { e.stopPropagation(); }}
      className={`h-4 w-4 checked:border-amber-600 checked:bg-amber-600 dark:checked:border-amber-500 dark:checked:bg-amber-500${extraClass !== undefined ? ` ${extraClass}` : ''}`}
      aria-label={isSelected ? `Deselect ${identifier} for archive` : `Select ${identifier} for archive`}
    />
  );
}

// --- Main component ---

const IssueGroupRow = memo(function IssueGroupRow({
  group,
  onAction,
  onArchiveGroup,
  onDeleteGroup,
  onOpenLogs,
  actioningTaskId,
  actioningType,
  isSelected = false,
  isSelectable = false,
  isBatchActioning = false,
  onToggleSelection,
  groupKey,
}: IssueGroupRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const { latestTask, pipeline, aggregateStatus } = group;
  const actionableStep = pipeline.steps.find((s) => s.state === 'actionable');
  const hasMergeAction = actionableStep?.agentType === 'merge';
  const hasImplementAction = actionableStep !== undefined && !hasMergeAction;
  const isActioning = actioningTaskId !== null && actioningTaskId !== undefined && (actioningTaskId === latestTask.id || group.tasks.some((t) => t.id === actioningTaskId));
  const effectiveActionType: ActioningType | undefined = isBatchActioning ? 'archive' : isActioning ? (actioningType ?? null) : undefined;
  const waveVariant: WaveLoaderVariant = effectiveActionType === 'archive' ? 'archive' : effectiveActionType === 'delete' ? 'delete' : 'default';
  const actionAccent = getActionAccentShadow(effectiveActionType);
  const isBeingRemoved = effectiveActionType === 'archive' || effectiveActionType === 'delete';

  function renderActionButton(compact: boolean): React.JSX.Element | null {
    const px = compact ? 'px-2' : 'px-2.5';
    if (isActioning || isBatchActioning) return <WaveLoader compact={compact} variant={waveVariant} />;
    if (hasMergeAction && pipeline.pr !== null) {
      return (
        <a
          href={pipeline.pr.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e): void => { e.stopPropagation(); }}
          className={`${OUTPUT_CHIP} inline-flex items-center gap-1 rounded-full bg-purple-600 ${px} py-1 text-xs font-medium text-white transition-colors hover:bg-purple-500`}
        >
          <GitMerge className="h-3 w-3" />
          Merge
        </a>
      );
    }
    if (hasImplementAction) {
      return (
        <button
          onClick={(e): void => {
            e.stopPropagation();
            onAction(latestTask.id, 'implement');
          }}
          className={`${OUTPUT_CHIP} inline-flex items-center gap-1 rounded-full bg-green-600 ${px} py-1 text-xs font-medium text-white transition-colors hover:bg-green-500`}
        >
          <Play className="h-3 w-3" />
          Code
        </button>
      );
    }
    if (pipeline.pr !== null) {
      return (
        <a
          href={pipeline.pr.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e): void => { e.stopPropagation(); }}
          className={`${OUTPUT_CHIP} inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 ${px} py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400`}
        >
          <ExternalLink className="h-3 w-3" />
          #{pipeline.pr.number}
        </a>
      );
    }
    if (aggregateStatus === 'failed') {
      return (
        <button
          onClick={(e): void => {
            e.stopPropagation();
            onAction(latestTask.id, 'retry');
          }}
          className={`${OUTPUT_CHIP} inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300`}
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
      );
    }
    if (aggregateStatus === 'active') return <WaveLoader compact={compact} />;
    return null;
  }
  const createdRelative = formatRelative(latestTask.createdAt);

  const handleRowClick = (): void => {
    setExpanded((prev) => !prev);
  };

  return (
    <div>
      {/* Collapsed row */}
      <div
        className={`group relative cursor-pointer rounded-lg border px-4 py-3 text-sm transition-all duration-300 ${isBeingRemoved ? getRemovalStateClasses(effectiveActionType) : 'border-slate-200 bg-white hover:shadow-md dark:border-slate-700 dark:bg-slate-800'} ${actionAccent ?? getAccentShadow(aggregateStatus)}`}
        onClick={handleRowClick}
      >
        <div className="hidden grid-cols-[28px_1fr_1fr_140px_120px_36px] items-center gap-2 lg:grid">
          {/* Checkbox column */}
          <div className="flex items-center justify-center">
            {isSelectable && onToggleSelection !== undefined && groupKey !== undefined ? (
              <SelectionCheckbox
                isSelected={isSelected}
                groupKey={groupKey}
                identifier={group.linearIssue?.identifier ?? 'issue'}
                onToggle={onToggleSelection}
              />
            ) : null}
          </div>
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
                  <span className="inline-flex items-center">
                    <IssueIdentifierLink
                      linearIssue={group.linearIssue}
                      linkClassName="font-mono text-sm text-blue-500 hover:text-blue-400 hover:underline"
                    />
                    <ActionStateTag actionType={effectiveActionType} />
                  </span>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {group.linearIssue.title}
                  </p>
                </>
              ) : (
                <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                  {summaryOrPrompt(latestTask)}
                  <ActionStateTag actionType={effectiveActionType} />
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
              <span className="text-slate-500 dark:text-slate-600">Created</span>{' '}
              {createdRelative}
            </p>
            <p className="text-slate-400 dark:text-slate-500">
              <span className="text-slate-500 dark:text-slate-600">Dispatched</span>{' '}
              {group.mostRecentDispatchedAt !== undefined ? formatRelative(group.mostRecentDispatchedAt) : 'Pending'}
            </p>
          </div>

          {/* Output column */}
          <div className="flex items-center justify-end gap-2">
            {renderActionButton(false)}
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
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowArchiveConfirm(true);
              }}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-amber-500/10 hover:text-amber-500 dark:hover:bg-amber-500/20 dark:hover:text-amber-400"
              title="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Transcript column */}
          <div className="flex items-center justify-end">
            <button
              onClick={(e): void => {
                e.stopPropagation();
                onOpenLogs(latestTask.id);
              }}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title="Preview logs"
              aria-label={`Preview logs for ${latestTask.id}`}
            >
              <ScrollText className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile layout (< lg) */}
        <div className="flex flex-col gap-2 lg:hidden">
          <div className="flex items-center gap-2">
            {isSelectable && onToggleSelection !== undefined && groupKey !== undefined ? (
              <SelectionCheckbox
                isSelected={isSelected}
                groupKey={groupKey}
                identifier={group.linearIssue?.identifier ?? 'issue'}
                onToggle={onToggleSelection}
                extraClass="flex-shrink-0"
              />
            ) : null}
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
                <span className="text-sm">
                  <IssueIdentifierLink
                    linearIssue={group.linearIssue}
                    linkClassName="font-mono text-blue-500 hover:text-blue-400 hover:underline"
                  />
                  <ActionStateTag actionType={effectiveActionType} />
                  <span className="text-slate-400"> · </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{createdRelative}</span>
                </span>
              ) : (
                <span className="text-sm">
                  <span className="truncate text-slate-600 dark:text-slate-400">
                    {summaryOrPrompt(latestTask)}
                  </span>
                  <ActionStateTag actionType={effectiveActionType} />
                  <span className="text-slate-400"> · </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{createdRelative}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  onOpenLogs(latestTask.id);
                }}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                title="Preview logs"
                aria-label={`Preview logs for ${latestTask.id}`}
              >
                <ScrollText className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  setShowArchiveConfirm(true);
                }}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-amber-500/10 hover:text-amber-500 dark:hover:bg-amber-500/20 dark:hover:text-amber-400"
                title="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
              <div className="w-16 flex items-center justify-center">
                {renderActionButton(true)}
              </div>
            </div>
          </div>
          <p className="truncate pl-6 text-xs text-slate-500 dark:text-slate-400">
            {group.linearIssue !== undefined
              ? group.linearIssue.title
              : summaryOrPrompt(latestTask)}
          </p>
          <div className="flex items-center gap-3 pl-6 text-xs text-slate-500 dark:text-slate-400">
            <PipelineVisualization group={group} compact />
          </div>
        </div>

        {/* Delete confirmation overlay */}
        {showDeleteConfirm ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
            onClick={(e): void => { e.stopPropagation(); }}
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {group.tasks.length > 1
                  ? `Delete all ${String(group.tasks.length)} tasks for ${group.linearIssue?.identifier ?? 'this group'}?`
                  : 'Delete task?'}
              </p>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  setShowDeleteConfirm(false);
                }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  onDeleteGroup(group.tasks.map((t) => t.id));
                  setShowDeleteConfirm(false);
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}

        {/* Archive confirmation overlay */}
        {showArchiveConfirm ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
            onClick={(e): void => { e.stopPropagation(); }}
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {group.tasks.length > 1
                  ? `Archive all ${String(group.tasks.length)} tasks for ${group.linearIssue?.identifier ?? 'this group'}?`
                  : 'Archive task?'}
              </p>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  setShowArchiveConfirm(false);
                }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={(e): void => {
                  e.stopPropagation();
                  onArchiveGroup(group.tasks.map((t) => t.id));
                  setShowArchiveConfirm(false);
                }}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500"
              >
                Archive
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
  prev.timeTick === next.timeTick &&
  prev.group.linearIssueId === next.group.linearIssueId &&
  prev.group.linearIssue?.identifier === next.group.linearIssue?.identifier &&
  prev.group.linearIssue?.parentIdentifier === next.group.linearIssue?.parentIdentifier &&
  prev.group.linearIssue?.title === next.group.linearIssue?.title &&
  prev.group.linearIssue?.url === next.group.linearIssue?.url &&
  prev.group.aggregateStatus === next.group.aggregateStatus &&
  prev.group.latestTask.updatedAt === next.group.latestTask.updatedAt &&
  prev.group.tasks.length === next.group.tasks.length &&
  prev.group.pipeline.steps.length === next.group.pipeline.steps.length &&
  prev.group.pipeline.steps.every((s, i) => {
    const n = next.group.pipeline.steps[i];
    return s.state === n?.state && s.agentType === n.agentType;
  }) &&
  prev.group.pipeline.pr?.number === next.group.pipeline.pr?.number &&
  prev.group.pipeline.failedAttempts === next.group.pipeline.failedAttempts &&
  prev.group.mostRecentDispatchedAt === next.group.mostRecentDispatchedAt &&
  prev.actioningTaskId === next.actioningTaskId &&
  prev.actioningType === next.actioningType &&
  prev.isSelected === next.isSelected &&
  prev.isSelectable === next.isSelectable &&
  prev.isBatchActioning === next.isBatchActioning &&
  prev.groupKey === next.groupKey &&
  prev.onDeleteGroup === next.onDeleteGroup &&
  prev.onAction === next.onAction &&
  prev.onArchiveGroup === next.onArchiveGroup &&
  prev.onOpenLogs === next.onOpenLogs &&
  prev.onToggleSelection === next.onToggleSelection,
);

export { IssueGroupRow };
export type { IssueGroupRowProps };
