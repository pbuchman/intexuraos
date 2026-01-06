import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsage } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-perplexity costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    webSearchCostPerCall: 0.005, // Request Fee
    useProviderCost: true
  };

  describe('calculateTextCost', () => {
    it('uses provider cost if available', () => {
      const usage = { inputTokens: 100, outputTokens: 100 };
      expect(calculateTextCost(usage, basePricing, 0.12)).toBe(0.12);
    });

    it('uses usage.providerCost when pricing flag is false', () => {
      const pricingNoFlag: ModelPricing = {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        useProviderCost: false,
      };
      const usage = { inputTokens: 100, outputTokens: 100, providerCost: 0.08 };
      expect(calculateTextCost(usage, pricingNoFlag, undefined)).toBe(0.08);
    });

    it('falls back to calculation with request fee if provider cost missing', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      expect(calculateTextCost(usage, basePricing, undefined)).toBeCloseTo(0.0155, 6);
    });
  });

  describe('normalizeUsage', () => {
    it('normalizes usage using provider cost priority', () => {
      const result = normalizeUsage(1000, 500, 0.05, basePricing);
      expect(result.costUsd).toBe(0.05);
      expect(result.totalTokens).toBe(1500);
    });
  });
});
