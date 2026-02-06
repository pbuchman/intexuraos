import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button, Card, Layout, RefreshIndicator } from '@/components';
import { useGitHubPREvents } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';

/**
 * Individual event item within a PR group
 */
interface PREventItemProps {
  eventType: string;
  action: string | null;
  senderLogin: string;
  createdAt: string;
}

function PREventItem({ eventType, action, senderLogin, createdAt }: PREventItemProps): React.JSX.Element {
  const getEventDisplay = (): { icon: string; label: string; color: string } => {
    if (eventType === 'pull_request_review') {
      return {
        icon: '💬',
        label: action === 'submitted' ? 'Review' : action === null ? 'Review' : `Review ${action}`,
        color: 'text-purple-700 dark:text-purple-400',
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

  return (
    <div className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
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
    </div>
  );
}

/**
 * Collapsible group of events for a single PR
 */
interface PREventsGroupProps {
  pullRequestNumber: number;
  title: string | null;
  repository: string;
  events: {
    eventType: string;
    action: string | null;
    senderLogin: string;
    createdAt: string;
  }[];
}

function PREventsGroup({
  pullRequestNumber,
  title,
  repository,
  events,
}: PREventsGroupProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

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
        <span className="text-sm text-slate-500">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
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
          <div className="space-y-2">
            {events.map((event) => (
              <PREventItem key={`${event.createdAt}-${event.eventType}`} {...event} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Main page for GitHub PR Events
 */
export function PREventsPage(): React.JSX.Element {
  const {
    groupedEvents,
    loading,
    refreshing,
    error,
    refresh,
  } = useGitHubPREvents({ limit: 100 });

  if (loading && groupedEvents.length === 0) {
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">GitHub PR Events</h2>
          <p className="text-slate-600 dark:text-slate-300">View pull request activity</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void refresh();
            }}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="ml-2">Refresh</span>
          </Button>
          <Link to="/code-tasks" className="text-sm text-blue-600 underline dark:text-blue-400">
            Back to Code Tasks
          </Link>
        </div>
      </div>

      <RefreshIndicator show={refreshing} />

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {groupedEvents.length === 0 && !loading ? (
        <Card>
          <div className="py-12 text-center">
            <GitPullRequest className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No PR events found</p>
            <p className="text-sm text-slate-500">
              No webhook events have been received yet.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedEvents.map((group) => (
            <PREventsGroup
              key={group.pullRequestNumber}
              pullRequestNumber={group.pullRequestNumber}
              title={group.title}
              repository={group.repository}
              events={group.events.map((e) => ({
                eventType: e.eventType,
                action: e.action,
                senderLogin: e.senderLogin,
                createdAt: e.createdAt,
              }))}
            />
          ))}
        </div>
      )}

      {loading && groupedEvents.length > 0 ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : null}
    </Layout>
  );
}
