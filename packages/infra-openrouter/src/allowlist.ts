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
    promptPerToken: '0.00000026',
    completionPerToken: '0.00000156',
  },
  {
    id: 'qwen/qwen3.5-flash-02-23',
    name: 'Qwen 3.5 Flash',
    provider: 'Qwen',
    promptPerToken: '0.00000007',
    completionPerToken: '0.00000026',
  },
  // MiniMax
  {
    id: 'minimax/minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'MiniMax',
    promptPerToken: '0.0000003',
    completionPerToken: '0.0000012',
  },
  // xAI
  {
    id: 'x-ai/grok-4.20-beta',
    name: 'Grok 4.20 Beta',
    provider: 'xAI',
    promptPerToken: '0.000002',
    completionPerToken: '0.000006',
  },
  {
    id: 'x-ai/grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'xAI',
    promptPerToken: '0.0000002',
    completionPerToken: '0.0000005',
  },
  // Moonshot
  {
    id: 'moonshotai/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'Moonshot',
    promptPerToken: '0.00000045',
    completionPerToken: '0.0000022',
  },
  // Anthropic
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    promptPerToken: '0.000003',
    completionPerToken: '0.000015',
  },
  {
    id: 'anthropic/claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    promptPerToken: '0.000005',
    completionPerToken: '0.000025',
  },
  // Google
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    promptPerToken: '0.000002',
    completionPerToken: '0.000012',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    promptPerToken: '0.0000003',
    completionPerToken: '0.0000025',
  },
  // OpenAI
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    provider: 'OpenAI',
    promptPerToken: '0.0000025',
    completionPerToken: '0.000015',
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'OpenAI',
    promptPerToken: '0.00000075',
    completionPerToken: '0.0000045',
  },
  // Xiaomi
  {
    id: 'xiaomi/mimo-v2-pro',
    name: 'MiMo V2 Pro',
    provider: 'Xiaomi',
    promptPerToken: '0.000001',
    completionPerToken: '0.000003',
  },
  // Z.ai
  {
    id: 'z-ai/glm-5-turbo',
    name: 'GLM 5 Turbo',
    provider: 'Z.ai',
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
