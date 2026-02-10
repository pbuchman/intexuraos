import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CloudDownload,
  ExternalLink,
  Eye,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button, Layout } from '@/components';
import { useAuth } from '@/context';
import { useFailedLinearIssues } from '@/hooks';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { deleteFailedIssue, listLinearIssues, retryFailedIssue, syncFromLinear } from '@/services';
import type { FailedLinearIssue, LinearIssue, ListIssuesResponse } from '@/types';
import { stripMarkdown } from '@/utils/markdownUtils';

const POLLING_INTERVAL_MS = 60_000; // 1 minute

const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
  1: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  3: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  4: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

type TabType = 'todo' | 'backlog' | 'in_progress' | 'in_review' | 'to_test' | 'done' | 'archive';

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: 'Todo', icon: <Circle className="h-4 w-4" /> },
  { id: 'backlog', label: 'Backlog', icon: <Circle className="h-4 w-4" /> },
  { id: 'in_progress', label: 'In Progress', icon: <Clock className="h-4 w-4" /> },
  { id: 'in_review', label: 'In Review', icon: <Eye className="h-4 w-4" /> },
  { id: 'to_test', label: 'To Test', icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: 'archive', label: 'Archive', icon: <ChevronDown className="h-4 w-4" /> },
];

interface IssueCardProps {
  issue: LinearIssue;
}

