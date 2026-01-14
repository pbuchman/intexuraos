import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { LlmProvider, SupportedModel } from '@/services/researchAgentApi.types';

interface ModelOption {
  id: SupportedModel;
  name: string;
}

interface ProviderConfig {
  id: LlmProvider;
  displayName: string;
  models: ModelOption[];
}

const PROVIDER_MODELS: ProviderConfig[] = [
  {
    id: LlmProviders.Google,
    displayName: 'Google',
    models: [
      { id: LlmModels.Gemini25Flash, name: 'Gemini Flash' },
      { id: LlmModels.Gemini25Pro, name: 'Gemini Pro' },
    ],
  },
  {
    id: LlmProviders.Anthropic,
    displayName: 'Anthropic',
    models: [
      { id: LlmModels.ClaudeSonnet45, name: 'Claude Sonnet' },
      { id: LlmModels.ClaudeOpus45, name: 'Claude Opus' },
    ],
  },
  {
    id: LlmProviders.OpenAI,
    displayName: 'OpenAI',
    models: [
      { id: LlmModels.GPT52, name: 'GPT-5.2' },
      { id: LlmModels.O4MiniDeepResearch, name: 'O4 Mini' },
    ],
  },
  {
    id: LlmProviders.Perplexity,
    displayName: 'Perplexity',
    models: [
      { id: LlmModels.Sonar, name: 'Sonar' },
      { id: LlmModels.SonarPro, name: 'Sonar Pro' },
      { id: LlmModels.SonarDeepResearch, name: 'Sonar Deep Research' },
    ],
  },
  {
    id: LlmProviders.Zai,
    displayName: 'Zai',
    models: [{ id: LlmModels.Glm47, name: 'GLM-4.7' }],
  },
];

export interface ModelSelectorProps {
  selectedModels: Map<LlmProvider, SupportedModel | null>;
  onChange: (provider: LlmProvider, model: SupportedModel | null) => void;
  configuredProviders: LlmProvider[];
  disabledProviders?: Set<LlmProvider>;
  failedProviders?: Map<LlmProvider, string>;
  loading?: boolean;
  disabled?: boolean | undefined;
}

export function ModelSelector({
  selectedModels,
  onChange,
  configuredProviders,
  disabledProviders,
  failedProviders,
  loading = false,
  disabled = false,
}: ModelSelectorProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading API key status...</span>
        </div>
      ) : null}
      {PROVIDER_MODELS.map((provider) => {
        const isConfigured = configuredProviders.includes(provider.id);
        const isProviderDisabled = disabledProviders?.has(provider.id) === true;
        const isTestFailed = failedProviders?.has(provider.id) === true;
        const testFailedError = isTestFailed ? failedProviders.get(provider.id) : undefined;
        const selectedModel = selectedModels.get(provider.id) ?? null;
        const isActive = selectedModel !== null;
        const isRowDisabled = loading || !isConfigured || isTestFailed || isProviderDisabled || disabled;

        return (
          <div
            key={provider.id}
            className={`rounded-lg border-2 p-4 transition-all ${
              isRowDisabled
                ? 'border-slate-200 bg-slate-50 opacity-60'
                : isActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`font-medium ${!isRowDisabled ? 'text-slate-900' : 'text-slate-400'}`}
                >
                  {provider.displayName}
                  {isProviderDisabled && isConfigured ? ' (already selected)' : ''}
                </span>
                {isActive ? (
                  <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                    Active
                  </span>
                ) : null}
                {isTestFailed ? (
                  <div className="flex items-center gap-1 group relative">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span className="text-xs text-red-600">Test failed</span>
                    <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-10 w-64 p-2 bg-white border border-red-200 rounded shadow-lg">
                      <p className="text-xs text-red-700 mb-2">{testFailedError ?? ''}</p>
                      <Link
                        to="/settings/api-keys"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Fix in Settings →
                      </Link>
                    </div>
                  </div>
                ) : !isConfigured ? (
                  <Link
                    to="/settings/api-keys"
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    Configure API key →
                  </Link>
                ) : null}
              </div>

              <div className="relative w-40">
                <select
                  value={selectedModel ?? ''}
                  onChange={(e): void => {
                    const value = e.target.value;
                    onChange(provider.id, value === '' ? null : (value as SupportedModel));
                  }}
                  disabled={isRowDisabled}
                  className={`w-full appearance-none rounded-lg border px-4 py-2 pr-10 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isRowDisabled
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
                    isRowDisabled ? 'text-slate-300' : 'text-slate-500'
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
