import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  Layout,
  ModelSelector,
  getDefaultModelSelections,
  getSelectedModelsList,
  PROVIDER_MODELS,
} from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys } from '@/hooks';
import { getResearch, saveDraft, updateDraft } from '@/services/llmOrchestratorApi';
import type {
  LlmProvider,
  SupportedModel,
  SaveDraftRequest,
} from '@/services/llmOrchestratorApi.types';

const MAX_INPUT_CONTEXTS = 5;
const MAX_CONTEXT_LENGTH = 60000;

export function LlmOrchestratorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getAccessToken } = useAuth();
  const { keys, loading: keysLoading } = useLlmKeys();

  const draftId = searchParams.get('draftId');
  const isEditMode = draftId !== null && draftId !== '';

  const [prompt, setPrompt] = useState('');
  const [modelSelections, setModelSelections] = useState<Map<LlmProvider, SupportedModel | null>>(
    () => new Map()
  );
  const [synthesisModel, setSynthesisModel] = useState<SupportedModel | null>(null);
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
      : PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id);

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

        // Convert legacy selectedLlms to model selections
        const selections = new Map<LlmProvider, SupportedModel | null>();
        for (const provider of PROVIDER_MODELS) {
          if (draft.selectedLlms.includes(provider.id)) {
            selections.set(provider.id, provider.default);
          } else {
            selections.set(provider.id, null);
          }
        }
        setModelSelections(selections);

        // Convert legacy synthesisLlm to model
        const synthProvider = PROVIDER_MODELS.find((p) => p.id === draft.synthesisLlm);
        setSynthesisModel(synthProvider?.default ?? null);

        lastSavedPromptRef.current = draft.prompt;

        // Load input contexts if exists
        const loadedContexts =
          draft.inputContexts !== undefined && draft.inputContexts.length > 0
            ? draft.inputContexts.map((ctx) => ctx.content)
            : [];
        setInputContexts(loadedContexts);

        // Track initial saved state for change detection
        lastSavedStateRef.current = {
          modelSelections: selections,
          synthesisModel: synthProvider?.default ?? null,
          inputContexts: loadedContexts,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load draft');
      } finally {
        setLoading(false);
      }
    })();
  }, [isEditMode, draftId, getAccessToken]);

  // Auto-select default models for configured providers (only for new research)
  useEffect(() => {
    if (isEditMode) return; // Skip auto-select when editing draft

    if (!keysLoading && keys !== null) {
      const configured = PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id);
      const selections = getDefaultModelSelections(configured);
      setModelSelections(selections);

      // Set first configured model as synthesis model
      const selectedModels = getSelectedModelsList(selections);
      if (selectedModels.length > 0) {
        const firstModel = selectedModels[0];
        if (firstModel !== undefined) {
          setSynthesisModel(firstModel);
        }
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
      const selectedModels = getSelectedModelsList(modelSelections);

      const request: SaveDraftRequest = { prompt };
      if (selectedModels.length > 0) {
        request.selectedModels = selectedModels;
      }
      if (synthesisModel !== null) {
        request.synthesisModel = synthesisModel;
      }
      if (validContexts.length > 0) {
        request.inputContexts = validContexts.map((content) => ({ content }));
      }

      await updateDraft(token, draftId, request);

      lastSavedPromptRef.current = prompt;
      lastSavedStateRef.current = {
        modelSelections,
        synthesisModel,
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
    modelSelections,
    synthesisModel,
    inputContexts,
    getAccessToken,
  ]);

  // Track changes - any form field change should trigger autosave
  const lastSavedStateRef = useRef<{
    modelSelections: Map<LlmProvider, SupportedModel | null>;
    synthesisModel: SupportedModel | null;
    inputContexts: string[];
  }>({ modelSelections: new Map(), synthesisModel: null, inputContexts: [] });

  useEffect(() => {
    if (!isEditMode) return;

    const promptChanged = prompt !== lastSavedPromptRef.current;

    const currentModels = getSelectedModelsList(modelSelections);
    const savedModels = getSelectedModelsList(lastSavedStateRef.current.modelSelections);
    const modelsChanged = JSON.stringify(currentModels) !== JSON.stringify(savedModels);

    const synthesisChanged = synthesisModel !== lastSavedStateRef.current.synthesisModel;
    const contextsChanged =
      JSON.stringify(inputContexts) !== JSON.stringify(lastSavedStateRef.current.inputContexts);

    if (promptChanged || modelsChanged || synthesisChanged || contextsChanged) {
      setHasUnsavedChanges(true);
    }
  }, [prompt, modelSelections, synthesisModel, inputContexts, isEditMode]);

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

  const handleModelChange = (provider: LlmProvider, model: SupportedModel | null): void => {
    setModelSelections((prev) => {
      const next = new Map(prev);
      next.set(provider, model);
      return next;
    });
  };

  const validContexts = inputContexts.filter((ctx) => ctx.trim().length > 0);
  const hasValidContexts = validContexts.length > 0;
  const selectedModels = getSelectedModelsList(modelSelections);
  const isSingleModelNoContext = selectedModels.length === 1 && !hasValidContexts;

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
        if (selectedModels.length > 0) {
          draftRequest.selectedModels = selectedModels;
        }
        if (synthesisModel !== null) {
          draftRequest.synthesisModel = synthesisModel;
        }
        if (contextObjects.length > 0) {
          draftRequest.inputContexts = contextObjects;
        }
        await updateDraftFn(token, draftId, draftRequest);

        const research = await approveResearch(token, draftId);
        void navigate(`/research/${research.id}`);
      } else {
        if (synthesisModel === null) {
          throw new Error('Synthesis model is required');
        }
        const { createResearch } = await import('@/services/llmOrchestratorApi');
        const request: Parameters<typeof createResearch>[1] = {
          prompt,
          selectedModels,
          synthesisModel,
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
    if (selectedModels.length === 0 && !hasValidContexts) {
      setError('Select at least one model or provide input context');
      return;
    }
    if (synthesisModel === null) {
      setError('Select a synthesis model');
      return;
    }

    await executeSubmit(isSingleModelNoContext);
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
      if (selectedModels.length > 0) {
        request.selectedModels = selectedModels;
      }
      if (synthesisModel !== null) {
        request.synthesisModel = synthesisModel;
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

  const hasAnyProvider = configuredProviders.length > 0;
  const hasModelOrContext = selectedModels.length > 0 || hasValidContexts;
  const canSubmit = prompt.length >= 10 && hasModelOrContext && synthesisModel !== null;

  const getDisabledReason = (): string | undefined => {
    if (canSubmit) return undefined;
    if (prompt.length < 10) return 'Enter a research prompt (at least 10 characters)';
    if (!hasModelOrContext) return 'Select at least one model or provide input context';
    if (synthesisModel === null) return 'Select a synthesis model';
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

      {!hasAnyProvider && !keysLoading ? (
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

        <Card title="Research Models">
          <p className="text-sm text-slate-500 mb-4">
            Select which models to query for research (one per provider)
          </p>
          <ModelSelector
            selectedModels={modelSelections}
            onChange={handleModelChange}
            configuredProviders={configuredProviders}
            disabled={submitting || savingDraft}
          />
        </Card>

        <Card title="Synthesis Model">
          <p className="text-sm text-slate-500 mb-4">Select which model synthesizes the results</p>
          <div className="flex flex-wrap gap-2">
            {selectedModels.length === 0 ? (
              <p className="text-slate-400 text-sm">Select at least one research model first</p>
            ) : (
              selectedModels.map((model) => {
                const isSelected = synthesisModel === model;
                const modelConfig = PROVIDER_MODELS.flatMap((p) => p.models).find(
                  (m) => m.id === model
                );
                return (
                  <button
                    key={model}
                    type="button"
                    onClick={(): void => {
                      setSynthesisModel(model);
                    }}
                    disabled={submitting || savingDraft}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      isSelected
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {modelConfig?.name ?? model}
                  </button>
                );
              })
            )}
          </div>
        </Card>

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
                <h3 className="text-lg font-semibold text-slate-900">Single Model Research</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Research started with only one model (
                  {PROVIDER_MODELS.flatMap((p) => p.models).find((m) => m.id === selectedModels[0])
                    ?.name ?? selectedModels[0]}
                  ) and no additional context.
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
