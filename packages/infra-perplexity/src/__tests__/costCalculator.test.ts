import { describe, expect, it } from 'vitest';
import { calculateTextCost, normalizeUsageV2 } from '../costCalculator.js';
import type { ModelPricing } from '@intexuraos/llm-contract';

describe('infra-perplexity costCalculator', () => {
  const basePricing: ModelPricing = {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  };

  describe('calculateTextCost', () => {
    it('uses providerCost when useProviderCost is true and providerCost provided', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        useProviderCost: true,
      };
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, pricing, 0.05);
      expect(cost).toBe(0.05);
    });

    it('falls back to token calculation when useProviderCost is true but no providerCost', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        useProviderCost: true,
      };
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, pricing, undefined);
      // input: (1000/1M) * 3 = 0.003, output: (500/1M) * 15 = 0.0075
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('uses usage.providerCost for V1 compatibility', () => {
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        providerCost: 0.08,
      };
      const cost = calculateTextCost(usage, basePricing, undefined);
      expect(cost).toBe(0.08);
    });

    it('falls back to token calculation when no providerCost available', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = calculateTextCost(usage, basePricing, undefined);
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('prefers pricing.useProviderCost over usage.providerCost', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        useProviderCost: true,
      };
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        providerCost: 0.08,
      };
      // providerCost argument takes precedence when useProviderCost is true
      const cost = calculateTextCost(usage, pricing, 0.05);
      expect(cost).toBe(0.05);
    });

    it('handles zero tokens', () => {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const cost = calculateTextCost(usage, basePricing, undefined);
      expect(cost).toBe(0);
    });
  });

  describe('normalizeUsageV2', () => {
    it('returns normalized usage with calculated cost', () => {
      const result = normalizeUsageV2(1000, 500, undefined, basePricing);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.0105, 6),
      });
    });

    it('uses providerCost when provided', () => {
      const pricing: ModelPricing = {
        ...basePricing,
        useProviderCost: true,
      };
      const result = normalizeUsageV2(1000, 500, 0.05, pricing);
      expect(result.costUsd).toBe(0.05);
    });

    it('calculates cost from tokens when no providerCost', () => {
      const result = normalizeUsageV2(1000, 500, undefined, basePricing);
      expect(result.costUsd).toBeCloseTo(0.0105, 6);
    });
  });
});
