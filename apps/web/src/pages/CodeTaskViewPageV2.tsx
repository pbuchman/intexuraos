import { memo, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  XCircle,
} from 'lucide-react';
import { Card, Layout } from '@/components';
import { MarkdownContent } from '@/components/MarkdownContent.js';
import { PREventsGroup } from '@/components/PREventsGroup.js';
import { useTaskView, useWorkersStatus } from '@/hooks';
import { formatElapsedTime } from '@/utils/dateFormat';
import type { CodeTask, WorkerStatusTag } from '@/types';
import { V2TaskHeader } from '@/components/code-tasks/v2/V2TaskHeader.js';
import { V2LogStream } from '@/components/code-tasks/v2/V2LogStream.js';
import { V2TaskActions } from '@/components/code-tasks/v2/V2TaskActions.js';
import { V2NextSteps } from '@/components/code-tasks/v2/V2NextSteps.js';
import { isActiveStatus } from '@/components/code-tasks/v2/shared.js';
import type { WorkerType } from '@/components/code-tasks/v2/shared.js';
import { hasImplementationReadyLabel, isTaskMergeable, getTaskMergeUrl } from '@/utils/issueGroups.js';

/** Terminal statuses eligible for archive/delete actions. */
const ARCHIVABLE_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled', 'interrupted', 'planned', 'implemented', 'reviewed']);

