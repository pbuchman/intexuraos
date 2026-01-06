import { describe, expect, it } from 'vitest';
import { calculateTextCost, calculateImageCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-gemini costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    groundingCostPerRequest: 0.035
  };

  describe('calculateTextCost', () => {
    it('calculates basic cost without grounding', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0003, 6);
    });

    it('adds grounding cost when enabled', () => {
      const usage = { inputTokens: 1000, outputTokens: 500, groundingEnabled: true };
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0353, 6);
    });

    it('uses zero grounding cost when not provided in pricing', () => {
      const minimalPricing: ModelPricing = {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
      };
      const usage = { inputTokens: 1000, outputTokens: 500, groundingEnabled: true };
      // No grounding cost added: just input + output
      expect(calculateTextCost(usage, minimalPricing)).toBeCloseTo(0.0003, 6);
    });
  });

  describe('calculateImageCost', () => {
    it('returns price for existing size', () => {
      const pricingWithImage: ModelPricing = {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
        imagePricing: { '1024x1024': 0.04, '512x512': 0.02 },
      };
      expect(calculateImageCost('1024x1024', pricingWithImage)).toBe(0.04);
    });

    it('returns 0 when imagePricing is undefined', () => {
      const pricingNoImage: ModelPricing = {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
      };
      expect(calculateImageCost('1024x1024', pricingNoImage)).toBe(0);
    });

    it('returns 0 for missing size in imagePricing', () => {
      const pricingWithImage: ModelPricing = {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
        imagePricing: { '512x512': 0.02 },
      };
      expect(calculateImageCost('1024x1024', pricingWithImage)).toBe(0);
    });
  });

  describe('normalizeUsageV2', () => {
    it('returns normalized usage with cost', () => {
      const result = normalizeUsageV2(1000, 500, true, basePricing);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.0353, 6),
        groundingEnabled: true
      });
    });

    it('omits groundingEnabled when false', () => {
      const result = normalizeUsageV2(1000, 500, false, basePricing);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.0003, 6),
      });
      expect(result.groundingEnabled).toBeUndefined();
    });
  });
});
