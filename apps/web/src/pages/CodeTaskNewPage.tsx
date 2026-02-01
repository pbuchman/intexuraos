import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Play, Link2, Sparkles } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import rehypeSanitize from 'rehype-sanitize';
import { Button, Card, Layout } from '@/components';
import { LinearIssueCombobox } from '@/components';
import { useCodeTasks, useLinearIssueOptions } from '@/hooks';
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
  const { options, loading: linearLoading, error: linearError, generateTitle } = useLinearIssueOptions();

  const [prompt, setPrompt] = useState('');
  const [workerType, setWorkerType] = useState<CodeTaskWorkerType>('auto');
  const [linearMode, setLinearMode] = useState<LinearMode>('none');
  const [selectedIssue, setSelectedIssue] = useState<LinearIssueOption | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = prompt.trim().length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (!isValid) return;

    setSubmitting(true);
    setError(null);

    try {
      const requestData: {
        prompt: string;
        workerType?: CodeTaskWorkerType;
        linearIssueId?: string;
        linearIssueTitle?: string;
      } = {
        prompt: prompt.trim(),
        workerType,
      };

      if (linearMode === 'link' && selectedIssue !== null) {
        requestData.linearIssueId = selectedIssue.identifier;
        requestData.linearIssueTitle = selectedIssue.title;
      } else if (linearMode === 'create' && generatedTitle.trim() !== '') {
        requestData.linearIssueTitle = generatedTitle.trim();
      }

      const taskId = await submitTask(requestData);
      void navigate(`/code-tasks/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit task');
    } finally {
      setSubmitting(false);
    }
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
                    setGeneratedTitle('');
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (prompt.trim().length === 0) {
                        return;
                      }
                      setGeneratingTitle(true);
                      generateTitle(prompt.trim())
                        .then(setGeneratedTitle)
                        .catch(() => {
                          setError('Failed to generate issue title');
                        })
                        .finally(() => {
                          setGeneratingTitle(false);
                        });
                    }}
                    disabled={submitting || generatingTitle || prompt.trim().length === 0}
                    className="px-4 py-2 rounded-lg border border-blue-500 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70 flex items-center gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    {generatingTitle ? 'Generating...' : 'Generate Title'}
                  </button>
                </div>

                {generatedTitle && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                      Generated Title:
                    </p>
                    <p className="text-sm text-slate-900 dark:text-slate-100">{generatedTitle}</p>
                  </div>
                )}

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  A Linear issue will be created with the generated title. The Product Owner persona analyzes your task description to create a clear, actionable title.
                </p>
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
          onClick={(): void => {
            void handleSubmit();
          }}
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
    </Layout>
  );
}
