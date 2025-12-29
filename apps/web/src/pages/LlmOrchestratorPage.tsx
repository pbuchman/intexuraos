import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Button, Card } from '@/components';
import { useLlmKeys, useResearches } from '@/hooks';
import type { LlmProvider } from '@/services/llmOrchestratorApi.types';

interface ProviderOption {
  id: LlmProvider;
  name: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'google', name: 'Gemini (with web search)' },
  { id: 'openai', name: 'GPT-4o' },
  { id: 'anthropic', name: 'Claude (with web search)' },
];

export function LlmOrchestratorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { keys, loading: keysLoading } = useLlmKeys();
  const { createResearch } = useResearches();

  const [prompt, setPrompt] = useState('');
  const [selectedLlms, setSelectedLlms] = useState<LlmProvider[]>(['google']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProviderAvailable = (provider: LlmProvider): boolean => {
    if (keysLoading || keys === null) return false;
    return keys[provider] !== null;
  };

  const handleProviderToggle = (provider: LlmProvider): void => {
    setSelectedLlms((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

  const handleSubmit = async (): Promise<void> => {
    if (prompt.length < 10) {
      setError('Prompt must be at least 10 characters');
      return;
    }
    if (selectedLlms.length === 0) {
      setError('Select at least one LLM');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const research = await createResearch({ prompt, selectedLlms });
      void navigate(`/research/${research.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create research');
    } finally {
      setSubmitting(false);
    }
  };

  const googleAvailable = isProviderAvailable('google');

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">New Research</h2>
        <p className="text-slate-600">
          Run your research prompt across multiple LLMs and get a synthesized report.
        </p>
      </div>

      {!googleAvailable && !keysLoading ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-amber-800">
            <strong>Google API key required.</strong> Synthesis is powered by Gemini.{' '}
            <a href="/#/settings/api-keys" className="underline">
              Configure API keys
            </a>
          </p>
        </div>
      ) : null}

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="max-w-3xl space-y-6">
        <Card title="Research Prompt">
          <div className="space-y-2">
            <textarea
              value={prompt}
              onChange={(e): void => {
                setPrompt(e.target.value);
              }}
              placeholder="Enter your research question or topic..."
              className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={6}
              disabled={submitting}
            />
            <p className="text-sm text-slate-500">
              {String(prompt.length)}/10000 characters (minimum 10)
            </p>
          </div>
        </Card>

        <Card title="Select LLMs">
          <div className="space-y-3">
            {PROVIDERS.map((provider) => {
              const available = isProviderAvailable(provider.id);
              const isSelected = selectedLlms.includes(provider.id);

              return (
                <label
                  key={provider.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                    available ? 'hover:bg-slate-50' : 'cursor-not-allowed opacity-50'
                  } ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(): void => {
                      handleProviderToggle(provider.id);
                    }}
                    disabled={!available || submitting}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium">{provider.name}</span>
                  {!available ? (
                    <span className="text-xs text-slate-500">(API key not configured)</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            onClick={(): void => {
              void handleSubmit();
            }}
            disabled={submitting || !googleAvailable || prompt.length < 10}
            isLoading={submitting}
          >
            Start Research
          </Button>
        </div>
      </div>
    </Layout>
  );
}
