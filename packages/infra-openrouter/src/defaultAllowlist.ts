/**
 * Default model allowlist for OpenRouter - a curated set of 4 models
 * suitable for general use, including free and low-cost options.
 */

import type { ModelPricing } from '@intexuraos/llm-contract';
import { toModelPricing } from './costCalculator.js';

/**
 * Individual default allowlist entry with pricing.
 * Unlike AllowedOpenRouterModel, this does not include contextLength
 * as these models are used without context-length-based selection.
 */
export interface DefaultAllowedOpenRouterModel {
  /** Model ID as used in OpenRouter API */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider name */
  provider: string;
  /** Prompt price per token (as string from OpenRouter API) */
  promptPerToken: string;
  /** Completion price per token (as string from OpenRouter API) */
  completionPerToken: string;
}

/**
 * Curated default allowlist of 4 models including free and low-cost options.
 */
export const DEFAULT_OPENROUTER_ALLOWED_MODELS: readonly DefaultAllowedOpenRouterModel[] = [
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B IT',
    provider: 'Google',
    promptPerToken: '0',
    completionPerToken: '0',
  },
  {
    id: 'minimax/minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'MiniMax',
    promptPerToken: '0.0000003',
    completionPerToken: '0.0000012',
  },
  {
    id: 'qwen/qwen3.6-plus',
    name: 'Qwen 3.6 Plus',
    provider: 'Qwen',
    promptPerToken: '0.00000026',
    completionPerToken: '0.00000156',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    provider: 'NVIDIA',
    promptPerToken: '0',
    completionPerToken: '0',
  },
] as const;

/**
 * Check if a model ID is in the default allowlist.
 */
export function isDefaultAllowedModel(modelId: string): boolean {
  return DEFAULT_OPENROUTER_ALLOWED_MODELS.some((m) => m.id === modelId);
}

/**
 * Get pricing for a model in the default allowlist.
 * Returns undefined if the model is not in the default allowlist.
 */
export function getDefaultAllowlistPricing(rawModelId: string): ModelPricing | undefined {
  const model = DEFAULT_OPENROUTER_ALLOWED_MODELS.find((m) => m.id === rawModelId);
  if (model === undefined) return undefined;
  return toModelPricing(model.promptPerToken, model.completionPerToken);
}
