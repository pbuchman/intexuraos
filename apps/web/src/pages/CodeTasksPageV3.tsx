/**
 * Code Tasks V3 page with backend-driven issue grouping.
 *
 * Parallel implementation to CodeTasksPage — accessible at /code-tasks-v3
 * (hidden route, no sidebar nav entry).
 *
 * Key differences from CodeTasksPage:
 * - Grouping, filtering, sorting, and pagination happen on the backend
 * - Counts are always accurate (reflect all non-archived tasks)
 * - No client-side groupByLinearIssue / sortIssueGroups
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpDown, Clock, Plus } from 'lucide-react';
import { Button, CodeTaskLogsModal, Layout, TaskErrorModal } from '@/components';
import { IssueGroupRow } from '@/components/code-tasks/IssueGroupRow';
import { useAuth } from '@/context';
import { useIssueGroups, useRapidPoll } from '@/hooks/useIssueGroups';
import { useTimeTick } from '@/hooks';
import { ApiError } from '@/services/apiClient';
import { startImplementation, retryCodeTask, archiveCodeTask, deleteCodeTask } from '@/services/codeAgentApi';
import type { GroupStatus, SortOption } from '@/types/issueGroups';
import type { ActioningType } from '@/utils/issueGroups';

// V3 does not include 'archived' — backend excludes archived tasks
const ALL_GROUP_STATUSES: GroupStatus[] = ['active', 'needs-action', 'done', 'failed'];

const GROUP_STATUS_CONFIG: Record<GroupStatus, { label: string; dotClass: string; activeClass: string }> = {
  active: {
    label: 'Active',
    dotClass: 'bg-blue-500',
    activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  'needs-action': {
    label: 'Needs Action',
    dotClass: 'bg-green-500',
    activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
  done: {
    label: 'Done',
    dotClass: 'bg-emerald-500',
    activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  failed: {
    label: 'Failed',
    dotClass: 'bg-red-500',
    activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400',
  },
};

const INACTIVE_SEGMENT_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

const STORAGE_KEY = 'code-tasks-v3-group-filter';
const SORT_STORAGE_KEY = 'code-tasks-v3-sort';

const DEFAULT_FILTERS = ALL_GROUP_STATUSES;

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'linear-id', label: 'Linear' },
  { key: 'pr-number', label: 'PR#' },
  { key: 'created-time', label: 'Created' },
  { key: 'started-time', label: 'Dispatched' },
];

function loadSortFromStorage(): SortOption {
  const stored = localStorage.getItem(SORT_STORAGE_KEY);
  if (stored === 'linear-id' || stored === 'pr-number' || stored === 'started-time' || stored === 'created-time') {
    return stored;
  }
  return 'linear-id';
}

function loadFiltersFromStorage(): GroupStatus[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((s): s is GroupStatus =>
          ALL_GROUP_STATUSES.includes(s as GroupStatus),
        );
        if (valid.length > 0) {
          return valid;
        }
      }
    } catch {
      // Invalid JSON, use default
    }
  }
  return DEFAULT_FILTERS;
}

// --- PageHeader ---

interface PageHeaderProps {
  counts: Record<GroupStatus, number>;
  totalGroups: number;
}

function PageHeader({ counts, totalGroups }: PageHeaderProps): React.JSX.Element {
  const parts: string[] = [`${String(totalGroups)} issue${totalGroups !== 1 ? 's' : ''}`];
  if (counts['needs-action'] > 0) {
    parts.push(`${String(counts['needs-action'])} needs attention`);
  }
  if (counts.failed > 0) {
    parts.push(`${String(counts.failed)} failed`);
  }

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Code Tasks</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {parts.join(' \u00B7 ')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/code-tasks/dispatch-queue"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
        >
          <Clock className="h-4 w-4" />
          Queue
        </Link>
        <Link to="/code-tasks/new">
          <Button>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}

// --- StatusPipeline ---

interface StatusPipelineProps {
  counts: Record<GroupStatus, number>;
  activeFilters: GroupStatus[];
  onToggle: (status: GroupStatus) => void;
}

function StatusPipeline({ counts, activeFilters, onToggle }: StatusPipelineProps): React.JSX.Element {
  const activeSet = useMemo(() => new Set(activeFilters), [activeFilters]);

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {ALL_GROUP_STATUSES.map((status) => {
        const cfg = GROUP_STATUS_CONFIG[status];
        const count = counts[status];
        const isActive = activeSet.has(status);

        return (
          <button
            key={status}
            onClick={(): void => { onToggle(status); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? cfg.activeClass : INACTIVE_SEGMENT_CLASS
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
            <span className="font-medium">{String(count)}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- SortSelector ---

interface SortSelectorProps {
  activeSort: SortOption;
  onChangeSort: (sort: SortOption) => void;
}

function SortSelector({ activeSort, onChangeSort }: SortSelectorProps): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2">
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">
        Sort
      </span>
      <div className="flex gap-1.5">
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={(): void => { onChangeSort(key); }}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              activeSort === key
                ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- ColumnHeader ---

function ColumnHeader(): React.JSX.Element {
  return (
    <div className="mb-1 hidden grid-cols-[1fr_1fr_140px_120px_36px] px-4 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500 lg:grid">
      <div>Issue</div>
      <div>Pipeline</div>
      <div>Time</div>
      <div>Output</div>
      <div>Logs</div>
    </div>
  );
}

// --- CodeTasksPageV3 ---

export function CodeTasksPageV3(): React.JSX.Element {
  const { getAccessToken } = useAuth();

  const [activeFilters, setActiveFilters] = useState<GroupStatus[]>(loadFiltersFromStorage);
  const [activeSort, setActiveSort] = useState<SortOption>(loadSortFromStorage);
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const actionInFlightRef = useRef(false);
  const lastActionRef = useRef<{ taskId: string; action: 'retry' | 'implement' | 'archive' } | null>(null);
  const [actioningType, setActioningType] = useState<ActioningType>(null);

  // Server-side grouping, filtering, sorting, pagination
  const {
    groups,
    counts,
    totalGroups,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    loadMore,
    refresh,
  } = useIssueGroups({
    groupStatus: activeFilters,
    sortBy: activeSort,
  });

  // Rapid polling after user actions
  const { actioningTaskId, setActioningTaskId } = useRapidPoll(null, groups, refresh);

  // Sync actioningType when rapid poll clears actioningTaskId
  useEffect(() => {
    if (actioningTaskId === null) {
      setActioningType(null);
    }
  }, [actioningTaskId]);

  const timeTick = useTimeTick(30000, counts.active > 0);

  const handleToggleFilter = useCallback((status: GroupStatus): void => {
    setActiveFilters((prev) => {
      const set = new Set(prev);
      if (set.has(status)) {
        set.delete(status);
      } else {
        set.add(status);
      }
      const next = [...set];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleChangeSort = useCallback((sort: SortOption): void => {
    setActiveSort(sort);
    localStorage.setItem(SORT_STORAGE_KEY, sort);
  }, []);

  const handleAction = useCallback(
    async (taskId: string, action: 'delete' | 'retry' | 'implement' | 'archive') => {
      if (action === 'delete') {
        return;
      }
      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      lastActionRef.current = { taskId, action };
      setActioningTaskId(taskId);
      setActioningType(action);
      try {
        const token = await getAccessToken();
        if (action === 'implement') {
          await startImplementation(token, taskId);
        } else if (action === 'archive') {
          await archiveCodeTask(token, taskId);
        } else {
          await retryCodeTask(token, { taskId });
        }
        await refresh(false);
        lastActionRef.current = null;
      } catch (err: unknown) {
        setActioningTaskId(null);
        setActioningType(null);
        setActionError(
          err instanceof ApiError
            ? err
            : new ApiError('UNKNOWN', err instanceof Error ? err.message : 'An unexpected error occurred', 0),
        );
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [getAccessToken, refresh, setActioningTaskId],
  );

  const fireAction = useCallback(
    (taskId: string, action: 'delete' | 'retry' | 'implement' | 'archive'): void => {
      void handleAction(taskId, action);
    },
    [handleAction],
  );

  const handleGroupAction = useCallback(
    (taskIds: string[], actionType: 'archive' | 'delete', apiFn: (token: string, taskId: string) => Promise<void>): void => {
      void (async (): Promise<void> => {
        if (actionInFlightRef.current) return;
        actionInFlightRef.current = true;
        const actionStart = Date.now();
        const firstId = taskIds[0];
        if (firstId !== undefined) {
          setActioningTaskId(firstId);
          setActioningType(actionType);
        }
        try {
          const token = await getAccessToken();
          for (const taskId of taskIds) {
            await apiFn(token, taskId);
          }
          // Ensure the row shimmer animation is visible before refresh removes the row
          const MIN_ANIMATION_MS = 1200;
          const elapsed = Date.now() - actionStart;
          if (elapsed < MIN_ANIMATION_MS) {
            await new Promise<void>((resolve) => { setTimeout(resolve, MIN_ANIMATION_MS - elapsed); });
          }
          await refresh(false);
        } catch (err: unknown) {
          setActioningTaskId(null);
          setActioningType(null);
          setActionError(
            err instanceof ApiError
              ? err
              : new ApiError('UNKNOWN', err instanceof Error ? err.message : 'An unexpected error occurred', 0),
          );
        } finally {
          actionInFlightRef.current = false;
        }
      })();
    },
    [getAccessToken, refresh, setActioningTaskId],
  );

  const handleArchiveGroup = useCallback(
    (taskIds: string[]): void => { handleGroupAction(taskIds, 'archive', archiveCodeTask); },
    [handleGroupAction],
  );

  const handleDeleteGroup = useCallback(
    (taskIds: string[]): void => { handleGroupAction(taskIds, 'delete', deleteCodeTask); },
    [handleGroupAction],
  );

  const handleCloseErrorModal = useCallback((): void => {
    setActionError(null);
    lastActionRef.current = null;
  }, []);

  const handleRetryFromModal = useCallback((): void => {
    setActionError(null);
    const last = lastActionRef.current;
    if (last !== null) {
      void handleAction(last.taskId, last.action);
    }
  }, [handleAction]);

  if (loading && groups.length === 0) {
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
      <PageHeader counts={counts} totalGroups={totalGroups} />

      <StatusPipeline
        counts={counts}
        activeFilters={activeFilters}
        onToggle={handleToggleFilter}
      />

      <SortSelector activeSort={activeSort} onChangeSort={handleChangeSort} />

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <p className="mb-4 text-slate-600 dark:text-slate-300">
              {activeFilters.length > 0 && totalGroups > 0
                ? 'No issues match the selected filters'
                : 'No code tasks yet'}
            </p>
            {activeFilters.length > 0 && totalGroups > 0 ? (
              <button
                onClick={(): void => {
                  setActiveFilters(DEFAULT_FILTERS);
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_FILTERS));
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Clear filters
              </button>
            ) : null}
            {totalGroups === 0 ? (
              <Link to="/code-tasks/new" className="text-blue-600 underline dark:text-blue-400">
                Create your first code task
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div>
          <ColumnHeader />

          <div className={`mb-2 h-0.5 w-full overflow-hidden rounded-full ${refreshing ? 'bg-slate-700' : ''}`}>
            {refreshing ? (
              <div className="animate-progress-slide h-full w-2/5 rounded-full bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
            ) : null}
          </div>

          <div className={`space-y-1 ${refreshing && actioningType === null ? 'opacity-50 pointer-events-none' : ''}`}>
            {groups.map((group) => (
              <IssueGroupRow
                key={group.linearIssueId ?? group.latestTask.id}
                group={group}
                timeTick={timeTick}
                onAction={fireAction}
                onArchiveGroup={handleArchiveGroup}
                onDeleteGroup={handleDeleteGroup}
                onOpenLogs={setPreviewTaskId}
                actioningTaskId={actioningTaskId}
                actioningType={actioningType}
              />
            ))}
          </div>

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                onClick={(): void => {
                  void loadMore();
                }}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
                    <span>Loading...</span>
                  </div>
                ) : (
                  'Load More'
                )}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {previewTaskId !== null ? (
        <CodeTaskLogsModal
          taskId={previewTaskId}
          onClose={(): void => { setPreviewTaskId(null); }}
        />
      ) : null}

      <TaskErrorModal
        isOpen={actionError !== null}
        error={actionError}
        onClose={handleCloseErrorModal}
        onRetry={handleRetryFromModal}
      />
    </Layout>
  );
}
