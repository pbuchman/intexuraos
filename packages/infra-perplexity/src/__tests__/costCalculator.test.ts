import { describe, expect, it } from 'vitest';
import { calculateTextCost } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('perplexity costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    webSearchCostPerCall: 0.005, // Request Fee
    useProviderCost: true
  };

  it('uses provider cost if available', () => {
    const usage = { inputTokens: 100, outputTokens: 100 };
    expect(calculateTextCost(usage, basePricing, 0.12)).toBe(0.12);
  });

  it('falls back to calculation with request fee if provider cost missing', () => {
    const usage = { inputTokens: 1000, outputTokens: 500 };
    // Tokens: (1000*3 + 500*15) = 3000 + 7500 = 10500
    // Fee: 1 * 0.005 * 1M = 5000
    // Total: 15500 / 1M = 0.0155
    expect(calculateTextCost(usage, basePricing, undefined)).toBeCloseTo(0.0155, 6);
  });
});
