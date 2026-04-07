import { memo, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/context';
import { getGitHubEventLogPayload } from '@/services/codeAgentApi';
import type { GitHubEventLogListRow } from '@/hooks';
import { formatTimeOnly } from '@/utils/dateFormat';
import { GITHUB_EVENT_LOG_DESKTOP_GRID } from './githubEventLogTableLayout.js';

export interface GitHubEventLogTableRowProps {
  row: GitHubEventLogListRow;
}

function formatEntityLabel(row: GitHubEventLogListRow): string {
  if (row.pullRequestNumber !== null) {
    return `Pull Request #${String(row.pullRequestNumber)}`;
  }
  if (row.repository !== null) {
    return row.repository;
  }
  return '—';
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}…`;
}

function formatDecisionBadgeLabel(row: GitHubEventLogListRow): string {
  if (row.decisionState === 'pending') {
    return 'Pending';
  }
  if (row.dispatchAction === 'create_review_task' || row.decisionOutcome === 'request_review') {
    return 'Review';
  }
  if (row.decisionOutcome === 'dispatch') {
    return 'Dispatch';
  }
  if (row.decisionOutcome === 'skip') {
    return 'Skip';
  }
  return 'Completed';
}

function formatDecisionDetail(row: GitHubEventLogListRow): string | null {
  if (row.dispatchAction === 'create_review_task' && row.reviewTypes.length > 0) {
    return row.reviewTypes.join(', ');
  }
  return null;
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
  if (row.decisionOutcome === 'skip') {
    return 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-700/50 dark:text-slate-400 dark:ring-slate-600';
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

function getAccentShadow(row: GitHubEventLogListRow): string {
  if (row.decisionState === 'pending') return 'shadow-[inset_3px_0_0_theme(colors.amber.500)]';
  if (row.decisionOutcome === 'request_review') return 'shadow-[inset_3px_0_0_theme(colors.sky.500)]';
  if (row.decisionOutcome === 'dispatch') return 'shadow-[inset_3px_0_0_theme(colors.emerald.500)]';
  return '';
}

function buildEntityUrl(row: GitHubEventLogListRow): string | null {
  if (row.repository === null) {
    return null;
  }
  if (row.pullRequestNumber !== null) {
    return `https://github.com/${row.repository}/pull/${String(row.pullRequestNumber)}`;
  }
  return `https://github.com/${row.repository}`;
}

function GitHubEventLogTableRowComponent({ row }: GitHubEventLogTableRowProps): React.JSX.Element {
  const entityUrl = buildEntityUrl(row);
  const decisionLabel = formatDecisionBadgeLabel(row);
  const decisionDetail = formatDecisionDetail(row);
  const { getAccessToken } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [payload, setPayload] = useState<unknown>(null);
  const [payloadFetched, setPayloadFetched] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  const handleToggle = (): void => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);
    if (willExpand && !payloadFetched && !payloadLoading) {
      setPayloadLoading(true);
      setPayloadError(null);
      void (async (): Promise<void> => {
        try {
          const token = await getAccessToken();
          const result = await getGitHubEventLogPayload(token, row.id);
          setPayload(result.payload);
          setPayloadFetched(true);
        } catch (err) {
          setPayloadError(err instanceof Error ? err.message : 'Failed to load payload');
        } finally {
          setPayloadLoading(false);
        }
      })();
    }
  };

  const chevronButton = (
    <button
      type="button"
      onClick={handleToggle}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-transform hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      aria-label={isExpanded ? 'Collapse payload' : 'Expand payload'}
    >
      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
    </button>
  );

  return (
    <div
      className={`group overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(row)}`}
    >
      {/* Desktop: grid layout */}
      <div className={`hidden items-center gap-2 px-3 py-1.5 xl:grid ${GITHUB_EVENT_LOG_DESKTOP_GRID}`}>
        {chevronButton}

        {/* Time */}
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
          {formatTimeOnly(row.authPassedAt)}
        </span>

        {/* Event */}
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] ring-1 ${eventClasses(row)}`}>
            {row.githubEventName}
          </span>
          {row.isHydrating ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-500" />
          ) : null}
        </div>

        {/* Action */}
        <span className="min-w-0 truncate text-xs text-slate-600 dark:text-slate-400" title={row.action ?? undefined}>
          {row.action ?? '—'}
        </span>

        {/* Decision */}
        <div className="min-w-0">
          <span className={`inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ${decisionClasses(row)}`}>
            {decisionLabel}
          </span>
          {decisionDetail !== null ? (
            <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400" title={decisionDetail}>
              {decisionDetail}
            </div>
          ) : null}
        </div>

        {/* Reason */}
        <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400" title={row.reason ?? undefined}>
          {row.reason ?? '—'}
        </span>

        {/* Entity */}
        {entityUrl !== null ? (
          <a
            href={entityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block min-w-0 truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            {truncateText(formatEntityLabel(row), 30)}
          </a>
        ) : (
          <span className="min-w-0 truncate text-xs text-slate-400">—</span>
        )}
      </div>

      {/* Mobile: compact flex row */}
      <div className="px-3 py-1.5 xl:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {chevronButton}
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {formatTimeOnly(row.authPassedAt)}
          </span>
          <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] ring-1 ${eventClasses(row)}`}>
            {row.githubEventName}
          </span>
          {row.isHydrating ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-500" />
          ) : null}
          <span className={`ml-auto inline-flex max-w-[45%] shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ${decisionClasses(row)}`}>
            {decisionLabel}
          </span>
        </div>
        {decisionDetail !== null ? (
          <div className="pl-7 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
            <div className="truncate" title={decisionDetail}>
              {decisionDetail}
            </div>
          </div>
        ) : null}
      </div>

      {/* Expanded payload section */}
      {isExpanded ? (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          {payloadLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading payload…
            </div>
          ) : payloadError !== null ? (
            <p className="text-sm text-red-600 dark:text-red-400">{payloadError}</p>
          ) : (
            <pre className="max-h-96 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
              <code>{JSON.stringify(payload, null, 2)}</code>
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Reference equality is sufficient: the hook (useGitHubEventLog) always emits
// a new row object when isHydrating transitions, so a changed isHydrating value
// is automatically detected by the row reference check.
export const GitHubEventLogTableRow = memo(
  GitHubEventLogTableRowComponent,
  (prevProps, nextProps) => prevProps.row === nextProps.row,
);
