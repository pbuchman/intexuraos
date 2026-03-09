import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Loader2,
} from 'lucide-react';
import { MarkdownContent } from '@/components/MarkdownContent';
import { useGitHubPREvents } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import type { GitHubPRStatus } from '@/types';

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
    if (action === 'synchronize') {
      return {
        icon: '📤',
        label: 'Pushed commits',
        color: 'text-blue-700 dark:text-blue-400',
      };
    }
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
            <MarkdownContent content={body} allowHtml />
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

export interface PREventsGroupProps {
  pullRequestNumber: number;
  title?: string | null;
  repository: string;
  status?: GitHubPRStatus;
}

export function PREventsGroup({
  pullRequestNumber,
  title = null,
  repository,
  status,
}: PREventsGroupProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const { events, loading: eventsLoading } = useGitHubPREvents({
    repository,
    pullRequestNumber,
    enabled: isExpanded,
  });

  const derivedTitle = title ?? events.find((e) => e.title !== null)?.title ?? null;

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
            {derivedTitle !== null && derivedTitle !== '' ? (
              <span className="truncate text-slate-600 dark:text-slate-400">{derivedTitle}</span>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">{repository}</div>
        </div>
        {status !== undefined ? <StatusBadge status={status} /> : null}
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
