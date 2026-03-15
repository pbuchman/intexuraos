import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Plus, MoreVertical, FlaskConical, Pencil, Trash2, Server } from 'lucide-react';
import { Button, Card, Input, Layout } from '@/components';
import { useWorkerSettings } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import type {
  MaskedWorkerConfig,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  TestWorkerConnectivityResponse,
} from '@/services/workerSettingsApi.types';
import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core/code-task-worker-types';
import type { CodeTaskWorkerType } from '@intexuraos/common-core/code-task-worker-types';

const MAX_WORKERS = 2;

// Same metadata as CodeTaskNewPage.tsx — kept local to avoid premature abstraction
const WORKER_TYPE_METADATA: Record<CodeTaskWorkerType, { name: string; description: string }> = {
  auto: { name: 'Auto', description: 'Automatically select the best available model for the task' },
  opus: { name: 'Opus', description: 'Anthropic\'s most capable model for complex reasoning and coding tasks' },
  sonnet: { name: 'Sonnet', description: 'Anthropic\'s daily coding model with the best balance of speed and intelligence' },
  minimax: { name: 'MiniMax', description: 'MiniMax\'s coding and agent model with strong reasoning at lower cost' },
  glm: { name: 'GLM', description: 'Zhipu\'s flagship Agentic Engineering model for complex systems and long-running agent tasks' },
  qwen: { name: 'Qwen', description: 'Advanced Qwen model with thinking enabled' },
  kimi: { name: 'Kimi', description: 'Moonshot\'s latest recommended model with image understanding' },
};

