import { describe, expect, it } from 'vitest';
import { calculateTextCost } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('anthropic costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25
  };

  it('calculates write and read cache correctly', () => {
    const usage = {
      inputTokens: 1000,         // 1000 * 3 = 3000
      outputTokens: 100,         // 100 * 15 = 1500
      cachedTokens: 2000,        // 2000 * 3 * 0.1 = 600
      cacheCreationTokens: 500   // 500 * 3 * 1.25 = 1875
    };
    // Sum: 6975 / 1M = 0.006975
    expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.006975, 6);
  });
});
