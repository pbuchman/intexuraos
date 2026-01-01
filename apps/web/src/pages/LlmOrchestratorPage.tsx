import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useLlmKeys, useResearches } from '@/hooks';
import type { LlmProvider } from '@/services/llmOrchestratorApi.types';

const MAX_INPUT_CONTEXTS = 5;
const MAX_CONTEXT_LENGTH = 60000;

interface ProviderOption {
  id: LlmProvider;
  name: string;
  shortName: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'anthropic', name: 'Claude Opus 4.5', shortName: 'Claude' },
  { id: 'google', name: 'Gemini 2.0 Flash', shortName: 'Gemini' },
  { id: 'openai', name: 'GPT-4.1', shortName: 'GPT' },
];

export function LlmOrchestratorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { keys, loading: keysLoading } = useLlmKeys();
  const { createResearch, saveDraft } = useResearches();

  const [prompt, setPrompt] = useState('');
  const [selectedLlms, setSelectedLlms] = useState<LlmProvider[]>([]);
  const [synthesisLlm, setSynthesisLlm] = useState<LlmProvider | null>(null);
  const [inputContexts, setInputContexts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addInputContext = (): void => {
    if (inputContexts.length < MAX_INPUT_CONTEXTS) {
      setInputContexts((prev) => [...prev, '']);
    }
  };

  const removeInputContext = (index: number): void => {
    setInputContexts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateInputContext = (index: number, value: string): void => {
    setInputContexts((prev) => prev.map((ctx, i) => (i === index ? value : ctx)));
  };

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

  const validContexts = inputContexts.filter((ctx) => ctx.trim().length > 0);
  const hasValidContexts = validContexts.length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (prompt.length < 10) {
      setError('Prompt must be at least 10 characters');
      return;
    }
    if (selectedLlms.length === 0 && !hasValidContexts) {
      setError('Select at least one LLM or provide input context');
      return;
    }
    if (synthesisLlm === null) {
      setError('Select a synthesis LLM');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const contextObjects = validContexts.map((content) => ({ content }));

      const request: Parameters<typeof createResearch>[0] = {
        prompt,
        selectedLlms,
        synthesisLlm,
      };
      if (contextObjects.length > 0) {
        request.inputContexts = contextObjects;
      }

      const research = await createResearch(request);
      void navigate(`/research/${research.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create research');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (prompt.trim().length === 0) {
      setError('Prompt is required');
      return;
    }

    setSavingDraft(true);
    setError(null);

    try {
      const contextObjects = validContexts.map((content) => ({ content }));

      const request: Parameters<typeof saveDraft>[0] = {
        prompt,
      };
      if (selectedLlms.length > 0) {
        request.selectedLlms = selectedLlms;
      }
      if (synthesisLlm !== null) {
        request.synthesisLlm = synthesisLlm;
      }
      if (contextObjects.length > 0) {
        request.inputContexts = contextObjects;
      }

      const result = await saveDraft(request);
      void navigate(`/research/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  const hasAnyLlm = configuredProviders.length > 0;
  const hasLlmOrContext = selectedLlms.length > 0 || hasValidContexts;
  const canSubmit = prompt.length >= 10 && hasLlmOrContext && synthesisLlm !== null;

  const getDisabledReason = (): string | undefined => {
    if (canSubmit) return undefined;
    if (prompt.length < 10) return 'Enter a research prompt (at least 10 characters)';
    if (!hasLlmOrContext) return 'Select at least one LLM or provide input context';
    if (synthesisLlm === null) return 'Select a synthesis LLM';
    return undefined;
  };

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
              disabled={submitting || savingDraft}
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
                    disabled={!available || submitting || savingDraft}
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
                    disabled={!available || submitting || savingDraft}
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

        <Card title="Input Context (Optional)">
          <p className="text-sm text-slate-500 mb-4">
            Add your own reference materials to include in the research synthesis
          </p>
          <div className="space-y-4">
            {inputContexts.map((ctx, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">
                    Context {String(idx + 1)}
                  </span>
                  <button
                    type="button"
                    onClick={(): void => {
                      removeInputContext(idx);
                    }}
                    disabled={submitting || savingDraft}
                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                    title="Remove context"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={ctx}
                  onChange={(e): void => {
                    updateInputContext(idx, e.target.value);
                  }}
                  placeholder="Paste your reference content here..."
                  className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[100px]"
                  maxLength={MAX_CONTEXT_LENGTH}
                  disabled={submitting || savingDraft}
                />
                <div className="text-xs text-slate-400 text-right">
                  {ctx.length.toLocaleString()}/{MAX_CONTEXT_LENGTH.toLocaleString()}
                </div>
              </div>
            ))}
            {inputContexts.length < MAX_INPUT_CONTEXTS ? (
              <button
                type="button"
                onClick={addInputContext}
                disabled={submitting || savingDraft}
                className="w-full py-2 px-4 rounded-lg border-2 border-dashed border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Input Context
              </button>
            ) : (
              <p className="text-sm text-slate-400 text-center">
                Maximum {String(MAX_INPUT_CONTEXTS)} contexts allowed
              </p>
            )}
          </div>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => {
              void handleSaveDraft();
            }}
            disabled={prompt.trim().length === 0 || submitting || savingDraft}
            isLoading={savingDraft}
            title={prompt.trim().length === 0 ? 'Enter a prompt to save draft' : undefined}
          >
            Save as Draft
          </Button>
          <Button
            type="button"
            onClick={(): void => {
              void handleSubmit();
            }}
            disabled={!canSubmit || submitting || savingDraft}
            isLoading={submitting}
            title={getDisabledReason()}
          >
            Start Research
          </Button>
        </div>
      </div>
    </Layout>
  );
}
