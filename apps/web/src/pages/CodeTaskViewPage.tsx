import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  Play,
  RotateCcw,
  Send,
  StopCircle,
  Trash2,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { PREventsGroup } from '@/components/PREventsGroup';
import { useTaskView, useWorkersStatus } from '@/hooks';
import type { LogLine, MessageStatus } from '@/hooks';
import { formatDateTime, formatElapsedTime, formatRelative } from '@/utils/dateFormat';
import type { CodeTask, CodeTaskStatus, WorkerStatusTag } from '@/types';

// --- Worker type config ---

export type WorkerType = 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';

const WORKER_TYPES: WorkerType[] = ['auto', 'opus', 'sonnet', 'minimax', 'glm', 'qwen3.5-plus'];

const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  auto: 'Auto',
  opus: 'Opus',
  sonnet: 'Sonnet',
  minimax: 'Minimax',
  glm: 'GLM',
  'qwen3.5-plus': 'Qwen 3.5 Plus',
};

// --- Status badge config ---

interface StatusConfig {
  bg: string;
  text: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STATUS_MAP: Record<CodeTaskStatus, StatusConfig> = {
  queued: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Queued', icon: Clock },
  dispatched: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-800 dark:text-slate-300', label: 'Dispatched', icon: Clock },
  running: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-800 dark:text-blue-300', label: 'Running', icon: Loader2 },
  planned: { bg: 'bg-violet-100 dark:bg-violet-900/50', text: 'text-violet-800 dark:text-violet-300', label: 'Planned', icon: CheckCircle2 },
  implemented: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-800 dark:text-green-300', label: 'Implemented', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100 dark:bg-red-900/50', text: 'text-red-800 dark:text-red-300', label: 'Failed', icon: XCircle },
  interrupted: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-800 dark:text-amber-300', label: 'Interrupted', icon: AlertCircle },
  cancelled: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400', label: 'Cancelled', icon: XCircle },
  archived: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-500', label: 'Archived', icon: Archive },
};

const LINEAR_STATE_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  started: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

const DEFAULT_STATE_STYLE = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

const WORKER_STATUS_STYLES: Record<WorkerStatusTag, string> = {
  healthy: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-700 dark:text-emerald-100',
  'orchestrator-unreachable': 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-red-100',
  'tunnel-down': 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-red-100',
  unknown: 'bg-amber-200 text-amber-900 dark:bg-amber-700 dark:text-amber-100',
};

// --- Log line color mapping ---

const TAG_RE = /^(?:\d{2}:\d{2}:\d{2}\.\d{3} )?\[(\w+)\]/;

function extractTag(text: string): string | null {
  return TAG_RE.exec(text)?.[1] ?? null;
}

interface TagStyle {
  text: string;
  border?: string;
  bg?: string;
}

const TAG_STYLES: Record<string, TagStyle> = {
  user:         { text: 'text-cyan-400',    border: 'border-cyan-800',    bg: 'bg-cyan-900/20' },
  queued:       { text: 'text-amber-400',   border: 'border-amber-700',   bg: 'bg-amber-900/20' },
  resumed:      { text: 'text-emerald-400', border: 'border-emerald-700', bg: 'bg-emerald-900/20' },
  prompt:       { text: 'text-orange-300',  border: 'border-orange-700',  bg: 'bg-orange-900/20' },
  instructions: { text: 'text-violet-300',  border: 'border-violet-700',  bg: 'bg-violet-900/20' },
  claude:       { text: 'text-blue-300' },
  tool:         { text: 'text-yellow-300' },
  error:        { text: 'text-red-400' },
  done:         { text: 'text-green-400' },
  hook:         { text: 'text-purple-300' },
  init:         { text: 'text-cyan-300' },
  system:       { text: 'text-slate-500' },
  orchestrator: { text: 'text-slate-500' },
};

