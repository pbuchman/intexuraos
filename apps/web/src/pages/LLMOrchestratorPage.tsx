import { useState, useEffect, useCallback, type FormEvent, type ChangeEvent } from 'react';
import { Layout, Button, Card } from '@/components';
import { useAuth } from '@/context';
import { submitResearch, ApiError } from '@/services';
import { getUserSettings } from '@/services/authApi';
import type { LLMProvider } from '@/types';

interface FormState {
  prompt: string;
  selectedProviders: LLMProvider[];
}

interface ApiKeysState {
  'google-gemini'?: string;
  'openai-gpt'?: string;
  'anthropic-opus'?: string;
}

const LLM_PROVIDERS: { id: LLMProvider; name: string; description: string }[] = [
  { id: 'google-gemini', name: 'Google Gemini 3 Pro', description: 'Google' },
  { id: 'openai-gpt', name: 'OpenAI GPT 5.2 Thinking', description: 'OpenAI' },
  { id: 'anthropic-opus', name: 'Anthropic Opus 4.5', description: 'Anthropic' },
];

export function LLMOrchestratorPage(): React.JSX.Element {
  const { getAccessToken, user } = useAuth();
  const [form, setForm] = useState<FormState>({
    prompt: '',
    selectedProviders: [],
  });
  const [apiKeys, setApiKeys] = useState<ApiKeysState>({});
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchApiKeys = useCallback(async (): Promise<void> => {
    if (user?.sub === undefined) return;
    try {
      setIsLoadingKeys(true);
      const token = await getAccessToken();
      const settings = await getUserSettings(token, user.sub);
      setApiKeys(settings.apiKeys ?? {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch API keys');
    } finally {
      setIsLoadingKeys(false);
    }
  }, [getAccessToken, user?.sub]);

  useEffect(() => {
    void fetchApiKeys();
  }, [fetchApiKeys]);

  const handleProviderToggle = (provider: LLMProvider): void => {
    setForm((prev) => {
      const isSelected = prev.selectedProviders.includes(provider);
      return {
        ...prev,
        selectedProviders: isSelected
          ? prev.selectedProviders.filter((p) => p !== provider)
          : [...prev.selectedProviders, provider],
      };
    });
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (form.prompt.trim().length < 10) {
      setError('Prompt must be at least 10 characters');
      return;
    }

    if (form.selectedProviders.length === 0) {
      setError('Please select at least one LLM provider');
      return;
    }

    try {
      setIsSubmitting(true);
      const token = await getAccessToken();
      await submitResearch(token, {
        prompt: form.prompt.trim(),
        providers: form.selectedProviders,
      });
      setSuccessMessage(
        '✓ Research accepted for processing. You will receive a WhatsApp notification with a direct link when results are ready.'
      );
      setForm({ prompt: '', selectedProviders: [] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to submit research');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isProviderEnabled = (provider: LLMProvider): boolean => {
    return apiKeys[provider] !== undefined && apiKeys[provider] !== '';
  };

  if (isLoadingKeys) {
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
        <h2 className="text-2xl font-bold text-slate-900">LLM Orchestrator</h2>
        <p className="mt-1 text-slate-600">
          Run a single research prompt across multiple frontier LLMs with web-backed deep research.
          Results are automatically synthesized into a consolidated report via Gemini 3 Pro.
        </p>
      </div>

      <div className="max-w-4xl space-y-6">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}

        {successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            {successMessage}
          </div>
        ) : null}

        <Card>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
            <div>
              <label htmlFor="prompt" className="mb-2 block text-sm font-medium text-slate-700">
                Research Prompt
              </label>
              <textarea
                id="prompt"
                rows={10}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Describe your research question or topic in detail..."
                value={form.prompt}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>): void => {
                  setForm((prev) => ({ ...prev, prompt: e.target.value }));
                }}
              />
            </div>

            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">
                Select LLMs for Deep Research
              </label>
              <div className="space-y-3">
                {LLM_PROVIDERS.map((provider) => {
                  const enabled = isProviderEnabled(provider.id);
                  const isChecked = form.selectedProviders.includes(provider.id);

                  return (
                    <label
                      key={provider.id}
                      className={`flex items-start gap-3 rounded-lg border p-4 ${
                        enabled
                          ? 'cursor-pointer border-slate-200 bg-white hover:border-blue-300'
                          : 'cursor-not-allowed border-slate-200 bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!enabled}
                        checked={isChecked}
                        onChange={(): void => {
                          handleProviderToggle(provider.id);
                        }}
                        className="mt-0.5 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-slate-900">{provider.name}</div>
                        {!enabled ? (
                          <div className="mt-1 flex items-center gap-1.5 text-sm text-amber-600">
                            <span>⚠</span>
                            <span>
                              API key required —{' '}
                              <a
                                href="/#/settings/api-keys"
                                className="underline hover:text-amber-700"
                              >
                                configure in settings
                              </a>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" isLoading={isSubmitting}>
                Submit Research
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </Layout>
  );
}
