import { memo, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  GitBranch,
  GitCommit,
  Loader2,
  Link2,
  RotateCcw,
  StopCircle,
  XCircle,
} from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { TerminalLogViewer } from '@/components/TerminalLogViewer.js';
import { useCodeTask } from '@/hooks';
import { formatDateTime, formatElapsedTime, formatRelative } from '@/utils/dateFormat';
import type { CodeTask, CodeTaskStatus } from '@/types';

interface StatusStyle {
  bg: string;
  text: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STATUS_STYLES: Record<CodeTaskStatus, StatusStyle> = {
  dispatched: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-800 dark:text-slate-300', label: 'Dispatched', icon: Clock },
  running: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-300', label: 'Running', icon: Loader2 },
  completed: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-800 dark:text-green-300', label: 'Completed', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-800 dark:text-red-300', label: 'Failed', icon: XCircle },
  interrupted: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Interrupted', icon: AlertCircle },
  cancelled: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Cancelled', icon: XCircle },
};

export function CodeTaskDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { task, loading, error, cancelTask, retryTask } = useCodeTask(id ?? '');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [linksExpanded, setLinksExpanded] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
  );
  const [elapsedTime, setElapsedTime] = useState(0);

  // Calculate elapsed time for running tasks
  useEffect(() => {
    if (task === null || task.status !== 'running' && task.status !== 'dispatched') {
      setElapsedTime(0);
      return;
    }

    const startTime = new Date(task.createdAt).getTime();
    const interval = setInterval(() => {
      const now = Date.now();
      setElapsedTime(Math.floor((now - startTime) / 1000));
    }, 1000);

    return (): void => { clearInterval(interval); };
  }, [task?.id, task?.status, task?.createdAt]);

  const handleCancel = async (): Promise<void> => {
    if (task === null) return;

    setCancelling(true);
    setCancelError(null);

    try {
      await cancelTask();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel task');
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async (): Promise<void> => {
    if (task === null) return;

    setRetrying(true);
    setRetryError(null);

    try {
      const newTaskId = await retryTask();
      void navigate(`/code-tasks/${newTaskId}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Failed to retry task');
    } finally {
      setRetrying(false);
    }
  };

  const copyToClipboard = async (text: string, section: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => {
      setCopiedSection(null);
    }, 2000);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null || task === null) {
    return (
      <Layout>
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error ?? 'Task not found'}
        </div>
      </Layout>
    );
  }

  const status = STATUS_STYLES[task.status];
  const StatusIcon = status.icon;
  const isRunning = task.status === 'running' || task.status === 'dispatched';
  const canCancel = isRunning;
  const canRetry = task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted';

  // Build links array - Linear and PR
  const links: { label: string; url: string | undefined; text: string; type?: string }[] = [];
  if (task.linearIssueId !== undefined) {
    const typeLabel = task.linearIssueType ? ` [${task.linearIssueType}]` : '';
    const linkItem: { label: string; url: string; text: string; type?: string } = {
      label: 'Linear',
      url: `https://linear.app/intexuraos/issue/${task.linearIssueId}`,
      text: `${task.linearIssueId}${typeLabel} ${task.linearIssueTitle ?? ''}`,
    };
    if (task.linearIssueType !== undefined) {
      linkItem.type = task.linearIssueType;
    }
    links.push(linkItem);
  }
  if (task.result?.prUrl !== undefined) {
    links.push({
      label: 'Pull Request',
      url: task.result.prUrl,
      text: 'View Pull Request',
    });
  }

  return (
    <Layout>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {task.linearIssueId !== undefined ? (
            <span className="text-lg font-medium text-blue-600 dark:text-blue-400">{task.linearIssueId}</span>
          ) : null}
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {task.linearIssueTitle ?? 'Code Task'}
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${status.bg} ${status.text}`}
          >
            <StatusIcon className={`h-4 w-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
            {status.label}
          </span>
          {isRunning && elapsedTime > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              <Clock className="h-4 w-4" />
              {formatElapsedTime(elapsedTime)}
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
          <span>Created: {formatDateTime(task.createdAt)}</span>
          {task.status !== 'dispatched' && task.status !== 'running' ? (
            <span>Updated: {formatRelative(task.updatedAt)}</span>
          ) : null}
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize dark:bg-slate-700 dark:text-slate-300">
            {task.workerType}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize dark:bg-slate-700 dark:text-slate-300">
            {task.workerLocation}
          </span>
          {task.linearIssue !== undefined && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                task.linearIssue.state.type === 'completed' ? 'bg-green-100 text-green-700' :
                task.linearIssue.state.type === 'started' ? 'bg-blue-100 text-blue-700' :
                task.linearIssue.state.type === 'cancelled' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {task.linearIssue.state.name}
              </span>
              {task.linearIssue.assignee !== null && (
                <span className="text-xs text-green-600">
                  {task.linearIssue.assignee.name}
                </span>
              )}
              {task.linearIssue.commentCount > 0 && (
                <span className="text-xs text-gray-500">
                  {String(task.linearIssue.commentCount)} comments
                </span>
              )}
              {task.linearIssue.labels.map(label => (
                <span key={label.id} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {canCancel || canRetry ? (
          <div className="mt-4 flex gap-3">
            {canCancel ? (
              <Button
                variant="danger"
                onClick={(): void => {
                  void handleCancel();
                }}
                disabled={cancelling}
                isLoading={cancelling}
              >
                <StopCircle className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Cancel Task</span>
              </Button>
            ) : null}
            {canRetry ? (
              <Button
                onClick={(): void => {
                  void handleRetry();
                }}
                disabled={retrying}
                isLoading={retrying}
                loadingText="Retrying..."
              >
                <RotateCcw className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Retry Task</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        {cancelError !== null ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {cancelError}
          </div>
        ) : null}

        {retryError !== null ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {retryError}
          </div>
        ) : null}

        {/* Collapsible Links Section */}
        {links.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                setLinksExpanded(!linksExpanded);
              }}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors dark:border-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Links
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${linksExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {linksExpanded ? (
              <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                {links.map((link, idx) => {
                  const url = link.url;
                  return (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16 mt-0.5">
                        {link.label}:
                      </span>
                      <div className="flex-1 min-w-0">
                        {url !== undefined ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {link.text}
                            </a>
                            {link.type ? (
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                link.type === 'feature'
                                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                                  : link.type === 'bug'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                                    : link.type === 'refactor'
                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              }`}>
                                {link.type}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-600 dark:text-slate-400">{link.text}</span>
                        )}
                      </div>
                      {url !== undefined ? (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(url);
                          }}
                          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0"
                          title="Copy link"
                        >
                          <Copy className="h-3.5 w-3.5 text-slate-400" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Active Task Progress Indicator */}
      {isRunning && task.error === undefined ? (
        <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            <div className="flex-1">
              <p className="font-medium text-blue-900 dark:text-blue-200">
                {task.status === 'dispatched' ? 'Task queued...' : 'Working on your task...'}
              </p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                {elapsedTime > 0
                  ? `Elapsed time: ${formatElapsedTime(elapsedTime)}`
                  : 'Starting work...'}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <PromptCard
        prompt={task.prompt}
        sanitizedPrompt={task.sanitizedPrompt}
        onCopy={copyToClipboard}
        copiedSection={copiedSection}
      />

      {task.result !== undefined ? <TaskResultCard task={task} /> : null}

      {task.error !== undefined ? <TaskErrorCard task={task} /> : null}

      <TerminalLogViewer taskId={task.id} isActive={isRunning} />
    </Layout>
  );
}

// Memoized PromptCard to isolate copy state changes
interface PromptCardProps {
  prompt: string;
  sanitizedPrompt: string;
  onCopy: (text: string, section: string) => Promise<void>;
  copiedSection: string | null;
}

const PromptCard = memo(function PromptCard({
  prompt,
  sanitizedPrompt,
  onCopy,
  copiedSection,
}: PromptCardProps): React.JSX.Element {
  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Task Instructions</h3>
        <button
          type="button"
          onClick={() => {
            void onCopy(prompt, 'prompt');
          }}
          className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          title={copiedSection === 'prompt' ? 'Copied!' : 'Copy'}
        >
          {copiedSection === 'prompt' ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <Copy className="h-5 w-5" />
          )}
        </button>
      </div>
      <blockquote className="border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
        <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{prompt}</p>
      </blockquote>
      {sanitizedPrompt !== prompt ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
            Show sanitized prompt
          </summary>
          <blockquote className="mt-2 border-l-4 border-slate-300 bg-slate-100 py-2 pl-4 pr-3 text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <p className="whitespace-pre-wrap">{sanitizedPrompt}</p>
          </blockquote>
        </details>
      ) : null}
    </Card>
  );
});

// Memoized TaskResultCard - only re-renders when task.result changes
interface TaskResultCardProps {
  task: CodeTask;
}

const TaskResultCard = memo(function TaskResultCard({ task }: TaskResultCardProps): React.JSX.Element | null {
  const result = task.result;
  if (result === undefined) return null;

  return (
    <Card className="mb-6">
      <div className="space-y-4">
        {/* Summary section */}
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Summary</h3>
          <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{result.summary}</p>
        </div>

        {/* Additional info */}
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <GitBranch className="h-4 w-4" />
            <code className="rounded bg-slate-100 px-2 py-0.5 text-sm dark:bg-slate-700 dark:text-slate-300">{result.branch}</code>
          </div>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <GitCommit className="h-4 w-4" />
            <span>
              {result.commits} commit{result.commits !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {result.ciFailed === true ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            ⚠️ CI checks failed. Please review and fix before merging.
          </div>
        ) : null}

        {result.partialWork === true ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            ⚠️ Partial work completed. The task may need additional attention.
          </div>
        ) : null}

        {result.rebaseResult !== undefined && result.rebaseResult !== 'success' ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {result.rebaseResult === 'conflict'
              ? '⚠️ Merge conflicts need to be resolved manually.'
              : '⚠️ Rebase was skipped.'}
          </div>
        ) : null}
      </div>
    </Card>
  );
}, (prevProps, nextProps) => {
  // Only re-render if result object reference changed
  return prevProps.task.result === nextProps.task.result;
});

// Memoized TaskErrorCard - only re-renders when task.error changes
interface TaskErrorCardProps {
  task: CodeTask;
}

const TaskErrorCard = memo(function TaskErrorCard({ task }: TaskErrorCardProps): React.JSX.Element | null {
  const error = task.error;
  if (error === undefined) return null;

  return (
    <Card className="mb-6 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
        <div className="flex-1">
          <h3 className="font-medium text-red-800 dark:text-red-300">Task Failed</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error.message}</p>
        </div>
      </div>
    </Card>
  );
}, (prevProps, nextProps) => {
  // Only re-render if error object reference changed
  return prevProps.task.error === nextProps.task.error;
});

