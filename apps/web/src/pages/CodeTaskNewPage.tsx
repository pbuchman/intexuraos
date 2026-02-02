import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Play, Link2, Sparkles } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import rehypeSanitize from 'rehype-sanitize';
import { Button, Card, Layout, ConfirmSubmitModal } from '@/components';
import { LinearIssueCombobox } from '@/components';
import { useCodeTasks, useLinearIssueOptions, useWorkersStatus } from '@/hooks';
import type { CodeTaskWorkerType } from '@/types';
import type { LinearIssueOption } from '@/hooks/useLinearIssueOptions';

const WORKER_TYPES: { id: CodeTaskWorkerType; name: string; description: string }[] = [
  { id: 'auto', name: 'Auto', description: 'Automatically select the best model' },
  { id: 'opus', name: 'Opus', description: 'Claude Opus - most capable for complex tasks' },
  { id: 'glm', name: 'GLM', description: 'GLM - alternative model' },
];

type LinearMode = 'none' | 'link' | 'create';

const LINEAR_MODES: { id: LinearMode; name: string; description: string; icon: React.ReactNode }[] = [
  { id: 'none', name: 'None', description: 'No Linear issue', icon: null },
  { id: 'link', name: 'Link Existing', description: 'Link to an existing Linear issue', icon: <Link2 className="h-4 w-4" /> },
  { id: 'create', name: 'Create New', description: 'Auto-generate title from task description', icon: <Sparkles className="h-4 w-4" /> },
];

export function CodeTaskNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { submitTask } = useCodeTasks();
  const { options, loading: linearLoading, error: linearError } = useLinearIssueOptions();

  const [prompt, setPrompt] = useState('');
  const [workerType, setWorkerType] = useState<CodeTaskWorkerType>('auto');
  const [linearMode, setLinearMode] = useState<LinearMode>('none');
  const [selectedIssue, setSelectedIssue] = useState<LinearIssueOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { status: workersStatus, loading: workersLoading } = useWorkersStatus();

  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Compute available workers (enabled and sorted by priority)
  const availableWorkers = useMemo(() => {
    if (workersStatus === null) return [];
    return workersStatus.workers.filter((w) => w.priority > 0).sort((a, b) => a.priority - b.priority);
  }, [workersStatus]);

  // Pre-select first healthy worker when workers load
  useEffect(() => {
    if (availableWorkers.length > 0 && selectedWorker === null) {
      const firstHealthy = availableWorkers.find((w) => w.healthy);
      if (firstHealthy !== undefined) {
        setSelectedWorker(firstHealthy.name);
      }
    }
  }, [availableWorkers, selectedWorker]);

  // Check if we should show worker selection (more than 1 worker configured)
  const showWorkerSelection = availableWorkers.length > 1;

  const isValid =
    prompt.trim().length > 0 &&
    (!showWorkerSelection || selectedWorker !== null);

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

      // Add worker location if user has multiple workers
      if (showWorkerSelection && selectedWorker !== null) {
        requestData.workerLocation = selectedWorker;
      }

      // Only send linearIssueId if linking to existing issue
      if (linearMode === 'link' && selectedIssue !== null) {
        requestData.linearIssueId = selectedIssue.identifier;
      }

      const taskId = await submitTask(requestData);
      void navigate(`/code-tasks/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit task');
      setSubmitting(false);
    }
  };

  const handleCancelModal = (): void => {
    setShowConfirmModal(false);
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

          {showWorkerSelection && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2 dark:text-slate-200">
                Worker
              </label>
              {workersLoading ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">Loading workers...</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    {availableWorkers.map((worker) => {
                      const isHealthy = worker.healthy;
                      const isSelected = selectedWorker === worker.name;
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
                    {selectedWorker !== null
                      ? `Task will be sent to ${selectedWorker}`
                      : 'Select a healthy worker to run this task'}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="border-t border-slate-200 pt-6 dark:border-slate-700">
            <h3 className="text-sm font-medium text-slate-700 mb-4 dark:text-slate-200">
              Linear Issue (Optional)
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

            {linearMode === 'none' && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No Linear issue will be linked to this task.
              </p>
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
        workerName={selectedWorker ?? availableWorkers[0]?.name ?? 'default'}
        workerType={workerType}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelModal}
      />
    </Layout>
  );
}
