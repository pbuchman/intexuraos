import { useState } from 'react';
import { Plus, Trash2, XCircle } from 'lucide-react';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  Button,
  ModelSelector,
  PROVIDER_MODELS,
  getSelectedModelsList,
} from '@/components';
import { ErrorBanner } from '@/components';
import {
  getProviderForModel,
  type LlmProvider,
  type Research,
  type SupportedModel,
} from '@/services/researchAgentApi.types';
// getModelDisplayName not needed — PROVIDER_MODELS used directly for synthesis model display

const SYNTHESIS_CAPABLE_MODELS: SupportedModel[] = [LlmModels.Gemini25Pro, LlmModels.GPT52];

interface EnhanceModalProps {
  research: Research;
  configuredProviders: LlmProvider[];
  failedProviders: Map<LlmProvider, string>;
  onEnhance: (params: {
    additionalModels?: SupportedModel[];
    additionalContexts?: { content: string }[];
    removeContextIds?: string[];
    synthesisModel?: SupportedModel;
  }) => Promise<void>;
  onClose: () => void;
}

export function EnhanceModal({
  research,
  configuredProviders,
  failedProviders,
  onEnhance,
  onClose,
}: EnhanceModalProps): React.JSX.Element {
  const [enhanceModelSelections, setEnhanceModelSelections] = useState<
    Map<LlmProvider, SupportedModel | null>
  >(() => new Map());
  const [enhanceContexts, setEnhanceContexts] = useState<string[]>([]);
  const [removeContextIds, setRemoveContextIds] = useState<Set<string>>(() => new Set());
  const [enhanceSynthesisModel, setEnhanceSynthesisModel] = useState<SupportedModel | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);

  const existingProviders = new Set(research.selectedModels.map(getProviderForModel));

  const handleEnhanceModelChange = (provider: LlmProvider, model: SupportedModel | null): void => {
    setEnhanceModelSelections((prev) => {
      const next = new Map(prev);
      next.set(provider, model);
      return next;
    });
  };

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

  const handleEnhance = async (): Promise<void> => {
    const validContexts = enhanceContexts.filter((ctx) => ctx.trim().length > 0);
    const additionalModels = getSelectedModelsList(enhanceModelSelections);
    const removeIds = Array.from(removeContextIds);
    const hasSynthesisChange =
      enhanceSynthesisModel !== null && enhanceSynthesisModel !== research.synthesisModel;

    const hasChanges =
      additionalModels.length > 0 ||
      validContexts.length > 0 ||
      removeIds.length > 0 ||
      hasSynthesisChange;

    if (!hasChanges) return;

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

  const additionalModels = getSelectedModelsList(enhanceModelSelections);
  const validContexts = enhanceContexts.filter((c) => c.trim().length > 0);
  const hasSynthesisChange =
    enhanceSynthesisModel !== null && enhanceSynthesisModel !== research.synthesisModel;
  const isDisabled =
    enhancing ||
    (additionalModels.length === 0 &&
      validContexts.length === 0 &&
      removeContextIds.size === 0 &&
      !hasSynthesisChange);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
        <h3 className="mb-4 text-lg font-semibold dark:text-slate-100">Enhance Research</h3>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Add more AI models, change synthesis model, or modify context.
        </p>

        {/* Additional Models */}
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
            Add models from new providers:
          </p>
          <ModelSelector
            selectedModels={enhanceModelSelections}
            onChange={handleEnhanceModelChange}
            configuredProviders={configuredProviders}
            disabledProviders={existingProviders}
            failedProviders={failedProviders}
            disabled={enhancing}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Providers already in research are disabled. Select models from other providers.
          </p>
        </div>

        {/* Synthesis Model */}
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
            Synthesis Model{' '}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              (current:{' '}
              {PROVIDER_MODELS.flatMap((p) => p.models).find(
                (m) => m.id === research.synthesisModel
              )?.name ?? research.synthesisModel}
              )
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {SYNTHESIS_CAPABLE_MODELS.map((model) => {
              const isSelected = enhanceSynthesisModel === model;
              const isCurrent = research.synthesisModel === model;
              const modelConfig = PROVIDER_MODELS.flatMap((p) => p.models).find(
                (m) => m.id === model
              );
              const provider = getProviderForModel(model);
              const hasKey = configuredProviders.includes(provider);
              const isModelDisabled = !hasKey || enhancing;

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
                        : hasKey
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                          : 'bg-slate-50 text-slate-400 cursor-not-allowed dark:bg-slate-700/50 dark:text-slate-500'
                  }`}
                  title={
                    !hasKey ? 'API key not configured' : isCurrent ? 'Current model' : undefined
                  }
                >
                  {modelConfig?.name ?? model}
                  {!hasKey ? ' (no key)' : ''}
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
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-500 dark:bg-slate-600"
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
