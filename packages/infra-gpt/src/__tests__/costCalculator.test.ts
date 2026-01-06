import { describe, expect, it } from 'vitest';
import { calculateTextCost } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('openai costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    webSearchCostPerCall: 0.01,
    cacheReadMultiplier: 0.5
  };

  it('calculates cost with cache split', () => {
    // 1000 Total Input, 200 Cached.
    // Regular: 800 * 2.5 = 2000
    // Cached: 200 * 2.5 * 0.5 = 250
    // Output: 500 * 10 = 5000
    // Total: 7250 / 1M = 0.00725
    const usage = { inputTokens: 1000, outputTokens: 500, cachedTokens: 200 };
    expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.00725, 6);
  });

  it('includes deep research search cost', () => {
    const usage = { inputTokens: 0, outputTokens: 0, webSearchCalls: 5 };
    // 5 * 0.01 = 0.05
    expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.05, 6);
  });
});
