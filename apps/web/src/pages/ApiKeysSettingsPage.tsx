import { useState } from 'react';
import { Button, Card, Input, Layout } from '@/components';
import { useLlmKeys, useResearchSettings } from '@/hooks';
import type { LlmProvider, LlmTestResult } from '@/services/llmKeysApi.types';
import type { SearchMode } from '@/services/researchSettingsApi';

/**
 * Format a date as human-readable string.
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
  }

  return null;
}

export function ApiKeysSettingsPage(): React.JSX.Element {
  const { keys, loading, error, setKey, deleteKey, testKey } = useLlmKeys();
  const {
    settings: researchSettings,
    loading: researchSettingsLoading,
    error: researchSettingsError,
    saving: researchSettingsSaving,
    setSearchMode,
  } = useResearchSettings();

  if (loading || researchSettingsLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const combinedError = error ?? researchSettingsError;

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">API Keys</h2>
        <p className="text-slate-600">
          Configure your LLM API keys. Keys are encrypted and validated before storage.
        </p>
      </div>

      {combinedError !== null && combinedError !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {combinedError}
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
            onTest={async (): Promise<{ response: string; testedAt: string }> => {
              return await testKey(provider.id);
            }}
          />
        ))}
      </div>

      <div className="mt-10 mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Research Settings</h2>
        <p className="text-slate-600">Configure how research queries are processed.</p>
      </div>

      <ResearchModeSelector
        currentMode={researchSettings?.searchMode ?? 'deep'}
        saving={researchSettingsSaving}
        onSelect={(mode): void => {
          void setSearchMode(mode);
        }}
      />
    </Layout>
  );
}

interface SearchModeOption {
  id: SearchMode;
  name: string;
  description: string;
  models: string;
}

const SEARCH_MODES: SearchModeOption[] = [
  {
    id: 'deep',
    name: 'Deep Search',
    description: 'More thorough research using specialized models',
    models: 'Claude Opus 4.5, Gemini 2.5 Pro, o4-mini-deep-research',
  },
  {
    id: 'quick',
    name: 'Quick Search',
    description: 'Faster research using standard models with web search',
    models: 'Claude Sonnet 4.5, Gemini 2.5 Flash, GPT 5.2',
  },
];

interface ResearchModeSelectorProps {
  currentMode: SearchMode;
  saving: boolean;
  onSelect: (mode: SearchMode) => void;
}

function ResearchModeSelector({
  currentMode,
  saving,
  onSelect,
}: ResearchModeSelectorProps): React.JSX.Element {
  return (
    <Card>
      <div className="space-y-3">
        {SEARCH_MODES.map((mode) => {
          const isSelected = mode.id === currentMode;
          return (
            <button
              key={mode.id}
              type="button"
              disabled={saving}
              onClick={(): void => {
                if (!isSelected) {
                  onSelect(mode.id);
                }
              }}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{mode.name}</span>
                    {isSelected ? (
                      <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{mode.description}</p>
                  <p className="text-xs text-slate-400 mt-1">Models: {mode.models}</p>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? 'border-blue-500' : 'border-slate-300'
                  }`}
                >
                  {isSelected ? <div className="w-3 h-3 rounded-full bg-blue-500" /> : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {saving ? <p className="text-sm text-blue-600 mt-3">Saving...</p> : null}
    </Card>
  );
}

interface ApiKeyRowProps {
  provider: ProviderConfig;
  currentValue: string | null;
  savedTestResult: LlmTestResult | null;
  onSave: (apiKey: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<{ response: string; testedAt: string }>;
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
  const [testError, setTestError] = useState<string | null>(null);

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
    setTestError(null);
  };

  const handleTest = async (): Promise<void> => {
    setIsTesting(true);
    setTestError(null);

    try {
      await onTest();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-medium text-slate-900">{provider.name}</span>
          {isConfigured ? (
            <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              {currentValue}
            </code>
          ) : (
            <span className="text-sm text-slate-400">Not configured</span>
          )}
        </div>

        {!isEditing && !showDeleteConfirm ? (
          <div className="flex gap-2">
            {isConfigured ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    void handleTest();
                  }}
                  disabled={isTesting}
                  isLoading={isTesting}
                >
                  Test
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    setIsEditing(true);
                  }}
                >
                  Update
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={(): void => {
                    setShowDeleteConfirm(true);
                  }}
                >
                  Delete
                </Button>
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

      {testError !== null ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{testError}</p>
        </div>
      ) : savedTestResult !== null ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800 mb-1">
            LLM Response ({formatDate(savedTestResult.testedAt)}):
          </p>
          <p className="text-sm text-green-700">{savedTestResult.response}</p>
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
