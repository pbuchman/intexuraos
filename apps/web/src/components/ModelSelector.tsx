import { ChevronDown } from 'lucide-react';
import type { LlmProvider, SupportedModel } from '@/services/llmOrchestratorApi.types';

interface ModelOption {
  id: SupportedModel;
  name: string;
}

interface ProviderConfig {
  id: LlmProvider;
  displayName: string;
  models: ModelOption[];
  default: SupportedModel;
}

const PROVIDER_MODELS: ProviderConfig[] = [
  {
    id: 'google',
    displayName: 'Google',
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini Pro' },
    ],
    default: 'gemini-2.5-flash',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet' },
      { id: 'claude-opus-4-5-20251101', name: 'Claude Opus' },
    ],
    default: 'claude-sonnet-4-5-20250929',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'o4-mini-deep-research', name: 'O4 Mini' },
    ],
    default: 'gpt-5.2',
  },
];

export interface ModelSelectorProps {
  selectedModels: Map<LlmProvider, SupportedModel | null>;
  onChange: (provider: LlmProvider, model: SupportedModel | null) => void;
  configuredProviders: LlmProvider[];
  disabled?: boolean | undefined;
}

export function ModelSelector({
  selectedModels,
  onChange,
  configuredProviders,
  disabled = false,
}: ModelSelectorProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      {PROVIDER_MODELS.map((provider) => {
        const isConfigured = configuredProviders.includes(provider.id);
        const selectedModel = selectedModels.get(provider.id) ?? null;
        const isActive = selectedModel !== null;

        return (
          <div
            key={provider.id}
            className={`rounded-lg border-2 p-4 transition-all ${
              !isConfigured
                ? 'border-slate-200 bg-slate-50 opacity-60'
                : isActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`font-medium ${isConfigured ? 'text-slate-900' : 'text-slate-400'}`}
                >
                  {provider.displayName}
                  {!isConfigured ? ' (no key)' : ''}
                </span>
                {isActive ? (
                  <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                    Active
                  </span>
                ) : null}
              </div>

              <div className="relative">
                <select
                  value={selectedModel ?? ''}
                  onChange={(e): void => {
                    const value = e.target.value;
                    onChange(provider.id, value === '' ? null : (value as SupportedModel));
                  }}
                  disabled={!isConfigured || disabled}
                  className={`appearance-none rounded-lg border px-4 py-2 pr-10 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    !isConfigured || disabled
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'border-slate-200 bg-white text-slate-700 cursor-pointer hover:border-slate-300'
                  }`}
                >
                  <option value="">None</option>
                  {provider.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className={`absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none ${
                    !isConfigured || disabled ? 'text-slate-300' : 'text-slate-500'
                  }`}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function getDefaultModelSelections(
  configuredProviders: LlmProvider[]
): Map<LlmProvider, SupportedModel | null> {
  const selections = new Map<LlmProvider, SupportedModel | null>();

  for (const provider of PROVIDER_MODELS) {
    if (configuredProviders.includes(provider.id)) {
      selections.set(provider.id, provider.default);
    } else {
      selections.set(provider.id, null);
    }
  }

  return selections;
}

export function getSelectedModelsList(
  selections: Map<LlmProvider, SupportedModel | null>
): SupportedModel[] {
  const models: SupportedModel[] = [];
  for (const model of selections.values()) {
    if (model !== null) {
      models.push(model);
    }
  }
  return models;
}

export { PROVIDER_MODELS };
