/**
 * Cost calculator for Perplexity models.
 * Uses pricing configuration passed from app-settings-service.
 *
 * Priority: Use provider cost from API when useProviderCost is true.
 * Fallback: Calculate from tokens when no provider cost available.
 */

import type { TokenUsage, NormalizedUsage } from '@intexuraos/llm-contract';
import type { ModelPricing } from '@intexuraos/llm-contract';

/**
 * Calculate text generation cost based on token usage and pricing.
 * For Perplexity, prioritizes provider cost if useProviderCost is enabled.
 */
export function calculateTextCost(
  usage: TokenUsage,
  pricing: ModelPricing,
  providerCost: number | undefined
): number {
  // If useProviderCost is true and API returned a cost, use it
  if (pricing.useProviderCost === true && providerCost !== undefined) {
    return providerCost;
  }

  // Also use providerCost from usage if available (V1 compatibility)
  if (usage.providerCost !== undefined) {
    return usage.providerCost;
  }

  // Fallback: calculate from tokens
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Normalize raw token usage to standardized format with cost.
 */
export function normalizeUsageV2(
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
