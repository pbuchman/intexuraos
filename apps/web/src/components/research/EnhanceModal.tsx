import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, XCircle } from 'lucide-react';
import { getOpenRouterRawId, isOpenRouterModel } from '@intexuraos/llm-contract';
import {
  Button,
  ErrorBanner,
  MAX_TOTAL_MODELS,
  ModelSelector,
  getSelectedModelsList,
} from '@/components';
import {
  type OpenRouterModelInfo,
  type Research,
  type SupportedModel,
} from '@/services/researchAgentApi.types';
import { getModelDisplayName } from './shared.js';
import { resolveOpenRouterModelName } from '@/utils/openRouterModelNames.js';
import {
  isStoredResearchSynthesisModelExecutable,
  RESEARCH_SYNTHESIS_MODELS,
} from '@/utils/researchModelAvailability.js';

interface EnhanceModalProps {
  research: Research;
  openRouterModels: OpenRouterModelInfo[];
  openRouterLoading: boolean;
  openRouterError: string | null;
  hasOpenRouterAccess: boolean;
  onRetryModelCatalog: () => void;
  onEnhance: (params: {
    additionalModels?: SupportedModel[];
    additionalContexts?: { content: string }[];
    removeContextIds?: string[];
    synthesisModel?: SupportedModel;
  }) => Promise<void>;
  onClose: () => void;
}

interface EnhanceModelCapacity {
  completedModelCount: number;
  completedOpenRouterRawIds: Set<string>;
  remainingSlots: number;
}

export function getEnhanceModelCapacity(
  results: readonly Pick<Research['llmResults'][number], 'model' | 'status'>[],
): EnhanceModelCapacity {
  const completedModelIds = new Set(
    results
      .filter((result) => result.status === 'completed')
      .map((result) => result.model),
  );
  const completedOpenRouterRawIds = new Set(
    [...completedModelIds]
      .filter((model) => isOpenRouterModel(model))
      .map((model) => getOpenRouterRawId(model)),
  );
  return {
    completedModelCount: completedModelIds.size,
    completedOpenRouterRawIds,
    remainingSlots: Math.max(0, MAX_TOTAL_MODELS - completedModelIds.size),
  };
}

