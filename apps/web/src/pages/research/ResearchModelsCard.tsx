import { Card, ModelSelector } from '@/components';
import type { OpenRouterModelInfo } from '@/services/researchAgentApi.types';

interface ResearchModelsCardProps {
  openRouterModels: OpenRouterModelInfo[];
  selectedOpenRouterModels: string[];
  onOpenRouterChange: (models: string[]) => void;
  openRouterLoading: boolean;
  openRouterError: string | null;
  hasOpenRouterAccess: boolean;
  submitting: boolean;
  savingDraft: boolean;
}

export function ResearchModelsCard({
  openRouterModels,
  selectedOpenRouterModels,
  onOpenRouterChange,
  openRouterLoading,
  openRouterError,
  hasOpenRouterAccess,
  submitting,
  savingDraft,
}: ResearchModelsCardProps): React.JSX.Element {
  return (
    <Card title="Research Models">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Select up to 6 OpenRouter models. Selected and recommended models appear first.
      </p>
      <ModelSelector
        availableModels={openRouterModels}
        selectedModelIds={selectedOpenRouterModels}
        onChange={onOpenRouterChange}
        loading={openRouterLoading}
        disabled={submitting || savingDraft}
        error={openRouterError}
        hasOpenRouterAccess={hasOpenRouterAccess}
      />
    </Card>
  );
}
