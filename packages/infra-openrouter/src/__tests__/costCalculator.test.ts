import { describe, expect, it } from 'vitest';
import { toModelPricing, normalizeUsage } from '../costCalculator.js';

describe('costCalculator', () => {
  describe('toModelPricing', () => {
    it('converts per-token strings to per-million numbers', () => {
      const pricing = toModelPricing('0.00000026', '0.00000156');
      expect(pricing.inputPricePerMillion).toBeCloseTo(0.26, 4);
      expect(pricing.outputPricePerMillion).toBeCloseTo(1.56, 4);
      expect(pricing.useProviderCost).toBe(true);
    });

    it('handles larger per-token values', () => {
      const pricing = toModelPricing('0.000003', '0.000015');
      expect(pricing.inputPricePerMillion).toBe(3.0);
      expect(pricing.outputPricePerMillion).toBe(15.0);
      expect(pricing.useProviderCost).toBe(true);
    });
  });

  describe('normalizeUsage', () => {
    it('normalizes usage with provider cost — costUsd is always 0', () => {
      const result = normalizeUsage(100, 50, 0.005);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0);
    });

    it('normalizes usage without provider cost — costUsd is always 0', () => {
      const result = normalizeUsage(100, 50, undefined);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0);
    });

    it('handles zero tokens', () => {
      const result = normalizeUsage(0, 0, undefined);
      expect(result.costUsd).toBe(0);
    });
  });
});
