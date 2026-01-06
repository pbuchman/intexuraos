import { describe, expect, it } from 'vitest';
import { calculateTextCost, calculateImageCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-gpt costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  };

  describe('calculateTextCost', () => {
    it('calculates basic cost without cache', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, basePricing);
      // input: (1000/1M) * 2.5 = 0.0025, output: (500/1M) * 10 = 0.005
      expect(cost).toBeCloseTo(0.0075, 6);
    });

    it('applies cache multiplier (default 0.5)', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
      };
      const cost = calculateTextCost(usage, basePricing);
      // effectiveInput: 1000 - 200 * (1 - 0.5) = 1000 - 100 = 900
      // input: (900/1M) * 2.5 = 0.00225, output: (500/1M) * 10 = 0.005
      expect(cost).toBeCloseTo(0.00725, 6);
    });

    it('uses custom cache multiplier from pricing', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        cacheReadMultiplier: 0.25,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 400,
      };
      const cost = calculateTextCost(usage, pricing);
      // effectiveInput: 1000 - 400 * (1 - 0.25) = 1000 - 300 = 700
      // input: (700/1M) * 2.5 = 0.00175, output: (500/1M) * 10 = 0.005
      expect(cost).toBeCloseTo(0.00675, 6);
    });

    it('includes web search cost', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        webSearchCostPerCall: 0.025,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        webSearchCalls: 2,
      };
      const cost = calculateTextCost(usage, pricing);
      // base: 0.0075, webSearch: 2 * 0.025 = 0.05
      expect(cost).toBeCloseTo(0.0575, 6);
    });

    it('handles zero tokens', () => {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const cost = calculateTextCost(usage, basePricing);
      expect(cost).toBe(0);
    });

    it('handles missing optional fields gracefully', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, basePricing);
      expect(cost).toBeCloseTo(0.0075, 6);
    });
  });

  describe('calculateImageCost', () => {
    it('returns cost for defined size', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        imagePricing: {
          '1024x1024': 0.04,
          '1536x1024': 0.08,
        },
      };
      expect(calculateImageCost('1024x1024', pricing)).toBe(0.04);
      expect(calculateImageCost('1536x1024', pricing)).toBe(0.08);
    });

    it('returns 0 when no imagePricing defined', () => {
      const cost = calculateImageCost('1024x1024', basePricing);
      expect(cost).toBe(0);
    });

    it('returns 0 for undefined size in imagePricing', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        imagePricing: {
          '1024x1024': 0.04,
        },
      };
      expect(calculateImageCost('1024x1536', pricing)).toBe(0);
    });
  });

  describe('normalizeUsageV2', () => {
    it('returns normalized usage with calculated cost', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, undefined, basePricing);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.0075, 6),
      });
    });

    it('includes cacheTokens when present', () => {
      const result = normalizeUsageV2(1000, 500, 200, 0, undefined, basePricing);
      expect(result.cacheTokens).toBe(200);
    });

    it('excludes cacheTokens when zero', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, undefined, basePricing);
      expect(result.cacheTokens).toBeUndefined();
    });

    it('includes reasoningTokens when present', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, 150, basePricing);
      expect(result.reasoningTokens).toBe(150);
    });

    it('excludes reasoningTokens when zero', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, 0, basePricing);
      expect(result.reasoningTokens).toBeUndefined();
    });

    it('excludes reasoningTokens when undefined', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, undefined, basePricing);
      expect(result.reasoningTokens).toBeUndefined();
    });

    it('includes webSearchCalls when present', () => {
      const result = normalizeUsageV2(1000, 500, 0, 3, undefined, basePricing);
      expect(result.webSearchCalls).toBe(3);
    });

    it('excludes webSearchCalls when zero', () => {
      const result = normalizeUsageV2(1000, 500, 0, 0, undefined, basePricing);
      expect(result.webSearchCalls).toBeUndefined();
    });
  });
});
