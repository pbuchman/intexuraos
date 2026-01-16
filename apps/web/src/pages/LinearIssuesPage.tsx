import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button, Layout } from '@/components';
import { useAuth } from '@/context';
import { useFailedLinearIssues } from '@/hooks';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { listLinearIssues } from '@/services';
import type { FailedLinearIssue, LinearIssue, ListIssuesResponse } from '@/types';

const POLLING_INTERVAL_MS = 60_000; // 1 minute

const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600',
  1: 'bg-red-100 text-red-700',
  2: 'bg-orange-100 text-orange-700',
  3: 'bg-blue-100 text-blue-700',
  4: 'bg-slate-100 text-slate-500',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

type TabType = 'backlog' | 'in_progress' | 'in_review' | 'done' | 'archive';

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'backlog', label: 'Backlog', icon: <Circle className="h-4 w-4" /> },
  { id: 'in_progress', label: 'In Progress', icon: <Clock className="h-4 w-4" /> },
  { id: 'in_review', label: 'In Review', icon: <Eye className="h-4 w-4" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: 'archive', label: 'Archive', icon: <ChevronDown className="h-4 w-4" /> },
];

/**
 * Map Linear state to dashboard column
 */
function mapToColumn(issue: LinearIssue): TabType {
  const stateName = issue.status.name.toLowerCase();
  const stateType = issue.status.type;

  // In Review detection (Linear uses "started" type for review states)
  if (stateName.includes('review')) {
    return 'in_review';
  }

  // Check if completed within last week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const completedAt = issue.updatedAt ? new Date(issue.updatedAt) : null;
  const isRecent = completedAt !== null && completedAt >= weekAgo;

  switch (stateType) {
    case 'backlog':
    case 'unstarted':
      return 'backlog';
    case 'started':
      return 'in_progress';
    case 'completed':
      return isRecent ? 'done' : 'archive';
    case 'cancelled':
      return 'archive';
    default:
      return 'backlog';
  }
}

/**
 * Group issues by dashboard column
 */
function groupIssuesByColumn(issues: LinearIssue[]): Record<TabType, LinearIssue[]> {
  const grouped: Record<TabType, LinearIssue[]> = {
    backlog: [],
    in_progress: [],
    in_review: [],
    done: [],
    archive: [],
  };

  for (const issue of issues) {
    const column = mapToColumn(issue);
    grouped[column].push(issue);
  }

  return grouped;
}

interface IssueCardProps {
  issue: LinearIssue;
}

