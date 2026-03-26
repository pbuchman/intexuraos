import { useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { OpenRouterModelInfo } from '@/services/researchAgentApi.types';

interface OpenRouterModelSelectorProps {
  availableModels: OpenRouterModelInfo[];
  selectedModelIds: string[];
  onChange: (ids: string[]) => void;
  maxModels?: number;
  loading?: boolean;
  disabled?: boolean;
  error?: string | null;
}

function formatPrice(pricePerMillion: number): string {
  if (pricePerMillion === 0) {
    return '0.00';
  }
  if (pricePerMillion < 0.01) {
    return pricePerMillion.toFixed(4);
  }
  return pricePerMillion.toFixed(2);
}

function formatContextLength(length: number): string {
  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(1)}M`;
  }
  return `${(length / 1_000).toFixed(0)}K`;
}

export function OpenRouterModelSelector({
  availableModels,
  selectedModelIds,
  onChange,
  maxModels = 5,
  loading = false,
  disabled = false,
  error = null,
}: OpenRouterModelSelectorProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredModels = searchQuery.trim() === ''
    ? availableModels
    : availableModels.filter(
        (m) =>
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.provider.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const isMaxReached = selectedModelIds.length >= maxModels;

  const toggleModel = (modelId: string): void => {
    if (disabled) return;
    if (selectedModelIds.includes(modelId)) {
      onChange(selectedModelIds.filter((id) => id !== modelId));
    } else if (!isMaxReached) {
      onChange([...selectedModelIds, modelId]);
    }
  };

  const removeModel = (modelId: string): void => {
    if (disabled) return;
    onChange(selectedModelIds.filter((id) => id !== modelId));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-slate-400 dark:text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading OpenRouter models...</span>
      </div>
    );
  }

  if (error !== null) {
    return (
      <p className="py-2 text-sm text-red-600 dark:text-red-400">
        Failed to load OpenRouter models: {error}
      </p>
    );
  }

  if (availableModels.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-400 dark:text-slate-500">
        No OpenRouter models available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {selectedModelIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedModelIds.map((id) => {
            const model = availableModels.find((m) => m.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              >
                {model?.name ?? id}
                <button
                  type="button"
                  onClick={(): void => { removeModel(id); }}
                  disabled={disabled}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <span className="self-center text-xs text-slate-400 dark:text-slate-500">
            {String(selectedModelIds.length)}/{String(maxModels)} selected
          </span>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e): void => { setSearchQuery(e.target.value); }}
          placeholder="Search models..."
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
        />
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
        {filteredModels.length === 0 ? (
          <p className="p-3 text-center text-sm text-slate-400 dark:text-slate-500">
            No models match your search.
          </p>
        ) : (
          filteredModels.map((model) => {
            const isSelected = selectedModelIds.includes(model.id);
            const isCheckDisabled = disabled || (!isSelected && isMaxReached);

            return (
              <label
                key={model.id}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                } ${isCheckDisabled && !isSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(): void => { toggleModel(model.id); }}
                  disabled={isCheckDisabled}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {model.name}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {model.provider}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{formatContextLength(model.contextLength)} ctx</span>
                    <span>${formatPrice(model.pricing.inputPricePerMillion)}/M in</span>
                    <span>${formatPrice(model.pricing.outputPricePerMillion)}/M out</span>
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>

      {isMaxReached && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Maximum {String(maxModels)} models selected. Remove one to add another.
        </p>
      )}
    </div>
  );
}
