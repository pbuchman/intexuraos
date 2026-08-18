import { useState } from 'react';
import { FlaskConical, Pencil, Trash2 } from 'lucide-react';
import { formatDateTime } from '@/utils/dateFormat';
import type { LlmTestResult } from '@/services/llmKeysApi.types';
import { Button } from './ui/Button.js';
import { Card } from './ui/Card.js';
import { Input } from './ui/Input.js';

export interface OpenRouterKeyCardProps {
  maskedKey: string | null;
  accessSource: 'user' | 'platform' | 'unavailable';
  testResult: LlmTestResult | null;
  onSave: (apiKey: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<LlmTestResult>;
}

function accessDescription(source: OpenRouterKeyCardProps['accessSource']): string {
  if (source === 'user') return 'Requests use your personal OpenRouter key.';
  if (source === 'platform') return 'Platform OpenRouter access is active. A personal key is optional.';
  return 'OpenRouter access is unavailable. Add a personal key to enable AI features.';
}

export function OpenRouterKeyCard({
  maskedKey,
  accessSource,
  testResult,
  onSave,
  onDelete,
  onTest,
}: OpenRouterKeyCardProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localTestResult, setLocalTestResult] = useState<LlmTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayedTestResult = localTestResult ?? testResult;
  const hasUserKey = maskedKey !== null;

  const handleSave = async (): Promise<void> => {
    if (inputValue.length < 20) {
      setError('OpenRouter API key appears too short');
      return;
    }
    setSaving(true);
    setError(null);
    setLocalTestResult(null);
    try {
      await onSave(inputValue);
      setInputValue('');
      setEditing(false);
      setTesting(true);
      try {
        setLocalTestResult(await onTest());
      } catch {
        setError('API key saved, but automatic testing failed. Use Test to retry.');
      } finally {
        setTesting(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save OpenRouter key');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    try {
      setLocalTestResult(await onTest());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to test OpenRouter key');
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      setConfirmDelete(false);
      setLocalTestResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete OpenRouter key');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">OpenRouter API key</h3>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {accessSource === 'user'
                ? 'Personal key'
                : accessSource === 'platform'
                  ? 'Platform access'
                  : 'Unavailable'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {accessDescription(accessSource)}
          </p>
          {maskedKey !== null ? (
            <code className="mt-2 block truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {maskedKey}
            </code>
          ) : null}
        </div>

        {!editing && !confirmDelete ? (
          <div className="flex flex-wrap gap-2">
            {hasUserKey ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={(): void => void handleTest()} disabled={testing}>
                  <FlaskConical className="h-4 w-4 sm:mr-2" />
                  Test
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-4 w-4 sm:mr-2" />
                  Update
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(): void => {
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 sm:mr-2" />
                  Delete
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={(): void => {
                  setEditing(true);
                }}
              >
                Add personal key
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {testing ? <p className="mt-3 text-sm text-blue-600 dark:text-blue-400">Testing OpenRouter access...</p> : null}

      {error !== null ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {error}
        </div>
      ) : displayedTestResult !== null ? (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            displayedTestResult.status === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          <span className="font-medium">
            {displayedTestResult.status === 'success' ? 'Connection verified' : 'Connection failed'}
          </span>{' '}
          ({formatDateTime(displayedTestResult.testedAt)}): {displayedTestResult.message}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-3">
          <Input
            label="OpenRouter API Key"
            id="openrouter-api-key"
            name="openrouter-api-key"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="sk-or-..."
            value={inputValue}
            onChange={(event): void => {
              setInputValue(event.target.value);
              setError(null);
            }}
            disabled={saving}
          />
          <div className="flex gap-2">
            <Button type="button" onClick={(): void => void handleSave()} disabled={saving || inputValue.length < 10} isLoading={saving}>
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={(): void => {
                setEditing(false);
                setInputValue('');
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <p className="mb-3 text-sm text-red-800 dark:text-red-300">
            Delete your personal OpenRouter key? Your model preferences stay unchanged and platform access will be used when available.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" size="sm" onClick={(): void => void handleDelete()} disabled={deleting} isLoading={deleting}>
              Delete key
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(): void => {
                setConfirmDelete(false);
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
