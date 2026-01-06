import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-claude costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  };

  describe('calculateTextCost', () => {
    it('calculates basic cost without cache', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, basePricing);
      // input: (1000/1M) * 3 = 0.003, output: (500/1M) * 15 = 0.0075
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('applies cache read multiplier (default 0.1)', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
      };
      const cost = calculateTextCost(usage, basePricing);
      // regularInput: 1000 - 200 = 800 => (800/1M) * 3 = 0.0024
      // cacheRead: (200/1M) * 3 * 0.1 = 0.00006
      // output: (500/1M) * 15 = 0.0075
      expect(cost).toBeCloseTo(0.00996, 6);
    });

    it('applies cache creation multiplier (default 1.25)', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
      };
      const cost = calculateTextCost(usage, basePricing);
      // regularInput: 1000 - 200 = 800 => (800/1M) * 3 = 0.0024
      // cacheCreation: (200/1M) * 3 * 1.25 = 0.00075
      // output: (500/1M) * 15 = 0.0075
      expect(cost).toBeCloseTo(0.01065, 6);
    });

    it('uses custom cache multipliers from pricing', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        cacheReadMultiplier: 0.2,
        cacheWriteMultiplier: 1.5,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100,
        cacheCreationTokens: 100,
      };
      const cost = calculateTextCost(usage, pricing);
      // regularInput: 1000 - 100 - 100 = 800 => (800/1M) * 3 = 0.0024
      // cacheRead: (100/1M) * 3 * 0.2 = 0.00006
      // cacheCreation: (100/1M) * 3 * 1.5 = 0.00045
      // output: (500/1M) * 15 = 0.0075
      expect(cost).toBeCloseTo(0.01041, 6);
    });

    it('includes web search cost', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        webSearchCostPerCall: 0.01,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        webSearchCalls: 3,
      };
      const cost = calculateTextCost(usage, pricing);
      // base: 0.0105, webSearch: 3 * 0.01 = 0.03
      expect(cost).toBeCloseTo(0.0405, 6);
    });

    it('handles zero tokens', () => {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const cost = calculateTextCost(usage, basePricing);
      expect(cost).toBe(0);
    });

    it('handles missing optional fields gracefully', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, basePricing);
      expect(cost).toBeCloseTo(0.0105, 6);
    });
  });

  describe('normalizeUsageV2', () => {
    it('returns normalized usage with calculated cost', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, 0, basePricing);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.0105, 6),
      });
    });

    it('includes cacheTokens when present', () => {
      const result = normalizeUsageV2(1000, 500, 200, 100, 0, basePricing);
      expect(result.cacheTokens).toBe(300);
    });

    it('excludes cacheTokens when zero', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, 0, basePricing);
      expect(result.cacheTokens).toBeUndefined();
    });

    it('includes webSearchCalls when present', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, 3, basePricing);
      expect(result.webSearchCalls).toBe(3);
    });

    it('excludes webSearchCalls when zero', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, 0, basePricing);
      expect(result.webSearchCalls).toBeUndefined();
    });
  });
});
