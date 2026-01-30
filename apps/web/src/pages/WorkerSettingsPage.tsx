import { useEffect, useRef, useState } from 'react';
import { MoreVertical, FlaskConical, Pencil, Trash2, Server } from 'lucide-react';
import { Button, Card, Input, Layout } from '@/components';
import { useWorkerSettings } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import type {
  WorkerType,
  MaskedWorkerConfig,
  WorkerConfigInput,
  TestWorkerConnectivityResponse,
} from '@/services/workerSettingsApi.types';

interface WorkerConfig {
  id: WorkerType;
  name: string;
  description: string;
}

const WORKERS: WorkerConfig[] = [
  { id: 'mac', name: 'Mac Worker', description: 'Apple Silicon Mac for iOS/macOS builds' },
  { id: 'vm', name: 'VM Worker', description: 'Linux VM for general-purpose tasks' },
];

export function WorkerSettingsPage(): React.JSX.Element {
  const { settings, loading, error, updateConfig, deleteConfig, testConnectivity } = useWorkerSettings();

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Worker Configuration</h2>
        <p className="text-slate-600">
          Configure your code execution workers. Each worker requires Cloudflare Access credentials and a dispatch signing secret.
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {WORKERS.map((worker) => (
          <WorkerRow
            key={worker.id}
            worker={worker}
            currentConfig={settings?.[worker.id] ?? null}
            onSave={async (config): Promise<void> => {
              await updateConfig(worker.id, config);
            }}
            onDelete={async (): Promise<void> => {
              await deleteConfig(worker.id);
            }}
            onTest={async () => {
              return await testConnectivity(worker.id);
            }}
          />
        ))}
      </div>
    </Layout>
  );
}

interface WorkerRowProps {
  worker: WorkerConfig;
  currentConfig: MaskedWorkerConfig | null;
  onSave: (config: WorkerConfigInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<TestWorkerConnectivityResponse>;
}

function WorkerRow({
  worker,
  currentConfig,
  onSave,
  onDelete,
  onTest,
}: WorkerRowProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [url, setUrl] = useState('');
  const [cfAccessClientId, setCfAccessClientId] = useState('');
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState('');
  const [dispatchSigningSecret, setDispatchSigningSecret] = useState('');

  const isConfigured = currentConfig !== null;

  const resetForm = (): void => {
    setUrl('');
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
      await onSave({ url, cfAccessClientId, cfAccessClientSecret, dispatchSigningSecret });
      resetForm();
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 5000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save configuration';
      setFormError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    await onDelete();
    setShowDeleteConfirm(false);
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-slate-400" />
            <span className="font-medium text-slate-900">{worker.name}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{worker.description}</p>
          {isConfigured ? (
            <div className="mt-2 space-y-1">
              <code className="block truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                {currentConfig.url}
              </code>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span>CF Access ID: {currentConfig.cfAccessClientId}</span>
              </div>
            </div>
          ) : (
            <span className="mt-2 block text-sm text-slate-400">Not configured</span>
          )}
        </div>

        {!isEditing && !showDeleteConfirm ? (
          <div className="relative flex-shrink-0" ref={menuRef}>
            {isConfigured ? (
              <>
                <button
                  type="button"
                  onClick={(): void => {
                    setIsMenuOpen(!isMenuOpen);
                  }}
                  className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  title="Actions"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={(): void => {
                        setIsMenuOpen(false);
                        void handleTest();
                      }}
                      disabled={isTesting}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
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
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
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
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={(): void => {
                  setIsEditing(true);
                }}
              >
                Configure
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {saveSuccess ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            ✓ Worker configuration saved successfully
          </p>
        </div>
      ) : currentConfig?.testStatus !== undefined ? (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            currentConfig.testStatus === 'success'
              ? 'border-green-200 bg-green-50'
              : 'border-red-200 bg-red-50'
          }`}
        >
          <p
            className={`text-sm font-medium mb-1 ${
              currentConfig.testStatus === 'success' ? 'text-green-800' : 'text-red-800'
            }`}
          >
            {currentConfig.testStatus === 'success'
              ? `Connection Test (${currentConfig.lastTestedAt !== undefined ? formatDateTime(currentConfig.lastTestedAt) : 'N/A'}):`
              : `Connection Failed (${currentConfig.lastTestedAt !== undefined ? formatDateTime(currentConfig.lastTestedAt) : 'N/A'}):`}
          </p>
          <p
            className={`text-sm ${currentConfig.testStatus === 'success' ? 'text-green-700' : 'text-red-700'}`}
          >
            {currentConfig.testMessage ?? 'No message available'}
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
            placeholder="Cloudflare Access Service Token Secret"
            value={cfAccessClientSecret}
            onChange={(e): void => {
              setCfAccessClientSecret(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          <Input
            label="Dispatch Signing Secret"
            type="password"
            placeholder="HMAC signing secret for task dispatch"
            value={dispatchSigningSecret}
            onChange={(e): void => {
              setDispatchSigningSecret(e.target.value);
              setFormError(null);
            }}
            disabled={isSaving}
          />
          {formError !== null ? (
            <p className="text-sm text-red-600">{formError}</p>
          ) : null}
          {isSaving ? <p className="text-sm text-blue-600">Saving configuration...</p> : null}
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
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm text-red-800">Delete this worker configuration?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => {
                void handleDelete();
              }}
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
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
