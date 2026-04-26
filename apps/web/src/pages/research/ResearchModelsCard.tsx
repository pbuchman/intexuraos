import { Card, ModelSelector } from '@/components';
import type {
  LlmProvider,
  OpenRouterModelInfo,
  SupportedModel,
} from '@/services/researchAgentApi.types';

interface ResearchModelsCardProps {
  modelSelections: Map<LlmProvider, SupportedModel | null>;
  onModelChange: (provider: LlmProvider, model: SupportedModel | null) => void;
  configuredProviders: LlmProvider[];
  failedProviders: Map<LlmProvider, string>;
  keysLoading: boolean;
  submitting: boolean;
  savingDraft: boolean;
  openRouterModels: OpenRouterModelInfo[];
  selectedOpenRouterModels: string[];
  onOpenRouterChange: (models: string[]) => void;
  openRouterLoading: boolean;
  openRouterError: string | null;
  isOpenRouterConfigured: boolean;
}

export function ResearchModelsCard(props: ResearchModelsCardProps): React.JSX.Element {
  const {
    modelSelections,
    onModelChange,
    configuredProviders,
    failedProviders,
    keysLoading,
    submitting,
    savingDraft,
    openRouterModels,
    selectedOpenRouterModels,
    onOpenRouterChange,
    openRouterLoading,
    openRouterError,
    isOpenRouterConfigured,
  } = props;

  return (
    <Card title="Research Models">
      <p className="text-sm text-slate-500 mb-4 dark:text-slate-400">
        Select which models to query for research (one per provider)
      </p>
      <ModelSelector
        selectedModels={modelSelections}
        onChange={onModelChange}
        configuredProviders={configuredProviders}
        failedProviders={failedProviders}
        loading={keysLoading}
        disabled={submitting || savingDraft}
        openRouterModels={openRouterModels}
        selectedOpenRouterModels={selectedOpenRouterModels}
        onOpenRouterChange={onOpenRouterChange}
        openRouterLoading={openRouterLoading}
        openRouterError={openRouterError}
        isOpenRouterConfigured={isOpenRouterConfigured}
      />
    </Card>
  );
}
