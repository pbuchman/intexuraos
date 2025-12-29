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
    description: 'Required for research synthesis. Enables web search grounding.',
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    description: 'Optional. Adds GPT-4o to research options.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Optional. Adds Claude with web search to research options.',
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
            onSave={(apiKey): void => {
              void setKey(provider.id, apiKey);
            }}
            onDelete={(): void => {
              void deleteKey(provider.id);
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
  onSave: (apiKey: string) => void;
  onDelete: () => void;
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

  const handleSave = (): void => {
    const error = validateApiKeyFormat(provider.id, inputValue);
    if (error !== null) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSave(inputValue);
    setInputValue('');
    setIsEditing(false);
  };

  const handleDelete = (): void => {
    onDelete();
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
          />
          {validationError !== null ? (
            <p className="text-sm text-red-600">{validationError}</p>
          ) : null}
          <div className="flex gap-3">
            <Button type="button" onClick={handleSave} disabled={inputValue.length < 10}>
              Save
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
            <Button type="button" variant="danger" onClick={handleDelete}>
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
