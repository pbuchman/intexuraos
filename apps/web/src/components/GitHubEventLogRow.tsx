import { memo } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldCheck,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { GitHubEventLogListRow } from '@/hooks';

export interface GitHubEventLogRowProps {
  row: GitHubEventLogListRow;
  expanded: boolean;
  onToggle: (id: string) => void;
}

// --- Helpers ---

function formatEventLabel(row: GitHubEventLogListRow): string {
  if (row.action === null) {
    return row.eventType;
  }
  return `${row.eventType}.${row.action}`;
}

function formatDecisionSummary(row: GitHubEventLogListRow): string {
  if (row.dispatchAction === 'create_review_task' && row.reviewTypes.length > 0) {
    return `requested_review(${row.reviewTypes.join(', ')})`;
  }
  if (row.dispatchAction !== null) {
    return row.dispatchAction;
  }
  if (row.decisionOutcome !== null) {
    return row.decisionOutcome;
  }
  return 'pending';
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function decisionClasses(row: GitHubEventLogListRow): string {
  if (row.decisionState === 'pending') {
    return 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800';
  }
  if (row.decisionOutcome === 'request_review') {
    return 'bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:ring-sky-800';
  }
  if (row.decisionOutcome === 'dispatch') {
    return 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-800';
  }
  return 'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600';
}

function eventClasses(row: GitHubEventLogListRow): string {
  if (row.eventType === 'pull_request') {
    return 'bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:ring-indigo-800';
  }
  if (row.eventType === 'issue_comment' || row.eventType === 'pull_request_review_comment') {
    return 'bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:ring-orange-800';
  }
  if (row.eventType === 'pull_request_review') {
    return 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:ring-rose-800';
  }
  if (row.eventType === 'push') {
    return 'bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:ring-teal-800';
  }
  return 'bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600';
}

// --- Left border accent ---

function getAccentShadow(row: GitHubEventLogListRow): string {
  if (row.decisionState === 'pending') return 'shadow-[inset_3px_0_0_theme(colors.amber.500)]';
  if (row.decisionOutcome === 'request_review') return 'shadow-[inset_3px_0_0_theme(colors.sky.500)]';
  if (row.decisionOutcome === 'dispatch') return 'shadow-[inset_3px_0_0_theme(colors.emerald.500)]';
  return '';
}

// --- Expanded detail ---

function DetailSection({ row }: { row: GitHubEventLogListRow }): React.JSX.Element {
  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <DetailCard label="Decision">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {row.decisionOutcome ?? 'pending'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {row.decidedBy ?? 'awaiting evaluator'}
          </div>
        </DetailCard>

        <DetailCard label="Dispatch">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {row.dispatchAction ?? 'none'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {row.taskId ?? 'no task'}
          </div>
        </DetailCard>

        <DetailCard label="Reviews">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {row.reviewTypes.length > 0 ? row.reviewTypes.join(', ') : 'none'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {row.workerType ?? 'worker unset'}
          </div>
        </DetailCard>

        <DetailCard label="Latency">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {row.decisionLatencyMs !== null ? `${String(row.decisionLatencyMs)} ms` : 'n/a'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {row.deliveryId ?? row.id}
          </div>
        </DetailCard>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
          <ShieldCheck className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          Detail
        </div>
        <div className="text-slate-600 dark:text-slate-300">
          {row.reason ?? 'No explicit reason recorded yet.'}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Bot className="h-3.5 w-3.5" />
            {row.senderLogin ?? 'system'}
          </span>
          {row.normalizedEventId !== null ? (
            <span className="inline-flex items-center gap-1">
              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
              {row.normalizedEventId}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailCard({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

// --- Main component ---

function GitHubEventLogRowComponent({
  row,
  expanded,
  onToggle,
}: GitHubEventLogRowProps): React.JSX.Element {
  return (
    <div
      className={`group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(row)}`}
    >
      {/* Collapsed row */}
      <button
        type="button"
        onClick={(): void => { onToggle(row.id); }}
        className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 sm:grid-cols-[minmax(0,2.5fr)_minmax(0,1.8fr)_auto]"
      >
        {/* Event column */}
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${eventClasses(row)}`}>
              {formatEventLabel(row)}
            </span>
            {row.pullRequestNumber !== null ? (
              <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-slate-600">
                #{String(row.pullRequestNumber)}
              </span>
            ) : null}
            {row.isHydrating ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800">
                <Loader2 className="h-3 w-3 animate-spin" />
                hydrating
              </span>
            ) : null}
          </div>
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {row.repository ?? 'unknown repository'}
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
            {row.reason ?? 'Decision pending'}
          </div>
        </div>

        {/* Decision column */}
        <div className="flex min-w-0 flex-col justify-center gap-2 sm:items-start">
          <span className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${decisionClasses(row)}`}>
            {formatDecisionSummary(row)}
          </span>
          <div className="truncate text-sm text-slate-600 dark:text-slate-400">
            {row.senderLogin ?? 'system'}
          </div>
        </div>

        {/* Time + chevron column */}
        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {formatTimestamp(row.updatedAt)}
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400 transition-transform" />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded ? <DetailSection row={row} /> : null}
    </div>
  );
}

export const GitHubEventLogRow = memo(
  GitHubEventLogRowComponent,
  (prevProps, nextProps) => prevProps.row === nextProps.row && prevProps.expanded === nextProps.expanded,
);
