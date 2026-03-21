import { useState } from 'react';
import { Button, Card, Input } from '@/components';
import type { WorkerConfigInput } from '@/services/workerSettingsApi.types';

export interface AddWorkerFormProps {
  onCancel: () => void;
  onAdd: (config: WorkerConfigInput) => Promise<void>;
}

export function AddWorkerForm({ onCancel, onAdd }: AddWorkerFormProps): React.JSX.Element {
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
