/**
 * Cost calculator for Anthropic Claude models.
 * Uses pricing configuration passed from app-settings-service.
 */

import type { TokenUsage, NormalizedUsage } from '@intexuraos/llm-contract';
import type { ModelPricing } from '@intexuraos/llm-contract';

/**
 * Calculate text generation cost based on token usage and pricing.
 * Handles Anthropic-specific: cache read/write multipliers, web search.
 */
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const cacheReadMultiplier = pricing.cacheReadMultiplier ?? 0.1;
  const cacheWriteMultiplier = pricing.cacheWriteMultiplier ?? 1.25;

  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;

  const cacheReadCost =
    (cacheReadTokens / 1_000_000) * pricing.inputPricePerMillion * cacheReadMultiplier;
  const cacheCreationCost =
    (cacheCreationTokens / 1_000_000) * pricing.inputPricePerMillion * cacheWriteMultiplier;

  const regularInputTokens = usage.inputTokens - cacheReadTokens - cacheCreationTokens;
  const regularInputCost = (regularInputTokens / 1_000_000) * pricing.inputPricePerMillion;

  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  const webSearchCost = (usage.webSearchCalls ?? 0) * (pricing.webSearchCostPerCall ?? 0);

  return (
    Math.round(
      (regularInputCost + cacheReadCost + cacheCreationCost + outputCost + webSearchCost) *
        1_000_000
    ) / 1_000_000
  );
}

/**
 * Normalize raw token usage to standardized format with cost.
 */
export function normalizeUsageV2(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  webSearchCalls: number,
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    webSearchCalls,
  };
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing),
    ...(cacheReadTokens + cacheCreationTokens > 0 && {
      cacheTokens: cacheReadTokens + cacheCreationTokens,
    }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}
