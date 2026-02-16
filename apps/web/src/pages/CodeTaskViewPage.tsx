import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  GitBranch,
  GitCommit,
  Loader2,
  RotateCcw,
  StopCircle,
  XCircle,
} from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useTaskView, useWorkersStatus } from '@/hooks';
import type { LogLine } from '@/hooks';
import { formatDateTime, formatElapsedTime, formatRelative } from '@/utils/dateFormat';
import type { CodeTask, CodeTaskStatus } from '@/types';

// --- Status badge config ---

interface StatusConfig {
  bg: string;
  text: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STATUS_MAP: Record<CodeTaskStatus, StatusConfig> = {
  dispatched: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-800 dark:text-slate-300', label: 'Dispatched', icon: Clock },
  running: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-300', label: 'Running', icon: Loader2 },
  completed: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-800 dark:text-green-300', label: 'Completed', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-800 dark:text-red-300', label: 'Failed', icon: XCircle },
  interrupted: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Interrupted', icon: AlertCircle },
  cancelled: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Cancelled', icon: XCircle },
};

// --- Badge style lookup maps ---

const ISSUE_TYPE_STYLES: Record<string, string> = {
  feature: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  bug: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  refactor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
};

const LINEAR_STATE_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  started: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

const DEFAULT_BADGE_STYLE = 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';
const DEFAULT_STATE_STYLE = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

// --- Log line color mapping ---

function getLogLineClass(text: string): string {
  if (text.startsWith('[claude]')) return 'text-blue-300';
  if (text.startsWith('[tool]')) return 'text-yellow-300';
  if (text.startsWith('[error]')) return 'text-red-400';
  if (text.startsWith('[done]')) return 'text-green-400';
  if (text.startsWith('[hook]')) return 'text-purple-300';
  if (text.startsWith('[init]')) return 'text-cyan-300';
  if (text.startsWith('[system]')) return 'text-slate-500';
  // Tool result lines (indented with arrow or x)
  if (text.startsWith('  \u2192 ') || text.startsWith('  \u2717 ')) return 'text-slate-400';
  return 'text-slate-300';
}

// --- Page Component ---

export function CodeTaskViewPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    task, logs, loading, error,
    listenerHealthy,
    cancelling, cancelError, retrying, retryError,
    cancelTask, retryTask,
  } = useTaskView(id ?? '');
  const { status: workersStatus } = useWorkersStatus();

  const handleRetry = useCallback(async () => {
    try {
      const newId = await retryTask();
      void navigate(`/code-tasks/${newId}`);
    } catch {
      // retryTask already sets retryError state
    }
  }, [retryTask, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  if (error !== null || task === null) {
    return (
      <Layout>
        <Card variant="error" className="mt-4">
          <p>{error ?? 'Task not found'}</p>
        </Card>
      </Layout>
    );
  }

  const isActive = task.status === 'running' || task.status === 'dispatched';
  const isRetryable = task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted';
  const hasHealthyWorker = workersStatus?.workers.some((w) => w.healthy && w.priority > 0) === true;

  return (
    <Layout>
      <MemoTaskHeader task={task} />

      <MemoTaskActions
        task={task}
        isActive={isActive}
        isRetryable={isRetryable}
        hasHealthyWorker={hasHealthyWorker}
        cancelling={cancelling}
        cancelError={cancelError}
        retrying={retrying}
        retryError={retryError}
        onCancel={cancelTask}
        onRetry={handleRetry}
      />

      <MemoActiveProgress task={task} />

      <MemoTaskPrompt prompt={task.prompt} sanitizedPrompt={task.sanitizedPrompt} />

      {task.result !== undefined ? <MemoTaskResult task={task} /> : null}
      {task.error !== undefined ? <MemoTaskError task={task} /> : null}

      <MemoLogStream logs={logs} isActive={isActive} listenerHealthy={listenerHealthy} />

      {/* Reserved for future comment textarea */}
      <div className="mt-3 mb-6" />
    </Layout>
  );
}

// --- Sub-components (inline, not exported) ---

function TaskHeader({ task }: { task: CodeTask }): React.JSX.Element {
  const status = STATUS_MAP[task.status];
  const StatusIcon = status.icon;

  return (
    <div className="mb-6">
      <div className="min-h-[2.5rem] mt-1 flex flex-wrap items-center gap-2">
        {task.linearIssueId !== undefined ? (
          <span className="text-lg font-medium text-blue-600 dark:text-blue-400">
            {task.linearIssue?.identifier ?? task.linearIssueId}
          </span>
        ) : null}
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {task.linearIssue?.title ?? task.linearIssueTitle ?? 'Code Task'}
        </h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${status.bg} ${status.text}`}>
          <StatusIcon className={`h-4 w-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
          {status.label}
        </span>
      </div>

      <div className="min-h-[1.75rem] mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
        <span>Created: {formatDateTime(task.createdAt)}</span>
        {!isActiveStatus(task.status) ? (
          <span>Updated: {formatRelative(task.updatedAt)}</span>
        ) : null}
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize dark:bg-slate-700 dark:text-slate-300">
          {task.workerType}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize dark:bg-slate-700 dark:text-slate-300">
          {task.workerLocation}
        </span>

        {task.linearIssueType !== undefined ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            ISSUE_TYPE_STYLES[task.linearIssueType] ?? DEFAULT_BADGE_STYLE
          }`}>
            {task.linearIssueType}
          </span>
        ) : null}
        {task.linearIssue?.state !== undefined ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            LINEAR_STATE_STYLES[task.linearIssue.state.type] ?? DEFAULT_STATE_STYLE
          }`}>
            {task.linearIssue.state.name}
          </span>
        ) : null}
        {task.linearIssue?.assignee !== undefined && task.linearIssue.assignee !== null ? (
          <span className="text-xs text-green-600 dark:text-green-400">
            {task.linearIssue.assignee.name}
          </span>
        ) : null}
        {task.linearIssue !== undefined && task.linearIssue.commentCount > 0 ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {String(task.linearIssue.commentCount)} comments
          </span>
        ) : null}

        {task.linearIssue?.url !== undefined ? (
          <a
            href={task.linearIssue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Linear
          </a>
        ) : null}
        {task.result?.prUrl !== undefined ? (
          <a
            href={task.result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Pull Request
          </a>
        ) : null}
      </div>
    </div>
  );
}

