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
    it('preserves a positive finite provider-reported cost', () => {
      const result = normalizeUsage(100, 50, 0.005);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0.005);
      expect(result.providerReportedUsd).toBe(0.005);
    });

    it('keeps an absent provider-reported cost unknown', () => {
      const result = normalizeUsage(100, 50, undefined);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0);
      expect(result).not.toHaveProperty('providerReportedUsd');
    });

    it('preserves an explicitly reported zero cost', () => {
      const result = normalizeUsage(100, 50, 0);

      expect(result.costUsd).toBe(0);
      expect(result.providerReportedUsd).toBe(0);
    });

    it.each([-0.005, Number.NaN, Number.POSITIVE_INFINITY])(
      'keeps malformed provider cost %p unknown',
      (providerCost) => {
        const result = normalizeUsage(100, 50, providerCost);

        expect(result.costUsd).toBe(0);
        expect(result).not.toHaveProperty('providerReportedUsd');
      }
    );

    it('handles zero tokens', () => {
      const result = normalizeUsage(0, 0, undefined);
      expect(result.costUsd).toBe(0);
    });
  });
});
