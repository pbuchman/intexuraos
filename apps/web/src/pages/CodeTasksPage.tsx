import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useCodeTasks, useWorkersStatus } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import type { CodeTask, CodeTaskStatus, WorkerStatusTag, WorkersStatusResponse } from '@/types';

const LINEAR_STATE_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  started: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

const DEFAULT_STATE_STYLE = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

const ISSUE_TYPE_STYLES: Record<string, string> = {
  feature: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  bug: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  refactor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
};

const DEFAULT_BADGE_STYLE = 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';

const WORKER_STATUS_STYLES: Record<WorkerStatusTag, string> = {
  healthy: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-700 dark:text-emerald-100',
  'orchestrator-unreachable': 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-red-100',
  'tunnel-down': 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-red-100',
  unknown: 'bg-amber-200 text-amber-900 dark:bg-amber-700 dark:text-amber-100',
};

interface StatusStyle {
  bg: string;
  text: string;
  label: string;
}

const ALL_TASK_STATUSES: CodeTaskStatus[] = [
  'queued', 'dispatched', 'running', 'planned', 'implemented', 'failed', 'interrupted', 'cancelled', 'archived',
];

// Statuses shown by default (all except archived — INT-711)
const DEFAULT_VISIBLE_STATUSES: CodeTaskStatus[] = [
  'queued', 'dispatched', 'running', 'planned', 'implemented', 'failed', 'interrupted', 'cancelled',
];

const STATUS_STYLES: Record<CodeTaskStatus, StatusStyle> = {
  queued: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Queued' },
  dispatched: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-800 dark:text-slate-300', label: 'Dispatched' },
  running: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-300', label: 'Running' },
  planned: { bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-800 dark:text-violet-300', label: 'Planned' },
  implemented: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-800 dark:text-green-300', label: 'Implemented' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-800 dark:text-red-300', label: 'Failed' },
  interrupted: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Interrupted' },
  cancelled: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Cancelled' },
  archived: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-500', label: 'Archived' },
};

export function CodeTasksPage(): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState<CodeTaskStatus[]>(() => {
    const stored = localStorage.getItem('code-tasks-status-filter');
    if (stored !== null) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (s): s is CodeTaskStatus => ALL_TASK_STATUSES.includes(s as CodeTaskStatus)
          );
        }
      } catch {
        // Invalid JSON, use default
      }
    }
    // Default: show all statuses EXCEPT archived (INT-711)
    return DEFAULT_VISIBLE_STATUSES;
  });
  const [isFilterExpanded, setIsFilterExpanded] = useState(
    () => localStorage.getItem('code-tasks-filter-expanded') === 'true'
  );

  const { tasks, loading, loadingMore, error, hasMore, loadMore, deleteTask } = useCodeTasks({
    status: statusFilter,
  });
  const { status: workersStatus } = useWorkersStatus();

  const handleToggleStatus = (status: CodeTaskStatus): void => {
    setStatusFilter((prev) => {
      const next = prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status];
      localStorage.setItem('code-tasks-status-filter', JSON.stringify(next));
      return next;
    });
  };

  if (loading && tasks.length === 0) {
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Code Tasks</h2>
          <p className="text-slate-600 dark:text-slate-300">View and manage your code generation tasks</p>
        </div>
        <Link to="/code-tasks/new">
          <Button>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </Link>
      </div>

      {/* Status Filter */}
      <div className="mb-4">
        <button
          onClick={(): void => {
            setIsFilterExpanded((prev) => {
              localStorage.setItem('code-tasks-filter-expanded', String(!prev));
              return !prev;
            });
          }}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <Filter className="h-4 w-4" />
          Filter by status
          {statusFilter.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-400">
              {String(statusFilter.length)}
            </span>
          )}
          {isFilterExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {isFilterExpanded && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ALL_TASK_STATUSES.map((s) => {
              const style = STATUS_STYLES[s];
              return (
                <label
                  key={s}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    statusFilter.includes(s)
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={statusFilter.includes(s)}
                    onChange={(): void => {
                      handleToggleStatus(s);
                    }}
                    className="sr-only"
                  />
                  <span className={`inline-block h-2 w-2 rounded-full ${style.bg}`} />
                  {style.label}
                </label>
              );
            })}
            {statusFilter.length > 0 && (
              <button
                onClick={(): void => {
                  setStatusFilter([]);
                  localStorage.setItem('code-tasks-status-filter', '[]');
                }}
                className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="mb-4 text-slate-600 dark:text-slate-300">
              {statusFilter.length > 0 ? 'No tasks match the selected filters' : 'No code tasks yet'}
            </p>
            {statusFilter.length === 0 && (
              <Link to="/code-tasks/new" className="text-blue-600 underline dark:text-blue-400">
                Create your first code task
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <CodeTaskCard key={task.id} task={task} workersStatus={workersStatus} onDelete={async (): Promise<void> => { await deleteTask(task.id); }} />
          ))}

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
    </Layout>
  );
}

