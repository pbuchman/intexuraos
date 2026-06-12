import { Loader2 } from 'lucide-react';
import { Card, PROVIDER_MODELS } from '@/components';
import { getProviderForModel } from '@/services/researchAgentApi.types';
import type { LlmProvider, SupportedModel } from '@/services/researchAgentApi.types';

interface SynthesisModelCardProps {
  synthesisCapableModels: readonly SupportedModel[];
  synthesisModel: SupportedModel | null;
  onSelect: (model: SupportedModel) => void;
  configuredProviders: LlmProvider[];
  failedProviders: Map<LlmProvider, string>;
  keysLoading: boolean;
  submitting: boolean;
  savingDraft: boolean;
}

export function SynthesisModelCard(props: SynthesisModelCardProps): React.JSX.Element {
  const {
    synthesisCapableModels,
    synthesisModel,
    onSelect,
    configuredProviders,
    failedProviders,
    keysLoading,
    submitting,
    savingDraft,
  } = props;

  return (
    <Card title="Synthesis Model">
      <p className="text-sm text-slate-500 mb-4 dark:text-slate-400">
        Select which model synthesizes the results
      </p>
      {keysLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm dark:text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading API key status...</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {synthesisCapableModels.map((model) => {
            const isSelected = synthesisModel === model;
            const modelConfig = PROVIDER_MODELS.flatMap((p) => p.models).find(
              (m) => m.id === model
            );
            const provider = getProviderForModel(model);
            const hasKey = configuredProviders.includes(provider);
            const hasFailed = failedProviders.has(provider);
            const isDisabled = !hasKey || hasFailed || submitting || savingDraft;
            const disabledReason = !hasKey
              ? 'API key not configured'
              : hasFailed
                ? 'API key test failed'
                : undefined;

            return (
              <button
                key={model}
                type="button"
                onClick={(): void => {
                  onSelect(model);
                }}
                disabled={isDisabled}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-green-600 text-white'
                    : hasKey && !hasFailed
                      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                      : 'bg-slate-50 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500'
                }`}
                title={disabledReason}
              >
                {modelConfig?.name ?? model}
                {!hasKey ? ' (no key)' : hasFailed ? ' (test failed)' : ''}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
