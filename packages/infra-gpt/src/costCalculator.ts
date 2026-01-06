/**
 * Cost calculator for OpenAI GPT models.
 * Uses pricing configuration passed from app-settings-service.
 */

import type { TokenUsage, NormalizedUsage } from '@intexuraos/llm-contract';
import type { ModelPricing, ImageSize } from '@intexuraos/llm-contract';

/**
 * Calculate text generation cost based on token usage and pricing.
 * Handles OpenAI-specific features: cached tokens (Ephemeral Cache), web search tools.
 */
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  // 1. Safe Pricing Access (Default to 0)
  const inputPrice = pricing.inputPricePerMillion ?? 0;
  const outputPrice = pricing.outputPricePerMillion ?? 0;
  const searchPrice = pricing.webSearchCostPerCall ?? 0; // e.g., 0.01 for deep-research

  // 2. Cache Logic
  // OpenAI 'prompt_tokens' (inputTokens) INCLUDES cached tokens. We must split them.
  const totalInput = usage.inputTokens;
  const cachedCount = usage.cachedTokens ?? 0;
  // Safety: Ensure regular tokens never go below zero if API reports weird data
  const regularInputCount = Math.max(0, totalInput - cachedCount);

  const cacheMultiplier = pricing.cacheReadMultiplier ?? 0.5; // Default OpenAI discount is 50%

  // 3. Calculate Components (Scaled by 1M to avoid floating point errors)
  const regularInputCost = regularInputCount * inputPrice;
  const cachedInputCost = cachedCount * inputPrice * cacheMultiplier;
  const outputCost = usage.outputTokens * outputPrice;

  // Search cost is per-call, so we multiply by 1M to match the scale of other variables
  const searchCostScaled = (usage.webSearchCalls ?? 0) * searchPrice * 1_000_000;

  // 4. Sum and Normalize
  const totalScaledCost = regularInputCost + cachedInputCost + outputCost + searchCostScaled;

  return Math.round(totalScaledCost) / 1_000_000;
}

/**
 * Calculate image generation cost based on size and pricing.
 */
export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number {
  if (!pricing.imagePricing) {
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

    // Conditional metadata inclusion
    ...(cachedTokens > 0 && { cacheTokens: cachedTokens }),
    // Reasoning tokens are typically part of outputTokens in OpenAI,
    // but we keep them explicitly for analytics if provided.
    ...(reasoningTokens !== undefined && reasoningTokens > 0 && { reasoningTokens }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}
