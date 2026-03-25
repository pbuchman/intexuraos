/**
 * Curated allowlist of 14 frontier models from 10 providers.
 *
 * This is a hardcoded list instead of fetching the full OpenRouter catalog
 * to avoid overwhelming users and ensure quality. Each entry includes
 * fallback pricing that is used at execution time.
 *
 * The :online suffix is appended to model IDs when web search is required.
 * Live pricing is fetched from OpenRouter API when available via
 * GET /research/openrouter/models endpoint.
 */

import type { ModelPricing } from '@intexuraos/llm-contract';
import { toModelPricing } from './costCalculator.js';
import type { OpenRouterModelInfo } from './types.js';

/**
 * Individual allowlist entry with fallback pricing.
 */
export interface AllowedOpenRouterModel {
  /** Model ID as used in OpenRouter API (e.g., 'qwen/qwen3.5-plus-02-15') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider name */
  provider: string;
  /** Context window size in tokens (used as fallback when live API data is unavailable) */
  contextLength: number;
  /** Fallback prompt price per token (as string from OpenRouter API) */
  promptPerToken: string;
  /** Fallback completion price per token (as string from OpenRouter API) */
  completionPerToken: string;
}

/**
 * Curated allowlist of 14 frontier models from 10 providers.
 * Fallback pricing is used when live pricing is unavailable.
 */
export const OPENROUTER_ALLOWED_MODELS: readonly AllowedOpenRouterModel[] = [
  // Qwen
  {
    id: 'qwen/qwen3.5-plus-02-15',
    name: 'Qwen 3.5 Plus',
    provider: 'Qwen',
    contextLength: 1_000_000,
    promptPerToken: '0.00000026',
    completionPerToken: '0.00000156',
  },
  {
    id: 'qwen/qwen3.5-flash-02-23',
    name: 'Qwen 3.5 Flash',
    provider: 'Qwen',
    contextLength: 1_000_000,
    promptPerToken: '0.00000007',
    completionPerToken: '0.00000026',
  },
  // MiniMax
  {
    id: 'minimax/minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'MiniMax',
    contextLength: 205_000,
    promptPerToken: '0.0000003',
    completionPerToken: '0.0000012',
  },
  // xAI
  {
    id: 'x-ai/grok-4.20-beta',
    name: 'Grok 4.20 Beta',
    provider: 'xAI',
    contextLength: 2_000_000,
    promptPerToken: '0.000002',
    completionPerToken: '0.000006',
  },
  {
    id: 'x-ai/grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'xAI',
    contextLength: 2_000_000,
    promptPerToken: '0.0000002',
    completionPerToken: '0.0000005',
  },
  // Moonshot
  {
    id: 'moonshotai/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'Moonshot',
    contextLength: 262_000,
    promptPerToken: '0.00000045',
    completionPerToken: '0.0000022',
  },
  // Anthropic
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    contextLength: 1_000_000,
    promptPerToken: '0.000003',
    completionPerToken: '0.000015',
  },
  {
    id: 'anthropic/claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    contextLength: 1_000_000,
    promptPerToken: '0.000005',
    completionPerToken: '0.000025',
  },
  // Google
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    contextLength: 1_000_000,
    promptPerToken: '0.000002',
    completionPerToken: '0.000012',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    contextLength: 1_000_000,
    promptPerToken: '0.0000003',
    completionPerToken: '0.0000025',
  },
  // OpenAI
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    provider: 'OpenAI',
    contextLength: 1_000_000,
    promptPerToken: '0.0000025',
    completionPerToken: '0.000015',
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'OpenAI',
    contextLength: 400_000,
    promptPerToken: '0.00000075',
    completionPerToken: '0.0000045',
  },
  // Xiaomi
  {
    id: 'xiaomi/mimo-v2-pro',
    name: 'MiMo V2 Pro',
    provider: 'Xiaomi',
    contextLength: 1_000_000,
    promptPerToken: '0.000001',
    completionPerToken: '0.000003',
  },
  // Z.ai
  {
    id: 'z-ai/glm-5-turbo',
    name: 'GLM 5 Turbo',
    provider: 'Z.ai',
    contextLength: 203_000,
    promptPerToken: '0.00000096',
    completionPerToken: '0.0000032',
  },
] as const;

/**
 * Check if a model ID is in the curated allowlist.
 */
export function isAllowedModel(modelId: string): boolean {
  return OPENROUTER_ALLOWED_MODELS.some((m) => m.id === modelId);
}

/**
 * Get fallback pricing for an allowlisted model.
 * Returns undefined if the model is not in the allowlist.
 */
export function getAllowlistPricing(rawModelId: string): ModelPricing | undefined {
  const model = OPENROUTER_ALLOWED_MODELS.find((m) => m.id === rawModelId);
  if (!model) {
    return undefined;
  }
  return toModelPricing(model.promptPerToken, model.completionPerToken);
}

/**
 * Model used for key validation and test requests.
 * Exported so consumers can reference it by name instead of hardcoding IDs.
 */
export const OPENROUTER_VALIDATION_MODEL = 'qwen/qwen3.5-flash-02-23' as const;

/**
 * Comma-separated list of allowlisted model IDs for use in error messages.
 * Avoids hardcoding model lists that go stale when the allowlist is updated.
 */
export function allowlistModelIds(): string {
  return OPENROUTER_ALLOWED_MODELS.map((m) => m.id).join(', ');
}

/**
 * Catalog data resolved from the live OpenRouter API for a single model.
 */
export interface CatalogEntry {
  pricing: { inputPricePerMillion: number; outputPricePerMillion: number };
  contextLength: number;
}

/**
 * Build OpenRouterModelInfo from an allowlist entry, enriched with live catalog data.
 * When catalog data is unavailable, falls back to the allowlist's own pricing and context length.
 */
export function buildModelInfo(
  entry: AllowedOpenRouterModel,
  catalogEntry?: CatalogEntry
): OpenRouterModelInfo {
  return {
    id: entry.id,
    name: entry.name,
    provider: entry.provider,
    contextLength: catalogEntry?.contextLength ?? entry.contextLength,
    pricing: catalogEntry
      ? {
          inputPricePerMillion: catalogEntry.pricing.inputPricePerMillion,
          outputPricePerMillion: catalogEntry.pricing.outputPricePerMillion,
          useProviderCost: true,
        }
      : toModelPricing(entry.promptPerToken, entry.completionPerToken),
    inputModalities: ['text'],
    outputModalities: ['text'],
  };
}
