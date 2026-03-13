import { memo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type { GitHubEventLogListRow } from '@/hooks';
import { formatTimeOnly } from '@/utils/dateFormat';

export interface GitHubEventLogRowProps {
  row: GitHubEventLogListRow;
  expanded: boolean;
  onToggle: (id: string) => void;
}

// --- Helpers ---

function formatEventLabel(row: GitHubEventLogListRow): string {
  const base = row.githubEventName;
  if (row.action === null || row.action === 'unknown') {
    return base;
  }
  return `${base}.${row.action}`;
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
  const name = row.githubEventName;
  if (name === 'pull_request') {
    return 'bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:ring-indigo-800';
  }
  if (name === 'issue_comment' || name === 'pull_request_review_comment') {
    return 'bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:ring-orange-800';
  }
  if (name === 'pull_request_review') {
    return 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:ring-rose-800';
  }
  if (name === 'push') {
    return 'bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:ring-teal-800';
  }
  if (name === 'check_run' || name === 'check_suite') {
    return 'bg-cyan-100 text-cyan-700 ring-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:ring-cyan-800';
  }
  if (name === 'workflow_run' || name === 'workflow_job') {
    return 'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:ring-violet-800';
  }
  if (name === 'create' || name === 'delete') {
    return 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800';
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

function DetailPair({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="inline-flex gap-1">
      <span className="text-slate-400 dark:text-slate-500">{label}:</span>
      <span className="text-slate-700 dark:text-slate-300">{value}</span>
    </span>
  );
}

function DetailSection({ row }: { row: GitHubEventLogListRow }): React.JSX.Element {
  return (
    <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <DetailPair label="Decision" value={row.decisionOutcome ?? 'pending'} />
        <DetailPair label="Decided by" value={row.decidedBy ?? 'awaiting evaluator'} />
        <DetailPair label="Dispatch" value={row.dispatchAction ?? 'none'} />
        <DetailPair label="Reviews" value={row.reviewTypes.length > 0 ? row.reviewTypes.join(', ') : 'none'} />
        <DetailPair label="Latency" value={row.decisionLatencyMs !== null ? `${String(row.decisionLatencyMs)}ms` : 'n/a'} />
        <DetailPair label="ID" value={row.deliveryId ?? row.id} />
        {row.taskId !== null ? <DetailPair label="Task" value={row.taskId} /> : null}
        {row.workerType !== null ? <DetailPair label="Worker" value={row.workerType} /> : null}
      </div>
      {row.reason !== null ? (
        <div className="mt-1 text-slate-500 dark:text-slate-400">
          Reason: {row.reason}
        </div>
      ) : null}
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
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
      >
        <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">
          {formatTimeOnly(row.updatedAt)}
        </span>

        <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] ring-1 ${eventClasses(row)}`}>
          {formatEventLabel(row)}
        </span>

        {row.pullRequestNumber !== null ? (
          <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-slate-600">
            #{String(row.pullRequestNumber)}
          </span>
        ) : null}

        {row.isHydrating ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800">
            <Loader2 className="h-3 w-3 animate-spin" />
            hydrating
          </span>
        ) : null}

        <span className="min-w-0 shrink truncate text-xs text-slate-600 dark:text-slate-400">
          {row.repository ?? 'unknown repository'}
        </span>

        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-500">
          @{row.senderLogin ?? 'system'}
        </span>

        <span className={`ml-auto inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ${decisionClasses(row)}`}>
          {formatDecisionSummary(row)}
        </span>

        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform" />
        )}
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
