import { describe, expect, it } from 'vitest';
import { calculateTextCost, calculateImageCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-gemini costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
  };

  describe('calculateTextCost', () => {
    it('calculates basic cost without grounding', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, basePricing);
      // input: (1000/1M) * 0.1 = 0.0001, output: (500/1M) * 0.4 = 0.0002
      expect(cost).toBeCloseTo(0.0003, 6);
    });

    it('includes grounding cost when enabled', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        groundingCostPerRequest: 0.035,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        groundingEnabled: true,
      };
      const cost = calculateTextCost(usage, pricing);
      // base: 0.0003, grounding: 0.035
      expect(cost).toBeCloseTo(0.0353, 6);
    });

    it('excludes grounding cost when disabled', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        groundingCostPerRequest: 0.035,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        groundingEnabled: false,
      };
      const cost = calculateTextCost(usage, pricing);
      expect(cost).toBeCloseTo(0.0003, 6);
    });

    it('handles grounding enabled but no cost defined', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        groundingEnabled: true,
      };
      const cost = calculateTextCost(usage, basePricing);
      // No groundingCostPerRequest in pricing, should be 0
      expect(cost).toBeCloseTo(0.0003, 6);
    });

    it('handles zero tokens', () => {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const cost = calculateTextCost(usage, basePricing);
      expect(cost).toBe(0);
    });
  });

  describe('calculateImageCost', () => {
    it('returns cost for defined size', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        imagePricing: {
          '1024x1024': 0.02,
          '1536x1024': 0.04,
        },
      };
      expect(calculateImageCost('1024x1024', pricing)).toBe(0.02);
      expect(calculateImageCost('1536x1024', pricing)).toBe(0.04);
    });

    it('returns 0 when no imagePricing defined', () => {
      const cost = calculateImageCost('1024x1024', basePricing);
      expect(cost).toBe(0);
    });

    it('returns 0 for undefined size in imagePricing', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        imagePricing: {
          '1024x1024': 0.02,
        },
      };
      expect(calculateImageCost('1024x1536', pricing)).toBe(0);
    });
  });

  describe('normalizeUsageV2', () => {
    it('returns normalized usage with calculated cost', () => {
      const result = normalizeUsageV2(1000, 500, false, basePricing);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.0003, 6),
      });
    });

    it('includes groundingEnabled when true', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        groundingCostPerRequest: 0.035,
      };
      const result = normalizeUsageV2(1000, 500, true, pricing);
      expect(result.groundingEnabled).toBe(true);
      expect(result.costUsd).toBeCloseTo(0.0353, 6);
    });

    it('excludes groundingEnabled when false', () => {
      const result = normalizeUsageV2(1000, 500, false, basePricing);
      expect(result.groundingEnabled).toBeUndefined();
    });
  });
});
