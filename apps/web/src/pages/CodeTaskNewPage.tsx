import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core/code-task-worker-types';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Play, Link2, Sparkles, Pencil } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import rehypeSanitize from 'rehype-sanitize';
import { Button, Card, Layout, ConfirmSubmitModal, TaskConflictModal, TaskErrorModal, LinearIssueSelectorModal } from '@/components';
import type { ConflictReason } from '@/components';
import { useLinearIssueOptions, useWorkersStatus, findRecentTask } from '@/hooks';
import type { CodeTaskWorkerType } from '@/types';
import type { LinearIssueOption } from '@/hooks/useLinearIssueOptions';
import { ApiError, parseConflictError } from '@/services/apiClient';
import { listCodeTasks, submitCodeTask } from '@/services/codeAgentApi';
import { useAuth } from '@/context';
import { WORKER_TYPE_METADATA } from '@/components/workers/shared.js';

const WORKER_TYPES: { id: CodeTaskWorkerType; name: string; description: string }[] = CODE_TASK_WORKER_TYPES.map((id) => ({
  id,
  ...WORKER_TYPE_METADATA[id],
}));

type LinearMode = 'create' | 'link';

const PLANNING_PLACEHOLDER =
  'Describe what you want to build. The selected worker will analyze the instructions, create a Linear issue with acceptance criteria, and prepare a design — no code will be written prior to your approval.';

const EXECUTION_DEFAULT_PROMPT =
  'Implement exactly as described in the linked Linear issue. Follow the acceptance criteria and design, run CI, and create a PR.';

const LINEAR_MODES: { id: LinearMode; name: string; description: string; icon: React.ReactNode }[] = [
  { id: 'create', name: 'Create New', description: 'Auto-generate title from task description', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'link', name: 'Link Existing', description: 'Link to an existing Linear issue', icon: <Link2 className="h-4 w-4" /> },
];

/** Delay after which loading text changes to reassure users */
const LONG_SUBMIT_DELAY_MS = 10000;

