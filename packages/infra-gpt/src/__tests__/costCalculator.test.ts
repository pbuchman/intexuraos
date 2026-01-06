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
      // Input: 1000 * 2.5 = 2500
      // Output: 500 * 10 = 5000
      // Total: 7500 / 1M = 0.0075
      expect(cost).toBeCloseTo(0.0075, 6);
    });

    it('applies cache multiplier (default 0.5)', () => {
      const usage = {
        inputTokens: 1000, // Total input reported by API
        outputTokens: 500,
        cachedTokens: 200, // Part of input that was cached
      };
      const cost = calculateTextCost(usage, basePricing);

      // New Logic Split:
      // Regular Input: 1000 - 200 = 800 tokens
      // Regular Cost: 800 * 2.5 = 2000
      // Cached Cost: 200 * 2.5 * 0.5 (default multiplier) = 250
      // Output Cost: 500 * 10.0 = 5000
      // Total: (2000 + 250 + 5000) / 1M = 0.00725
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

      // Regular Input: 1000 - 400 = 600 tokens
      // Regular Cost: 600 * 2.5 = 1500
      // Cached Cost: 400 * 2.5 * 0.25 = 250
      // Output Cost: 500 * 10.0 = 5000
      // Total: (1500 + 250 + 5000) / 1M = 0.00675
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
      // Base tokens cost: 0.0075
      // Search cost: 2 * 0.025 = 0.05
      // Total: 0.0575
      expect(cost).toBeCloseTo(0.0575, 6);
    });

    it('handles zero tokens', () => {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const cost = calculateTextCost(usage, basePricing);
      expect(cost).toBe(0);
    });

    it('safeguards against cachedTokens > inputTokens (prevents negative regular cost)', () => {
      // API anomaly edge case
      const usage = {
        inputTokens: 100,
        outputTokens: 0,
        cachedTokens: 150, // More than total input
      };
      const cost = calculateTextCost(usage, basePricing);

      // Logic should clamp regular tokens to 0 (Math.max(0, 100-150))
      // Regular Cost: 0 * 2.5 = 0
      // Cached Cost: 150 * 2.5 * 0.5 = 187.5
      // Total: 187.5 / 1M = 0.0001875
      expect(cost).toBeCloseTo(0.0001875, 7);
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
    // Signature: (input, output, cached, webSearch, reasoning, pricing)

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
      // Cost verification handled in calculateTextCost tests
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
