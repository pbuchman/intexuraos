/**
 * Cost calculator for OpenAI GPT models.
 * Uses pricing configuration passed from app-settings-service.
 */

import type { TokenUsage, NormalizedUsage } from '@intexuraos/llm-contract';
import type { ModelPricing, ImageSize } from '@intexuraos/llm-contract';

/**
 * Calculate text generation cost based on token usage and pricing.
 * Handles OpenAI-specific features: cached tokens, web search calls.
 */
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const cacheMultiplier = pricing.cacheReadMultiplier ?? 0.5;
  const cachedTokens = usage.cachedTokens ?? 0;
  const effectiveInputTokens = usage.inputTokens - cachedTokens * (1 - cacheMultiplier);

  const inputCost = (effectiveInputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  const webSearchCost = (usage.webSearchCalls ?? 0) * (pricing.webSearchCostPerCall ?? 0);

  return Math.round((inputCost + outputCost + webSearchCost) * 1_000_000) / 1_000_000;
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
  cachedTokens: number,
  webSearchCalls: number,
  reasoningTokens: number | undefined,
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    cachedTokens,
    webSearchCalls,
    ...(reasoningTokens !== undefined && { reasoningTokens }),
  };
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing),
    ...(cachedTokens > 0 && { cacheTokens: cachedTokens }),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 && { reasoningTokens }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}
