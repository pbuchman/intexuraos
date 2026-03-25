import { describe, expect, it } from 'vitest';
import { toModelPricing, calculateTextCost, normalizeUsage } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

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

  describe('calculateTextCost', () => {
    const basePricing: ModelPricing = {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      useProviderCost: true,
    };

    it('uses provider cost when useProviderCost is true and cost is provided', () => {
      const usage = { inputTokens: 100, outputTokens: 50 };
      const cost = calculateTextCost(usage, basePricing, 0.005);
      expect(cost).toBe(0.005);
    });

    it('falls back to token calculation when useProviderCost is false', () => {
      const pricing = { ...basePricing, useProviderCost: false };
      const usage = { inputTokens: 100, outputTokens: 50 };
      const cost = calculateTextCost(usage, pricing, undefined);
      // 100 * (3.0/1M) + 50 * (15.0/1M) = 0.0003 + 0.00075 = 0.00105
      expect(cost).toBeCloseTo(0.00105, 5);
    });

    it('falls back to token calculation when useProviderCost is true but no cost provided', () => {
      const usage = { inputTokens: 100, outputTokens: 50 };
      const cost = calculateTextCost(usage, basePricing, undefined);
      expect(cost).toBeCloseTo(0.00105, 5);
    });

    it('handles zero tokens', () => {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const cost = calculateTextCost(usage, basePricing, undefined);
      expect(cost).toBe(0);
    });
  });

  describe('normalizeUsage', () => {
    const basePricing: ModelPricing = {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      useProviderCost: true,
    };

    it('normalizes usage with provider cost', () => {
      const result = normalizeUsage(100, 50, 0.005, basePricing);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0.005);
    });

    it('normalizes usage without provider cost using pricing', () => {
      const result = normalizeUsage(100, 50, undefined, basePricing);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBeCloseTo(0.00105, 5);
    });

    it('handles undefined provider cost correctly', () => {
      const result = normalizeUsage(1000, 500, undefined, basePricing);
      // 1000 * (3.0/1M) + 500 * (15.0/1M) = 0.003 + 0.0075 = 0.0105
      expect(result.costUsd).toBeCloseTo(0.0105, 4);
    });
  });
});
