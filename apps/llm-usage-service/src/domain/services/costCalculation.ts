import type { LlmProvider, ModelPricing } from '@intexuraos/llm-contract';
import { LlmProviders } from '@intexuraos/llm-contract';

/**
 * Token usage fields relevant to cost calculation.
 *
 * This is a subset of the usage event's `usage` field,
 * containing only the fields needed for cost computation.
 */
export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  webSearchCalls: number;
  groundingEnabled: boolean;
  imageCount: number;
}

/**
 * Consolidated cost calculation for all LLM providers.
 *
 * Dispatches to provider-specific logic based on the provider type.
 * All prices in `pricing` are per-million tokens; the function uses
 * scaled integer math with `Math.round()` for precision.
 *
 * Note: Image cost calculation (`calculateImageCost`) from `infra-gemini`
 * and `infra-gpt` is NOT consolidated here — image generation events are
 * not yet emitted with `schemaVersion: 2`. If image events are migrated
 * in the future, add image cost handling to the relevant provider branches.
 *
 * @param provider - The LLM provider identifier
 * @param usage - Token usage counts from the request
 * @param pricing - Model pricing configuration (per-million)
 * @returns Cost in USD
 */
export function calculateCost(
  provider: LlmProvider,
  usage: UsageTokens,
  pricing: ModelPricing
): number {
  switch (provider) {
    case LlmProviders.Anthropic:
      return calculateAnthropicCost(usage, pricing);
    case LlmProviders.Google:
      return calculateGoogleCost(usage, pricing);
    case LlmProviders.OpenAI:
      return calculateOpenAICost(usage, pricing);
    case LlmProviders.Perplexity:
      return calculatePerplexityCost(usage, pricing);
    case LlmProviders.OpenRouter:
      return calculateOpenRouterCost(usage, pricing);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * Anthropic cost calculation.
 *
 * - inputTokens are regular (non-cached) input tokens
 * - cacheReadTokens charged at inputPrice * cacheReadMultiplier (default 0.1)
 * - cacheWriteTokens charged at inputPrice * cacheWriteMultiplier (default 1.25)
 * - Web search calls charged per call
 */
function calculateAnthropicCost(usage: UsageTokens, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const searchPrice = pricing.webSearchCostPerCall ?? 0;

  const cacheReadMultiplier = pricing.cacheReadMultiplier ?? 0.1;
  const cacheWriteMultiplier = pricing.cacheWriteMultiplier ?? 1.25;

  const regularCost = usage.inputTokens * inputPrice;
  const readCost = usage.cacheReadTokens * inputPrice * cacheReadMultiplier;
  const writeCost = usage.cacheWriteTokens * inputPrice * cacheWriteMultiplier;
  const outputCost = usage.outputTokens * outputPrice;
  const searchCostScaled = usage.webSearchCalls * searchPrice * 1_000_000;

  return Math.round(regularCost + readCost + writeCost + outputCost + searchCostScaled) / 1_000_000;
}

/**
 * Google cost calculation.
 *
 * - thinkingTokens charged at output price
 * - Grounding adds a flat per-request cost when enabled
 */
function calculateGoogleCost(usage: UsageTokens, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const groundingPrice = pricing.groundingCostPerRequest ?? 0;

  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;
  const thinkingCost = usage.thinkingTokens * outputPrice;
  const groundingCostScaled = (usage.groundingEnabled ? groundingPrice : 0) * 1_000_000;

  return Math.round(inputCost + outputCost + thinkingCost + groundingCostScaled) / 1_000_000;
}

/**
 * OpenAI cost calculation.
 *
 * - cachedTokens are subtracted from inputTokens to get regular input count
 * - Cached tokens charged at inputPrice * cacheReadMultiplier (default 0.5)
 * - Web search calls charged per call
 */
function calculateOpenAICost(usage: UsageTokens, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const searchPrice = pricing.webSearchCostPerCall ?? 0;

  const regularInputCount = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const cacheMultiplier = pricing.cacheReadMultiplier ?? 0.5;

  const regularInputCost = regularInputCount * inputPrice;
  const cachedInputCost = usage.cachedTokens * inputPrice * cacheMultiplier;
  const outputCost = usage.outputTokens * outputPrice;
  const searchCostScaled = usage.webSearchCalls * searchPrice * 1_000_000;

  return (
    Math.round(regularInputCost + cachedInputCost + outputCost + searchCostScaled) / 1_000_000
  );
}

/**
 * Perplexity token-based cost calculation.
 *
 * - webSearchCalls defaults to 1 when 0 (Perplexity always charges at least one
 *   request fee per API call). This differs from the original infra-perplexity
 *   calculator which used `?? 1` (nullish coalescing), but the original
 *   `normalizeUsage()` always hardcoded `webSearchCalls: 1` before calling
 *   `calculateTextCost`, so the effective behavior is the same.
 * - Request fee is charged per search call via webSearchCostPerCall
 */
function calculatePerplexityCost(usage: UsageTokens, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const requestFee = pricing.webSearchCostPerCall ?? 0;

  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;

  const requests = usage.webSearchCalls > 0 ? usage.webSearchCalls : 1;
  const requestCostScaled = requests * requestFee * 1_000_000;

  return Math.round(inputCost + outputCost + requestCostScaled) / 1_000_000;
}

/**
 * OpenRouter token-based cost calculation.
 *
 * - Uses per-million prices divided down to per-token for calculation
 * - Scales back up for rounding precision
 */
function calculateOpenRouterCost(usage: UsageTokens, pricing: ModelPricing): number {
  const inputCost = usage.inputTokens * (pricing.inputPricePerMillion / 1_000_000);
  const outputCost = usage.outputTokens * (pricing.outputPricePerMillion / 1_000_000);

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