export function WorkerSettingsPage(): React.JSX.Element {
  const {
    settings,
    loading,
    error,
    addWorker,
    updateWorker,
    deleteWorker,
    testConnectivity,
    reorderWorkers,
    updateDefaultReviewWorkerType,
  } = useWorkerSettings();

  const [showAddForm, setShowAddForm] = useState(false);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const workers = settings?.workers ?? [];
  const hasReachedMax = workers.length >= MAX_WORKERS;

  return (
    <Layout>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Worker Configuration</h2>
            <p className="text-slate-600 dark:text-slate-300">
              Configure your code execution workers. Each worker requires Cloudflare Access credentials and an orchestrator secret.
              Max {MAX_WORKERS} workers.
            </p>
          </div>
          {!showAddForm && !hasReachedMax && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={(): void => {
                setShowAddForm(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Worker
            </Button>
          )}
        </div>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <div className="mb-6">
        <DefaultReviewWorkerTypeCard
          currentType={settings?.defaultReviewWorkerType ?? 'glm'}
          onUpdate={updateDefaultReviewWorkerType}
        />
      </div>

      <div className="space-y-4">
        {workers.map((worker, index) => (
          <WorkerRow
            key={worker.name}
            worker={worker}
            priority={index + 1}
            onUpdate={async (config: WorkerConfigUpdateInput): Promise<void> => {
              await updateWorker(worker.name, config);
            }}
            onDelete={async (): Promise<void> => {
              await deleteWorker(worker.name);
            }}
            onTest={async (): Promise<TestWorkerConnectivityResponse> => {
              return await testConnectivity(worker.name);
            }}
            onMoveUp={index > 0 ? async (): Promise<void> => {
              const reordered = [...workers];
              const prev = reordered[index - 1];
              const curr = reordered[index];
              if (prev !== undefined && curr !== undefined) {
                reordered[index - 1] = curr;
                reordered[index] = prev;
                await reorderWorkers(reordered.map((w) => w.name));
              }
            } : undefined}
            onMoveDown={index < workers.length - 1 ? async (): Promise<void> => {
              const reordered = [...workers];
              const curr = reordered[index];
              const next = reordered[index + 1];
              if (curr !== undefined && next !== undefined) {
                reordered[index] = next;
                reordered[index + 1] = curr;
                await reorderWorkers(reordered.map((w) => w.name));
              }
            } : undefined}
          />
        ))}

        {showAddForm && (
          <AddWorkerForm
            onCancel={(): void => {
              setShowAddForm(false);
            }}
            onAdd={async (config: WorkerConfigInput): Promise<void> => {
              await addWorker(config);
              setShowAddForm(false);
            }}
          />
        )}
      </div>
    </Layout>
  );
}

interface DefaultReviewWorkerTypeCardProps {
  currentType: string;
  onUpdate: (workerType: string) => Promise<void>;
}

function DefaultReviewWorkerTypeCard({ currentType, onUpdate }: DefaultReviewWorkerTypeCardProps): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [pendingType, setPendingType] = useState<string | null>(null);

  const handleSelect = async (type: string): Promise<void> => {
    if (type === currentType) return;
    setSaving(true);
    setPendingType(type);
    try {
      await onUpdate(type);
    } finally {
      setSaving(false);
      setPendingType(null);
    }
  };

  return (
    <Card>
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Default Review Model</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Model used for automated PR reviews when no specific model is requested.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {CODE_TASK_WORKER_TYPES.map((type) => {
          const meta = WORKER_TYPE_METADATA[type];
          return (
            <button
              key={type}
              type="button"
              onClick={(): void => {
                void handleSelect(type);
              }}
              disabled={saving}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                currentType === type
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
              } disabled:opacity-50`}
              title={meta.description}
            >
              {pendingType === type ? (
                <span className="flex items-center justify-center w-full h-full">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </span>
              ) : (
                meta.name
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

interface AddWorkerFormProps {
  onCancel: () => void;
  onAdd: (config: WorkerConfigInput) => Promise<void>;
}

function AddWorkerForm({ onCancel, onAdd }: AddWorkerFormProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [cfAccessClientId, setCfAccessClientId] = useState('');
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState('');
  const [dispatchSigningSecret, setDispatchSigningSecret] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const validateName = (value: string): boolean => {
    // 3-32 chars, lowercase alphanumeric + hyphens, must start/end with alphanumeric
    return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(value);
  };

  const handleSave = async (): Promise<void> => {
    if (
      name === '' ||
      url === '' ||
      cfAccessClientId === '' ||
      cfAccessClientSecret === '' ||
      dispatchSigningSecret === ''
    ) {
      setFormError('All fields are required');
      return;
    }

    if (!validateName(name)) {
      setFormError(
        'Worker name must be 3-32 characters, lowercase alphanumeric with hyphens, starting and ending with a letter or number'
      );
      return;
    }

    try {
      new URL(url);
    } catch {
      setFormError('Invalid URL format');
      return;
    }

    setFormError(null);
    setIsSaving(true);

    try {
      await onAdd({ name, url, cfAccessClientId, cfAccessClientSecret, dispatchSigningSecret });
      // Reset handled by parent onCancel
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add worker';
      setFormError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Add New Worker</h3>

      <div className="space-y-3">
        <Input
          label="Worker Name"
          placeholder="home-mac"
          value={name}
          onChange={(e): void => {
            setName(e.target.value);
            setFormError(null);
          }}
          disabled={isSaving}
        />

        <Input
          label="Worker URL"
          type="url"
          placeholder="https://your-worker.example.com"
          value={url}
          onChange={(e): void => {
            setUrl(e.target.value);
            setFormError(null);
          }}
          disabled={isSaving}
        />

        <Input
          label="CF Access Client ID"
          type="password"
          autoComplete="new-password"
          placeholder="Cloudflare Access Service Token ID"
          value={cfAccessClientId}
          onChange={(e): void => {
            setCfAccessClientId(e.target.value);
            setFormError(null);
          }}
          disabled={isSaving}
        />

        <Input
          label="CF Access Client Secret"
          type="password"
          autoComplete="new-password"
          placeholder="Cloudflare Access Service Token Secret"
          value={cfAccessClientSecret}
          onChange={(e): void => {
            setCfAccessClientSecret(e.target.value);
            setFormError(null);
          }}
          disabled={isSaving}
        />

        <Input
          label="Orchestrator Secret"
          type="password"
          autoComplete="new-password"
          placeholder="Shared secret for code-agent ↔ orchestrator communication"
          value={dispatchSigningSecret}
          onChange={(e): void => {
            setDispatchSigningSecret(e.target.value);
            setFormError(null);
          }}
          disabled={isSaving}
        />

        {formError !== null ? (
          <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
        ) : null}

        {isSaving ? <p className="text-sm text-blue-600 dark:text-blue-400">Adding worker...</p> : null}

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={(): void => {
              void handleSave();
            }}
            disabled={name === '' || url === '' || cfAccessClientId === '' || cfAccessClientSecret === '' || dispatchSigningSecret === '' || isSaving}
            isLoading={isSaving}
          >
            Add Worker
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface WorkerRowProps {
  worker: MaskedWorkerConfig;
  priority: number;
  onUpdate: (config: WorkerConfigUpdateInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<TestWorkerConnectivityResponse>;
  onMoveUp?: (() => Promise<void>) | undefined;
  onMoveDown?: (() => Promise<void>) | undefined;
}

function WorkerRow({
  worker,
  priority,
  onUpdate,
  onDelete,
  onTest,
  onMoveUp,
  onMoveDown,
}: WorkerRowProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [url, setUrl] = useState(worker.url);
  const [cfAccessClientId, setCfAccessClientId] = useState('');
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState('');
  const [dispatchSigningSecret, setDispatchSigningSecret] = useState('');

  const resetForm = (): void => {
    setUrl(worker.url);
    setCfAccessClientId('');
    setCfAccessClientSecret('');
    setDispatchSigningSecret('');
    setFormError(null);
  };

  const handleSave = async (): Promise<void> => {
    if (url === '' || cfAccessClientId === '' || cfAccessClientSecret === '' || dispatchSigningSecret === '') {
      setFormError('All fields are required');
      return;
    }

    try {
      new URL(url);
    } catch {
      setFormError('Invalid URL format');
      return;
    }

    setFormError(null);
    setIsSaving(true);

    try {
      await onUpdate({ url, cfAccessClientId, cfAccessClientSecret, dispatchSigningSecret });
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 5000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update configuration';
      setFormError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete();
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setIsTesting(true);
    setSaveSuccess(false);
    try {
      await onTest();
    } finally {
      setIsTesting(false);
    }
  };

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        {(onMoveUp !== undefined || onMoveDown !== undefined) && (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={onMoveUp !== undefined ? (): void => { void onMoveUp(); } : undefined}
              disabled={onMoveUp === undefined}
              className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title="Move up (higher priority)"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onMoveDown !== undefined ? (): void => { void onMoveDown(); } : undefined}
              disabled={onMoveDown === undefined}
              className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title="Move down (lower priority)"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-slate-400" />
            <span className="font-medium text-slate-900 dark:text-slate-100">{worker.name}</span>
            <span className="text-sm text-slate-500">({priority === 1 ? 'Primary' : 'Fallback'})</span>
          </div>

          <div className="mt-2 space-y-1">
            <code className="block truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {worker.url}
            </code>
            <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>CF Access ID: {worker.cfAccessClientId}</span>
              <span>Enabled: {worker.enabled ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>

        {!isEditing && !showDeleteConfirm ? (
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={(): void => {
                setIsMenuOpen(!isMenuOpen);
              }}
              className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title="Actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={(): void => {
                    setIsMenuOpen(false);
                    void handleTest();
                  }}
                  disabled={isTesting}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FlaskConical className="h-4 w-4" />
                  {isTesting ? 'Testing...' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={(): void => {
                    setIsMenuOpen(false);
                    setIsEditing(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Pencil className="h-4 w-4" />
                  Update
                </button>
                <button
                  type="button"
                  onClick={(): void => {
                    setIsMenuOpen(false);
                    setShowDeleteConfirm(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {saveSuccess ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/30">
          <p className="text-sm font-medium text-green-800 dark:text-green-300">✓ Worker configuration saved successfully</p>
        </div>
      ) : worker.testStatus !== undefined ? (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            worker.testStatus === 'success'
              ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30'
              : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30'
          }`}
        >
          <p
            className={`text-sm font-medium mb-1 ${
              worker.testStatus === 'success' ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'
            }`}
          >
            {worker.testStatus === 'success'
              ? `Connection Test (${worker.lastTestedAt !== undefined ? formatDateTime(worker.lastTestedAt) : 'N/A'}):`
              : `Connection Failed (${worker.lastTestedAt !== undefined ? formatDateTime(worker.lastTestedAt) : 'N/A'}):`}
          </p>
          <p
            className={`text-sm ${worker.testStatus === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
          >
            {worker.testMessage ?? 'No message available'}
          </p>
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-4 space-y-3">
          <Input
            label="Worker Name"
            placeholder="home-mac"
            value={url}
            onChange={(e): void => {
              setUrl(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          <Input
            label="Worker URL"
            type="url"
            placeholder="https://your-worker.example.com"
            value={url}
            onChange={(e): void => {
              setUrl(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          <Input
            label="CF Access Client ID"
            type="password"
            autoComplete="new-password"
            placeholder="Cloudflare Access Service Token ID"
            value={cfAccessClientId}
            onChange={(e): void => {
              setCfAccessClientId(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          <Input
            label="CF Access Client Secret"
            type="password"
            autoComplete="new-password"
            placeholder="Cloudflare Access Service Token Secret"
            value={cfAccessClientSecret}
            onChange={(e): void => {
              setCfAccessClientSecret(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          <Input
            label="Orchestrator Secret"
            type="password"
            autoComplete="new-password"
            placeholder="Shared secret for code-agent ↔ orchestrator communication"
            value={dispatchSigningSecret}
            onChange={(e): void => {
              setDispatchSigningSecret(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          {formError !== null ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
          {isSaving ? <p className="text-sm text-blue-600 dark:text-blue-400">Saving configuration...</p> : null}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={(): void => {
                void handleSave();
              }}
              disabled={url === '' || cfAccessClientId === '' || cfAccessClientSecret === '' || dispatchSigningSecret === '' || isSaving}
              isLoading={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={(): void => {
                setIsEditing(false);
                resetForm();
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {showDeleteConfirm ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <p className="mb-3 text-sm text-red-800 dark:text-red-300">Delete this worker configuration?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => {
                void handleDelete();
              }}
              disabled={deleting}
              isLoading={deleting}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(): void => {
                setShowDeleteConfirm(false);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
