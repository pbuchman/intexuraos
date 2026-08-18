import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { createOpenRouterModelId } from '@intexuraos/llm-contract';
import type { OpenRouterModelInfo, SupportedModel } from '@/services/researchAgentApi.types';
import { OpenRouterModelSelector } from './OpenRouterModelSelector.js';

export const MAX_TOTAL_MODELS = 6;

export interface ModelSelectorProps {
  availableModels: OpenRouterModelInfo[];
  selectedModelIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
  error?: string | null;
  hasOpenRouterAccess: boolean;
  maxModels?: number;
}

export function ModelSelector({
  availableModels,
  selectedModelIds,
  onChange,
  loading = false,
  disabled = false,
  error = null,
  hasOpenRouterAccess,
  maxModels = MAX_TOTAL_MODELS,
}: ModelSelectorProps): React.JSX.Element {
  if (!hasOpenRouterAccess && !loading) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        OpenRouter access is unavailable.{' '}
        <Link to="/settings/api-keys" className="font-medium underline">
          Open API settings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 dark:bg-slate-700/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Models selected
        </span>
        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
          {String(selectedModelIds.length)}/{String(maxModels)}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-400 dark:text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading OpenRouter models...
        </div>
      ) : (
        <OpenRouterModelSelector
          availableModels={availableModels}
          selectedModelIds={selectedModelIds}
          onChange={onChange}
          maxModels={maxModels}
          disabled={disabled}
          error={error}
        />
      )}
    </div>
  );
}

export function getSelectedModelsList(openRouterModelIds: readonly string[]): SupportedModel[] {
  const uniqueIds = [...new Set(openRouterModelIds)].slice(0, MAX_TOTAL_MODELS);
  return uniqueIds.map((id) => createOpenRouterModelId(id));
}

export function getActiveSelectedModelsList(
  openRouterModelIds: readonly string[],
  availableModelIds: readonly string[],
): SupportedModel[] {
  const availableIds = new Set(availableModelIds);
  return getSelectedModelsList(openRouterModelIds.filter((id) => availableIds.has(id)));
}