const MemoTaskHeader = memo(TaskHeader);

function isActiveStatus(status: CodeTaskStatus): boolean {
  return status === 'dispatched' || status === 'running';
}

interface TaskActionsProps {
  task: CodeTask;
  isActive: boolean;
  isRetryable: boolean;
  hasHealthyWorker: boolean;
  cancelling: boolean;
  cancelError: string | null;
  retrying: boolean;
  retryError: string | null;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
}

function TaskActions({
  isActive, isRetryable, hasHealthyWorker,
  cancelling, cancelError, retrying, retryError,
  onCancel, onRetry,
}: TaskActionsProps): React.JSX.Element | null {
  const showActions = isActive || (isRetryable && hasHealthyWorker);
  if (!showActions && cancelError === null && retryError === null && !(isRetryable && !hasHealthyWorker)) return null;

  return (
    <div className="mb-6">
      {showActions ? (
        <div className="flex gap-3">
          {isActive ? (
            <Button
              variant="danger"
              onClick={(): void => { void onCancel(); }}
              disabled={cancelling}
              isLoading={cancelling}
            >
              <StopCircle className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Cancel Task</span>
            </Button>
          ) : null}
          {isRetryable && hasHealthyWorker ? (
            <Button
              onClick={(): void => { void onRetry(); }}
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
      {isRetryable && !hasHealthyWorker ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          No healthy workers available. Retry will be enabled when a worker is online.
        </p>
      ) : null}
      {cancelError !== null ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{cancelError}</p>
      ) : null}
      {retryError !== null ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{retryError}</p>
      ) : null}
    </div>
  );
}

const MemoTaskActions = memo(TaskActions);

// --- Elapsed timer (self-contained interval, only re-renders itself) ---

function ElapsedTimer({ createdAt }: { createdAt: string }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    if (Number.isNaN(start)) return;
    const tick = (): void => { setElapsed(Math.floor((Date.now() - start) / 1000)); };
    tick();
    const id = setInterval(tick, 1000);
    return (): void => { clearInterval(id); };
  }, [createdAt]);

  return (
    <span className="text-sm text-blue-700 dark:text-blue-300">
      {elapsed > 0 ? formatElapsedTime(elapsed) : 'Starting...'}
    </span>
  );
}

const MemoActiveProgress = memo(function ActiveProgress({ task }: { task: CodeTask }): React.JSX.Element | null {
  if (!isActiveStatus(task.status)) return null;
  if (task.error !== undefined) return null;

  return (
    <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
        <div className="flex-1">
          <p className="font-medium text-blue-900 dark:text-blue-200">
            {task.status === 'dispatched' ? 'Task queued...' : 'Working on your task...'}
          </p>
          <ElapsedTimer createdAt={task.createdAt} />
        </div>
      </div>
    </Card>
  );
}, (prev, next) => prev.task.status === next.task.status && prev.task.error === next.task.error && prev.task.createdAt === next.task.createdAt);

