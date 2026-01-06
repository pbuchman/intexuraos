import type { TokenUsage, NormalizedUsage, ModelPricing } from '@intexuraos/llm-contract';

export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const searchPrice = pricing.webSearchCostPerCall ?? 0;

  const cacheReadMultiplier = pricing.cacheReadMultiplier ?? 0.1;
  const cacheWriteMultiplier = pricing.cacheWriteMultiplier ?? 1.25;

  const regularInput = usage.inputTokens;
  const cacheRead = usage.cachedTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;

  // Scaled Math
  const regularCost = regularInput * inputPrice;
  const readCost = cacheRead * inputPrice * cacheReadMultiplier;
  const writeCost = cacheWrite * inputPrice * cacheWriteMultiplier;
  const outputCost = usage.outputTokens * outputPrice;

  // Web Search Cost
  const searchCostScaled = (usage.webSearchCalls ?? 0) * searchPrice * 1_000_000;

  return Math.round(regularCost + readCost + writeCost + outputCost + searchCostScaled) / 1_000_000;
}

export function normalizeUsageV2(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  webSearchCalls: number, // Added to match client call
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    cachedTokens: cacheReadTokens,
    cacheCreationTokens: cacheWriteTokens,
    webSearchCalls,
  };

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: calculateTextCost(usage, pricing),
    ...(cacheReadTokens > 0 && { cacheReadTokens }),
    ...(cacheWriteTokens > 0 && { cacheWriteTokens }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}
