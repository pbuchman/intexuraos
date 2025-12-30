import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Button, Card } from '@/components';
import { useLlmKeys, useResearches } from '@/hooks';
import type { LlmProvider } from '@/services/llmOrchestratorApi.types';

interface ProviderOption {
  id: LlmProvider;
  name: string;
  shortName: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'google', name: 'Gemini 3 Pro', shortName: 'Gemini' },
  { id: 'openai', name: 'GPT-5.2 Pro', shortName: 'GPT' },
  { id: 'anthropic', name: 'Claude Opus 4.5', shortName: 'Claude' },
];

export function LlmOrchestratorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { keys, loading: keysLoading } = useLlmKeys();
  const { createResearch } = useResearches();

  const [prompt, setPrompt] = useState('');
  const [selectedLlms, setSelectedLlms] = useState<LlmProvider[]>([]);
  const [synthesisLlm, setSynthesisLlm] = useState<LlmProvider | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configuredProviders: LlmProvider[] =
    keysLoading || keys === null
      ? []
      : PROVIDERS.filter((p) => keys[p.id] !== null).map((p) => p.id);

  // Auto-select all configured LLMs and set first configured as synthesis LLM
  useEffect(() => {
    if (!keysLoading && keys !== null) {
      const configured = PROVIDERS.filter((p) => keys[p.id] !== null).map((p) => p.id);
      setSelectedLlms(configured);
      const firstConfigured = configured[0];
      if (firstConfigured !== undefined) {
        setSynthesisLlm(firstConfigured);
      }
    }
  }, [keysLoading, keys]);

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
    if (synthesisLlm === null) {
      setError('Select a synthesis LLM');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const research = await createResearch({ prompt, selectedLlms, synthesisLlm });
      void navigate(`/research/${research.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create research');
    } finally {
      setSubmitting(false);
    }
  };

  const hasAnyLlm = configuredProviders.length > 0;
  const canSubmit =
    hasAnyLlm && prompt.length >= 10 && selectedLlms.length > 0 && synthesisLlm !== null;

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">New Research</h2>
        <p className="text-slate-600">
          Run your research prompt across multiple LLMs and get a synthesized report.
        </p>
      </div>

      {!hasAnyLlm && !keysLoading ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-amber-800">
            <strong>No API keys configured.</strong> Configure at least one API key to start
            research.{' '}
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

      <div className="space-y-6">
        <Card title="Research Prompt">
          <div className="space-y-2">
            <textarea
              value={prompt}
              onChange={(e): void => {
                setPrompt(e.target.value);
              }}
              placeholder="Enter your research question or topic..."
              className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[150px]"
              rows={8}
              disabled={submitting}
            />
            <p className="text-sm text-slate-500">{String(prompt.length)}/20000 characters</p>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card title="Research LLMs">
            <p className="text-sm text-slate-500 mb-3">Select which LLMs to query for research</p>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((provider) => {
                const available = isProviderAvailable(provider.id);
                const isSelected = selectedLlms.includes(provider.id);

                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={(): void => {
                      if (available) {
                        handleProviderToggle(provider.id);
                      }
                    }}
                    disabled={!available || submitting}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      !available
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {provider.shortName}
                    {!available ? ' (no key)' : ''}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Synthesis LLM">
            <p className="text-sm text-slate-500 mb-3">Select which LLM synthesizes the results</p>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map((provider) => {
                const available = isProviderAvailable(provider.id);
                const isSelected = synthesisLlm === provider.id;

                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={(): void => {
                      if (available) {
                        setSynthesisLlm(provider.id);
                      }
                    }}
                    disabled={!available || submitting}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      !available
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : isSelected
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {provider.shortName}
                    {!available ? ' (no key)' : ''}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="flex gap-3">
          <Button
            type="button"
            onClick={(): void => {
              void handleSubmit();
            }}
            disabled={!canSubmit || submitting}
            isLoading={submitting}
          >
            Start Research
          </Button>
        </div>
      </div>
    </Layout>
  );
}
