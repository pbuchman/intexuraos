import { useEffect, useRef, useState } from 'react';
import { MoreVertical, FlaskConical, Pencil, Trash2 } from 'lucide-react';
import { Button, Card, Input, Layout } from '@/components';
import { useLlmKeys } from '@/hooks';
import type { LlmProvider, LlmTestResult } from '@/services/llmKeysApi.types';

/**
 * Format a date as human-readable string.
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface ProviderConfig {
  id: LlmProvider;
  name: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'google', name: 'Google (Gemini)' },
  { id: 'openai', name: 'OpenAI (GPT)' },
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'perplexity', name: 'Perplexity (Sonar)' },
  { id: 'zai', name: 'Zai (GLM)' },
];

/**
 * Validate API key format for each provider.
 * Returns error message if invalid, null if valid.
 */
function validateApiKeyFormat(provider: LlmProvider, key: string): string | null {
  if (key.length < 10) {
    return 'API key is too short';
  }

  switch (provider) {
    case 'google':
      if (!key.startsWith('AIza')) {
        return 'Google API key should start with "AIza"';
      }
      if (key.length !== 39) {
        return 'Google API key should be 39 characters';
      }
      break;
    case 'openai':
      if (!key.startsWith('sk-')) {
        return 'OpenAI API key should start with "sk-"';
      }
      break;
    case 'anthropic':
      if (!key.startsWith('sk-ant-')) {
        return 'Anthropic API key should start with "sk-ant-"';
      }
      break;
    case 'perplexity':
      if (!key.startsWith('pplx-')) {
        return 'Perplexity API key should start with "pplx-"';
      }
      break;
    case 'zai':
      // No format validation for zai
      break;
  }

  return null;
}

export function ApiKeysSettingsPage(): React.JSX.Element {
  const { keys, loading, error, setKey, deleteKey, testKey } = useLlmKeys();

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
        <h2 className="text-2xl font-bold text-slate-900">API Keys</h2>
        <p className="text-slate-600">
          Configure your LLM API keys. Keys are encrypted and validated before storage.
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {PROVIDERS.map((provider) => (
          <ApiKeyRow
            key={provider.id}
            provider={provider}
            currentValue={keys?.[provider.id] ?? null}
            savedTestResult={keys?.testResults[provider.id] ?? null}
            onSave={async (apiKey): Promise<void> => {
              await setKey(provider.id, apiKey);
            }}
            onDelete={async (): Promise<void> => {
              await deleteKey(provider.id);
            }}
            onTest={async () => {
              return await testKey(provider.id);
            }}
          />
        ))}
      </div>
    </Layout>
  );
}

interface ApiKeyRowProps {
  provider: ProviderConfig;
  currentValue: string | null;
  savedTestResult: LlmTestResult | null;
  onSave: (apiKey: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<LlmTestResult>;
}

function ApiKeyRow({
  provider,
  currentValue,
  savedTestResult,
  onSave,
  onDelete,
  onTest,
}: ApiKeyRowProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isConfigured = currentValue !== null;

  const handleSave = async (): Promise<void> => {
    const formatError = validateApiKeyFormat(provider.id, inputValue);
    if (formatError !== null) {
      setValidationError(formatError);
      return;
    }
    setValidationError(null);
    setIsSaving(true);

    try {
      await onSave(inputValue);
      setInputValue('');
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 5000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save API key';
      setValidationError(errorMessage);
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
          <span className="font-medium text-slate-900">{provider.name}</span>
          {isConfigured ? (
            <code className="mt-1 block truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              {currentValue}
            </code>
          ) : (
            <span className="mt-1 block text-sm text-slate-400">Not configured</span>
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
            ✓ API key validated and saved successfully
          </p>
        </div>
      ) : savedTestResult !== null ? (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            savedTestResult.status === 'success'
              ? 'border-green-200 bg-green-50'
              : 'border-red-200 bg-red-50'
          }`}
        >
          <p
            className={`text-sm font-medium mb-1 ${
              savedTestResult.status === 'success' ? 'text-green-800' : 'text-red-800'
            }`}
          >
            {savedTestResult.status === 'success'
              ? `LLM Response (${formatDate(savedTestResult.testedAt)}):`
              : `API Key Error (${formatDate(savedTestResult.testedAt)}):`}
          </p>
          <p
            className={`text-sm ${savedTestResult.status === 'success' ? 'text-green-700' : 'text-red-700'}`}
          >
            {savedTestResult.message}
          </p>
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-4 space-y-3">
          <Input
            label="API Key"
            type="password"
            placeholder="Enter API key..."
            value={inputValue}
            onChange={(e): void => {
              setInputValue(e.target.value);
              setValidationError(null);
            }}
            disabled={isSaving}
          />
          {validationError !== null ? (
            <p className="text-sm text-red-600">{validationError}</p>
          ) : null}
          {isSaving ? <p className="text-sm text-blue-600">Validating API key...</p> : null}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={(): void => {
                void handleSave();
              }}
              disabled={inputValue.length < 10 || isSaving}
              isLoading={isSaving}
            >
              {isSaving ? 'Validating...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={(): void => {
                setIsEditing(false);
                setInputValue('');
                setValidationError(null);
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
          <p className="mb-3 text-sm text-red-800">Delete this API key?</p>
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
