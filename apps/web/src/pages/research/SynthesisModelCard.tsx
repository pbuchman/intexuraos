import { getOpenRouterRawId } from '@intexuraos/llm-contract';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components';
import type { OpenRouterModelInfo, SupportedModel } from '@/services/researchAgentApi.types';
import { resolveOpenRouterModelName } from '@/utils/openRouterModelNames.js';

interface SynthesisModelCardProps {
  synthesisCapableModels: readonly SupportedModel[];
  synthesisModel: SupportedModel | null;
  onSelect: (model: SupportedModel) => void;
  availableModels: OpenRouterModelInfo[];
  hasOpenRouterAccess: boolean;
  loading: boolean;
  submitting: boolean;
  savingDraft: boolean;
}

export function SynthesisModelCard({
  synthesisCapableModels,
  synthesisModel,
  onSelect,
  availableModels,
  hasOpenRouterAccess,
  loading,
  submitting,
  savingDraft,
}: SynthesisModelCardProps): React.JSX.Element {
  const availableIds = new Set(availableModels.map((model) => model.id));

  return (
    <Card title="Synthesis Model">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Select the OpenRouter model that synthesizes the results.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading OpenRouter models...
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {synthesisCapableModels.map((model) => {
            const rawId = getOpenRouterRawId(model);
            const isSelected = synthesisModel === model;
            const isAvailable = hasOpenRouterAccess && availableIds.has(rawId);
            const isDisabled = submitting || savingDraft || !isAvailable;
            return (
              <button
                key={model}
                type="button"
                onClick={(): void => {
                  onSelect(model);
                }}
                disabled={isDisabled}
                className={`rounded-lg border-2 p-4 text-left transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                    : isDisabled
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-800/50'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600'
                }`}
                title={isAvailable ? undefined : 'Model is not available in the OpenRouter catalog'}
              >
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {resolveOpenRouterModelName(rawId)}
                </span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  {rawId}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