interface CodeTaskCardProps {
  task: CodeTask;
  workersStatus: WorkersStatusResponse | null;
  onDelete: () => Promise<void>;
}

function CodeTaskCard({ task, workersStatus, onDelete }: CodeTaskCardProps): React.JSX.Element {
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const status = STATUS_STYLES[task.status];
  const taskWorkerStatus = workersStatus?.workers.find((w) => w.name === task.workerLocation);
  const workerStatusTag: WorkerStatusTag | null = taskWorkerStatus?.status ?? null;

  const handleCardClick = (): void => {
    void navigate(`/code-tasks/${task.id}`);
  };

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const truncatePrompt = (prompt: string, maxLength = 150): string => {
    if (prompt.length <= maxLength) return prompt;
    return `${prompt.slice(0, maxLength)}...`;
  };

  return (
    <div
      onClick={handleCardClick}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400">
          {task.linearIssueId !== undefined ? (
            (task.linearIssueUrl ?? task.linearIssue?.url) !== undefined ? (
              <a
                href={task.linearIssueUrl ?? task.linearIssue?.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e): void => { e.stopPropagation(); }}
                className="mr-2 text-blue-600 hover:underline dark:text-blue-400"
              >
                {task.linearIssueId}
              </a>
            ) : (
              <span className="mr-2 text-blue-600 dark:text-blue-400">{task.linearIssueId}</span>
            )
          ) : null}
          {task.linearIssueTitle ?? truncatePrompt(task.sanitizedPrompt, 80)}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
          {truncatePrompt(task.sanitizedPrompt)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {task.status === 'planned' && task.implementationTaskId === undefined && (
          <span className="inline-flex items-center rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-medium text-green-400 dark:bg-red-700 dark:text-green-300">
            Ready to implement
          </span>
        )}
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg} ${status.text}`}>
          {status.label}
        </span>
        {task.agentType === 'planning' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            Planning
          </span>
        ) : task.agentType === 'execution' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            Execution
          </span>
        ) : null}
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700 dark:bg-slate-700 dark:text-slate-300">
          {task.workerType}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${workerStatusTag !== null ? WORKER_STATUS_STYLES[workerStatusTag] : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
          {task.workerLocation}
        </span>
        {task.linearIssueType !== undefined ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            ISSUE_TYPE_STYLES[task.linearIssueType] ?? DEFAULT_BADGE_STYLE
          }`}>
            {task.linearIssueType}
          </span>
        ) : null}
        {task.linearIssue !== undefined ? (
          <>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${LINEAR_STATE_STYLES[task.linearIssue.state.type] ?? DEFAULT_STATE_STYLE}`}>
              {task.linearIssue.state.name}
            </span>
            {task.linearIssue.assignee !== null ? (
              <span className="text-xs text-green-600 dark:text-green-400">{task.linearIssue.assignee.name}</span>
            ) : null}
            {task.linearIssue.commentCount > 0 ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {String(task.linearIssue.commentCount)} comments
              </span>
            ) : null}
          </>
        ) : null}
        {task.linearIssueId !== undefined ? (
          (task.linearIssueUrl ?? task.linearIssue?.url) !== undefined ? (
            <a
              href={task.linearIssueUrl ?? task.linearIssue?.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e): void => { e.stopPropagation(); }}
              className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/80"
            >
              {task.linearIssueId}
            </a>
          ) : (
            <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/80">
              {task.linearIssueId}
            </span>
          )
        ) : null}
        {task.linearIssue?.labels !== undefined && task.linearIssue.labels.length > 0 ? (
          task.linearIssue.labels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-full bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300"
            >
              {label.name}
            </span>
          ))
        ) : null}
        {task.result?.prUrl !== undefined ? (
          <a
            href={task.result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e): void => { e.stopPropagation(); }}
            className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80"
          >
            PR #{/\/pull\/(\d+)/.exec(task.result.prUrl)?.[1] ?? ''}
          </a>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-4 text-sm text-slate-500 dark:text-slate-400">
          <span>Created: {formatDateTime(task.createdAt)}</span>
          {(task.status === 'planned' || task.status === 'implemented') ? (
            <span>Completed: {formatDateTime(task.updatedAt)}</span>
          ) : null}
        </div>
        {!showDeleteConfirm ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e): void => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {showDeleteConfirm ? (
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30"
          onClick={(e): void => { e.stopPropagation(); }}
        >
          <p className="mb-3 text-sm text-red-800 dark:text-red-400">
            Delete &quot;{task.linearIssueTitle ?? truncatePrompt(task.sanitizedPrompt, 60)}&quot;?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => { void handleDelete(); }}
              disabled={isDeleting}
              isLoading={isDeleting}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(): void => { setShowDeleteConfirm(false); }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {task.error !== undefined ? (
        <div className="mt-3 text-sm text-red-600 dark:text-red-400">
          Error: {task.error.message}
        </div>
      ) : null}
    </div>
  );
}
