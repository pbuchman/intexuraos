import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsageV2 } from '../costCalculator.js';
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
  });
});
