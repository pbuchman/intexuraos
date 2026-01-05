import type { TokenUsage } from '@intexuraos/llm-contract';
import type { LlmPricing } from '../ports/pricingRepository.js';

const DEFAULT_WEB_SEARCH_COST = 0.01;
const DEFAULT_GROUNDING_COST = 0.035;
const DEFAULT_CACHE_WRITE_MULTIPLIER = 1.25;
const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;
const DEFAULT_OPENAI_CACHE_MULTIPLIER = 0.25;

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: LlmPricing
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export function calculateAccurateCost(
  usage: TokenUsage & { costUsd?: number },
  pricing: LlmPricing
): number {
  // Check for provider-reported cost (from TokenUsage.providerCost or NormalizedUsage.costUsd)
  if (usage.providerCost !== undefined) {
    return usage.providerCost;
  }
  if (usage.costUsd !== undefined) {
    return usage.costUsd;
  }

  const inputPrice = pricing.inputPricePerMillion / 1_000_000;
  const outputPrice = pricing.outputPricePerMillion / 1_000_000;

  let cost = 0;

  if (pricing.provider === 'anthropic') {
    cost = calculateAnthropicCost(usage, inputPrice, outputPrice, pricing);
  } else if (pricing.provider === 'openai') {
    cost = calculateOpenAICost(usage, inputPrice, outputPrice, pricing);
  } else if (pricing.provider === 'google') {
    cost = calculateGeminiCost(usage, inputPrice, outputPrice, pricing);
  } else {
    cost = usage.inputTokens * inputPrice + usage.outputTokens * outputPrice;
  }

  return Math.round(cost * 1_000_000) / 1_000_000;
}

function calculateAnthropicCost(
  usage: TokenUsage,
  inputPrice: number,
  outputPrice: number,
  pricing: LlmPricing
): number {
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;
  const regularInputTokens = usage.inputTokens - cacheReadTokens;

  const cacheReadMultiplier = pricing.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER;
  const cacheWriteMultiplier = pricing.cacheWriteMultiplier ?? DEFAULT_CACHE_WRITE_MULTIPLIER;
  const webSearchCost = pricing.webSearchCostPerCall ?? DEFAULT_WEB_SEARCH_COST;

  const inputCost = regularInputTokens * inputPrice;
  const cacheReadCost = cacheReadTokens * inputPrice * cacheReadMultiplier;
  const cacheWriteCost = cacheCreationTokens * inputPrice * cacheWriteMultiplier;
  const outputCost = usage.outputTokens * outputPrice;
  const searchCost = (usage.webSearchCalls ?? 0) * webSearchCost;

  return inputCost + cacheReadCost + cacheWriteCost + outputCost + searchCost;
}

function calculateOpenAICost(
  usage: TokenUsage,
  inputPrice: number,
  outputPrice: number,
  pricing: LlmPricing
): number {
  const cachedTokens = usage.cachedTokens ?? 0;
  const regularInputTokens = usage.inputTokens - cachedTokens;

  const cacheMultiplier = pricing.cacheReadMultiplier ?? DEFAULT_OPENAI_CACHE_MULTIPLIER;
  const webSearchCost = pricing.webSearchCostPerCall ?? DEFAULT_WEB_SEARCH_COST;

  const inputCost = regularInputTokens * inputPrice;
  const cachedCost = cachedTokens * inputPrice * cacheMultiplier;
  const outputCost = usage.outputTokens * outputPrice;
  const searchCost = (usage.webSearchCalls ?? 0) * webSearchCost;

  return inputCost + cachedCost + outputCost + searchCost;
}

function calculateGeminiCost(
  usage: TokenUsage,
  inputPrice: number,
  outputPrice: number,
  pricing: LlmPricing
): number {
  const groundingCost = pricing.groundingCostPerRequest ?? DEFAULT_GROUNDING_COST;

  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;
  const searchCost = usage.groundingEnabled === true ? groundingCost : 0;

  return inputCost + outputCost + searchCost;
}
