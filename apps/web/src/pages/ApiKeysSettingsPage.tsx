import { useEffect, useRef, useState } from 'react';
import { MoreVertical, FlaskConical, Pencil, Trash2 } from 'lucide-react';
import {
  ALL_FAST_MODELS,
  FAST_MODEL_DISPLAY_NAMES,
  LlmProviders,
  MODEL_PROVIDER_MAP,
  type FastModel,
  type LlmProvider as ContractLlmProvider,
} from '@intexuraos/llm-contract';
import { Button, Card, Input, Layout } from '@/components';
import { useLlmKeys } from '@/hooks';
import { formatDateTime } from '@/utils/dateFormat';
import type { LlmProvider, LlmTestResult } from '@/services/llmKeysApi.types';

interface ProviderConfig {
  id: LlmProvider;
  name: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'google', name: 'Google (Gemini)' },
  { id: 'openai', name: 'OpenAI (GPT)' },
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'perplexity', name: 'Perplexity (Sonar)' },
];

const PROVIDER_GROUP_LABELS: Record<string, string> = {
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

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
  }

  return null;
}

interface TestResults {
  google: LlmTestResult | null;
  openai: LlmTestResult | null;
  anthropic: LlmTestResult | null;
  perplexity: LlmTestResult | null;
}

/**
 * Group fast models by their provider for the dropdown.
 * Only includes providers that are configured AND have passing test results.
 */
function groupModelsByProvider(
  configuredProviders: Set<string>,
  testResults?: TestResults
): { provider: string; label: string; models: { model: FastModel; name: string; disabled: boolean }[] }[] {
  const groups = new Map<string, { model: FastModel; name: string; disabled: boolean }[]>();

  for (const model of ALL_FAST_MODELS) {
    const provider = MODEL_PROVIDER_MAP[model] as string;

    // Skip providers that aren't configured or have failed tests
    const isConfigured = configuredProviders.has(provider);
    const testResult = testResults?.[provider as keyof TestResults];
    const hasPassingTest = testResult?.status === 'success';

    if (!isConfigured || !hasPassingTest) {
      continue;
    }

    const existing = groups.get(provider) ?? [];
    existing.push({
      model,
      name: FAST_MODEL_DISPLAY_NAMES[model],
      disabled: false,
    });
    groups.set(provider, existing);
  }

  const result: { provider: string; label: string; models: { model: FastModel; name: string; disabled: boolean }[] }[] = [];
  for (const [provider, models] of groups) {
    result.push({
      provider,
      label: PROVIDER_GROUP_LABELS[provider] ?? provider,
      models,
    });
  }

  return result;
}

export function ApiKeysSettingsPage(): React.JSX.Element {
  const { keys, defaultModel, loading, error, savingDefaultModel, setKey, deleteKey, testKey, setDefaultModel } = useLlmKeys();

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const configuredProviders = new Set<string>();
  if (keys?.google !== null && keys?.google !== undefined) configuredProviders.add(LlmProviders.Google);
  if (keys?.openai !== null && keys?.openai !== undefined) configuredProviders.add(LlmProviders.OpenAI);
  if (keys?.anthropic !== null && keys?.anthropic !== undefined) configuredProviders.add(LlmProviders.Anthropic);
  if (keys?.perplexity !== null && keys?.perplexity !== undefined) configuredProviders.add(LlmProviders.Perplexity);

  const modelGroups = groupModelsByProvider(configuredProviders, keys?.testResults);

  const currentProvider = defaultModel !== null
    ? (MODEL_PROVIDER_MAP[defaultModel as FastModel] as ContractLlmProvider | undefined) ?? null
    : null;
  const hasKeyForDefaultModel = currentProvider !== null && configuredProviders.has(currentProvider);

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">LLM Settings</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Configure your LLM API keys and default model.
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <Card className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">Default Model</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The model used by default for generate() calls across your services.
            </p>
          </div>
          <div className="relative flex items-center gap-2">
            {savingDefaultModel ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            ) : null}
            <select
              value={defaultModel ?? ''}
              onChange={(e): void => {
                if (e.target.value !== '') {
                  void setDefaultModel(e.target.value);
                }
              }}
              disabled={savingDefaultModel}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="" disabled>Select a model</option>
              {modelGroups.map((group) => (
                <optgroup key={group.provider} label={group.label}>
                  {group.models.map((m) => (
                    <option key={m.model} value={m.model} disabled={m.disabled}>
                      {m.name}{m.disabled ? ' (No API key)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        {defaultModel !== null && !hasKeyForDefaultModel ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/30">
            <p className="text-sm text-amber-800 dark:text-amber-400">
              No API key configured for this model&apos;s provider. Add one below or select a different model.
            </p>
          </div>
        ) : null}
      </Card>

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
  const [deleting, setDeleting] = useState(false);
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
    <Card className="relative overflow-hidden">
      {isTesting ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Testing...</span>
          </div>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-slate-900 dark:text-slate-100">{provider.name}</span>
          {isConfigured ? (
            <code className="mt-1 block truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {currentValue}
            </code>
          ) : (
            <span className="mt-1 block text-sm text-slate-400 dark:text-slate-500">Not configured</span>
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
                      Test
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
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/30">
          <p className="text-sm font-medium text-green-800 dark:text-green-400">
            ✓ API key validated and saved successfully
          </p>
        </div>
      ) : savedTestResult !== null ? (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            savedTestResult.status === 'success'
              ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30'
              : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30'
          }`}
        >
          <p
            className={`text-sm font-medium mb-1 ${
              savedTestResult.status === 'success' ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'
            }`}
          >
            {savedTestResult.status === 'success'
              ? `LLM Response (${formatDateTime(savedTestResult.testedAt)}):`
              : `API Key Error (${formatDateTime(savedTestResult.testedAt)}):`}
          </p>
          <p
            className={`text-sm ${savedTestResult.status === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}
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
            <p className="text-sm text-red-600 dark:text-red-400">{validationError}</p>
          ) : null}
          {isSaving ? <p className="text-sm text-blue-600 dark:text-blue-400">Validating API key...</p> : null}
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
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <p className="mb-3 text-sm text-red-800 dark:text-red-400">Delete this API key?</p>
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
