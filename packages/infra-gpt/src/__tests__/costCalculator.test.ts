import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-gpt costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    webSearchCostPerCall: 0.01,
    cacheReadMultiplier: 0.5
  };

  describe('calculateTextCost', () => {
    it('calculates cost with cache split', () => {
      const usage = { inputTokens: 1000, outputTokens: 500, cachedTokens: 200 };
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.00725, 6);
    });

    it('includes deep research search cost', () => {
      const usage = { inputTokens: 0, outputTokens: 0, webSearchCalls: 5 };
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.05, 6);
    });
  });

  describe('normalizeUsageV2', () => {
    it('returns normalized structure', () => {
      const result = normalizeUsageV2(1000, 500, 200, 1, undefined, basePricing);
      expect(result.costUsd).toBeCloseTo(0.00725 + 0.01, 6);
      expect(result.cacheTokens).toBe(200);
      expect(result.webSearchCalls).toBe(1);
    });
  });
});
