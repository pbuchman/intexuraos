/**
 * Static mapping of OpenRouter model IDs to human-readable names.
 *
 * Mirrors the curated allowlist in packages/infra-openrouter/src/allowlist.ts
 * and the default allowlist in packages/infra-openrouter/src/defaultAllowlist.ts.
 * When a model ID is not found in this mapping, the raw ID is returned as-is.
 */

import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

const OPENROUTER_MODEL_NAMES: Record<string, string> = {
  // Curated allowlist (allowlist.ts)
  'qwen/qwen3.5-plus-02-15': 'Qwen 3.5 Plus',
  'qwen/qwen3.5-flash-02-23': 'Qwen 3.5 Flash',
  'minimax/minimax-m3': 'MiniMax M3',
  'x-ai/grok-4.20-beta': 'Grok 4.20 Beta',
  'x-ai/grok-4.1-fast': 'Grok 4.1 Fast',
  'moonshotai/kimi-k2.5': 'Kimi K2.5',
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'anthropic/claude-opus-4.6': 'Claude Opus 4.6',
  'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'google/gemini-3.6-flash': 'Gemini 3.6 Flash',
  'google/gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'openai/gpt-5.4': 'GPT-5.4',
  'openai/gpt-5.4-mini': 'GPT-5.4 Mini',
  'xiaomi/mimo-v2.5-pro': 'MiMo V2.5 Pro',
  'z-ai/glm-5-turbo': 'GLM 5 Turbo',
  // Default allowlist (defaultAllowlist.ts) — minimax/minimax-m3 shared above
  'google/gemma-4-31b-it': 'Gemma 4 31B IT',
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
  'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super 120B',
};

const HISTORICAL_DIRECT_MODELS: Record<string, { name: string; provider: string }> = {
  [LlmModels.ClaudeSonnet46]: {
    name: 'Claude Sonnet 4.6',
    provider: LlmProviders.Anthropic,
  },
  [LlmModels.ClaudeOpus46]: { name: 'Claude Opus 4.6', provider: LlmProviders.Anthropic },
  [LlmModels.ClaudeSonnet47]: {
    name: 'Claude Sonnet 4.7',
    provider: LlmProviders.Anthropic,
  },
  [LlmModels.O4MiniDeepResearch]: {
    name: 'O4 Mini Deep Research',
    provider: LlmProviders.OpenAI,
  },
  [LlmModels.GPT54]: { name: 'GPT-5.4', provider: LlmProviders.OpenAI },
  [LlmModels.Sonar]: { name: 'Sonar', provider: LlmProviders.Perplexity },
  [LlmModels.SonarPro]: { name: 'Sonar Pro', provider: LlmProviders.Perplexity },
  [LlmModels.SonarDeepResearch]: {
    name: 'Sonar Deep Research',
    provider: LlmProviders.Perplexity,
  },
};

export interface StoredResearchModelPresentation {
  id: string;
  name: string;
  provider: string;
  author: string | null;
  available: boolean;
}

export interface ResearchModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
}

interface ResolveStoredResearchModelInput {
  modelId: string;
  storedProvider?: string;
  availableModelIds: readonly string[];
  availableModels?: readonly ResearchModelCatalogEntry[];
}

function formatAuthor(rawModelId: string): string | null {
  const separator = rawModelId.indexOf('/');
  if (separator <= 0) return null;
  const author = rawModelId.slice(0, separator);
  return author
    .split('-')
    .map((part) => (part === '' ? '' : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');
}

function humanizeStoredModelId(modelId: string): string {
  const slug = (modelId.split('/').at(-1) ?? modelId).replace(/:(?:online|free)$/u, '');
  if (slug === '') return modelId;
  return slug
    .split(/[-_]+/u)
    .filter((part) => part !== '')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

/**
 * Resolve an OpenRouter model ID to its human-readable name.
 * Strips known suffixes (:online, :free) before lookup — OpenRouter appends
 * these for web-search mode and free-tier variants respectively.
 * Returns the raw model ID if no friendly name is found.
 */
export function resolveOpenRouterModelName(modelId: string): string {
  let baseId = modelId;
  if (baseId.endsWith(':online')) baseId = baseId.slice(0, -7);
  else if (baseId.endsWith(':free')) baseId = baseId.slice(0, -5);
  return OPENROUTER_MODEL_NAMES[baseId] ?? modelId;
}

export function resolveStoredResearchModel({
  modelId,
  storedProvider,
  availableModelIds,
  availableModels = [],
}: ResolveStoredResearchModelInput): StoredResearchModelPresentation {
  if (!modelId.startsWith('or:')) {
    const historical = HISTORICAL_DIRECT_MODELS[modelId];
    return {
      id: modelId,
      name: historical?.name ?? humanizeStoredModelId(modelId),
      provider: storedProvider ?? historical?.provider ?? 'historical',
      author: null,
      available: false,
    };
  }

  const rawModelId = modelId.slice(3);
  const liveModel = availableModels.find((model) => model.id === rawModelId);
  const resolvedName = resolveOpenRouterModelName(rawModelId);
  return {
    id: modelId,
    name:
      liveModel?.name ??
      (resolvedName === rawModelId ? humanizeStoredModelId(rawModelId) : resolvedName),
    provider: storedProvider ?? liveModel?.provider ?? 'openrouter',
    author: liveModel?.provider ?? formatAuthor(rawModelId),
    available: liveModel !== undefined || availableModelIds.includes(rawModelId),
  };
}
