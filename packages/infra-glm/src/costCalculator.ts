import type {
  TokenUsage,
  NormalizedUsage,
  ModelPricing,
} from '@intexuraos/llm-contract';

export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const searchPrice = pricing.webSearchCostPerCall ?? 0;

  const totalInput = usage.inputTokens;
  const cachedCount = usage.cachedTokens ?? 0;
  const regularInputCount = Math.max(0, totalInput - cachedCount);

  const cacheMultiplier = pricing.cacheReadMultiplier ?? 0.5;

  const regularInputCost = regularInputCount * inputPrice;
  const cachedInputCost = cachedCount * inputPrice * cacheMultiplier;
  const outputCost = usage.outputTokens * outputPrice;
  const searchCostScaled = (usage.webSearchCalls ?? 0) * searchPrice * 1_000_000;

  return Math.round(regularInputCost + cachedInputCost + outputCost + searchCostScaled) / 1_000_000;
}

export function normalizeUsage(
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