export function CodeTaskNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const { groupedOptions, loading: linearLoading, error: linearError } = useLinearIssueOptions();

  const [prompt, setPrompt] = useState('');
  const [workerType, setWorkerType] = useState<CodeTaskWorkerType>('auto');
  const [linearMode, setLinearMode] = useState<LinearMode>('create');
  const [selectedIssue, setSelectedIssue] = useState<LinearIssueOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingText, setLoadingText] = useState('Submitting...');
  const [error, setError] = useState<string | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<{ taskId: string; reason: ConflictReason } | null>(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [taskError, setTaskError] = useState<ApiError | null>(null);
  const [showIssueSelectorModal, setShowIssueSelectorModal] = useState(false);
  const longSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptManuallyEdited = useRef(false);

  /** Clear the phased loading timer */
  const clearLongSubmitTimer = useCallback((): void => {
    if (longSubmitTimerRef.current !== null) {
      clearTimeout(longSubmitTimerRef.current);
      longSubmitTimerRef.current = null;
    }
  }, []);

  /** Start phased loading: after LONG_SUBMIT_DELAY_MS, update the text */
  const startLongSubmitTimer = useCallback((): void => {
    clearLongSubmitTimer();
    longSubmitTimerRef.current = setTimeout(() => {
      setLoadingText('Still processing, please wait...');
    }, LONG_SUBMIT_DELAY_MS);
  }, [clearLongSubmitTimer]);

  // Clean up timer on unmount
  useEffect(() => {
    return clearLongSubmitTimer;
  }, [clearLongSubmitTimer]);

  const { status: workersStatus, loading: workersLoading } = useWorkersStatus();

  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Compute all workers (sorted by priority, priority > 0 means enabled)
  const allWorkers = useMemo(() => {
    if (workersStatus === null) return [];
    return workersStatus.workers.filter((w) => w.priority > 0).sort((a, b) => a.priority - b.priority);
  }, [workersStatus]);

  // Worker section states
  const hasNoWorkers = workersStatus !== null && allWorkers.length === 0;

  // Sync default prompt when linearMode changes (only if user hasn't manually edited)
  useEffect(() => {
    if (promptManuallyEdited.current) return;
    if (linearMode === 'link') {
      setPrompt(EXECUTION_DEFAULT_PROMPT);
    } else {
      setPrompt('');
    }
  }, [linearMode]);

  const placeholderText = linearMode === 'create'
    ? PLANNING_PLACEHOLDER
    : 'Describe what you want the selected worker to build or fix...';

  // Form is valid when: has prompt AND workers are configured
  const isValid =
    prompt.trim().length > 0 &&
    !hasNoWorkers;

  // Get task title for confirmation modal
  const getTaskTitle = (): string => {
    if (linearMode === 'link' && selectedIssue !== null) {
      return `${selectedIssue.identifier} ${selectedIssue.title}`;
    }
    // For 'create' or 'none' mode, use a truncated prompt
    const truncated = prompt.trim().substring(0, 50);
    return truncated.length < prompt.trim().length ? `${truncated}...` : truncated;
  };

  const handleSubmitClick = (): void => {
    if (!isValid) return;
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setLoadingText('Submitting...');
    setError(null);
    setShowConflictModal(false);
    setShowErrorModal(false);
    startLongSubmitTimer();

    try {
      const requestData: {
        prompt: string;
        workerType?: CodeTaskWorkerType;
        linearIssueId?: string;
      } = {
        prompt: prompt.trim(),
        workerType,
      };

      // Only send linearIssueId if linking to existing issue
      if (linearMode === 'link' && selectedIssue !== null) {
        requestData.linearIssueId = selectedIssue.identifier;
      }

      const token = await getAccessToken();
      const { codeTaskId: taskId } = await submitCodeTask(token, requestData);
      clearLongSubmitTimer();
      void navigate(`/code-tasks/${taskId}`);
    } catch (err) {
      clearLongSubmitTimer();
      setSubmitting(false);
      setShowConfirmModal(false);

      if (err instanceof ApiError) {
        // Timeout recovery: check if task was created server-side despite timeout
        if (err.code === 'TIMEOUT') {
          try {
            const token = await getAccessToken();
            const { tasks } = await listCodeTasks(token, {});
            const recentTask = findRecentTask(tasks, prompt.trim());
            if (recentTask !== null) {
              // Task was created successfully — navigate to it
              void navigate(`/code-tasks/${recentTask.id}`);
              return;
            }
          } catch {
            // Recovery check failed — fall through to show timeout error
          }
          // No task found — show timeout-specific error
          setTaskError(err);
          setShowErrorModal(true);
          return;
        }

        if (err.code === 'CONFLICT') {
          const parsedConflict = parseConflictError(err.message);
          if (parsedConflict !== null) {
            setConflictInfo(parsedConflict);
            setShowConflictModal(true);
            return;
          }
        }
        // Show error modal for non-conflict API errors
        setTaskError(err);
        setShowErrorModal(true);
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to submit task');
    }
  };

  const handleCancelModal = (): void => {
    setShowConfirmModal(false);
  };

  const handleNavigateToTask = (taskId: string): void => {
    void navigate(`/code-tasks/${taskId}`);
  };

  const handleCloseConflictModal = (): void => {
    setShowConflictModal(false);
    setConflictInfo(null);
  };

  const handleCloseErrorModal = (): void => {
    setShowErrorModal(false);
    setTaskError(null);
  };

  const handleRetrySubmit = (): void => {
    setShowErrorModal(false);
    setTaskError(null);
    void handleConfirmSubmit();
  };

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New Code Task</h2>
        <p className="text-slate-600 dark:text-slate-300">Submit a coding task to be executed by the selected worker</p>
      </div>

      <Card className="mb-6">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">
              Task Instructions <span className="text-red-500">*</span>
            </label>
            <div data-color-mode="light" className="dark:hidden">
              <MDEditor
                value={prompt}
                onChange={(value: string | undefined): void => {
                  promptManuallyEdited.current = true;
                  setPrompt(value ?? '');
                }}
                preview="edit"
                visibleDragbar={false}
                height={200}
                previewOptions={{
                  rehypePlugins: [rehypeSanitize],
                }}
                textareaProps={{
                  placeholder: placeholderText,
                  disabled: submitting,
                }}
              />
            </div>
            <div data-color-mode="dark" className="hidden dark:block">
              <MDEditor
                value={prompt}
                onChange={(value: string | undefined): void => {
                  promptManuallyEdited.current = true;
                  setPrompt(value ?? '');
                }}
                preview="edit"
                visibleDragbar={false}
                height={200}
                previewOptions={{
                  rehypePlugins: [rehypeSanitize],
                }}
                textareaProps={{
                  placeholder: placeholderText,
                  disabled: submitting,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Supports markdown formatting. Use the toolbar or keyboard shortcuts (Ctrl+B for bold, Ctrl+I for italic).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">Worker Type</label>
            <div className="flex flex-wrap gap-3">
              {WORKER_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={(): void => {
                    setWorkerType(type.id);
                  }}
                  disabled={submitting}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    workerType === type.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                  } disabled:opacity-50`}
                  title={type.description}
                >
                  {type.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {WORKER_TYPES.find((t) => t.id === workerType)?.description}
            </p>
          </div>

          {hasNoWorkers && !workersLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="text-lg">⚪</span>
                <span>No workers configured</span>
              </div>
              <Link
                to="/settings/workers"
                className="mt-2 block text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                Configure in Settings →
              </Link>
            </div>
          ) : null}

          <div className="border-t border-slate-200 pt-6 dark:border-slate-700">
            <h3 className="text-sm font-medium text-slate-700 mb-4 dark:text-slate-200">
              Linear Issue
            </h3>

            <div className="flex flex-wrap gap-3 mb-4">
              {LINEAR_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={(): void => {
                    promptManuallyEdited.current = false;
                    if (mode.id === 'link') {
                      setLinearMode('link');
                      setShowIssueSelectorModal(true);
                    } else {
                      setLinearMode(mode.id);
                      setSelectedIssue(null);
                    }
                  }}
                  disabled={submitting}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2 ${
                    linearMode === mode.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                  } disabled:opacity-50`}
                  title={mode.description}
                >
                  {mode.icon}
                  {mode.name}
                </button>
              ))}
            </div>

            {linearMode === 'link' && selectedIssue !== null && (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {selectedIssue.identifier}
                  </span>
                  <span className="ml-2 text-sm text-slate-700 dark:text-slate-200">
                    {selectedIssue.title}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(): void => {
                    setShowIssueSelectorModal(true);
                  }}
                  disabled={submitting}
                  className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 disabled:opacity-50"
                  title="Change issue"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )}

            {linearMode === 'link' && selectedIssue === null && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Click &quot;Link Existing&quot; to select a Linear issue.
              </p>
            )}

            {linearMode === 'create' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-1">
                      Auto-generate Issue Title
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      A Linear issue will be created with a title generated by our Product Owner persona AI. It analyzes your task description to create a clear, actionable title focused on value or problem statement.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </Card>

      {error !== null ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <h3 className="font-medium text-red-800 dark:text-red-300">Failed to submit task</h3>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="flex gap-3">
        <Button
          onClick={handleSubmitClick}
          disabled={!isValid}
          isLoading={submitting}
          loadingText={loadingText}
        >
          <Play className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Submit Task</span>
        </Button>
        <Button
          variant="secondary"
          onClick={(): void => {
            void navigate('/code-tasks');
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>

      <ConfirmSubmitModal
        isOpen={showConfirmModal}
        taskTitle={getTaskTitle()}
        workerType={workerType}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelModal}
      />

      {showConflictModal && conflictInfo !== null ? (
        <TaskConflictModal
          isOpen={showConflictModal}
          taskId={conflictInfo.taskId}
          reason={conflictInfo.reason}
          onClose={handleCloseConflictModal}
          onNavigateToTask={handleNavigateToTask}
        />
      ) : null}

      <TaskErrorModal
        isOpen={showErrorModal}
        error={taskError}
        onClose={handleCloseErrorModal}
        onRetry={handleRetrySubmit}
      />

      <LinearIssueSelectorModal
        isOpen={showIssueSelectorModal}
        groupedOptions={groupedOptions}
        loading={linearLoading}
        error={linearError}
        selected={selectedIssue}
        onSelect={(option: LinearIssueOption): void => {
          setSelectedIssue(option);
          setShowIssueSelectorModal(false);
        }}
        onClose={(): void => {
          setShowIssueSelectorModal(false);
          if (selectedIssue === null) {
            setLinearMode('create');
          }
        }}
      />
    </Layout>
  );
}
