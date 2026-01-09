import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsage } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-claude costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.03,
  };

  describe('calculateTextCost', () => {
    it('calculates write and read cache correctly', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 100,
        cachedTokens: 2000, // Read
        cacheCreationTokens: 500, // Write
      };
      // Regular: 1000 * 3 = 3000
      // Read: 2000 * 3 * 0.1 = 600
      // Write: 500 * 3 * 1.25 = 1875
      // Output: 100 * 15 = 1500
      // Total: 6975 / 1M = 0.006975
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.006975, 6);
    });

    it('uses default multipliers when not provided', () => {
      const minimalPricing: ModelPricing = {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 100,
        cachedTokens: 2000,
        cacheCreationTokens: 500,
      };
      // Default: cacheReadMultiplier=0.1, cacheWriteMultiplier=1.25
      // Same calculation as above: 0.006975
      expect(calculateTextCost(usage, minimalPricing)).toBeCloseTo(0.006975, 6);
    });

    it('handles undefined cache tokens', () => {
      const usage = { inputTokens: 1000, outputTokens: 100 };
      // Regular: 1000 * 3 = 3000
      // Output: 100 * 15 = 1500
      // Total: 4500 / 1M = 0.0045
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0045, 6);
    });

    it('handles web search cost when undefined in pricing', () => {
      const pricingWithoutSearch: ModelPricing = {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      };
      const usage = { inputTokens: 1000, outputTokens: 100, webSearchCalls: 5 };
      // Search cost defaults to 0
      expect(calculateTextCost(usage, pricingWithoutSearch)).toBeCloseTo(0.0045, 6);
    });
  });

  describe('normalizeUsage', () => {
    it('aggregates cache tokens into single contract field', () => {
      // 2000 Read + 500 Write
      const result = normalizeUsage(1000, 100, 2000, 500, 1, basePricing);

      // Contract compliance:
      expect(result.cacheTokens).toBe(2500); // 2000 + 500

      // Cost calculation remains precise:
      // Token Cost (from cache test): 0.006975
      // Search Cost (1 call * 0.03): 0.03
      // Total: 0.036975
      expect(result.costUsd).toBeCloseTo(0.036975, 6);
    });
  });
});
