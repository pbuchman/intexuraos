import { useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Card, Layout, MarkdownContent } from '@/components';
import { useGitHubPREvents, useGitHubPRSummaries } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import type { GitHubPRStatus } from '@/types';

/**
 * Individual event item within a PR group
 */
interface PREventItemProps {
  eventType: string;
  action: string | null;
  senderLogin: string;
  createdAt: string;
  eventUrl: string | null;
  body: string | null;
}

function PREventItem({ eventType, action, senderLogin, createdAt, eventUrl, body }: PREventItemProps): React.JSX.Element {
  const getEventDisplay = (): { icon: string; label: string; color: string } => {
    if (eventType === 'pull_request_review') {
      return {
        icon: '💬',
        label: action === 'submitted' ? 'Review' : action === null ? 'Review' : `Review ${action}`,
        color: 'text-purple-700 dark:text-purple-400',
      };
    }
    if (eventType === 'pull_request_review_comment') {
      return {
        icon: '📝',
        label: 'Inline Comment',
        color: 'text-orange-700 dark:text-orange-400',
      };
    }
    if (eventType === 'issue_comment') {
      return {
        icon: '💭',
        label: 'Comment',
        color: 'text-cyan-700 dark:text-cyan-400',
      };
    }
    if (eventType === 'push') {
      return {
        icon: '📤',
        label: 'Push',
        color: 'text-blue-700 dark:text-blue-400',
      };
    }
    // pull_request
    return {
      icon: '🔀',
      label: action ?? 'PR Event',
      color: 'text-green-700 dark:text-green-400',
    };
  };

  const { icon, label, color } = getEventDisplay();

  const hasBody = body !== null && body !== '';

  return (
    <div className="rounded-md bg-slate-50 text-sm dark:bg-slate-800">
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="text-base" aria-hidden="true">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${color}`}>{label}</span>
            <span className="text-slate-500">by</span>
            <span className="truncate text-slate-700 dark:text-slate-300">@{senderLogin}</span>
          </div>
          <div className="text-xs text-slate-500">
            {formatDateTime(createdAt)}
          </div>
        </div>
        {eventUrl !== null ? (
          <a
            href={eventUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Open on GitHub"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      {hasBody ? (
        <div className="mx-3 mb-2 rounded border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-800">
            @{senderLogin} commented
          </div>
          <div className="px-3 py-2 text-sm">
            <MarkdownContent content={body} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Status badge colors for PR states
 */
function StatusBadge({ status }: { status: GitHubPRStatus }): React.JSX.Element {
  const classMap: Record<GitHubPRStatus, string> = {
    merged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    closed: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
    open: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${classMap[status]}`}>
      {status}
    </span>
  );
}

/**
 * Collapsible group for a single PR — loads events lazily when expanded
 */
interface PREventsGroupProps {
  pullRequestNumber: number;
  title: string | null;
  repository: string;
  status: GitHubPRStatus;
}

function PREventsGroup({
  pullRequestNumber,
  title,
  repository,
  status,
}: PREventsGroupProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const { events, loading: eventsLoading } = useGitHubPREvents({
    repository,
    pullRequestNumber,
    enabled: isExpanded,
  });

  const prUrl = `https://github.com/${repository}/pull/${String(pullRequestNumber)}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="flex w-full items-center gap-3 rounded-t-lg px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        <span className="text-slate-500 transition-transform duration-200" aria-hidden="true">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <GitPullRequest className="h-4 w-4 text-green-600 dark:text-green-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-slate-100">
              #{pullRequestNumber}
            </span>
            {title !== null && title !== '' ? (
              <span className="truncate text-slate-600 dark:text-slate-400">{title}</span>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">{repository}</div>
        </div>
        <StatusBadge status={status} />
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          onClick={(e): void => {
            e.stopPropagation();
          }}
          aria-label="Open PR on GitHub"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </button>
      {isExpanded ? (
        <div className="border-t border-slate-200 p-3 dark:border-slate-700">
          {eventsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <PREventItem key={`${event.createdAt}-${event.eventType}`} {...event} />
              ))}
              {events.length === 0 ? (
                <p className="py-2 text-center text-sm text-slate-500">No events found</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Main page for GitHub PR Events — last 30 days, loaded from summaries
 */
export function PREventsPage(): React.JSX.Element {
  const {
    prs,
    loading,
    refreshing,
    error,
    refresh,
  } = useGitHubPRSummaries();

  if (loading && prs.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Github Pull Request Events (last 30 days)</h2>
          <p className="text-slate-600 dark:text-slate-300">View pull request activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            disabled={refreshing}
            className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-blue-400"
            title="Refresh"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {prs.length === 0 && !loading ? (
        <Card>
          <div className="py-12 text-center">
            <GitPullRequest className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No PR events found</p>
            <p className="text-sm text-slate-500">
              No webhook events have been received in the last 30 days.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {prs.map((pr) => (
            <PREventsGroup
              key={`${pr.repository}#${String(pr.pullRequestNumber)}`}
              pullRequestNumber={pr.pullRequestNumber}
              title={pr.title}
              repository={pr.repository}
              status={pr.status}
            />
          ))}
        </div>
      )}

      {loading && prs.length > 0 ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : null}
    </Layout>
  );
}
