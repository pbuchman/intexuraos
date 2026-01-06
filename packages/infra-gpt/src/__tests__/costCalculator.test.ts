import { describe, expect, it } from 'vitest';
import { calculateTextCost, calculateImageCost, normalizeUsage } from '../costCalculator.js';
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

    it('uses zero search cost when not provided in pricing', () => {
      const pricingNoSearch: ModelPricing = {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
      };
      const usage = { inputTokens: 1000, outputTokens: 500, webSearchCalls: 5 };
      // No search cost added: (1000 * 2.5 + 500 * 10) / 1M = 0.0075
      expect(calculateTextCost(usage, pricingNoSearch)).toBeCloseTo(0.0075, 6);
    });

    it('uses default cache multiplier when not provided', () => {
      const pricingNoMultiplier: ModelPricing = {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
      };
      const usage = { inputTokens: 1000, outputTokens: 500, cachedTokens: 200 };
      // Default cacheReadMultiplier = 0.5
      // Regular: (1000 - 200) * 2.5 = 2000
      // Cached: 200 * 2.5 * 0.5 = 250
      // Output: 500 * 10 = 5000
      // Total: 7250 / 1M = 0.00725
      expect(calculateTextCost(usage, pricingNoMultiplier)).toBeCloseTo(0.00725, 6);
    });
  });

  describe('calculateImageCost', () => {
    it('returns price for existing size', () => {
      const pricingWithImage: ModelPricing = {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.06 },
      };
      expect(calculateImageCost('1024x1024', pricingWithImage)).toBe(0.04);
    });

    it('returns 0 when imagePricing is undefined', () => {
      const pricingNoImage: ModelPricing = {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
      };
      expect(calculateImageCost('1024x1024', pricingNoImage)).toBe(0);
    });

    it('returns 0 for missing size in imagePricing', () => {
      const pricingWithImage: ModelPricing = {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        imagePricing: { '1536x1024': 0.06 },
      };
      expect(calculateImageCost('1024x1024', pricingWithImage)).toBe(0);
    });
  });

  describe('normalizeUsage', () => {
    it('returns normalized structure', () => {
      const result = normalizeUsage(1000, 500, 200, 1, undefined, basePricing);
      expect(result.costUsd).toBeCloseTo(0.00725 + 0.01, 6);
      expect(result.cacheTokens).toBe(200);
      expect(result.webSearchCalls).toBe(1);
    });

    it('includes reasoningTokens when provided', () => {
      const result = normalizeUsage(1000, 500, 0, 0, 150, basePricing);
      expect(result.reasoningTokens).toBe(150);
    });

    it('omits reasoningTokens when zero', () => {
      const result = normalizeUsage(1000, 500, 0, 0, 0, basePricing);
      expect(result.reasoningTokens).toBeUndefined();
    });

    it('omits optional fields when zero', () => {
      const result = normalizeUsage(1000, 500, 0, 0, undefined, basePricing);
      expect(result.cacheTokens).toBeUndefined();
      expect(result.webSearchCalls).toBeUndefined();
      expect(result.reasoningTokens).toBeUndefined();
    });
  });
});