export function CodeTaskViewPageV2(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    task, logs, loading, error,
    listenerHealthy,
    cancelling, cancelError, retrying, retryError,
    sending, sendError, messageStatus,
    implementing, implementError, startImplementation,
    deleting, deleteError, deleteTask, clearDeleteError,
    archiving, archiveError, archiveTask, clearArchiveError,
    cancelTask, retryTask, sendMessage,
  } = useTaskView(id ?? '');
  const { status: workersStatus } = useWorkersStatus();

  const [selectedWorkerType, setSelectedWorkerType] = useState<WorkerType>('auto');
  const [showRetryDropdown, setShowRetryDropdown] = useState(false);
  const [showImplementDropdown, setShowImplementDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (task?.workerType !== undefined) {
      setSelectedWorkerType(task.workerType);
    }
  }, [task?.workerType]);

  const handleRetry = useCallback(async () => {
    setShowRetryDropdown(false);
    try {
      const newId = await retryTask(selectedWorkerType);
      void navigate(`/code-tasks/${newId}`);
    } catch {
      // retryTask already sets retryError state
    }
  }, [retryTask, navigate, selectedWorkerType]);

  const handleImplement = useCallback(async () => {
    setShowImplementDropdown(false);
    try {
      const newId = await startImplementation(selectedWorkerType);
      void navigate(`/code-tasks/${newId}`);
    } catch {
      // startImplementation already sets implementError state
    }
  }, [startImplementation, navigate, selectedWorkerType]);

  const handleDelete = useCallback(async (): Promise<void> => {
    try {
      await deleteTask();
      void navigate('/code-tasks');
    } catch {
      // deleteTask already sets deleteError state
    }
  }, [deleteTask, navigate]);

  const handleArchive = useCallback(async (): Promise<void> => {
    try {
      await archiveTask();
      void navigate('/code-tasks');
    } catch {
      // archiveTask already sets archiveError state
    }
  }, [archiveTask, navigate]);

  useEffect(() => {
    if (task !== null && !ARCHIVABLE_STATUSES.has(task.status)) {
      setShowDeleteConfirm(false);
    }
  }, [task?.status]);

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

  const isActive = task.status === 'running' || task.status === 'dispatched' || task.status === 'queued';
  const isRetryable = task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted';
  const taskWorkerStatus = workersStatus !== null
    ? workersStatus.workers.find((w) => w.name === task.workerLocation)
    : undefined;
  const isTaskWorkerOnline = taskWorkerStatus === undefined || taskWorkerStatus.healthy;
  const workerStatusTag: WorkerStatusTag | null = taskWorkerStatus?.status ?? null;
  const isImplementable = task.status === 'planned' &&
    task.implementationTaskId === undefined &&
    task.linearIssueId !== undefined &&
    hasImplementationReadyLabel(task.linearIssue?.labels);
  const isMergeable = isTaskMergeable(task);
  const mergeUrl = isMergeable ? getTaskMergeUrl(task) : undefined;
  const isArchivable = ARCHIVABLE_STATUSES.has(task.status);

  return (
    <Layout>
      <MemoV2TaskHeader task={task} workerStatusTag={workerStatusTag} />

      <MemoActiveProgressCard task={task} />

      {task.parentTaskId !== undefined && task.followUpReason === 'execution_implement' ? (
        <DesignTaskBanner parentTaskId={task.parentTaskId} />
      ) : null}
      {task.agentType === 'planning' && task.implementationTaskId !== undefined ? (
        <ImplementationLinkBanner implementationTaskId={task.implementationTaskId} />
      ) : null}

      <MemoTaskPromptCard prompt={task.prompt} sanitizedPrompt={task.sanitizedPrompt} />

      {task.result?.summary !== undefined && task.result.summary !== '' ? <MemoRunSummaryCard summary={task.result.summary} /> : null}

      {task.result !== undefined ? <MemoTaskResultSection task={task} /> : null}
      {task.error !== undefined ? <MemoTaskErrorCard task={task} /> : null}

      <MemoV2LogStream
        logs={logs}
        isActive={isActive}
        listenerHealthy={listenerHealthy}
        taskStatus={task.status}
        onSendMessage={sendMessage}
        sending={sending}
        sendError={sendError}
        messageStatus={messageStatus}
        workerOnline={isTaskWorkerOnline}
        workerName={task.workerLocation}
      />

      <MemoV2NextSteps
        isImplementable={isImplementable}
        implementing={implementing}
        implementError={implementError}
        {...(task.implementationTaskId !== undefined ? { implementationTaskId: task.implementationTaskId } : {})}
        selectedWorkerType={selectedWorkerType}
        originalWorkerType={task.workerType}
        showDropdown={showImplementDropdown}
        onToggleDropdown={(): void => { setShowImplementDropdown(!showImplementDropdown); }}
        onSelectWorkerType={(type): void => { setSelectedWorkerType(type); setShowImplementDropdown(false); }}
        onImplement={(): void => { void handleImplement(); }}
        {...(task.result?.prUrl !== undefined ? { prUrl: task.result.prUrl } : {})}
        {...(task.linearIssue?.url !== undefined ? { linearIssueUrl: task.linearIssue.url } : {})}
        isMergeable={isMergeable}
        {...(mergeUrl !== undefined ? { mergeUrl } : {})}
      />

      <MemoV2TaskActions
        isActive={isActive}
        cancelling={cancelling}
        cancelError={cancelError}
        onCancel={cancelTask}
        isRetryable={isRetryable}
        retrying={retrying}
        retryError={retryError}
        selectedWorkerType={selectedWorkerType}
        originalWorkerType={task.workerType}
        showDropdown={showRetryDropdown}
        onToggleDropdown={(): void => { setShowRetryDropdown(!showRetryDropdown); }}
        onSelectWorkerType={(type): void => { setSelectedWorkerType(type); setShowRetryDropdown(false); }}
        onRetry={(): void => { void handleRetry(); }}
        deleting={deleting}
        deleteError={deleteError}
        showDeleteConfirm={showDeleteConfirm}
        onShowDeleteConfirm={(): void => { setShowDeleteConfirm(true); }}
        onCancelDeleteConfirm={(): void => { setShowDeleteConfirm(false); clearDeleteError(); clearArchiveError(); }}
        onConfirmDelete={(): void => { void handleDelete(); }}
        isArchivable={isArchivable}
        archiving={archiving}
        archiveError={archiveError}
        onArchive={(): void => { void handleArchive(); }}
        {...(task.result?.prUrl !== undefined ? { prUrl: task.result.prUrl } : {})}
        {...(task.linearIssue?.url !== undefined ? { linearIssueUrl: task.linearIssue.url } : {})}
        linksInNextSteps={isImplementable || task.implementationTaskId !== undefined || isMergeable}
      />
    </Layout>
  );
}

// --- Memo wrappers ---

const MemoV2TaskHeader = memo(V2TaskHeader);
const MemoV2LogStream = memo(V2LogStream);
const MemoV2NextSteps = memo(V2NextSteps);
const MemoV2TaskActions = memo(V2TaskActions);

// --- Inline sub-components ---

