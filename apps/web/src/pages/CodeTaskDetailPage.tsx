import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommit,
  Loader2,
  StopCircle,
  Terminal,
  XCircle,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import { Button, Card, Layout, RefreshIndicator } from '@/components';
import { useAuth } from '@/context';
import { useCodeTask } from '@/hooks';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';
import type { CodeTask, CodeTaskStatus } from '@/types';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  tool?: string;
}

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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatElapsedTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${String(diffDays)}d ago`;
  }
  if (diffHours > 0) {
    return `${String(diffHours)}h ago`;
  }
  if (diffMinutes > 0) {
    return `${String(diffMinutes)}m ago`;
  }
  return 'just now';
}

export function CodeTaskDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { task, loading, refreshing, error, cancelTask } = useCodeTask(id ?? '');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error ?? 'Task not found'}
        </div>
        <Link to="/code-tasks" className="text-blue-600 underline">
          Back to list
        </Link>
      </Layout>
    );
  }

  const status = STATUS_STYLES[task.status];
  const StatusIcon = status.icon;
  const isRunning = task.status === 'running' || task.status === 'dispatched';
  const canCancel = isRunning;

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/code-tasks" className="text-sm text-blue-600 hover:underline">
          ← Back to list
        </Link>
      </div>

      <RefreshIndicator show={refreshing} />

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {task.linearIssueId !== undefined ? (
            <span className="text-lg font-medium text-blue-600">{task.linearIssueId}</span>
          ) : null}
          <h2 className="text-2xl font-bold text-slate-900">
            {task.linearIssueTitle ?? 'Code Task'}
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${status.bg} ${status.text}`}
          >
            <StatusIcon className={`h-4 w-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
            {status.label}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500">
          <span>Created: {formatDate(task.createdAt)}</span>
          {task.status !== 'dispatched' && task.status !== 'running' ? (
            <span>Updated: {formatElapsedTime(task.updatedAt)}</span>
          ) : null}
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">
            {task.workerType}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">
            {task.workerLocation}
          </span>
        </div>

        {canCancel ? (
          <div className="mt-4 flex gap-3">
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
          </div>
        ) : null}

        {cancelError !== null ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {cancelError}
          </div>
        ) : null}
      </div>

      <Card title="Prompt" className="mb-6">
        <div className="mb-2 flex justify-end">
          <Button
            variant="secondary"
            onClick={(): void => {
              void copyToClipboard(task.prompt, 'prompt');
            }}
          >
            <Copy className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">
              {copiedSection === 'prompt' ? 'Copied!' : 'Copy'}
            </span>
          </Button>
        </div>
        <blockquote className="border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3">
          <p className="whitespace-pre-wrap text-slate-700">{task.prompt}</p>
        </blockquote>
        {task.sanitizedPrompt !== task.prompt ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
              Show sanitized prompt
            </summary>
            <blockquote className="mt-2 border-l-4 border-slate-300 bg-slate-100 py-2 pl-4 pr-3 text-sm text-slate-500">
              <p className="whitespace-pre-wrap">{task.sanitizedPrompt}</p>
            </blockquote>
          </details>
        ) : null}
      </Card>

      {task.result !== undefined ? <TaskResultCard task={task} /> : null}

      {task.error !== undefined ? <TaskErrorCard task={task} /> : null}

      <LogViewer taskId={task.id} isActive={isRunning} />
    </Layout>
  );
}

interface TaskResultCardProps {
  task: CodeTask;
}

function TaskResultCard({ task }: TaskResultCardProps): React.JSX.Element | null {
  const result = task.result;
  if (result === undefined) return null;

  return (
    <Card title="Result" className="mb-6">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-6">
          {result.prUrl !== undefined ? (
            <a
              href={result.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              View Pull Request
            </a>
          ) : null}
          <div className="flex items-center gap-2 text-slate-600">
            <GitBranch className="h-4 w-4" />
            <code className="rounded bg-slate-100 px-2 py-0.5 text-sm">{result.branch}</code>
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            <GitCommit className="h-4 w-4" />
            <span>
              {result.commits} commit{result.commits !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {result.ciFailed === true ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            ⚠️ CI checks failed. Please review and fix before merging.
          </div>
        ) : null}

        {result.partialWork === true ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            ⚠️ Partial work completed. The task may need additional attention.
          </div>
        ) : null}

        {result.rebaseResult !== undefined && result.rebaseResult !== 'success' ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {result.rebaseResult === 'conflict'
              ? '⚠️ Merge conflicts need to be resolved manually.'
              : '⚠️ Rebase was skipped.'}
          </div>
        ) : null}

        <div>
          <h4 className="mb-2 font-medium text-slate-700">Summary</h4>
          <p className="whitespace-pre-wrap text-slate-600">{result.summary}</p>
        </div>
      </div>
    </Card>
  );
}

interface TaskErrorCardProps {
  task: CodeTask;
}

function TaskErrorCard({ task }: TaskErrorCardProps): React.JSX.Element | null {
  const error = task.error;
  if (error === undefined) return null;

  return (
    <Card className="mb-6 border-red-200 bg-red-50">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div>
          <h3 className="font-semibold text-red-800">Error: {error.code}</h3>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
          {error.remediation !== undefined ? (
            <div className="mt-3 space-y-2">
              {error.remediation.manualSteps !== undefined ? (
                <p className="text-sm text-slate-700">
                  <strong>Manual steps:</strong> {error.remediation.manualSteps}
                </p>
              ) : null}
              {error.remediation.supportLink !== undefined ? (
                <a
                  href={error.remediation.supportLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Get help
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

interface LogViewerProps {
  taskId: string;
  isActive: boolean;
}

function LogViewer({ taskId, isActive }: LogViewerProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const firebaseAuthenticatedRef = useRef(false);
  const isMountedRef = useRef(true);

  const scrollToBottom = useCallback((): void => {
    if (autoScroll && logsEndRef.current !== null) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [autoScroll]);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const setupListener = async (): Promise<void> => {
      try {
        if (!firebaseAuthenticatedRef.current || !isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessToken();
          await authenticateFirebase(token);
          firebaseAuthenticatedRef.current = true;
        }

        const db = getFirestoreClient();
        const logsRef = collection(db, 'code_tasks', taskId, 'logs');
        const logsQuery = query(logsRef, orderBy('timestamp', 'asc'));

        unsubscribeRef.current = onSnapshot(
          logsQuery,
          (snapshot) => {
            if (!isMountedRef.current) return;

            const newLogs: LogEntry[] = [];
            snapshot.forEach((doc) => {
              const data = doc.data();
              const toolValue = data['tool'] as string | undefined;
              const levelValue = data['level'] as string | undefined;
              const level: LogEntry['level'] =
                levelValue === 'info' ||
                levelValue === 'warn' ||
                levelValue === 'error' ||
                levelValue === 'debug'
                  ? levelValue
                  : 'info';
              const entry: LogEntry = {
                id: doc.id,
                timestamp: data['timestamp'] as string,
                level,
                message: data['message'] as string,
              };
              if (toolValue !== undefined) {
                entry.tool = toolValue;
              }
              newLogs.push(entry);
            });
            setLogs(newLogs);
            setLogsLoading(false);
            setTimeout(scrollToBottom, 100);
          },
          (err) => {
            if (isMountedRef.current) {
              setLogsError(err.message);
              setLogsLoading(false);
            }
          }
        );
      } catch (err) {
        if (isMountedRef.current) {
          setLogsError(err instanceof Error ? err.message : 'Failed to load logs');
          setLogsLoading(false);
        }
      }
    };

    void setupListener();

    return (): void => {
      if (unsubscribeRef.current !== null) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [taskId, getAccessToken, scrollToBottom]);

  const formatLogTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getLevelColor = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-amber-400';
      case 'debug':
        return 'text-slate-500';
      default:
        return 'text-green-400';
    }
  };

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          <span>Execution Logs</span>
          {isActive ? (
            <span className="ml-2 flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : null}
        </div>
      }
      className="mb-6"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-slate-500">
          {logs.length} log{logs.length !== 1 ? 's' : ''}
        </span>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e): void => {
              setAutoScroll(e.target.checked);
            }}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Auto-scroll
        </label>
      </div>

      <div className="rounded-lg bg-slate-900 p-4 font-mono text-sm max-h-96 overflow-y-auto">
        {logsLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading logs...
          </div>
        ) : logsError !== null ? (
          <div className="text-red-400">Error: {logsError}</div>
        ) : logs.length === 0 ? (
          <div className="text-slate-500">No logs yet...</div>
        ) : (
          <>
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2 py-0.5 hover:bg-slate-800/50">
                <span className="text-slate-500 shrink-0">{formatLogTime(log.timestamp)}</span>
                <span className={`shrink-0 uppercase w-12 ${getLevelColor(log.level)}`}>
                  [{log.level}]
                </span>
                {log.tool !== undefined ? (
                  <span className="text-blue-400 shrink-0">[{log.tool}]</span>
                ) : null}
                <span className="text-slate-200 break-all">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </>
        )}
      </div>
    </Card>
  );
}
