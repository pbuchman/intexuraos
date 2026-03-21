import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, MoreVertical, FlaskConical, Pencil, Trash2, Server } from 'lucide-react';
import { Button, Card, Input } from '@/components';
import { formatDateTime } from '@/utils/dateFormat';
import type {
  MaskedWorkerConfig,
  WorkerConfigUpdateInput,
  TestWorkerConnectivityResponse,
} from '@/services/workerSettingsApi.types';

export interface WorkerRowProps {
  worker: MaskedWorkerConfig;
  priority: number;
  onUpdate: (config: WorkerConfigUpdateInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<TestWorkerConnectivityResponse>;
  onMoveUp?: (() => Promise<void>) | undefined;
  onMoveDown?: (() => Promise<void>) | undefined;
}

export function WorkerRow({
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
