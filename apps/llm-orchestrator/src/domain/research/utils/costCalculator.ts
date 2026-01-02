import type { LlmPricing } from '../ports/pricingRepository.js';

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: LlmPricing
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
