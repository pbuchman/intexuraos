import type { LlmProvider, ModelPricing, ImageSize } from '@intexuraos/llm-contract';
import { LlmProviders } from '@intexuraos/llm-contract';
import { IntexuraOSError } from '@intexuraos/common-core';

/** Default image size used when only an image count is available (no per-request size). */
const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';

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
  imageSize?: ImageSize;
}

/**
 * Consolidated cost calculation for all LLM providers.
 *
 * Dispatches to provider-specific logic based on the provider type.
 * All prices in `pricing` are per-million tokens; the function uses
 * scaled integer math with `Math.round()` for precision.
 *
 * Image generation costs are also handled: when `imageCount > 0` and the
 * model has `imagePricing`, the per-image price for `usage.imageSize` is
 * multiplied by `imageCount`. Events emitted before image dimensions were
 * tracked fall back to the default size (`1024x1024`).
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
      throw new IntexuraOSError('INTERNAL_ERROR', `Unsupported provider: ${String(exhaustive)}`);
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
  const imageCost = calculateImageCost(usage.imageCount, usage.imageSize, pricing);

  return Math.round(inputCost + outputCost + thinkingCost + groundingCostScaled) / 1_000_000 + imageCost;
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
  const imageCost = calculateImageCost(usage.imageCount, usage.imageSize, pricing);

  return (
    Math.round(regularInputCost + cachedInputCost + outputCost + searchCostScaled) / 1_000_000 + imageCost
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

/**
 * Calculate image generation cost.
 *
 * Consolidated from `infra-gemini` and `infra-gpt` `calculateImageCost`.
 * Uses the default image size (`1024x1024`) for older events that only carry
 * `imageCount`.
 *
 * @returns Total image cost in USD (0 when no images or no imagePricing)
 */
function calculateImageCost(
  imageCount: number,
  imageSize: ImageSize | undefined,
  pricing: ModelPricing
): number {
  if (imageCount <= 0) return 0;
  if (pricing.imagePricing === undefined) return 0;
  const perImagePrice = pricing.imagePricing[imageSize ?? DEFAULT_IMAGE_SIZE] ?? 0;
  return perImagePrice * imageCount;
}