function getLogLineClass(text: string): string {
  const tag = extractTag(text);
  if (tag !== null) return TAG_STYLES[tag]?.text ?? 'text-slate-300';
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
    sending, sendError, messageStatus,
    implementing, implementError, startImplementation,
    deleting, deleteError, deleteTask, clearDeleteError,
    cancelTask, retryTask, sendMessage,
  } = useTaskView(id ?? '');
  const { status: workersStatus } = useWorkersStatus();

  // Worker type selection state
  const [selectedWorkerType, setSelectedWorkerType] = useState<WorkerType>('auto');
  const [showRetryDropdown, setShowRetryDropdown] = useState(false);
  const [showImplementDropdown, setShowImplementDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Set default worker type from task when it loads
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

  // Reset delete confirmation state when the task is no longer in a retryable status
  useEffect(() => {
    if (task !== null && task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'interrupted') {
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
    task.linearIssueId !== undefined;

  return (
    <Layout>
      <MemoTaskHeader task={task} workerStatusTag={workerStatusTag} />

      <MemoActiveProgress task={task} />

      {task.parentTaskId !== undefined && task.followUpReason === 'execution_implement' ? (
        <DesignTaskBanner
          parentTaskId={task.parentTaskId}
        />
      ) : null}
      {task.agentType === 'planning' && task.implementationTaskId !== undefined ? (
        <ImplementationLinkBanner implementationTaskId={task.implementationTaskId} />
      ) : null}

      <MemoTaskPrompt prompt={task.prompt} sanitizedPrompt={task.sanitizedPrompt} />

      {task.result?.summary !== undefined && task.result.summary !== '' ? <MemoRunSummary summary={task.result.summary} /> : null}

      {task.result !== undefined ? <MemoTaskResult task={task} /> : null}
      {task.error !== undefined ? <MemoTaskError task={task} /> : null}

      <MemoLogStream
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

      <MemoNextSteps
        isImplementable={isImplementable}
        implementing={implementing}
        implementError={implementError}
        {...(task.implementationTaskId !== undefined ? { implementationTaskId: task.implementationTaskId } : {})}
        selectedWorkerType={selectedWorkerType}
        originalWorkerType={task.workerType as WorkerType}
        showDropdown={showImplementDropdown}
        onToggleDropdown={(): void => { setShowImplementDropdown(!showImplementDropdown); }}
        onSelectWorkerType={(type): void => { setSelectedWorkerType(type); setShowImplementDropdown(false); }}
        onImplement={(): void => { void handleImplement(); }}
        {...(task.result?.prUrl !== undefined ? { prUrl: task.result.prUrl } : {})}
        {...(task.linearIssue?.url !== undefined ? { linearIssueUrl: task.linearIssue.url } : {})}
      />

      <MemoTaskActions
        isActive={isActive}
        cancelling={cancelling}
        cancelError={cancelError}
        onCancel={cancelTask}
        isRetryable={isRetryable}
        retrying={retrying}
        retryError={retryError}
        selectedWorkerType={selectedWorkerType}
        originalWorkerType={task.workerType as WorkerType}
        showDropdown={showRetryDropdown}
        onToggleDropdown={(): void => { setShowRetryDropdown(!showRetryDropdown); }}
        onSelectWorkerType={(type): void => { setSelectedWorkerType(type); setShowRetryDropdown(false); }}
        onRetry={(): void => { void handleRetry(); }}
        deleting={deleting}
        deleteError={deleteError}
        showDeleteConfirm={showDeleteConfirm}
        onShowDeleteConfirm={(): void => { setShowDeleteConfirm(true); }}
        onCancelDeleteConfirm={(): void => { setShowDeleteConfirm(false); clearDeleteError(); }}
        onConfirmDelete={(): void => { void handleDelete(); }}
        {...(task.result?.prUrl !== undefined ? { prUrl: task.result.prUrl } : {})}
        {...(task.linearIssue?.url !== undefined ? { linearIssueUrl: task.linearIssue.url } : {})}
      />
    </Layout>
  );
}

// --- Sub-components (inline, not exported) ---

function TaskHeader({ task, workerStatusTag }: { task: CodeTask; workerStatusTag: WorkerStatusTag | null }): React.JSX.Element {
  const status = STATUS_MAP[task.status];
  const StatusIcon = status.icon;

  return (
    <div className="mb-6">
      <div className="min-h-[2.5rem] mt-1 flex flex-wrap items-center gap-2">
        {task.linearIssueId !== undefined ? (
          task.linearIssue?.url !== undefined ? (
            <a
              href={task.linearIssue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {task.linearIssue.identifier}
            </a>
          ) : (
            <span className="text-lg font-medium text-blue-600 dark:text-blue-400">
              {task.linearIssue?.identifier ?? task.linearIssueId}
            </span>
          )
        ) : null}
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {task.linearIssue?.title ?? 'Code Task'}
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
        {task.agentType === 'planning' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            Planning
          </span>
        ) : task.agentType === 'execution' ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            Execution
          </span>
        ) : null}
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
          {task.workerType}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${workerStatusTag !== null ? WORKER_STATUS_STYLES[workerStatusTag] : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
          {task.workerLocation}
        </span>
        {task.linearIssue?.state !== undefined ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            LINEAR_STATE_STYLES[task.linearIssue.state.type] ?? DEFAULT_STATE_STYLE
          }`}>
            {task.linearIssue.state.name}
          </span>
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
            className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/80"
          >
            {task.linearIssue.identifier}
          </a>
        ) : null}
        {task.result?.prUrl !== undefined ? (
          <a
            href={task.result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80"
          >
            PR #{/\/pull\/(\d+)/.exec(task.result.prUrl)?.[1] ?? ''}
          </a>
        ) : null}
      </div>
    </div>
  );
}

const MemoTaskHeader = memo(TaskHeader);

function isActiveStatus(status: CodeTaskStatus): boolean {
  return status === 'queued' || status === 'dispatched' || status === 'running';
}

function GitHubButton({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-600"
    >
      GitHub
    </a>
  );
}

function LinearButton({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-violet-600 bg-violet-700 px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-600"
    >
      Linear
    </a>
  );
}

function TaskActions({
  isActive, cancelling, cancelError, onCancel,
  isRetryable, retrying, retryError,
  selectedWorkerType, originalWorkerType, showDropdown, onToggleDropdown, onSelectWorkerType,
  onRetry,
  deleting, deleteError, showDeleteConfirm,
  onShowDeleteConfirm, onCancelDeleteConfirm, onConfirmDelete,
  prUrl, linearIssueUrl,
}: {
  isActive: boolean;
  cancelling: boolean;
  cancelError: string | null;
  onCancel: () => Promise<void>;
  isRetryable: boolean;
  retrying: boolean;
  retryError: string | null;
  selectedWorkerType: WorkerType;
  originalWorkerType: WorkerType;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  onSelectWorkerType: (type: WorkerType) => void;
  onRetry: () => void;
  deleting: boolean;
  deleteError: string | null;
  showDeleteConfirm: boolean;
  onShowDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onConfirmDelete: () => void;
  prUrl?: string;
  linearIssueUrl?: string;
}): React.JSX.Element | null {
  if (!isActive && !isRetryable && cancelError === null && retryError === null && deleteError === null && prUrl === undefined && linearIssueUrl === undefined) return null;

  return (
    <div className="mt-4 flex flex-wrap items-stretch gap-3">
      {isActive ? (
        <>
          <Button
            variant="danger"
            onClick={(): void => { void onCancel(); }}
            disabled={cancelling}
            isLoading={cancelling}
          >
            <StopCircle className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Cancel Task</span>
          </Button>
          {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
          {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
        </>
      ) : null}
      {isRetryable ? (
        showDeleteConfirm ? (
          <div className="ml-auto flex items-center gap-3">
            <p className="text-sm text-red-400">Delete this task permanently?</p>
            <Button
              variant="danger"
              size="sm"
              onClick={onConfirmDelete}
              disabled={deleting}
              isLoading={deleting}
              loadingText="Deleting..."
            >
              Delete
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancelDeleteConfirm}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <div className="relative flex">
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying || deleting}
                className="flex items-center gap-2 rounded-l-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                <span className="hidden sm:inline">Retry Task</span>
                <span className="hidden sm:inline font-normal text-blue-200">{'· '}{WORKER_TYPE_LABELS[selectedWorkerType]}</span>
              </button>
              <div className="w-px bg-blue-400/30" />
              <button
                type="button"
                onClick={onToggleDropdown}
                disabled={retrying || deleting}
                className="flex items-center rounded-r-lg bg-blue-600 px-2.5 py-2 text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showDropdown ? (
                <div className="absolute bottom-full left-0 z-10 mb-2 w-48 rounded-lg border border-gray-700 bg-gray-800 py-1.5 shadow-xl">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Model</div>
                  {WORKER_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={(): void => { onSelectWorkerType(type); }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-700 ${
                        selectedWorkerType === type ? 'text-blue-400' : 'text-gray-300'
                      }`}
                    >
                      <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                        selectedWorkerType === type ? 'border-blue-400' : 'border-gray-500'
                      }`}>
                        {selectedWorkerType === type ? <div className="h-1.5 w-1.5 rounded-full bg-blue-400" /> : null}
                      </div>
                      <span className="flex-1">{WORKER_TYPE_LABELS[type]}</span>
                      {type === originalWorkerType ? (
                        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-400">original</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
            {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
            <button
              type="button"
              onClick={onShowDeleteConfirm}
              disabled={deleting || retrying}
              className="ml-auto flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-red-900/20 hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          </>
        )
      ) : null}
      {!isActive && !isRetryable ? (
        <>
          {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
          {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
        </>
      ) : null}
      {cancelError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{cancelError}</p>
      ) : null}
      {retryError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{retryError}</p>
      ) : null}
      {deleteError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
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
            {task.status === 'queued' ? 'Waiting for available worker...' : task.status === 'dispatched' ? 'Task dispatched...' : 'Working on your task...'}
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

interface NextStepsProps {
  isImplementable: boolean;
  implementing: boolean;
  implementError: string | null;
  implementationTaskId?: string;
  selectedWorkerType: WorkerType;
  originalWorkerType: WorkerType;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  onSelectWorkerType: (type: WorkerType) => void;
  onImplement: () => void;
  prUrl?: string;
  linearIssueUrl?: string;
}

function NextSteps({
  isImplementable,
  implementing,
  implementError,
  implementationTaskId,
  selectedWorkerType,
  originalWorkerType,
  showDropdown,
  onToggleDropdown,
  onSelectWorkerType,
  onImplement,
  prUrl,
  linearIssueUrl,
}: NextStepsProps): React.JSX.Element | null {
  if (!isImplementable && implementationTaskId === undefined && implementError === null) return null;

  return (
    <div className="mt-4">
      {implementationTaskId !== undefined ? (
        <div className="flex items-center gap-3">
          <a
            href={`/#/code-tasks/${implementationTaskId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            <Play className="h-4 w-4" />
            View Implementation
          </a>
          {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
          {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
        </div>
      ) : isImplementable ? (
        <div className="relative flex items-center gap-3">
          <div className="relative flex">
            <button
              type="button"
              onClick={onImplement}
              disabled={implementing}
              className="flex items-center gap-2 rounded-l-lg border border-emerald-600/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
            >
              {implementing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="hidden sm:inline">Implement</span>
              <span className="hidden sm:inline font-normal text-emerald-400/70">{'· '}{WORKER_TYPE_LABELS[selectedWorkerType]}</span>
            </button>
            <div className="w-px bg-emerald-500/20" />
            <button
              type="button"
              onClick={onToggleDropdown}
              disabled={implementing}
              className="flex items-center rounded-r-lg border border-l-0 border-emerald-600/30 bg-emerald-500/10 px-2.5 py-2 text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showDropdown ? (
              <div className="absolute bottom-full left-0 z-10 mb-2 w-48 rounded-lg border border-gray-700 bg-gray-800 py-1.5 shadow-xl">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Model</div>
                {WORKER_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={(): void => { onSelectWorkerType(type); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-700 ${
                      selectedWorkerType === type ? 'text-emerald-400' : 'text-gray-300'
                    }`}
                  >
                    <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                      selectedWorkerType === type ? 'border-emerald-400' : 'border-gray-500'
                    }`}>
                      {selectedWorkerType === type ? <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
                    </div>
                    <span className="flex-1">{WORKER_TYPE_LABELS[type]}</span>
                    {type === originalWorkerType ? (
                      <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">plan</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
          {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
        </div>
      ) : null}
      {implementError !== null ? (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-400">{implementError}</p>
        </div>
      ) : null}
    </div>
  );
}

const MemoNextSteps = memo(NextSteps);

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

function RunSummary({ summary }: { summary: string }): React.JSX.Element {
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
      <blockquote className="border-l-4 rounded border-emerald-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
        <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{summary}</p>
      </blockquote>
    </Card>
  );
}

const MemoRunSummary = memo(RunSummary);

function TaskResult({ task }: { task: CodeTask }): React.JSX.Element | null {
  const result = task.result;
  if (result === undefined) return null;

  const prNumber = result.prUrl !== undefined
    ? parseInt(/\/pull\/(\d+)/.exec(result.prUrl)?.[1] ?? '', 10)
    : undefined;

  if (prNumber === undefined || isNaN(prNumber)) return null;

  return (
    <div className="mb-6">
      <PREventsGroup
        pullRequestNumber={prNumber}
        title={result.summary ?? null}
        repository={task.repository}
      />
    </div>
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

// --- Tool block collapsing ---

interface ToolBlock {
  headerIdx: number;
  bodyStart: number;
  bodyEnd: number;
  finalized: boolean;
}

const TIMESTAMP_PREFIX_RE = /^\d{2}:\d{2}:\d{2}\.\d{3} /;

function isBodyLine(text: string): boolean {
  const stripped = text.replace(TIMESTAMP_PREFIX_RE, '');
  return stripped.startsWith('  \u2192 ') || stripped.startsWith('  \u2717 ') || stripped.startsWith('    ');
}

function countVisualLines(logs: LogLine[], start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; i++) {
    const line = logs[i];
    if (line !== undefined) {
      count += line.text.split('\n').length;
    }
  }
  return count;
}

interface LogStreamProps {
  logs: LogLine[];
  isActive: boolean;
  listenerHealthy: boolean;
  taskStatus: CodeTaskStatus;
  onSendMessage: (message: string) => Promise<void>;
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: MessageStatus;
  workerOnline: boolean;
  workerName: string;
}

/** Delay (ms) before clearing the auto-scroll guard flag after a programmatic scrollIntoView. */
const SMOOTH_SCROLL_GUARD_MS = 500;

function LogStream({ logs, isActive, listenerHealthy, taskStatus, onSendMessage, sending, sendError, messageStatus, workerOnline, workerName }: LogStreamProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [followLogs, setFollowLogs] = useState(true);
  const [copied, setCopied] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [blockOverrides, setBlockOverrides] = useState<Set<number>>(() => new Set());
  const followRef = useRef(true);
  const prevLogCountRef = useRef(0);
  const isAutoScrollingRef = useRef(false);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Tool block collapsing
  const bodyLineMap = useMemo(() => {
    const blocks: ToolBlock[] = [];
    let current: ToolBlock | null = null;

    const finalizeBlock = (endIdx: number): void => {
      if (current !== null) {
        current.bodyEnd = endIdx;
        current.finalized = true;
        if (current.bodyEnd > current.bodyStart) {
          blocks.push(current);
        }
        current = null;
      }
    };

    for (let i = 0; i < logs.length; i++) {
      const line = logs[i];
      if (line === undefined) continue;
      const text = line.text;
      const tag = extractTag(text);

      if (tag === 'tool') {
        finalizeBlock(i);
        current = { headerIdx: i, bodyStart: i + 1, bodyEnd: i + 1, finalized: false };
      } else if (tag !== null) {
        finalizeBlock(i);
      } else if (current !== null && isBodyLine(text)) {
        current.bodyEnd = i + 1;
      } else {
        finalizeBlock(i);
      }
    }
    // Last open block stays unfinalized (still streaming)
    if (current !== null && current.bodyEnd > current.bodyStart) {
      blocks.push(current);
    }

    const map = new Map<number, ToolBlock>();
    for (const block of blocks) {
      map.set(block.headerIdx, block);
      for (let j = block.bodyStart; j < block.bodyEnd; j++) {
        map.set(j, block);
      }
    }
    return map;
  }, [logs]);

  // Auto-scroll when new logs arrive and follow mode is on
  useEffect(() => {
    if (logs.length > prevLogCountRef.current && followRef.current) {
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = setTimeout(() => { isAutoScrollingRef.current = false; }, SMOOTH_SCROLL_GUARD_MS);
    }
    prevLogCountRef.current = logs.length;
    return (): void => { clearTimeout(autoScrollTimerRef.current); };
  }, [logs.length]);

  // Detect manual scroll-up to disable follow
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const onScroll = (): void => {
      if (isAutoScrollingRef.current) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (atBottom && !followRef.current) {
        followRef.current = true;
        setFollowLogs(true);
      } else if (!atBottom && followRef.current) {
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
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = setTimeout(() => { isAutoScrollingRef.current = false; }, SMOOTH_SCROLL_GUARD_MS);
    }
  };

  const copyAllLogs = useCallback((): void => {
    const text = logs.map((l) => l.text).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }).catch(() => { /* clipboard unavailable */ });
  }, [logs]);

  const toggleCompact = useCallback((): void => {
    setCompactMode((prev) => !prev);
    setBlockOverrides(new Set());
  }, []);

  const toggleBlock = useCallback((headerIdx: number): void => {
    setBlockOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(headerIdx)) {
        next.delete(headerIdx);
      } else {
        next.add(headerIdx);
      }
      return next;
    });
  }, []);

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
                onClick={toggleCompact}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  compactMode
                    ? 'text-blue-400 bg-blue-900/30 hover:text-blue-300'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                {compactMode ? 'Collapse All' : 'Expand All'}
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
        className={`max-h-[80vh] overflow-y-auto bg-slate-900 p-3 font-mono text-sm leading-relaxed${taskStatus === 'cancelled' ? ' rounded-b-lg' : ''}`}
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
        {logs.map((line, idx) => {
          const block = bodyLineMap.get(idx);
          if (block === undefined) {
            return <MemoLogLineRow key={line.sequence} line={line} />;
          }
          const isHeader = idx === block.headerIdx;
          const collapsible = block.finalized && countVisualLines(logs, block.bodyStart, block.bodyEnd) >= 2;
          const collapsed = collapsible && (compactMode !== blockOverrides.has(block.headerIdx));

          if (!isHeader && collapsed) return null;

          return (
            <MemoLogLineRow
              key={line.sequence}
              line={line}
              collapsible={isHeader && collapsible}
              collapsed={isHeader && collapsed}
              hiddenCount={isHeader ? countVisualLines(logs, block.bodyStart, block.bodyEnd) : 0}
              {...(isHeader && collapsible ? { onToggle: toggleBlock } : {})}
              headerIdx={block.headerIdx}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        onSendMessage={onSendMessage}
        sending={sending}
        sendError={sendError}
        messageStatus={messageStatus}
        workerOnline={workerOnline}
        workerName={workerName}
      />
    </div>
  );
}

function MessageInput({ onSendMessage, sending, sendError, messageStatus, workerOnline, workerName }: {
  onSendMessage: (message: string) => Promise<void>;
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: MessageStatus;
  workerOnline: boolean;
  workerName: string;
}): React.JSX.Element {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback((): void => {
    const trimmed = message.trim();
    if (trimmed.length === 0 || sending) return;
    setMessage('');
    // Reset textarea height
    if (textareaRef.current !== null) {
      textareaRef.current.style.height = '';
    }
    void onSendMessage(trimmed).finally(() => {
      // Restore focus after React settles (resume path re-renders heavily)
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    });
  }, [message, sending, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-grow textarea
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setMessage(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, 96))}px`;
  }, []);

  const hasText = message.trim().length > 0;

  return (
    <div className="rounded-b-lg border-t border-slate-700 bg-slate-800/90 px-3 py-2">
      {!workerOnline ? (
        <div className="flex items-center gap-2 rounded bg-amber-900/30 border border-amber-800/50 px-2.5 py-1.5 text-xs text-amber-300 mb-2">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span>Worker may be offline — message will be delivered when the worker is back online</span>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <span className={`pb-1.5 text-sm font-mono ${hasText ? 'text-blue-400' : 'text-slate-500'}`}>&rsaquo;</span>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Send a message to Claude..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none font-mono leading-relaxed min-h-6 max-h-24"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!hasText || sending}
          className={`rounded p-1.5 transition-colors ${
            hasText && !sending
              ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-900/30'
              : 'text-slate-600 cursor-not-allowed'
          }`}
          title="Send (Enter)"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>

      {messageStatus === 'delivered' ? (
        <p className="mt-1 text-xs text-green-400">
          Message delivered — task resumed
        </p>
      ) : null}
      {sendError !== null ? (
        sendError.code === 'WORKER_UNAVAILABLE' ? (
          <div className="mt-2 flex items-center gap-2 rounded bg-amber-900/30 border border-amber-800/50 px-2.5 py-1.5 text-xs text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>Worker <strong>{workerName}</strong> is offline — task can only be continued when this worker is back online</span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-red-400">{sendError.message}</p>
        )
      ) : null}
    </div>
  );
}

const MemoLogStream = memo(LogStream);

interface LogLineRowProps {
  line: LogLine;
  collapsible?: boolean;
  collapsed?: boolean;
  hiddenCount?: number;
  onToggle?: (headerIdx: number) => void;
  headerIdx?: number;
}

const MemoLogLineRow = memo(function LogLineRow({ line, collapsible, collapsed, hiddenCount, onToggle, headerIdx }: LogLineRowProps): React.JSX.Element {
  const tag = extractTag(line.text);
  const style = tag !== null ? TAG_STYLES[tag] : undefined;
  const border = style?.border;
  const extraClass = border !== undefined ? ` border-l-2 ${border} ${style?.bg ?? ''} pl-2` : '';

  if (collapsible === true) {
    const Chevron = collapsed === true ? ChevronRight : ChevronDown;
    return (
      <div
        role="button"
        tabIndex={0}
        className={`whitespace-pre-wrap break-all ${getLogLineClass(line.text)}${extraClass} cursor-pointer select-none flex items-start gap-1 hover:bg-slate-800/50 -mx-1 px-1 rounded`}
        onClick={(): void => { if (headerIdx !== undefined) onToggle?.(headerIdx); }}
        onKeyDown={(e): void => {
          if ((e.key === 'Enter' || e.key === ' ') && headerIdx !== undefined) {
            e.preventDefault();
            onToggle?.(headerIdx);
          }
        }}
      >
        <Chevron className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" />
        <span className="flex-1">
          {line.text}
          {collapsed === true && hiddenCount !== undefined && hiddenCount > 0 ? (
            <span className="ml-2 text-xs text-slate-500">(+{String(hiddenCount)} lines)</span>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className={`whitespace-pre-wrap break-all ${getLogLineClass(line.text)}${extraClass}`}>
      {line.text}
    </div>
  );
}, (prev, next) =>
  prev.line === next.line &&
  prev.collapsed === next.collapsed &&
  prev.collapsible === next.collapsible &&
  prev.hiddenCount === next.hiddenCount
);
