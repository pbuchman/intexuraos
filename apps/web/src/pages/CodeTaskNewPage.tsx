import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, Play } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useCodeTasks } from '@/hooks';
import type { CodeTaskWorkerType } from '@/types';

const WORKER_TYPES: { id: CodeTaskWorkerType; name: string; description: string }[] = [
  { id: 'auto', name: 'Auto', description: 'Automatically select the best model' },
  { id: 'opus', name: 'Opus', description: 'Claude Opus - most capable for complex tasks' },
  { id: 'glm', name: 'GLM', description: 'GLM - alternative model' },
];

export function CodeTaskNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { submitTask } = useCodeTasks();

  const [prompt, setPrompt] = useState('');
  const [workerType, setWorkerType] = useState<CodeTaskWorkerType>('auto');
  const [linearIssueId, setLinearIssueId] = useState('');
  const [linearIssueTitle, setLinearIssueTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = prompt.trim().length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (!isValid) return;

    setSubmitting(true);
    setError(null);

    try {
      const taskId = await submitTask({
        prompt: prompt.trim(),
        workerType,
        ...(linearIssueId.trim() !== '' && { linearIssueId: linearIssueId.trim() }),
        ...(linearIssueTitle.trim() !== '' && { linearIssueTitle: linearIssueTitle.trim() }),
      });
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
        <h2 className="text-2xl font-bold text-slate-900">New Code Task</h2>
        <p className="text-slate-600">Submit a coding task to be executed by Claude</p>
      </div>

      <Card className="mb-6">
        <div className="space-y-6">
          <div>
            <label htmlFor="prompt" className="block text-sm font-medium text-slate-700 mb-2">
              Task Description <span className="text-red-500">*</span>
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e): void => {
                setPrompt(e.target.value);
              }}
              placeholder="Describe what you want Claude to build or fix..."
              className="w-full rounded-lg border border-slate-200 p-3 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={6}
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-slate-500">
              Be specific about what you want to achieve. Include any relevant context or constraints.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Worker Type</label>
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
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  } disabled:opacity-50`}
                  title={type.description}
                >
                  {type.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {WORKER_TYPES.find((t) => t.id === workerType)?.description}
            </p>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <h3 className="text-sm font-medium text-slate-700 mb-4">
              Linear Issue (Optional)
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="linearIssueId" className="block text-sm text-slate-600 mb-1">
                  Issue ID
                </label>
                <input
                  id="linearIssueId"
                  type="text"
                  value={linearIssueId}
                  onChange={(e): void => {
                    setLinearIssueId(e.target.value);
                  }}
                  placeholder="INT-123"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="linearIssueTitle" className="block text-sm text-slate-600 mb-1">
                  Issue Title
                </label>
                <input
                  id="linearIssueTitle"
                  type="text"
                  value={linearIssueTitle}
                  onChange={(e): void => {
                    setLinearIssueTitle(e.target.value);
                  }}
                  placeholder="Issue title..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={submitting}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Link this task to a Linear issue for tracking and context.
            </p>
          </div>
        </div>
      </Card>

      {error !== null ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
          <div>
            <h3 className="font-medium text-red-800">Failed to submit task</h3>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="flex gap-3">
        <Button
          onClick={(): void => {
            void handleSubmit();
          }}
          disabled={!isValid || submitting}
          isLoading={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
              <span className="hidden sm:inline">Submitting...</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Submit Task</span>
            </>
          )}
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
