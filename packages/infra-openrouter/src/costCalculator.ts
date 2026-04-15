/**
 * Cost calculation utilities for OpenRouter models.
 *
 * Converts OpenRouter's per-token pricing strings to per-million numbers
 * and handles usage normalization.
 */

import type { NormalizedUsage, ModelPricing } from '@intexuraos/llm-contract';

/**
 * Convert OpenRouter per-token pricing strings to per-million ModelPricing.
 *
 * OpenRouter returns prices like '0.00000026' per token.
 * We convert to per-million for consistency with our internal pricing.
 * The resulting prices work with the formula: tokens * (price / 1_000_000)
 *
 * @param promptPerToken - Prompt price per token (e.g., '0.00000026')
 * @param completionPerToken - Completion price per token (e.g., '0.00000156')
 * @returns ModelPricing with per-million prices and useProviderCost: true
 */
export function toModelPricing(promptPerToken: string, completionPerToken: string): ModelPricing {
  const promptPerMillion = parseFloat(promptPerToken) * 1_000_000;
  const completionPerMillion = parseFloat(completionPerToken) * 1_000_000;

  return {
    inputPricePerMillion: promptPerMillion,
    outputPricePerMillion: completionPerMillion,
    useProviderCost: true,
  };
}

/**
 * Normalize OpenRouter usage into our standard format.
 */
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  _providerCost: number | null | undefined
): NormalizedUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: 0,
  };
}
