import { describe, expect, it } from 'vitest';
import { calculateCost } from '../../../../domain/research/utils/costCalculator.js';
import type { LlmPricing } from '../../../../domain/research/ports/pricingRepository.js';

describe('calculateCost', () => {
  const basePricing: LlmPricing = {
    provider: 'anthropic',
    model: 'claude-3-opus',
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('calculates cost correctly for typical usage', () => {
    const cost = calculateCost(1000, 500, basePricing);
    // Input: 1000 tokens * $15/M = $0.015
    // Output: 500 tokens * $75/M = $0.0375
    // Total: $0.0525
    expect(cost).toBe(0.0525);
  });

  it('returns zero for zero tokens', () => {
    const cost = calculateCost(0, 0, basePricing);
    expect(cost).toBe(0);
  });

  it('handles large token counts', () => {
    const cost = calculateCost(1_000_000, 1_000_000, basePricing);
    // Input: 1M tokens * $15/M = $15
    // Output: 1M tokens * $75/M = $75
    // Total: $90
    expect(cost).toBe(90);
  });

  it('rounds to 6 decimal places', () => {
    const pricing: LlmPricing = {
      ...basePricing,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
    };
    const cost = calculateCost(333, 777, pricing);
    // Input: 333 * 0.15 / 1M = 0.00004995
    // Output: 777 * 0.60 / 1M = 0.0004662
    // Total: 0.00051615 -> rounded to 0.000516
    expect(cost).toBe(0.000516);
  });
});