function IssueCard({ issue }: IssueCardProps): React.JSX.Element {
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{issue.identifier}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${String(PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS[0])}`}
        >
          {PRIORITY_LABELS[issue.priority] ?? 'No priority'}
        </span>
      </div>

      <h4 className="mb-2 font-medium text-slate-900 line-clamp-2">{issue.title}</h4>

      {issue.description !== null && issue.description !== '' && (
        <p className="mb-2 text-sm text-slate-500 line-clamp-2">{issue.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{issue.status.name}</span>
        <ExternalLink className="h-3 w-3" />
      </div>
    </a>
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
  colorClass = 'bg-slate-50',
}: IssueColumnProps): React.JSX.Element {
  return (
    <div className={`flex flex-col rounded-lg ${colorClass} p-4`}>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-slate-700">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
          {issues.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {issues.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">No issues</p>
        ) : (
          issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        )}
      </div>
    </div>
  );
}

interface FailedIssueCardProps {
  issue: FailedLinearIssue;
  onDismiss: (id: string) => void;
}

function FailedIssueCard({ issue, onDismiss }: FailedIssueCardProps): React.JSX.Element {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex shrink-0 items-center justify-center rounded-lg bg-amber-100 p-2 text-amber-600">
        <AlertCircle className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h4 className="font-medium text-amber-900">
            {issue.extractedTitle ?? 'Untitled issue'}
          </h4>
          <button
            type="button"
            onClick={() => {
              onDismiss(issue.id);
            }}
            className="shrink-0 rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-amber-600"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <p className="mb-2 line-clamp-2 text-sm text-amber-700">{issue.originalText}</p>

        <div className="flex items-center gap-2 text-xs text-amber-600">
          <span className="rounded bg-amber-100 px-1.5 py-0.5">{issue.error}</span>
        </div>
      </div>
    </div>
  );
}

interface NeedsAttentionSectionProps {
  issues: FailedLinearIssue[];
  onDismiss: (id: string) => void;
}

function NeedsAttentionSection({
  issues,
  onDismiss,
}: NeedsAttentionSectionProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const visibleCount = expanded ? issues.length : Math.min(issues.length, 3);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold text-amber-900">
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
            className="text-amber-700 hover:bg-amber-100 hover:text-amber-900"
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

      <p className="mb-4 text-sm text-amber-700">
        These issues couldn't be created. Please edit them and try again.
      </p>

      <div className="space-y-2">
        {issues.slice(0, visibleCount).map((issue) => (
          <FailedIssueCard key={issue.id} issue={issue} onDismiss={onDismiss} />
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
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('backlog');
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [dismissedFailedIssueIds, setDismissedFailedIssueIds] = useState<Set<string>>(new Set());

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

  const handleDismissFailedIssue = (id: string): void => {
    setDismissedFailedIssueIds((prev) => new Set([...prev, id]));
  };

  const visibleFailedIssues = failedIssues.filter(
    (issue) => !dismissedFailedIssueIds.has(issue.id)
  );

  if (loading && failedIssuesLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="mb-4 h-12 w-12 text-red-500" />
          <h3 className="mb-2 text-lg font-medium text-slate-900">Unable to load issues</h3>
          <p className="mb-4 text-slate-500">{error}</p>
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

  // Group all issues by dashboard column
  const allIssues = data?.issues ?? {
    backlog: [],
    unstarted: [],
    started: [],
    completed: [],
    cancelled: [],
  };

  const flatIssues = [
    ...allIssues.backlog,
    ...allIssues.unstarted,
    ...allIssues.started,
    ...allIssues.completed,
    ...allIssues.cancelled,
  ];

  const columnIssues = groupIssuesByColumn(flatIssues);

  return (
    <Layout>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Linear Issues</h2>
          <p className="text-slate-600">Issues from your connected Linear workspace.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void handleRefresh();
          }}
          disabled={refreshing}
          isLoading={refreshing}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <NeedsAttentionSection issues={visibleFailedIssues} onDismiss={handleDismissFailedIssue} />

      {/* Mobile: Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 md:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="ml-1 text-xs text-slate-500">({columnIssues[tab.id].length})</span>
          </button>
        ))}
      </div>

      {/* Mobile: Active column */}
      <div className="md:hidden">
        {activeTab === 'archive' ? (
          <div className="rounded-lg bg-slate-50 p-4">
            <button
              type="button"
              onClick={() => {
                setArchiveExpanded(!archiveExpanded);
              }}
              className="mb-4 flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200"
            >
              <span className="font-medium text-slate-700">
                Archive ({columnIssues.archive.length} older completed issues)
              </span>
              {archiveExpanded ? (
                <ChevronUp className="h-5 w-5 text-slate-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-500" />
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

      {/* Desktop: Grid of columns */}
      <div className="hidden md:grid md:grid-cols-4 md:gap-4">
        <IssueColumn
          title="Backlog"
          icon={<Circle className="h-4 w-4 text-slate-400" />}
          issues={columnIssues.backlog}
          colorClass="bg-slate-50"
        />
        <IssueColumn
          title="In Progress"
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          issues={columnIssues.in_progress}
          colorClass="bg-blue-50"
        />
        <IssueColumn
          title="In Review"
          icon={<Eye className="h-4 w-4 text-purple-500" />}
          issues={columnIssues.in_review}
          colorClass="bg-purple-50"
        />
        <IssueColumn
          title="Done (This Week)"
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          issues={columnIssues.done}
          colorClass="bg-green-50"
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
            className="flex w-full items-center justify-between rounded-lg bg-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-200"
          >
            <span className="font-medium text-slate-700">
              Archive ({columnIssues.archive.length} older completed issues)
            </span>
            {archiveExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500" />
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
