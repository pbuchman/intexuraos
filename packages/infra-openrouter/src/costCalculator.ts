/**
 * Cost calculation utilities for OpenRouter models.
 *
 * Converts OpenRouter's per-token pricing strings to per-million numbers
 * and handles usage normalization.
 */

import type { TokenUsage, NormalizedUsage, ModelPricing } from '@intexuraos/llm-contract';

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
 * Calculate text generation cost based on token usage and pricing.
 * Prioritizes direct provider cost. Falls back to calculation from token prices.
 */
export function calculateTextCost(
  usage: TokenUsage,
  pricing: ModelPricing,
  providerCost: number | undefined
): number {
  // 1. Direct Provider Cost (Priority)
  if (pricing.useProviderCost === true && providerCost !== undefined) {
    return providerCost;
  }
  /* v8 ignore start -- upstream: usage.providerCost fallback when provider doesn't supply direct cost @preserve */
  if (usage.providerCost !== undefined) {
    return usage.providerCost;
  }
  /* v8 ignore stop @preserve */

  // 2. Fallback Calculation using per-million prices
  // Formula: tokens * (pricePerMillion / 1_000_000) = tokens * pricePerToken
  const inputCost = usage.inputTokens * (pricing.inputPricePerMillion / 1_000_000);
  const outputCost = usage.outputTokens * (pricing.outputPricePerMillion / 1_000_000);

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Normalize OpenRouter usage into our standard format.
 */
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  providerCost: number | undefined,
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    ...(providerCost !== undefined && { providerCost }),
  };

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing, providerCost),
  };
}
