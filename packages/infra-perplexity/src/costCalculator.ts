import type { TokenUsage, NormalizedUsage, ModelPricing } from '@intexuraos/llm-contract';

/**
 * Calculate text generation cost based on token usage and pricing.
 * Prioritizes direct provider cost. Falls back to calculation with request fees.
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
  if (usage.providerCost !== undefined) {
    return usage.providerCost;
  }

  // 2. Fallback Calculation
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;

  // Perplexity Request Fee
  const requestFee = pricing.webSearchCostPerCall ?? 0;

  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;

  const requests = usage.webSearchCalls ?? 1;
  const requestCostScaled = requests * requestFee * 1_000_000;

  return Math.round(inputCost + outputCost + requestCostScaled) / 1_000_000;
}

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
    webSearchCalls: 1 // Default to 1 call for Perplexity normalization
  };

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing, providerCost),
    webSearchCalls: 1
  };
}
