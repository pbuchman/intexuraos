import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Plus,
  XCircle,
} from 'lucide-react';
import { Button, Card, Layout, RefreshIndicator } from '@/components';
import { useCodeTasks } from '@/hooks';
import type { CodeTask, CodeTaskStatus } from '@/types';

interface StatusStyle {
  bg: string;
  text: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STATUS_STYLES: Record<CodeTaskStatus, StatusStyle> = {
  dispatched: { bg: 'bg-slate-100', text: 'text-slate-800', label: 'Dispatched', icon: Clock },
  running: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Running', icon: Loader2 },
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed', icon: XCircle },
  interrupted: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Interrupted', icon: AlertCircle },
  cancelled: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Cancelled', icon: XCircle },
};

export function CodeTasksPage(): React.JSX.Element {
  const { tasks, loading, loadingMore, refreshing, error, hasMore, loadMore } = useCodeTasks();

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
          <h2 className="text-2xl font-bold text-slate-900">Code Tasks</h2>
          <p className="text-slate-600">View and manage your code generation tasks</p>
        </div>
        <Link to="/code-tasks/new">
          <Button>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </Link>
      </div>

      <RefreshIndicator show={refreshing} />

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="mb-4 text-slate-600">No code tasks yet</p>
            <Link to="/code-tasks/new" className="text-blue-600 underline">
              Create your first code task
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <CodeTaskCard key={task.id} task={task} />
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
}

function CodeTaskCard({ task }: CodeTaskCardProps): React.JSX.Element {
  const navigate = useNavigate();
  const status = STATUS_STYLES[task.status];
  const StatusIcon = status.icon;
  const isRunning = task.status === 'running';

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleCardClick = (): void => {
    void navigate(`/code-tasks/${task.id}`);
  };

  const truncatePrompt = (prompt: string, maxLength = 150): string => {
    if (prompt.length <= maxLength) return prompt;
    return `${prompt.slice(0, maxLength)}...`;
  };

  return (
    <div
      onClick={handleCardClick}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {task.linearIssueId !== undefined ? (
              <span className="text-sm font-medium text-blue-600">{task.linearIssueId}</span>
            ) : null}
            <h3 className="text-lg font-semibold text-slate-900 hover:text-blue-600 truncate">
              {task.linearIssueTitle ?? truncatePrompt(task.sanitizedPrompt, 80)}
            </h3>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">
            {truncatePrompt(task.sanitizedPrompt)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg} ${status.text} flex-shrink-0`}
        >
          <StatusIcon className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          {status.label}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <div className="flex gap-4">
          <span>Created: {formatDate(task.createdAt)}</span>
          {task.status === 'completed' ? (
            <span>Completed: {formatDate(task.updatedAt)}</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">
            {task.workerType}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">
            {task.workerLocation}
          </span>
        </div>
      </div>

      {task.result !== undefined ? (
        <div className="mt-3 flex items-center gap-4 text-sm">
          {task.result.prUrl !== undefined ? (
            <a
              href={task.result.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e): void => {
                e.stopPropagation();
              }}
              className="flex items-center gap-1 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View PR
            </a>
          ) : null}
          <span className="text-slate-600">
            {task.result.commits} commit{task.result.commits !== 1 ? 's' : ''} on{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{task.result.branch}</code>
          </span>
          {task.result.ciFailed === true ? (
            <span className="text-amber-600">CI failed</span>
          ) : null}
        </div>
      ) : null}

      {task.error !== undefined ? (
        <div className="mt-3 text-sm text-red-600">
          Error: {task.error.message}
        </div>
      ) : null}
    </div>
  );
}