function TaskPrompt({ prompt, sanitizedPrompt }: { prompt: string; sanitizedPrompt: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((): void => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }).catch(() => { /* clipboard unavailable */ });
  }, [prompt]);

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Task Instructions</h3>
        <button
          type="button"
          onClick={copy}
          className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          title={copied ? 'Copied!' : 'Copy'}
        >
          {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <blockquote className="border-l-4 rounded border-blue-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
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
}

const MemoTaskPrompt = memo(TaskPrompt);

function TaskResult({ task }: { task: CodeTask }): React.JSX.Element | null {
  const result = task.result;
  if (result === undefined) return null;

  return (
    <Card className="mb-6">
      <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">Summary</h3>
      <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{result.summary}</p>
      <div className="mt-3 flex flex-wrap gap-6">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <GitBranch className="h-4 w-4" />
          <code className="rounded bg-slate-100 px-2 py-0.5 text-sm dark:bg-slate-700">{result.branch}</code>
        </div>
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <GitCommit className="h-4 w-4" />
          <span>{String(result.commits)} commit{result.commits !== 1 ? 's' : ''}</span>
        </div>
      </div>
      {result.ciFailed === true ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">CI checks failed. Review before merging.</p>
      ) : null}
      {result.partialWork === true ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Partial work completed. May need additional attention.</p>
      ) : null}
    </Card>
  );
}

const MemoTaskResult = memo(TaskResult, (prev, next) =>
  prev.task.result === next.task.result
);

function TaskError({ task }: { task: CodeTask }): React.JSX.Element | null {
  const err = task.error;
  if (err === undefined) return null;

  return (
    <Card variant="error" className="mb-6">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
        <div>
          <h3 className="font-medium text-red-800 dark:text-red-300">Task Failed</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{err.message}</p>
        </div>
      </div>
    </Card>
  );
}

const MemoTaskError = memo(TaskError, (prev, next) =>
  prev.task.error === next.task.error
);

function LogStream({ logs, isActive, listenerHealthy }: { logs: LogLine[]; isActive: boolean; listenerHealthy: boolean }): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [followLogs, setFollowLogs] = useState(true);
  const [copied, setCopied] = useState(false);
  const followRef = useRef(true);
  const prevLogCountRef = useRef(0);

  // Auto-scroll when new logs arrive and follow mode is on
  useEffect(() => {
    if (logs.length > prevLogCountRef.current && followRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLogCountRef.current = logs.length;
  }, [logs.length]);

  // Detect manual scroll-up to disable follow
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const onScroll = (): void => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (!atBottom && followRef.current) {
        followRef.current = false;
        setFollowLogs(false);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return (): void => { el.removeEventListener('scroll', onScroll); };
  }, []);

  const toggleFollow = (): void => {
    const next = !followRef.current;
    followRef.current = next;
    setFollowLogs(next);
    if (next) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const copyAllLogs = useCallback((): void => {
    const text = logs.map((l) => l.text).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }).catch(() => { /* clipboard unavailable */ });
  }, [logs]);

  return (
    <div className="mt-6 mb-6">
      {/* Terminal header */}
      <div className="flex items-center justify-between rounded-t-lg border-b border-slate-700 bg-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
            <span className="h-3 w-3 rounded-full bg-green-500/70" />
          </div>
          <span className="text-sm font-medium text-slate-300">Execution Logs</span>
          {isActive && listenerHealthy ? (
            <span className="flex items-center gap-1.5 rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-300">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {String(logs.length)} line{logs.length !== 1 ? 's' : ''}
          </span>
          {logs.length > 0 ? (
            <>
              <button
                type="button"
                onClick={toggleFollow}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  followLogs
                    ? 'text-blue-400 bg-blue-900/30 hover:text-blue-300'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                {followLogs ? 'Following' : 'Follow'}
              </button>
              <button
                type="button"
                onClick={copyAllLogs}
                className="rounded p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                title={copied ? 'Copied!' : 'Copy all logs'}
              >
                {copied ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Log lines */}
      <div
        ref={containerRef}
        className="max-h-[80vh] overflow-y-auto rounded-b-lg bg-slate-900 p-3 font-mono text-sm leading-relaxed"
      >
        {logs.length === 0 && isActive ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for logs...
          </div>
        ) : null}
        {logs.length === 0 && !isActive ? (
          <p className="text-slate-500">No logs available.</p>
        ) : null}
        {logs.map((line) => (
          <MemoLogLineRow key={line.sequence} line={line} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const MemoLogStream = memo(LogStream);

const MemoLogLineRow = memo(function LogLineRow({ line }: { line: LogLine }): React.JSX.Element {
  return (
    <div className={`whitespace-pre-wrap break-all ${getLogLineClass(line.text)}`}>
      {line.text}
    </div>
  );
});
