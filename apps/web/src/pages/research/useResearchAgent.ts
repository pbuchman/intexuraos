import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LlmModels,
  LlmProviders,
  getOpenRouterRawId,
  isOpenRouterModel,
} from '@intexuraos/llm-contract';
import { getSelectedModelsList, PROVIDER_MODELS, MAX_TOTAL_MODELS } from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys, useOpenRouterModels } from '@/hooks';
import { ApiError } from '@/services/apiClient';
import {
  getResearch,
  improveInput,
  saveDraft,
  updateDraft,
  validateInput,
} from '@/services/researchAgentApi';
import {
  getProviderForModel,
  getProviderForStoredModel,
  isSelectableModel,
  type LlmProvider,
  type SupportedModel,
  type SaveDraftRequest,
} from '@/services/researchAgentApi.types';

const SYNTHESIS_CAPABLE_MODELS: SupportedModel[] = [LlmModels.Gemini25Pro, LlmModels.GPT54];

export const RESEARCH_AGENT_CONSTANTS = {
  MAX_INPUT_CONTEXTS: 5,
  MAX_CONTEXT_LENGTH: 60000,
  SYNTHESIS_CAPABLE_MODELS,
} as const;

export interface UseResearchAgentOptions {
  draftId: string | null;
}

function useResearchAgentImpl(options: UseResearchAgentOptions) { // eslint-disable-line @typescript-eslint/explicit-function-return-type -- private; exported wrapper provides explicit return type via ReturnType
  const { draftId } = options;
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const { keys, loading: keysLoading } = useLlmKeys();
  const isOpenRouterConfigured = keys !== null && keys.openrouter !== null;
  const {
    models: openRouterModels,
    loading: openRouterLoading,
    error: openRouterError,
  } = useOpenRouterModels(isOpenRouterConfigured);

  const isEditMode = draftId !== null && draftId !== '';

  const [prompt, setPrompt] = useState('');
  const [modelSelections, setModelSelections] = useState<Map<LlmProvider, SupportedModel | null>>(
    () => new Map(),
  );
  const [synthesisModel, setSynthesisModel] = useState<SupportedModel | null>(null);
  const [selectedOpenRouterModels, setSelectedOpenRouterModels] = useState<string[]>([]);
  const [inputContexts, setInputContexts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSingleProviderConfirm, setShowSingleProviderConfirm] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [improving, setImproving] = useState(false);
  const [showImprovementModal, setShowImprovementModal] = useState(false);
  const [pendingImprovedPrompt, setPendingImprovedPrompt] = useState<string | null>(null);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [originalPromptBeforeImprovement, setOriginalPromptBeforeImprovement] = useState<
    string | null
  >(null);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedPromptRef = useRef('');
  const lastSavedStateRef = useRef<{
    modelSelections: Map<LlmProvider, SupportedModel | null>;
    synthesisModel: SupportedModel | null;
    inputContexts: string[];
    selectedOpenRouterModels: string[];
  }>({
    modelSelections: new Map(),
    synthesisModel: null,
    inputContexts: [],
    selectedOpenRouterModels: [],
  });

  const configuredProviders: LlmProvider[] =
    keysLoading || keys === null
      ? []
      : [
          ...PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id),
          ...(keys.openrouter !== null ? [LlmProviders.OpenRouter] : []),
        ];

  const failedProviders: Map<LlmProvider, string> = ((): Map<LlmProvider, string> => {
    const map = new Map<LlmProvider, string>();
    if (keys !== null) {
      for (const provider of PROVIDER_MODELS) {
        const testResult = keys.testResults[provider.id];
        if (testResult?.status === 'failure') {
          map.set(provider.id, testResult.message);
        }
      }
    }
    return map;
  })();

  useEffect(() => {
    const regularCount = Array.from(modelSelections.values()).filter((m) => m !== null).length;
    const maxOR = MAX_TOTAL_MODELS - regularCount;
    if (selectedOpenRouterModels.length > maxOR) {
      setSelectedOpenRouterModels((prev) => prev.slice(0, maxOR));
    }
  }, [modelSelections, selectedOpenRouterModels.length]);

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
        const selections = new Map<LlmProvider, SupportedModel | null>();
        for (const provider of PROVIDER_MODELS) {
          const selectedModel = draft.selectedModels.find(
            (m): m is SupportedModel =>
              isSelectableModel(m) && getProviderForStoredModel(m) === provider.id,
          );
          selections.set(provider.id, selectedModel ?? null);
        }
        setModelSelections(selections);
        const orModels = draft.selectedModels
          .filter((m) => isOpenRouterModel(m))
          .map((m) => getOpenRouterRawId(m));
        setSelectedOpenRouterModels(orModels);
        const draftSynthesisModel =
          isSelectableModel(draft.synthesisModel) &&
          SYNTHESIS_CAPABLE_MODELS.includes(draft.synthesisModel)
            ? draft.synthesisModel
            : null;
        setSynthesisModel(draftSynthesisModel);
        lastSavedPromptRef.current = draft.prompt;
        const loadedContexts =
          draft.inputContexts !== undefined && draft.inputContexts.length > 0
            ? draft.inputContexts.map((ctx) => ctx.content)
            : [];
        setInputContexts(loadedContexts);
        lastSavedStateRef.current = {
          modelSelections: selections,
          synthesisModel: draftSynthesisModel,
          inputContexts: loadedContexts,
          selectedOpenRouterModels: orModels,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load draft');
      } finally {
        setLoading(false);
      }
    })();
  }, [isEditMode, draftId, getAccessToken]);

  useEffect(() => {
    if (isEditMode) return;
    if (!keysLoading && keys !== null) {
      const configured = PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id);
      const selections = new Map<LlmProvider, SupportedModel | null>();
      for (const provider of PROVIDER_MODELS) {
        selections.set(provider.id, null);
      }
      setModelSelections(selections);
      const availableSynthesis = SYNTHESIS_CAPABLE_MODELS.find((m) =>
        configured.includes(getProviderForModel(m)),
      );
      if (availableSynthesis !== undefined) {
        setSynthesisModel(availableSynthesis);
      }
    }
  }, [keysLoading, keys, isEditMode]);

  const performAutosave = useCallback(async (): Promise<void> => {
    if (!isEditMode || !hasUnsavedChanges || prompt.trim().length === 0) return;
    try {
      const token = await getAccessToken();
      const validCtx = inputContexts.filter((c) => c.trim().length > 0);
      const selectedModels = getSelectedModelsList(modelSelections, selectedOpenRouterModels);
      const request: SaveDraftRequest = { prompt };
      if (selectedModels.length > 0) request.selectedModels = selectedModels;
      if (synthesisModel !== null) request.synthesisModel = synthesisModel;
      if (validCtx.length > 0) request.inputContexts = validCtx.map((content) => ({ content }));
      await updateDraft(token, draftId, request);
      lastSavedPromptRef.current = prompt;
      lastSavedStateRef.current = {
        modelSelections,
        synthesisModel,
        inputContexts: validCtx,
        selectedOpenRouterModels,
      };
      setHasUnsavedChanges(false);
    } catch {
      /* silent */
    }
  }, [
    isEditMode,
    draftId,
    hasUnsavedChanges,
    prompt,
    modelSelections,
    synthesisModel,
    inputContexts,
    selectedOpenRouterModels,
    getAccessToken,
  ]);

  useEffect(() => {
    if (!isEditMode) return;
    const promptChanged = prompt !== lastSavedPromptRef.current;
    const currentModels = getSelectedModelsList(modelSelections, selectedOpenRouterModels);
    const savedModels = getSelectedModelsList(
      lastSavedStateRef.current.modelSelections,
      lastSavedStateRef.current.selectedOpenRouterModels,
    );
    const modelsChanged = JSON.stringify(currentModels) !== JSON.stringify(savedModels);
    const synthesisChanged = synthesisModel !== lastSavedStateRef.current.synthesisModel;
    const contextsChanged =
      JSON.stringify(inputContexts) !== JSON.stringify(lastSavedStateRef.current.inputContexts);
    if (promptChanged || modelsChanged || synthesisChanged || contextsChanged) {
      setHasUnsavedChanges(true);
    }
  }, [
    prompt,
    modelSelections,
    synthesisModel,
    inputContexts,
    selectedOpenRouterModels,
    isEditMode,
  ]);

  useEffect(() => {
    if (!isEditMode) return undefined;
    if (autosaveTimerRef.current !== null) clearInterval(autosaveTimerRef.current);
    autosaveTimerRef.current = setInterval(() => {
      void performAutosave();
    }, 60000);
    return (): void => {
      if (autosaveTimerRef.current !== null) clearInterval(autosaveTimerRef.current);
    };
  }, [isEditMode, performAutosave]);

  useEffect(() => {
    return (): void => {
      if (autosaveTimerRef.current !== null) clearInterval(autosaveTimerRef.current);
    };
  }, []);

  const handlePromptBlur = (): void => {
    if (isEditMode && hasUnsavedChanges) void performAutosave();
  };

  const handleAutoImprove = async (): Promise<void> => {
    if (prompt.trim().length === 0) return;
    setImproving(true);
    setError(null);
    setValidationWarning(null);
    try {
      const token = await getAccessToken();
      const result = await improveInput(token, { prompt });
      setPrompt(result.improvedPrompt);
      if (isEditMode) void performAutosave();
    } catch {
      /* silent */
    } finally {
      setImproving(false);
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
  const selectedModels = getSelectedModelsList(modelSelections, selectedOpenRouterModels);
  const isSingleModelNoContext = selectedModels.length === 1 && !hasValidContexts;

  const executeSubmit = async (params?: {
    improvedPrompt?: string;
    originalPrompt?: string;
  }): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const promptToSubmit = params?.improvedPrompt ?? prompt;
    try {
      const token = await getAccessToken();
      const contextObjects = validContexts.map((content) => ({ content }));
      if (isEditMode) {
        const { updateDraft: updateDraftFn, approveResearch } = await import(
          '@/services/researchAgentApi'
        );
        const draftRequest: SaveDraftRequest = { prompt: promptToSubmit };
        if (selectedModels.length > 0) draftRequest.selectedModels = selectedModels;
        if (synthesisModel !== null) draftRequest.synthesisModel = synthesisModel;
        if (contextObjects.length > 0) draftRequest.inputContexts = contextObjects;
        await updateDraftFn(token, draftId, draftRequest);
        const research = await approveResearch(token, draftId);
        void navigate(`/research/${research.id}`);
      } else {
        if (synthesisModel === null) throw new Error('Synthesis model is required');
        const { createResearch } = await import('@/services/researchAgentApi');
        const request: Parameters<typeof createResearch>[1] = {
          prompt: promptToSubmit,
          selectedModels,
          synthesisModel,
        };
        if (params?.originalPrompt !== undefined) request.originalPrompt = params.originalPrompt;
        if (contextObjects.length > 0) request.inputContexts = contextObjects;
        const research = await createResearch(token, request);
        void navigate(`/research/${research.id}`);
      }
    } catch (err) {
      let errorMessage: string;
      if (err instanceof ApiError && err.details !== undefined) {
        const { errors: validationErrors } = err.details as {
          errors?: { path?: string; message?: string }[];
        };
        const messages = (validationErrors ?? [])
          .map((e) => e.message)
          .filter((m): m is string => m !== undefined);
        errorMessage = messages.length > 0 ? messages.join('; ') : err.message;
      } else {
        errorMessage = err instanceof Error ? err.message : 'Failed to create research';
      }
      setError(errorMessage);
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
    if (selectedModels.length > MAX_TOTAL_MODELS) {
      const excess = selectedModels.length - MAX_TOTAL_MODELS;
      setError(
        `Maximum ${String(MAX_TOTAL_MODELS)} models allowed. You selected ${String(selectedModels.length)}. Please remove ${String(excess)} model${excess === 1 ? '' : 's'}.`,
      );
      return;
    }
    setError(null);
    setValidationWarning(null);
    const hasGoogleKey = keys?.google !== null && keys?.google !== undefined;
    if (hasGoogleKey) {
      setValidating(true);
      setShowValidationModal(true);
      setValidationWarning(null);
      try {
        const token = await getAccessToken();
        const validation = await validateInput(token, { prompt, includeImprovement: true });
        if (validation.quality === 0) {
          setValidationWarning(validation.reason);
          setValidating(false);
          return;
        }
        if (validation.quality === 1 && validation.improvedPrompt !== null) {
          setShowValidationModal(false);
          setPendingImprovedPrompt(validation.improvedPrompt);
          setShowImprovementModal(true);
          setValidating(false);
          return;
        }
        setShowValidationModal(false);
      } catch {
        setShowValidationModal(false);
      } finally {
        setValidating(false);
      }
    }
    if (isSingleModelNoContext && !isEditMode) {
      setShowSingleProviderConfirm(true);
      return;
    }
    await executeSubmit();
  };

  const handleConfirmProceed = (): void => {
    setShowSingleProviderConfirm(false);
    if (originalPromptBeforeImprovement !== null) {
      void executeSubmit({ originalPrompt: originalPromptBeforeImprovement });
    } else {
      void executeSubmit();
    }
  };

  const handleUseImprovedPrompt = (): void => {
    if (pendingImprovedPrompt !== null) {
      const originalPrompt = prompt;
      setOriginalPromptBeforeImprovement(originalPrompt);
      setPrompt(pendingImprovedPrompt);
      setPendingImprovedPrompt(null);
      setShowImprovementModal(false);
      setValidationWarning(null);
      if (isSingleModelNoContext && !isEditMode) {
        setShowSingleProviderConfirm(true);
        return;
      }
      void executeSubmit({ improvedPrompt: pendingImprovedPrompt, originalPrompt });
    }
  };

  const handleUseOriginalPrompt = (): void => {
    setPendingImprovedPrompt(null);
    setShowImprovementModal(false);
    setValidationWarning(null);
    if (isSingleModelNoContext && !isEditMode) {
      setShowSingleProviderConfirm(true);
      return;
    }
    void executeSubmit();
  };

  const handleDiscardDraft = async (): Promise<void> => {
    if (!isEditMode) return;
    setDiscarding(true);
    try {
      const token = await getAccessToken();
      const { deleteResearch } = await import('@/services/researchAgentApi');
      await deleteResearch(token, draftId);
      void navigate('/research');
    } catch {
      setError('Failed to discard draft');
      setDiscarding(false);
      setShowDiscardConfirm(false);
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
      const request: SaveDraftRequest = { prompt };
      if (selectedModels.length > 0) request.selectedModels = selectedModels;
      if (synthesisModel !== null) request.synthesisModel = synthesisModel;
      if (contextObjects.length > 0) request.inputContexts = contextObjects;
      let resultId: string;
      if (isEditMode) {
        const updated = await updateDraft(token, draftId, request);
        resultId = updated.id;
        lastSavedPromptRef.current = prompt;
        setHasUnsavedChanges(false);
      } else {
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
  const hasSynthesisModel =
    synthesisModel !== null && SYNTHESIS_CAPABLE_MODELS.includes(synthesisModel);
  const canSubmit = prompt.length >= 10 && hasModelOrContext && hasSynthesisModel;

  const getDisabledReason = (): string | undefined => {
    if (canSubmit) return undefined;
    if (prompt.length < 10) return 'Enter a research prompt (at least 10 characters)';
    if (!hasModelOrContext) return 'Select at least one model or provide input context';
    if (!hasSynthesisModel) return 'Select Gemini Pro or GPT-5.4 for synthesis';
    return undefined;
  };

  const hasGoogleKey = keys?.google !== null && keys?.google !== undefined;

  const addInputContext = (): void => {
    if (inputContexts.length < RESEARCH_AGENT_CONSTANTS.MAX_INPUT_CONTEXTS) {
      setInputContexts((prev) => [...prev, '']);
    }
  };
  const removeInputContext = (index: number): void => {
    setInputContexts((prev) => prev.filter((_, i) => i !== index));
  };
  const updateInputContext = (index: number, value: string): void => {
    setInputContexts((prev) => prev.map((ctx, i) => (i === index ? value : ctx)));
  };

  return {
    // mode + status
    isEditMode,
    loading,
    error,
    keysLoading,
    hasAnyProvider,
    hasGoogleKey,
    canSubmit,
    getDisabledReason,
    // form state
    prompt,
    setPrompt,
    modelSelections,
    handleModelChange,
    synthesisModel,
    setSynthesisModel,
    selectedOpenRouterModels,
    setSelectedOpenRouterModels,
    inputContexts,
    addInputContext,
    removeInputContext,
    updateInputContext,
    selectedModels,
    // dependent data
    configuredProviders,
    failedProviders,
    isOpenRouterConfigured,
    openRouterModels,
    openRouterLoading,
    openRouterError,
    // flags
    submitting,
    savingDraft,
    discarding,
    validating,
    improving,
    showSingleProviderConfirm,
    setShowSingleProviderConfirm,
    showDiscardConfirm,
    setShowDiscardConfirm,
    showValidationModal,
    setShowValidationModal,
    showImprovementModal,
    pendingImprovedPrompt,
    validationWarning,
    setValidationWarning,
    // handlers
    handlePromptBlur,
    handleAutoImprove,
    handleSubmit,
    handleConfirmProceed,
    handleUseImprovedPrompt,
    handleUseOriginalPrompt,
    handleDiscardDraft,
    handleSaveDraft,
  };
}

export type ResearchAgentHook = ReturnType<typeof useResearchAgentImpl>;

export function useResearchAgent(options: UseResearchAgentOptions): ResearchAgentHook {
  return useResearchAgentImpl(options);
}
