import { memo } from 'react';
import {
  Bot,
  ChevronDown,
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
    return 'bg-amber-100 text-amber-700 ring-amber-200';
  }
  if (row.decisionOutcome === 'request_review') {
    return 'bg-sky-100 text-sky-700 ring-sky-200';
  }
  if (row.decisionOutcome === 'dispatch') {
    return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
  }
  return 'bg-slate-200 text-slate-700 ring-slate-300';
}

function eventClasses(row: GitHubEventLogListRow): string {
  if (row.eventType === 'pull_request') {
    return 'bg-indigo-100 text-indigo-700 ring-indigo-200';
  }
  if (row.eventType === 'issue_comment' || row.eventType === 'pull_request_review_comment') {
    return 'bg-orange-100 text-orange-700 ring-orange-200';
  }
  if (row.eventType === 'pull_request_review') {
    return 'bg-rose-100 text-rose-700 ring-rose-200';
  }
  if (row.eventType === 'push') {
    return 'bg-teal-100 text-teal-700 ring-teal-200';
  }
  return 'bg-slate-200 text-slate-700 ring-slate-300';
}

function GitHubEventLogRowComponent({
  row,
  expanded,
  onToggle,
}: GitHubEventLogRowProps): React.JSX.Element {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_12px_32px_-22px_rgba(15,23,42,0.45)] ring-1 ring-white">
      <button
        type="button"
        onClick={() => {
          onToggle(row.id);
        }}
        className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:grid-cols-[minmax(0,2.5fr)_minmax(0,1.8fr)_auto]"
      >
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${eventClasses(row)}`}>
              {formatEventLabel(row)}
            </span>
            {row.pullRequestNumber !== null ? (
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                #{String(row.pullRequestNumber)}
              </span>
            ) : null}
            {row.isHydrating ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                <Loader2 className="h-3 w-3 animate-spin" />
                hydrating
              </span>
            ) : null}
          </div>

          <div className="truncate text-sm font-semibold text-slate-900">
            {row.repository ?? 'unknown repository'}
          </div>
          <div className="mt-1 truncate text-sm text-slate-500">
            {row.reason ?? 'Decision pending'}
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-2 sm:items-start">
          <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${decisionClasses(row)}`}>
            {formatDecisionSummary(row)}
          </span>
          <div className="truncate text-sm text-slate-600">
            {row.senderLogin ?? 'system'}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
            {formatTimestamp(row.updatedAt)}
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-200/80 bg-slate-50/80 px-4 py-4">
          <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-white px-3 py-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Decision</div>
              <div className="font-medium text-slate-900">{row.decisionOutcome ?? 'pending'}</div>
              <div className="mt-1 text-xs text-slate-500">{row.decidedBy ?? 'awaiting evaluator'}</div>
            </div>

            <div className="rounded-2xl bg-white px-3 py-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Dispatch</div>
              <div className="font-medium text-slate-900">{row.dispatchAction ?? 'none'}</div>
              <div className="mt-1 text-xs text-slate-500">{row.taskId ?? 'no task'}</div>
            </div>

            <div className="rounded-2xl bg-white px-3 py-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Reviews</div>
              <div className="font-medium text-slate-900">
                {row.reviewTypes.length > 0 ? row.reviewTypes.join(', ') : 'none'}
              </div>
              <div className="mt-1 text-xs text-slate-500">{row.workerType ?? 'worker unset'}</div>
            </div>

            <div className="rounded-2xl bg-white px-3 py-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Latency</div>
              <div className="font-medium text-slate-900">
                {row.decisionLatencyMs !== null ? `${String(row.decisionLatencyMs)} ms` : 'n/a'}
              </div>
              <div className="mt-1 text-xs text-slate-500">{row.deliveryId ?? row.id}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 rounded-2xl bg-white px-3 py-3 text-sm text-slate-600">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <ShieldCheck className="h-4 w-4 text-slate-500" />
              Detail
            </div>
            <div>{row.reason ?? 'No explicit reason recorded yet.'}</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
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
      ) : null}
    </article>
  );
}

export const GitHubEventLogRow = memo(
  GitHubEventLogRowComponent,
  (prevProps, nextProps) => prevProps.row === nextProps.row && prevProps.expanded === nextProps.expanded,
);
