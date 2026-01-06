/**
 * Cost calculator for Gemini models.
 * Uses pricing configuration passed from app-settings-service.
 */

import type { TokenUsage, NormalizedUsage } from '@intexuraos/llm-contract';
import type { ModelPricing, ImageSize } from '@intexuraos/llm-contract';

/**
 * Calculate text generation cost based on token usage and pricing.
 */
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  const groundingCost =
    usage.groundingEnabled === true && pricing.groundingCostPerRequest !== undefined
      ? pricing.groundingCostPerRequest
      : 0;
  return Math.round((inputCost + outputCost + groundingCost) * 1_000_000) / 1_000_000;
}

/**
 * Calculate image generation cost based on size and pricing.
 */
export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number {
  if (pricing.imagePricing === undefined) {
    return 0;
  }
  return pricing.imagePricing[size] ?? 0;
}

/**
 * Normalize raw token usage to standardized format with cost.
 */
export function normalizeUsageV2(
  inputTokens: number,
  outputTokens: number,
  groundingEnabled: boolean,
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    groundingEnabled,
  };
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing),
    ...(groundingEnabled && { groundingEnabled: true }),
  };
}

