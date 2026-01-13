import { describe, expect, it } from 'vitest';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { calculateTextCost, normalizeUsage } from '../costCalculator.js';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 0.6,
  outputPricePerMillion: 2.2,
  webSearchCostPerCall: 0.005,
  ...overrides,
});

describe('calculateTextCost', () => {
  it('calculates basic text cost', () => {
    const pricing = createTestPricing();
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
    };

    const cost = calculateTextCost(usage, pricing);
    // (100/1M * 0.6) + (50/1M * 2.2) = 0.00006 + 0.00011 = 0.00017
    expect(cost).toBeCloseTo(0.00017, 6);
  });

  it('calculates cost with cache split', () => {
    const pricing = createTestPricing({ cacheReadMultiplier: 0.5 });
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 40,
    };

    const cost = calculateTextCost(usage, pricing);
    // Regular: (100-40) * 0.6 = 60 * 0.6 = 36
    // Cached: 40 * 0.6 * 0.5 = 12
    // Output: 50 * 2.2 = 110
    // Total: (36 + 12 + 110) / 1M = 0.000158
    expect(cost).toBeCloseTo(0.000158, 6);
  });

  it('adds web search cost', () => {
    const pricing = createTestPricing({ webSearchCostPerCall: 0.005 });
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      webSearchCalls: 2,
    };

    const cost = calculateTextCost(usage, pricing);
    // Text cost: 0.00017
    // Search: 2 * 0.005 * 1M = 10000 / 1M = 0.01
    // Total: 0.01017
    expect(cost).toBeCloseTo(0.01017, 6);
  });

  it('handles zero values', () => {
    const pricing = createTestPricing();
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
    };

    expect(calculateTextCost(usage, pricing)).toBe(0);
  });

  it('handles missing optional fields', () => {
    const pricing = createTestPricing();
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
    };

    const cost = calculateTextCost(usage, pricing);
    expect(cost).toBeCloseTo(0.00017, 6);
  });

  it('uses default cache multiplier when not specified', () => {
    const pricing = createTestPricing({});
    const usage = {
      inputTokens: 100,
      outputTokens: 0,
      cachedTokens: 50,
    };

    const cost = calculateTextCost(usage, pricing);
    // Regular: 50 * 0.6 = 30
    // Cached (default 0.5): 50 * 0.6 * 0.5 = 15
    // Total: (30 + 15) / 1M = 0.000045
    expect(cost).toBeCloseTo(0.000045, 6);
  });

  it('uses default search cost when not specified', () => {
    const pricing = {
      inputPricePerMillion: 0.6,
      outputPricePerMillion: 2.2,
    } satisfies ModelPricing;
    const usage = {
      inputTokens: 100,
      outputTokens: 0,
      webSearchCalls: 5,
    };

    const cost = calculateTextCost(usage, pricing);
    // Search cost defaults to 0 when not in pricing
    expect(cost).toBeCloseTo(0.00006, 6);
  });

  it('handles cached tokens exceeding input tokens', () => {
    const pricing = createTestPricing();
    const usage = {
      inputTokens: 50,
      outputTokens: 0,
      cachedTokens: 100, // More than total input
    };

    const cost = calculateTextCost(usage, pricing);
    // Math.max(0, 50 - 100) = 0 regular input
    // Cached: 100 * 0.6 * 0.5 = 30
    // Total: 30 / 1M = 0.00003
    expect(cost).toBeCloseTo(0.00003, 6);
  });
});

describe('normalizeUsage', () => {
  it('creates normalized usage with cost', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 0, undefined, pricing);

    expect(normalized.inputTokens).toBe(100);
    expect(normalized.outputTokens).toBe(50);
    expect(normalized.totalTokens).toBe(150);
    expect(normalized.costUsd).toBeCloseTo(0.00017, 6);
  });

  it('includes cacheTokens when provided', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 30, 0, undefined, pricing);

    expect(normalized.cacheTokens).toBe(30);
  });

  it('omits cacheTokens when zero', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 0, undefined, pricing);

    expect(normalized.cacheTokens).toBeUndefined();
  });

  it('includes webSearchCalls when provided', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 3, undefined, pricing);

    expect(normalized.webSearchCalls).toBe(3);
  });

  it('omits webSearchCalls when zero', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 0, undefined, pricing);

    expect(normalized.webSearchCalls).toBeUndefined();
  });

  it('includes reasoningTokens when provided and positive', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 0, 100, pricing);

    expect(normalized.reasoningTokens).toBe(100);
  });

  it('omits reasoningTokens when undefined', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 0, undefined, pricing);

    expect(normalized.reasoningTokens).toBeUndefined();
  });

  it('omits reasoningTokens when zero', () => {
    const pricing = createTestPricing();
    const normalized = normalizeUsage(100, 50, 0, 0, 0, pricing);

    expect(normalized.reasoningTokens).toBeUndefined();
  });
});