function IssueCard({ issue }: IssueCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white transition-all hover:border-blue-300 hover:shadow-md dark:border-slate-600 dark:bg-slate-700 dark:hover:border-blue-500">
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-4"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{issue.identifier}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${String(PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS[0])}`}
          >
            {PRIORITY_LABELS[issue.priority] ?? 'No priority'}
          </span>
        </div>

        <h4 className="mb-2 font-medium text-slate-900 line-clamp-2 dark:text-slate-100">{issue.title}</h4>

        {issue.description !== null && issue.description !== '' && (
          <p className="mb-2 text-sm text-slate-500 line-clamp-2 dark:text-slate-400">
            {stripMarkdown(issue.description)}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
          <span>{issue.status?.name ?? 'Unknown'}</span>
          <ExternalLink className="h-3 w-3" />
        </div>
      </a>

      {/* Sub-issues list */}
      {issue.childCount > 0 && issue.children.length > 0 && <SubIssuesList issues={issue.children} />}
    </div>
  );
}

interface SubIssuesListProps {
  issues: LinearIssue[];
}

function SubIssuesList({ issues }: SubIssuesListProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(true);

  if (issues.length === 0) {
    return null;
  }

  // Status icon mapping
  const getStatusIcon = (issue: LinearIssue): React.ReactNode => {
    if (!issue.status) {
      return <Circle className="h-3 w-3 text-slate-400" />;
    }
    const type = issue.status.type;
    switch (type) {
      case 'backlog':
      case 'unstarted':
        return <Circle className="h-3 w-3 text-slate-400" />;
      case 'started':
        return <Clock className="h-3 w-3 text-blue-500" />;
      case 'completed':
      case 'cancelled':
        return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      default:
        return <Circle className="h-3 w-3 text-slate-400" />;
    }
  };

  return (
    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-600">
      <button
        type="button"
        onClick={() => {
          setExpanded(!expanded);
        }}
        className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Sub-issues ({issues.length})
      </button>

      {expanded && (
        <div className="space-y-1">
          {issues.map((child) => (
            <a
              key={child.id}
              href={child.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              {getStatusIcon(child)}
              <span className="font-medium text-slate-500 dark:text-slate-500">{child.identifier}</span>
              <span className="truncate">{child.title}</span>
              <ExternalLink className="ml-auto h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface IssueColumnProps {
  title: string;
  icon: React.ReactNode;
  issues: LinearIssue[];
  colorClass?: string;
}

function IssueColumn({
  title,
  icon,
  issues,
  colorClass = 'bg-slate-50 dark:bg-slate-800',
}: IssueColumnProps): React.JSX.Element {
  return (
    <div className={`flex flex-col rounded-lg ${colorClass} p-4`}>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-600 dark:text-slate-300">
          {issues.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {issues.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8 dark:text-slate-500">No issues</p>
        ) : (
          issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </div>
    </div>
  );
}

interface StackedSectionProps {
  title: string;
  icon: React.ReactNode;
  issues: LinearIssue[];
  colorClass?: string;
}

function StackedSection({
  title,
  icon,
  issues,
  colorClass = 'bg-white dark:bg-slate-700',
}: StackedSectionProps): React.JSX.Element | null {
  if (issues.length === 0) {
    return null;
  }

  return (
    <div className={`mb-4 rounded-lg ${colorClass} p-3 last:mb-0`}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-600 dark:text-slate-300">
          {issues.length}
        </span>
      </div>

      <div className="space-y-2">
        {issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
      </div>
    </div>
  );
}

interface StackedColumnProps {
  title: string;
  sections: {
    title: string;
    icon: React.ReactNode;
    issues: LinearIssue[];
    colorClass?: string;
  }[];
  colorClass?: string;
}

function StackedColumn({
  title,
  sections,
  colorClass = 'bg-slate-50 dark:bg-slate-800',
}: StackedColumnProps): React.JSX.Element {
  const totalIssues = sections.reduce((sum, section) => sum + section.issues.length, 0);

  return (
    <div className={`flex flex-col rounded-lg ${colorClass} p-4`}>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-600 dark:text-slate-300">
          {totalIssues}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {sections.map((section) => (
          <StackedSection
            key={section.title}
            title={section.title}
            icon={section.icon}
            issues={section.issues}
            colorClass={section.colorClass ?? 'bg-white dark:bg-slate-700'}
          />
        ))}
      </div>
    </div>
  );
}

interface FailedIssueCardProps {
  issue: FailedLinearIssue;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  isDeleting: boolean;
  isRetrying: boolean;
}

function FailedIssueCard({
  issue,
  onDelete,
  onRetry,
  isDeleting,
  isRetrying,
}: FailedIssueCardProps): React.JSX.Element {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/30">
      <div className="flex shrink-0 items-center justify-center rounded-lg bg-amber-100 p-2 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
        <AlertCircle className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h4 className="font-medium text-amber-900 dark:text-amber-200">
            {issue.extractedTitle ?? 'Untitled issue'}
          </h4>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => void onRetry(issue.id)}
              disabled={isRetrying || isDeleting}
              className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-amber-900/50 dark:hover:text-blue-400"
              aria-label="Retry"
              title="Retry creating issue"
            >
              {isRetrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void onDelete(issue.id)}
              disabled={isDeleting || isRetrying}
              className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-amber-900/50 dark:hover:text-red-400"
              aria-label="Delete"
              title="Delete failed issue"
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>

        <p className="mb-2 line-clamp-2 text-sm text-amber-700 dark:text-amber-300">{issue.originalText}</p>

        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/50">{issue.error}</span>
        </div>
      </div>
    </div>
  );
}

interface NeedsAttentionSectionProps {
  issues: FailedLinearIssue[];
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  deletingId: string | null;
  retryingId: string | null;
}

function NeedsAttentionSection({
  issues,
  onDelete,
  onRetry,
  deletingId,
  retryingId,
}: NeedsAttentionSectionProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const visibleCount = expanded ? issues.length : Math.min(issues.length, 3);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">
            Needs Attention ({issues.length})
          </h3>
        </div>
        {issues.length > 3 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(!expanded);
            }}
            className="text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/50 dark:hover:text-amber-200"
          >
            {expanded ? (
              <>
                <span>Show less</span>
                <ChevronUp className="ml-1 h-4 w-4" />
              </>
            ) : (
              <>
                <span>Show all ({issues.length})</span>
                <ChevronDown className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>

      <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
        These issues couldn't be created. Please edit them and try again.
      </p>

      <div className="space-y-2">
        {issues.slice(0, visibleCount).map((issue) => (
          <FailedIssueCard
            key={issue.id}
            issue={issue}
            onDelete={onDelete}
            onRetry={onRetry}
            isDeleting={deletingId === issue.id}
            isRetrying={retryingId === issue.id}
          />
        ))}
      </div>
    </div>
  );
}

export function LinearIssuesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const {
    issues: failedIssues,
    loading: failedIssuesLoading,
    refresh: refreshFailedIssues,
  } = useFailedLinearIssues();
  const [data, setData] = useState<ListIssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('todo');
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [deletingFailedIssueId, setDeletingFailedIssueId] = useState<string | null>(null);
  const [retryingFailedIssueId, setRetryingFailedIssueId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadIssues = useCallback(
    async (showRefreshIndicator = false): Promise<void> => {
      try {
        if (showRefreshIndicator) {
          setRefreshing(true);
        }
        setError(null);
        const token = await getAccessToken();
        const response = await listLinearIssues(token, true);
        setData(response);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load issues. Make sure Linear is connected.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getAccessToken]
  );

  // Initial load
  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  // Polling
  useEffect(() => {
    const interval = setInterval(() => {
      void loadIssues(false);
    }, POLLING_INTERVAL_MS);

    return (): void => {
      clearInterval(interval);
    };
  }, [loadIssues]);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([loadIssues(true), refreshFailedIssues()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteFailedIssue = async (id: string): Promise<void> => {
    try {
      setDeletingFailedIssueId(id);
      setError(null);
      const token = await getAccessToken();
      await deleteFailedIssue(token, id);
      await refreshFailedIssues();
      setSuccessMessage('Failed issue deleted');
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to delete issue'));
    } finally {
      setDeletingFailedIssueId(null);
    }
  };

  const handleRetryFailedIssue = async (id: string): Promise<void> => {
    try {
      setRetryingFailedIssueId(id);
      setError(null);
      const token = await getAccessToken();
      const result = await retryFailedIssue(token, id);
      await Promise.all([refreshFailedIssues(), loadIssues(true)]);
      setSuccessMessage(`Issue created: ${result.issue.identifier}`);
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to retry issue creation'));
    } finally {
      setRetryingFailedIssueId(null);
    }
  };

  const handleSync = async (): Promise<void> => {
    try {
      setSyncing(true);
      setError(null);
      const token = await getAccessToken();
      const result = await syncFromLinear(token);
      await loadIssues(true);
      const syncedCount = result.created + result.updated;
      setSuccessMessage(
        `Synced ${String(syncedCount)} issue${syncedCount === 1 ? '' : 's'} from Linear` +
          (result.deleted > 0 ? ` (removed ${String(result.deleted)} deleted issue${result.deleted === 1 ? '' : 's'})` : '')
      );
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to sync from Linear'));
    } finally {
      setSyncing(false);
    }
  };

  if (loading || failedIssuesLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null && data === null) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="mb-4 h-12 w-12 text-red-500 dark:text-red-400" />
          <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">Unable to load issues</h3>
          <p className="mb-4 text-slate-500 dark:text-slate-400">{error}</p>
          <Button
            type="button"
            onClick={() => {
              void handleRefresh();
            }}
          >
            Try Again
          </Button>
        </div>
      </Layout>
    );
  }

  const columnIssues = {
    todo: data?.issues.todo ?? [],
    backlog: data?.issues.backlog ?? [],
    in_progress: data?.issues.in_progress ?? [],
    in_review: data?.issues.in_review ?? [],
    to_test: data?.issues.to_test ?? [],
    done: data?.issues.done ?? [],
    archive: data?.issues.archive ?? [],
  };

  return (
    <Layout>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Linear Issues</h2>
          <p className="text-slate-600 dark:text-slate-300">Issues from your connected Linear workspace.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(): void => {
              void handleRefresh();
            }}
            disabled={refreshing || syncing}
            className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-blue-400"
            title="Refresh"
          >
            {refreshing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <RefreshCw className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={(): void => {
              void handleSync();
            }}
            disabled={syncing || refreshing}
            className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-blue-400"
            title="Sync from Linear"
          >
            {syncing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CloudDownload className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {successMessage !== null && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          {successMessage}
        </div>
      )}

      {error !== null && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <NeedsAttentionSection
        issues={failedIssues}
        onDelete={handleDeleteFailedIssue}
        onRetry={handleRetryFailedIssue}
        deletingId={deletingFailedIssueId}
        retryingId={retryingFailedIssueId}
      />

      {/* Mobile: Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 md:hidden dark:bg-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">({columnIssues[tab.id].length})</span>
          </button>
        ))}
      </div>

      {/* Mobile: Active column */}
      <div className="md:hidden">
        {activeTab === 'archive' ? (
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setArchiveExpanded(!archiveExpanded);
              }}
              className="mb-4 flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Archive ({columnIssues.archive.length} older completed issues)
              </span>
              {archiveExpanded ? (
                <ChevronUp className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              )}
            </button>

            {archiveExpanded && (
              <div className="mt-4 space-y-3">
                {columnIssues.archive.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <IssueColumn
            title={TABS.find((t) => t.id === activeTab)?.label ?? ''}
            icon={TABS.find((t) => t.id === activeTab)?.icon}
            issues={columnIssues[activeTab]}
          />
        )}
      </div>

      {/* Desktop: 3-column layout with stacked sections */}
      <div className="hidden md:grid md:grid-cols-3 md:gap-4">
        {/* Column 1: Todo + Backlog (stacked) */}
        <StackedColumn
          title="Planning"
          sections={[
            {
              title: 'Todo',
              icon: <Circle className="h-3 w-3 text-blue-400" />,
              issues: columnIssues.todo,
              colorClass: 'bg-blue-50 dark:bg-blue-900/20',
            },
            {
              title: 'Backlog',
              icon: <Circle className="h-3 w-3 text-slate-400" />,
              issues: columnIssues.backlog,
              colorClass: 'bg-slate-50 dark:bg-slate-700/50',
            },
          ]}
          colorClass="bg-slate-50 dark:bg-slate-800"
        />

        {/* Column 2: In Progress → In Review → To Test (stacked) */}
        <StackedColumn
          title="In Progress"
          sections={[
            {
              title: 'In Progress',
              icon: <Clock className="h-3 w-3 text-blue-500" />,
              issues: columnIssues.in_progress,
              colorClass: 'bg-blue-50 dark:bg-blue-900/20',
            },
            {
              title: 'In Review',
              icon: <Eye className="h-3 w-3 text-purple-500" />,
              issues: columnIssues.in_review,
              colorClass: 'bg-purple-50 dark:bg-purple-900/20',
            },
            {
              title: 'To Test',
              icon: <CheckCircle2 className="h-3 w-3 text-amber-500" />,
              issues: columnIssues.to_test,
              colorClass: 'bg-amber-50 dark:bg-amber-900/20',
            },
          ]}
          colorClass="bg-blue-50 dark:bg-slate-800"
        />

        {/* Column 3: Recently Closed */}
        <IssueColumn
          title="Recently Closed"
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          issues={columnIssues.done}
          colorClass="bg-green-50 dark:bg-slate-800"
        />
      </div>

      {/* Archive section (desktop) */}
      {columnIssues.archive.length > 0 && (
        <div className="mt-6 hidden md:block">
          <button
            type="button"
            onClick={() => {
              setArchiveExpanded(!archiveExpanded);
            }}
            className="flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Archive ({columnIssues.archive.length} older completed issues)
            </span>
            {archiveExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            )}
          </button>

          {archiveExpanded && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {columnIssues.archive.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
