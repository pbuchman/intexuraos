import { useState } from 'react';
import { Layout, Button, Card, Input } from '@/components';
import { useLlmKeys } from '@/hooks';
import type { LlmProvider } from '@/services/llmKeysApi.types';

interface ProviderConfig {
  id: LlmProvider;
  name: string;
  description: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'google',
    name: 'Google (Gemini)',
    description: 'Required for research synthesis. Enables Gemini 3 Pro with web search grounding.',
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    description: 'Optional. Adds GPT-5.2 Pro to research options.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Optional. Adds Claude Opus 4.5 with web search to research options.',
  },
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
  const { keys, loading, error, setKey, deleteKey } = useLlmKeys();

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
          Configure your LLM API keys. Keys are encrypted before storage.
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="max-w-2xl space-y-6">
        {PROVIDERS.map((provider) => (
          <ApiKeyCard
            key={provider.id}
            provider={provider}
            currentValue={keys?.[provider.id] ?? null}
            onSave={async (apiKey): Promise<void> => {
              await setKey(provider.id, apiKey);
            }}
            onDelete={async (): Promise<void> => {
              await deleteKey(provider.id);
            }}
          />
        ))}
      </div>
    </Layout>
  );
}

interface ApiKeyCardProps {
  provider: ProviderConfig;
  currentValue: string | null;
  onSave: (apiKey: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

function ApiKeyCard({
  provider,
  currentValue,
  onSave,
  onDelete,
}: ApiKeyCardProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
  };

  const isConfigured = currentValue !== null;
  const variant = isConfigured ? 'success' : 'default';

  return (
    <Card title={provider.name} variant={variant}>
      <p className="mb-4 text-sm text-slate-600">{provider.description}</p>

      <div className="flex items-center justify-between mb-4">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isConfigured ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {isConfigured ? 'Configured' : 'Not configured'}
        </span>
      </div>

      {isConfigured && !isEditing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-700">
              {currentValue}
            </code>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={(): void => {
                setIsEditing(true);
              }}
            >
              Update
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={(): void => {
                setShowDeleteConfirm(true);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      {isEditing || !isConfigured ? (
        <div className="space-y-3">
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
          <div className="flex gap-3">
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
            {isEditing ? (
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
            ) : null}
          </div>
        </div>
      ) : null}

      {showDeleteConfirm ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm text-red-800">Are you sure you want to delete this API key?</p>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="danger"
              onClick={(): void => {
                void handleDelete();
              }}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
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