export function EnhanceModal({
  research,
  openRouterModels,
  openRouterLoading,
  openRouterError,
  hasOpenRouterAccess,
  onRetryModelCatalog,
  onEnhance,
  onClose,
}: EnhanceModalProps): React.JSX.Element {
  const [selectedAdditionalModels, setSelectedAdditionalModels] = useState<string[]>([]);
  const [enhanceContexts, setEnhanceContexts] = useState<string[]>([]);
  const [removeContextIds, setRemoveContextIds] = useState<Set<string>>(() => new Set());
  const [enhanceSynthesisModel, setEnhanceSynthesisModel] = useState<SupportedModel | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return (): void => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const modelCapacity = useMemo(
    () => getEnhanceModelCapacity(research.llmResults),
    [research.llmResults],
  );
  const additionalCatalog = useMemo(
    () =>
      openRouterModels.filter(
        (model) => !modelCapacity.completedOpenRouterRawIds.has(model.id),
      ),
    [modelCapacity, openRouterModels],
  );
  const remainingModelSlots = modelCapacity.remainingSlots;

  const toggleRemoveContext = (contextId: string): void => {
    setRemoveContextIds((prev) => {
      const next = new Set(prev);
      if (next.has(contextId)) {
        next.delete(contextId);
      } else {
        next.add(contextId);
      }
      return next;
    });
  };

  const additionalModels = getSelectedModelsList(selectedAdditionalModels);
  const validContexts = enhanceContexts.filter((c) => c.trim().length > 0);
  const availableModelIds = openRouterModels.map((model) => model.id);
  const modelCatalogReady =
    hasOpenRouterAccess && !openRouterLoading && openRouterError === null;
  const inheritedSynthesisExecutable = isStoredResearchSynthesisModelExecutable(
    research.synthesisModel,
    availableModelIds,
  );
  const selectedSynthesisExecutable =
    enhanceSynthesisModel !== null &&
    isStoredResearchSynthesisModelExecutable(enhanceSynthesisModel, availableModelIds);
  const hasSynthesisChange =
    enhanceSynthesisModel !== null && enhanceSynthesisModel !== research.synthesisModel;
  const hasExecutableSynthesis =
    enhanceSynthesisModel === null
      ? inheritedSynthesisExecutable
      : selectedSynthesisExecutable;
  const isDisabled =
    enhancing ||
    !hasOpenRouterAccess ||
    openRouterLoading ||
    openRouterError !== null ||
    !hasExecutableSynthesis ||
    (additionalModels.length === 0 &&
      validContexts.length === 0 &&
      removeContextIds.size === 0 &&
      !hasSynthesisChange);

  const handleEnhance = async (): Promise<void> => {
    if (isDisabled) return;

    const removeIds = Array.from(removeContextIds);

    setEnhancing(true);
    setEnhanceError(null);

    try {
      await onEnhance({
        ...(additionalModels.length > 0 && { additionalModels }),
        ...(validContexts.length > 0 && {
          additionalContexts: validContexts.map((content) => ({ content })),
        }),
        ...(removeIds.length > 0 && { removeContextIds: removeIds }),
        ...(hasSynthesisChange && { synthesisModel: enhanceSynthesisModel }),
      });
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : 'Failed to enhance research');
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
        <h3 className="mb-4 text-lg font-semibold dark:text-slate-100">Enhance Research</h3>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Add more AI models, change synthesis model, or modify context.
        </p>

        {!hasOpenRouterAccess ? null : openRouterLoading ? (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-700/50 dark:text-slate-300">
            Loading the OpenRouter model catalog before enhancement is available.
          </div>
        ) : openRouterError !== null ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <span>The OpenRouter model catalog could not be loaded.</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetryModelCatalog}
            >
              Retry model catalog
            </Button>
          </div>
        ) : !inheritedSynthesisExecutable && !selectedSynthesisExecutable ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            The inherited synthesis model is unavailable. Select an active synthesis model before
            enhancing this research.
          </div>
        ) : null}

        {/* Additional Models */}
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
            Add OpenRouter models:
          </p>
          <ModelSelector
            availableModels={additionalCatalog}
            selectedModelIds={selectedAdditionalModels}
            onChange={setSelectedAdditionalModels}
            loading={openRouterLoading}
            disabled={enhancing}
            error={openRouterError}
            hasOpenRouterAccess={hasOpenRouterAccess}
            maxModels={remainingModelSlots}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Models already used by this research are excluded. You can add{' '}
            {String(remainingModelSlots)} more.
          </p>
        </div>

        {/* Synthesis Model */}
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
            Synthesis Model{' '}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              (current:{' '}
              {getModelDisplayName(research.synthesisModel)}
              )
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {RESEARCH_SYNTHESIS_MODELS.map((model) => {
              const isSelected = enhanceSynthesisModel === model;
              const isCurrent = research.synthesisModel === model;
              const rawId = getOpenRouterRawId(model);
              const modelDisplayName = resolveOpenRouterModelName(rawId);
              const isAvailable =
                modelCatalogReady &&
                openRouterModels.some((candidate) => candidate.id === rawId);
              const isModelDisabled = !hasOpenRouterAccess || !isAvailable || enhancing;

              return (
                <button
                  key={model}
                  type="button"
                  onClick={(): void => {
                    setEnhanceSynthesisModel(isSelected ? null : model);
                  }}
                  disabled={isModelDisabled}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    isSelected
                    ? 'bg-green-600 text-white'
                    : isCurrent
                      ? 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                        : isAvailable
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                          : 'bg-slate-50 text-slate-400 cursor-not-allowed dark:bg-slate-700/50 dark:text-slate-500'
                  }`}
                  title={
                    modelCatalogReady && !isAvailable
                      ? 'Model is unavailable'
                      : isCurrent
                        ? 'Current model'
                        : undefined
                  }
                >
                  {modelDisplayName}
                  {modelCatalogReady && !isAvailable ? ' (unavailable)' : ''}
                  {isCurrent && !isSelected ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* Existing Contexts */}
        {(research.inputContexts?.length ?? 0) > 0 ? (
          <div className="mb-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              Existing contexts{' '}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                ({String((research.inputContexts?.length ?? 0) - removeContextIds.size)} will be
                kept)
              </span>
            </p>
            <div className="space-y-2">
              {research.inputContexts?.map((ctx, idx) => {
                const isRemoved = removeContextIds.has(ctx.id);
                return (
                  <div
                    key={ctx.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 ${
                      isRemoved ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30' : 'border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!isRemoved}
                      onChange={(): void => {
                        toggleRemoveContext(ctx.id);
                      }}
                      disabled={enhancing}
                      className="h-4 w-4"
                    />
                    <span
                      className={`flex-1 text-sm truncate ${
                        isRemoved ? 'text-red-600 line-through dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {ctx.label !== undefined && ctx.label !== ''
                        ? ctx.label
                        : `Context ${String(idx + 1)}: ${ctx.content.substring(0, 100)}${ctx.content.length > 100 ? '...' : ''}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* New Contexts */}
        <div className="mb-4 space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Add new context{' '}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              (
              {String(
                (research.inputContexts?.length ?? 0) -
                  removeContextIds.size +
                  enhanceContexts.length
              )}
              /5 total)
            </span>
          </p>

          {enhanceContexts.map((ctx, idx) => (
            <div key={idx} className="flex gap-2">
              <textarea
                value={ctx}
                onChange={(e): void => {
                  setEnhanceContexts((prev) =>
                    prev.map((c, i) => (i === idx ? e.target.value : c))
                  );
                }}
                placeholder="Paste additional reference content..."
                className="flex-1 rounded-lg border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
                rows={2}
                disabled={enhancing}
              />
              <button
                type="button"
                onClick={(): void => {
                  setEnhanceContexts((prev) => prev.filter((_, i) => i !== idx));
                }}
                disabled={enhancing}
                className="self-start rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {(research.inputContexts?.length ?? 0) -
            removeContextIds.size +
            enhanceContexts.length <
          5 ? (
            <button
              type="button"
              onClick={(): void => {
                setEnhanceContexts((prev) => [...prev, '']);
              }}
              disabled={enhancing}
              className="w-full rounded-lg border-2 border-dashed border-slate-200 py-2 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"
            >
              + Add context
            </button>
          ) : null}
        </div>

        <ErrorBanner message={enhanceError} className="mb-4" />

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={enhancing}>
            <XCircle className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
          <Button
            onClick={(): void => {
              void handleEnhance();
            }}
            disabled={isDisabled}
            isLoading={enhancing}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Enhance</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
