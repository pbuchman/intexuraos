import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys } from '@/hooks';
import { getResearch, saveDraft, updateDraft } from '@/services/llmOrchestratorApi';
import type { LlmProvider, SaveDraftRequest } from '@/services/llmOrchestratorApi.types';

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
  const [searchParams] = useSearchParams();
  const { getAccessToken } = useAuth();
  const { keys, loading: keysLoading } = useLlmKeys();

  const draftId = searchParams.get('draftId');
  const isEditMode = draftId !== null && draftId !== '';

  const [prompt, setPrompt] = useState('');
  const [selectedLlms, setSelectedLlms] = useState<LlmProvider[]>([]);
  const [synthesisLlm, setSynthesisLlm] = useState<LlmProvider | null>(null);
  const [inputContexts, setInputContexts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSingleProviderConfirm, setShowSingleProviderConfirm] = useState(false);
  const [pendingResearchId, setPendingResearchId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedPromptRef = useRef('');

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

  // Load draft if in edit mode
  useEffect(() => {
    if (!isEditMode) {
      setLoading(false);
      return;
    }

    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const draft = await getResearch(token, draftId);

        setPrompt(draft.prompt);
        setSelectedLlms(draft.selectedLlms);
        setSynthesisLlm(draft.synthesisLlm);
        lastSavedPromptRef.current = draft.prompt;

        // Load input contexts if exists
        const loadedContexts =
          draft.inputContexts !== undefined && draft.inputContexts.length > 0
            ? draft.inputContexts.map((ctx) => ctx.content)
            : [];
        setInputContexts(loadedContexts);

        // Track initial saved state for change detection
        lastSavedStateRef.current = {
          selectedLlms: draft.selectedLlms,
          synthesisLlm: draft.synthesisLlm,
          inputContexts: loadedContexts,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load draft');
      } finally {
        setLoading(false);
      }
    })();
  }, [isEditMode, draftId, getAccessToken]);

  // Auto-select all configured LLMs and set first configured as synthesis LLM (only for new research)
  useEffect(() => {
    if (isEditMode) return; // Skip auto-select when editing draft

    if (!keysLoading && keys !== null) {
      const configured = PROVIDERS.filter((p) => keys[p.id] !== null).map((p) => p.id);
      setSelectedLlms(configured);
      const firstConfigured = configured[0];
      if (firstConfigured !== undefined) {
        setSynthesisLlm(firstConfigured);
      }
    }
  }, [keysLoading, keys, isEditMode]);

  // Autosave function
  const performAutosave = useCallback(async (): Promise<void> => {
    if (!isEditMode || !hasUnsavedChanges || prompt.trim().length === 0) {
      return;
    }

    try {
      const token = await getAccessToken();
      const validContexts = inputContexts.filter((ctx) => ctx.trim().length > 0);

      const request: SaveDraftRequest = { prompt };
      if (selectedLlms.length > 0) {
        request.selectedLlms = selectedLlms;
      }
      if (synthesisLlm !== null) {
        request.synthesisLlm = synthesisLlm;
      }
      if (validContexts.length > 0) {
        request.inputContexts = validContexts.map((content) => ({ content }));
      }

      await updateDraft(token, draftId, request);

      lastSavedPromptRef.current = prompt;
      lastSavedStateRef.current = {
        selectedLlms,
        synthesisLlm,
        inputContexts: validContexts,
      };
      setHasUnsavedChanges(false);
    } catch {
      // Silently fail autosave - don't disrupt user
    }
  }, [
    isEditMode,
    draftId,
    hasUnsavedChanges,
    prompt,
    selectedLlms,
    synthesisLlm,
    inputContexts,
    getAccessToken,
  ]);

  // Track changes - any form field change should trigger autosave
  const lastSavedStateRef = useRef<{
    selectedLlms: LlmProvider[];
    synthesisLlm: LlmProvider | null;
    inputContexts: string[];
  }>({ selectedLlms: [], synthesisLlm: null, inputContexts: [] });

  useEffect(() => {
    if (!isEditMode) return;

    const promptChanged = prompt !== lastSavedPromptRef.current;
    const llmsChanged =
      JSON.stringify(selectedLlms) !== JSON.stringify(lastSavedStateRef.current.selectedLlms);
    const synthesisChanged = synthesisLlm !== lastSavedStateRef.current.synthesisLlm;
    const contextsChanged =
      JSON.stringify(inputContexts) !== JSON.stringify(lastSavedStateRef.current.inputContexts);

    if (promptChanged || llmsChanged || synthesisChanged || contextsChanged) {
      setHasUnsavedChanges(true);
    }
  }, [prompt, selectedLlms, synthesisLlm, inputContexts, isEditMode]);

  // 1-minute autosave interval
  useEffect(() => {
    if (!isEditMode) return undefined;

    if (autosaveTimerRef.current !== null) {
      clearInterval(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setInterval(() => {
      void performAutosave();
    }, 60000); // 1 minute

    return (): void => {
      if (autosaveTimerRef.current !== null) {
        clearInterval(autosaveTimerRef.current);
      }
    };
  }, [isEditMode, performAutosave]);

  // Cleanup on unmount
  useEffect(() => {
    return (): void => {
      if (autosaveTimerRef.current !== null) {
        clearInterval(autosaveTimerRef.current);
      }
    };
  }, []);

  const handlePromptBlur = (): void => {
    if (isEditMode && hasUnsavedChanges) {
      void performAutosave();
    }
  };

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
  const isSingleProviderNoContext = selectedLlms.length === 1 && !hasValidContexts;

  const executeSubmit = async (showConfirmation: boolean): Promise<void> => {
    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const contextObjects = validContexts.map((content) => ({ content }));

      if (isEditMode) {
        const { updateDraft: updateDraftFn, approveResearch } =
          await import('@/services/llmOrchestratorApi');

        const draftRequest: SaveDraftRequest = { prompt };
        if (selectedLlms.length > 0) {
          draftRequest.selectedLlms = selectedLlms;
        }
        if (synthesisLlm !== null) {
          draftRequest.synthesisLlm = synthesisLlm;
        }
        if (contextObjects.length > 0) {
          draftRequest.inputContexts = contextObjects;
        }
        await updateDraftFn(token, draftId, draftRequest);

        const research = await approveResearch(token, draftId);
        void navigate(`/research/${research.id}`);
      } else {
        if (synthesisLlm === null) {
          throw new Error('Synthesis LLM is required');
        }
        const { createResearch } = await import('@/services/llmOrchestratorApi');
        const request: Parameters<typeof createResearch>[1] = {
          prompt,
          selectedLlms,
          synthesisLlm,
        };
        if (contextObjects.length > 0) {
          request.inputContexts = contextObjects;
        }
        const research = await createResearch(token, request);

        if (showConfirmation) {
          setPendingResearchId(research.id);
          setShowSingleProviderConfirm(true);
          setSubmitting(false);
        } else {
          void navigate(`/research/${research.id}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create research');
      setSubmitting(false);
    }
  };

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

    await executeSubmit(isSingleProviderNoContext);
  };

  const handleConfirmProceed = (): void => {
    if (pendingResearchId !== null) {
      setShowSingleProviderConfirm(false);
      void navigate(`/research/${pendingResearchId}`);
    }
  };

  const handleConfirmDiscard = async (): Promise<void> => {
    if (pendingResearchId === null) return;

    setDiscarding(true);
    try {
      const token = await getAccessToken();
      const { deleteResearch } = await import('@/services/llmOrchestratorApi');
      await deleteResearch(token, pendingResearchId);
      window.location.reload();
    } catch {
      setError('Failed to discard research');
      setDiscarding(false);
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
      const token = await getAccessToken();
      const contextObjects = validContexts.map((content) => ({ content }));

      let resultId: string;

      const request: SaveDraftRequest = { prompt };
      if (selectedLlms.length > 0) {
        request.selectedLlms = selectedLlms;
      }
      if (synthesisLlm !== null) {
        request.synthesisLlm = synthesisLlm;
      }
      if (contextObjects.length > 0) {
        request.inputContexts = contextObjects;
      }

      if (isEditMode) {
        // Update existing draft
        const updated = await updateDraft(token, draftId, request);
        resultId = updated.id;
        lastSavedPromptRef.current = prompt;
        setHasUnsavedChanges(false);
      } else {
        // Create new draft
        const result = await saveDraft(token, request);
        resultId = result.id;
      }

      void navigate(`/research/${resultId}`);
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
        <h2 className="text-2xl font-bold text-slate-900">
          {isEditMode ? 'Edit Research' : 'New Research'}
        </h2>
        <p className="text-slate-600">
          Run your research prompt across multiple LLMs and get a synthesized report.
        </p>
      </div>

      {loading ? (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-700">
          Loading draft...
        </div>
      ) : null}

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
              onBlur={handlePromptBlur}
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

      {showSingleProviderConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Single Provider Research</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Research started with only one provider (
                  {PROVIDERS.find((p) => p.id === selectedLlms[0])?.shortName ?? selectedLlms[0]})
                  and no additional context.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  The result will show the individual report without synthesis.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={(): void => {
                  void handleConfirmDiscard();
                }}
                disabled={discarding}
                isLoading={discarding}
              >
                Discard
              </Button>
              <Button onClick={handleConfirmProceed} disabled={discarding}>
                Proceed
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
