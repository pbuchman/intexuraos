import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Layout, Button, Card, Input } from '@/components';
import { useAuth } from '@/context';
import { getUserSettings, updateUserSettings, ApiError } from '@/services';
import { validateApiKey } from '@/services/llmOrchestratorApi';
import type { LLMProvider } from '@/types';
import { Eye, EyeOff } from 'lucide-react';

interface ApiKeyState {
  value: string;
  isVisible: boolean;
  isValidating: boolean;
  validationStatus: 'none' | 'success' | 'error';
  validationError?: string;
}

type ApiKeysFormState = Record<LLMProvider, ApiKeyState>;

const PROVIDERS: { id: LLMProvider; name: string; model: string }[] = [
  { id: 'google-gemini', name: 'Google', model: 'Gemini 3 Pro' },
  { id: 'openai-gpt', name: 'OpenAI', model: 'GPT 5.2 Thinking' },
  { id: 'anthropic-opus', name: 'Anthropic', model: 'Opus 4.5' },
];

export function ApiKeysPage(): React.JSX.Element {
  const { getAccessToken, user } = useAuth();
  const [formState, setFormState] = useState<ApiKeysFormState>({
    'google-gemini': {
      value: '',
      isVisible: false,
      isValidating: false,
      validationStatus: 'none',
    },
    'openai-gpt': {
      value: '',
      isVisible: false,
      isValidating: false,
      validationStatus: 'none',
    },
    'anthropic-opus': {
      value: '',
      isVisible: false,
      isValidating: false,
      validationStatus: 'none',
    },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchApiKeys = useCallback(async (): Promise<void> => {
    if (user?.sub === undefined) return;
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const settings = await getUserSettings(token, user.sub);
      const apiKeys = settings.apiKeys ?? {};

      setFormState({
        'google-gemini': {
          value: apiKeys['google-gemini'] ?? '',
          isVisible: false,
          isValidating: false,
          validationStatus: apiKeys['google-gemini'] !== undefined ? 'success' : 'none',
        },
        'openai-gpt': {
          value: apiKeys['openai-gpt'] ?? '',
          isVisible: false,
          isValidating: false,
          validationStatus: apiKeys['openai-gpt'] !== undefined ? 'success' : 'none',
        },
        'anthropic-opus': {
          value: apiKeys['anthropic-opus'] ?? '',
          isVisible: false,
          isValidating: false,
          validationStatus: apiKeys['anthropic-opus'] !== undefined ? 'success' : 'none',
        },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch API keys');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, user?.sub]);

  useEffect(() => {
    void fetchApiKeys();
  }, [fetchApiKeys]);

  const toggleVisibility = (provider: LLMProvider): void => {
    setFormState((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        isVisible: !prev[provider].isVisible,
      },
    }));
  };

  const updateValue = (provider: LLMProvider, value: string): void => {
    setFormState((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        value,
        validationStatus: 'none',
        validationError: undefined,
      },
    }));
  };

  const testApiKey = async (provider: LLMProvider): Promise<void> => {
    const key = formState[provider].value.trim();
    if (key === '') {
      setFormState((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          validationStatus: 'error',
          validationError: 'API key is required',
        },
      }));
      return;
    }

    setFormState((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        isValidating: true,
        validationStatus: 'none',
      },
    }));

    try {
      const token = await getAccessToken();
      const result = await validateApiKey(token, {
        provider,
        apiKey: key,
      });

      setFormState((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValidating: false,
          validationStatus: result.valid ? 'success' : 'error',
          validationError: result.valid ? undefined : result.error,
        },
      }));
    } catch (e) {
      setFormState((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValidating: false,
          validationStatus: 'error',
          validationError: e instanceof ApiError ? e.message : 'Validation failed',
        },
      }));
    }
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (user?.sub === undefined) return;

    setError(null);
    setSuccessMessage(null);

    const apiKeys: Record<LLMProvider, string> = {
      'google-gemini': formState['google-gemini'].value.trim(),
      'openai-gpt': formState['openai-gpt'].value.trim(),
      'anthropic-opus': formState['anthropic-opus'].value.trim(),
    };

    try {
      setIsSaving(true);
      const token = await getAccessToken();
      await updateUserSettings(token, user.sub, { apiKeys });
      setSuccessMessage('API keys saved successfully');
      await fetchApiKeys();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save API keys');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
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
          Configure API keys for LLM providers. Keys are validated upon save by executing a quick
          test prompt.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}

        {successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            {successMessage}
          </div>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          {PROVIDERS.map((provider) => {
            const state = formState[provider.id];
            return (
              <Card key={provider.id} title={`${provider.name} (${provider.model})`}>
                <div className="space-y-4">
                  <div className="relative">
                    <Input
                      label=""
                      type={state.isVisible ? 'text' : 'password'}
                      placeholder="Enter API key"
                      value={state.value}
                      onChange={(e): void => {
                        updateValue(provider.id, e.target.value);
                      }}
                    />
                    <div className="absolute right-0 top-0 flex gap-2">
                      <button
                        type="button"
                        onClick={(): void => {
                          toggleVisibility(provider.id);
                        }}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label={state.isVisible ? 'Hide API key' : 'Show API key'}
                      >
                        {state.isVisible ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void testApiKey(provider.id)}
                        isLoading={state.isValidating}
                        disabled={state.value.trim() === ''}
                      >
                        Test
                      </Button>
                    </div>
                  </div>

                  {state.validationStatus === 'success' ? (
                    <p className="text-sm text-green-700">✓ Validated successfully</p>
                  ) : state.validationStatus === 'error' ? (
                    <p className="text-sm text-red-700">
                      ⚠ Validation failed: {state.validationError ?? 'Unknown error'}
                    </p>
                  ) : state.value === '' ? (
                    <p className="text-sm text-slate-500">No key configured</p>
                  ) : null}
                </div>
              </Card>
            );
          })}

          <div className="flex justify-end">
            <Button type="submit" isLoading={isSaving}>
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
