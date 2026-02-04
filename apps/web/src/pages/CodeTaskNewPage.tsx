import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Play, Link2, Sparkles } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import rehypeSanitize from 'rehype-sanitize';
import { Button, Card, Layout, ConfirmSubmitModal, TaskConflictModal } from '@/components';
import type { ConflictReason } from '@/components';
import { LinearIssueCombobox } from '@/components';
import { useCodeTasks, useLinearIssueOptions, useWorkersStatus } from '@/hooks';
import type { CodeTaskWorkerType } from '@/types';
import type { LinearIssueOption } from '@/hooks/useLinearIssueOptions';
import { ApiError, parseConflictError } from '@/services/apiClient';

const WORKER_TYPES: { id: CodeTaskWorkerType; name: string; description: string }[] = [
  { id: 'auto', name: 'Auto', description: 'Automatically select the best model' },
  { id: 'opus', name: 'Opus', description: 'Claude Opus - most capable for complex tasks' },
  { id: 'glm', name: 'GLM', description: 'GLM - alternative model' },
];

type LinearMode = 'create' | 'link';

const LINEAR_MODES: { id: LinearMode; name: string; description: string; icon: React.ReactNode }[] = [
  { id: 'create', name: 'Create New', description: 'Auto-generate title from task description', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'link', name: 'Link Existing', description: 'Link to an existing Linear issue', icon: <Link2 className="h-4 w-4" /> },
];

export function CodeTaskNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { submitTask } = useCodeTasks();
  const { options, loading: linearLoading, error: linearError } = useLinearIssueOptions();

  const [prompt, setPrompt] = useState('');
  const [workerType, setWorkerType] = useState<CodeTaskWorkerType>('auto');
  const [linearMode, setLinearMode] = useState<LinearMode>('create');
  const [selectedIssue, setSelectedIssue] = useState<LinearIssueOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<{ taskId: string; reason: ConflictReason } | null>(null);

  const { status: workersStatus, loading: workersLoading } = useWorkersStatus();

  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Compute all workers (sorted by priority, priority > 0 means enabled)
  const allWorkers = useMemo(() => {
    if (workersStatus === null) return [];
    return workersStatus.workers.filter((w) => w.priority > 0).sort((a, b) => a.priority - b.priority);
  }, [workersStatus]);

  // Compute healthy workers (can be selected)
  const healthyWorkers = useMemo(() => {
    return allWorkers.filter((w) => w.healthy);
  }, [allWorkers]);

  // Worker section states
  const hasNoWorkers = workersStatus !== null && allWorkers.length === 0;
  const hasNoHealthyWorkers = allWorkers.length > 0 && healthyWorkers.length === 0;

  // Pre-select first healthy worker when workers load
  useEffect(() => {
    if (healthyWorkers.length > 0 && selectedWorker === null) {
      setSelectedWorker(healthyWorkers[0]?.name ?? null);
    }
  }, [healthyWorkers, selectedWorker]);

  // Form is valid when: has prompt AND has a healthy worker selected (or only 1 healthy worker auto-selected)
  const isValid =
    prompt.trim().length > 0 &&
    healthyWorkers.length > 0 &&
    (healthyWorkers.length === 1 || selectedWorker !== null);

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
    setError(null);
    setShowConflictModal(false);

    try {
      const requestData: {
        prompt: string;
        workerType?: CodeTaskWorkerType;
        workerLocation?: string;
        linearIssueId?: string;
      } = {
        prompt: prompt.trim(),
        workerType,
      };

      // Add worker location (use selected or first healthy)
      const workerToUse = selectedWorker ?? healthyWorkers[0]?.name;
      if (workerToUse !== undefined) {
        requestData.workerLocation = workerToUse;
      }

      // Only send linearIssueId if linking to existing issue
      if (linearMode === 'link' && selectedIssue !== null) {
        requestData.linearIssueId = selectedIssue.identifier;
      }

      const taskId = await submitTask(requestData);
      void navigate(`/code-tasks/${taskId}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const parsedConflict = parseConflictError(err.message);
        if (parsedConflict !== null) {
          setConflictInfo(parsedConflict);
          setShowConflictModal(true);
          return;
        }
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

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New Code Task</h2>
        <p className="text-slate-600 dark:text-slate-300">Submit a coding task to be executed by Claude</p>
      </div>

      <Card className="mb-6">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">
              Task Description <span className="text-red-500">*</span>
            </label>
            <div data-color-mode="light" className="dark:hidden">
              <MDEditor
                value={prompt}
                onChange={(value: string | undefined): void => {
                  // MDEditor returns null when cleared; convert to empty string for validation
                  setPrompt(value ?? '');
                }}
                preview="edit"
                height={200}
                previewOptions={{
                  rehypePlugins: [rehypeSanitize],
                }}
                textareaProps={{
                  placeholder: 'Describe what you want Claude to build or fix...',
                  disabled: submitting,
                }}
              />
            </div>
            <div data-color-mode="dark" className="hidden dark:block">
              <MDEditor
                value={prompt}
                onChange={(value: string | undefined): void => {
                  // MDEditor returns null when cleared; convert to empty string for validation
                  setPrompt(value ?? '');
                }}
                preview="edit"
                height={200}
                previewOptions={{
                  rehypePlugins: [rehypeSanitize],
                }}
                textareaProps={{
                  placeholder: 'Describe what you want Claude to build or fix...',
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

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">
              Worker
            </label>
            {workersLoading ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Loading workers...</div>
            ) : hasNoWorkers ? (
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
            ) : hasNoHealthyWorkers ? (
              <div>
                <div className="flex flex-wrap gap-3">
                  {allWorkers.map((worker) => (
                    <div
                      key={worker.name}
                      className="px-4 py-2 rounded-lg border border-slate-200 bg-slate-100 text-sm font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        {worker.name}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                  All workers are currently unavailable. Please wait or check worker status in the header.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-3">
                  {allWorkers.map((worker) => {
                    const isHealthy = worker.healthy;
                    const isSelected = selectedWorker === worker.name || (healthyWorkers.length === 1 && isHealthy);
                    return (
                      <button
                        key={worker.name}
                        type="button"
                        onClick={(): void => {
                          if (isHealthy) {
                            setSelectedWorker(worker.name);
                          }
                        }}
                        disabled={submitting || !isHealthy}
                        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                            : isHealthy
                              ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                              : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                        } disabled:opacity-50`}
                        title={
                          isHealthy
                            ? `Worker: ${worker.name}`
                            : `${worker.name} is unhealthy and cannot be selected`
                        }
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'}`}
                          />
                          {worker.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {healthyWorkers.length === 1
                    ? `Task will be sent to ${healthyWorkers[0]?.name ?? 'worker'}`
                    : selectedWorker !== null
                      ? `Task will be sent to ${selectedWorker}`
                      : 'Select a healthy worker to run this task'}
                </p>
              </>
            )}
          </div>

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
                    setLinearMode(mode.id);
                    setSelectedIssue(null);
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

            {linearMode === 'link' && (
              <div className="space-y-3">
                <LinearIssueCombobox
                  options={options}
                  loading={linearLoading}
                  error={linearError}
                  selected={selectedIssue}
                  onSelect={setSelectedIssue}
                  disabled={submitting}
                  placeholder="Search or select an issue..."
                  allowNone={false}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select an existing Linear issue to link this task for tracking and context.
                </p>
              </div>
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
          loadingText="Submitting..."
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
        workerName={selectedWorker ?? healthyWorkers[0]?.name ?? 'default'}
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
    </Layout>
  );
}
