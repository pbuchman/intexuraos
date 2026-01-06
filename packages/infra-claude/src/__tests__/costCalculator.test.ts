import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-claude costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.03
  };

  describe('calculateTextCost', () => {
    it('calculates write and read cache correctly', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 100,
        cachedTokens: 2000,
        cacheCreationTokens: 500
      };
      // Regular: 1000 * 3 = 3000
      // Read: 2000 * 3 * 0.1 = 600
      // Write: 500 * 3 * 1.25 = 1875
      // Output: 100 * 15 = 1500
      // Total: 6975 / 1M = 0.006975
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.006975, 6);
    });

    it('adds web search cost', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 100,
        webSearchCalls: 2
      };
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0645, 6);
    });
  });

  describe('normalizeUsageV2', () => {
    it('accepts webSearchCalls and calculates cost', () => {
      // 5th argument is webSearchCalls
      const result = normalizeUsageV2(1000, 100, 0, 0, 1, basePricing);

      expect(result.webSearchCalls).toBe(1);
      // Cost: 0.003 (in) + 0.0015 (out) + 0.03 (search) = 0.0345
      expect(result.costUsd).toBeCloseTo(0.0345, 6);
    });
  });
});