function ElapsedTimer({ createdAt }: { createdAt: string }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    if (Number.isNaN(start)) return;
    const tick = (): void => { setElapsed(Math.floor((Date.now() - start) / 1000)); };
    tick();
    const intervalId = setInterval(tick, 1000);
    return (): void => { clearInterval(intervalId); };
  }, [createdAt]);

  return (
    <span className="text-sm text-blue-700 dark:text-blue-300">
      {elapsed > 0 ? formatElapsedTime(elapsed) : 'Starting...'}
    </span>
  );
}

const MemoActiveProgressCard = memo(function ActiveProgressCard({ task }: { task: CodeTask }): React.JSX.Element | null {
  if (!isActiveStatus(task.status)) return null;
  if (task.error !== undefined) return null;

  const isQueued = task.status === 'queued';

  return (
    <Card className={`mb-6 ${task.status === 'queued' ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/30' : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30'}`}>
      <div className="flex items-center gap-3">
        {isQueued
          ? <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          : <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />}
        <div className="flex-1">
          <p className={`font-medium ${isQueued ? 'text-amber-900 dark:text-amber-200' : 'text-blue-900 dark:text-blue-200'}`}>
            {isQueued ? 'Queued for execution...' : task.status === 'dispatched' ? 'Task dispatched...' : 'Working on your task...'}
          </p>
          <ElapsedTimer createdAt={task.createdAt} />
        </div>
      </div>
    </Card>
  );
}, (prev, next) => prev.task.status === next.task.status && prev.task.error === next.task.error && prev.task.createdAt === next.task.createdAt);

function DesignTaskBanner({ parentTaskId }: { parentTaskId: string }): React.JSX.Element {
  return (
    <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300">
      {'This task implements the IntexuraOS Agent-Based Code Task Execution Flow. '}
      <a
        href={`/#/code-tasks/${parentTaskId}`}
        className="font-medium underline hover:no-underline"
      >
        {'PLANNING'}
      </a>
    </div>
  );
}

function ImplementationLinkBanner({ implementationTaskId }: { implementationTaskId: string }): React.JSX.Element {
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
      {'This task is the planning step of the IntexuraOS Agent-Based Code Task Execution Flow. '}
      <a
        href={`/#/code-tasks/${implementationTaskId}`}
        className="font-medium underline hover:no-underline"
      >
        {'IMPLEMENTATION'}
      </a>
    </div>
  );
}

const MemoTaskPromptCard = memo(function TaskPromptCard({ prompt, sanitizedPrompt }: { prompt: string; sanitizedPrompt: string }): React.JSX.Element {
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
      <div className="rounded border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
        <MarkdownContent content={prompt} />
      </div>
      {sanitizedPrompt !== prompt ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
            Show sanitized prompt
          </summary>
          <div className="mt-2 border-l-4 border-slate-300 bg-slate-100 py-2 pl-4 pr-3 text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <MarkdownContent content={sanitizedPrompt} />
          </div>
        </details>
      ) : null}
    </Card>
  );
});

const MemoRunSummaryCard = memo(function RunSummaryCard({ summary }: { summary: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((): void => {
    void navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }).catch(() => { /* clipboard unavailable */ });
  }, [summary]);

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Run Summary</h3>
        <button
          type="button"
          onClick={copy}
          className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
          title={copied ? 'Copied!' : 'Copy'}
        >
          {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <div className="rounded border-l-4 border-emerald-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
        <MarkdownContent content={summary} />
      </div>
    </Card>
  );
});

const MemoTaskResultSection = memo(function TaskResultSection({ task }: { task: CodeTask }): React.JSX.Element | null {
  const result = task.result;
  if (result === undefined) return null;

  const prNumber = result.prUrl !== undefined
    ? parseInt(/\/pull\/(\d+)/.exec(result.prUrl)?.[1] ?? '', 10)
    : undefined;

  const hasValidPr = prNumber !== undefined && !isNaN(prNumber);

  // V2 fix: Only render PREventsGroup here, NOT the summary (which is in RunSummaryCard)
  if (!hasValidPr) return null;

  return (
    <div className="mb-6">
      <PREventsGroup
        pullRequestNumber={prNumber}
        repository={task.repository}
      />
    </div>
  );
}, (prev, next) =>
  prev.task.result === next.task.result
);

const MemoTaskErrorCard = memo(function TaskErrorCard({ task }: { task: CodeTask }): React.JSX.Element | null {
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
}, (prev, next) =>
  prev.task.error === next.task.error
);
