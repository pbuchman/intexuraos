import { describe, expect, it } from 'vitest';
import {
  calculateCost,
  calculateAccurateCost,
} from '../../../../domain/research/utils/costCalculator.js';
import type { LlmPricing } from '../../../../domain/research/ports/pricingRepository.js';
import type { TokenUsage } from '@intexuraos/llm-contract';

describe('calculateCost', () => {
  const basePricing: LlmPricing = {
    provider: 'anthropic',
    model: 'claude-3-opus',
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('calculates cost correctly for typical usage', () => {
    const cost = calculateCost(1000, 500, basePricing);
    // Input: 1000 tokens * $15/M = $0.015
    // Output: 500 tokens * $75/M = $0.0375
    // Total: $0.0525
    expect(cost).toBe(0.0525);
  });

  it('returns zero for zero tokens', () => {
    const cost = calculateCost(0, 0, basePricing);
    expect(cost).toBe(0);
  });

  it('handles large token counts', () => {
    const cost = calculateCost(1_000_000, 1_000_000, basePricing);
    // Input: 1M tokens * $15/M = $15
    // Output: 1M tokens * $75/M = $75
    // Total: $90
    expect(cost).toBe(90);
  });

  it('rounds to 6 decimal places', () => {
    const pricing: LlmPricing = {
      ...basePricing,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
    };
    const cost = calculateCost(333, 777, pricing);
    // Input: 333 * 0.15 / 1M = 0.00004995
    // Output: 777 * 0.60 / 1M = 0.0004662
    // Total: 0.00051615 -> rounded to 0.000516
    expect(cost).toBe(0.000516);
  });
});

describe('calculateAccurateCost', () => {
  describe('with providerCost', () => {
    it('returns providerCost directly when provided', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        providerCost: 0.05178,
      };
      const pricing: LlmPricing = {
        provider: 'perplexity',
        model: 'sonar-pro',
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const cost = calculateAccurateCost(usage, pricing);
      expect(cost).toBe(0.05178);
    });
  });

  describe('Anthropic cost calculation', () => {
    const anthropicPricing: LlmPricing = {
      provider: 'anthropic',
      model: 'claude-3-opus',
      inputPricePerMillion: 15,
      outputPricePerMillion: 75,
      webSearchCostPerCall: 0.01,
      cacheWriteMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('calculates basic cost without cache or search', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
      };

      const cost = calculateAccurateCost(usage, anthropicPricing);
      // Input: 1000 * $15/M = $0.015
      // Output: 500 * $75/M = $0.0375
      expect(cost).toBe(0.0525);
    });

    it('accounts for cache read tokens with discount', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 400,
      };

      const cost = calculateAccurateCost(usage, anthropicPricing);
      // Regular input: (1000 - 400) * $15/M = $0.009
      // Cache read: 400 * $15/M * 0.1 = $0.0006
      // Output: 500 * $75/M = $0.0375
      expect(cost).toBe(0.0471);
    });

    it('accounts for cache creation tokens with premium', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
      };

      const cost = calculateAccurateCost(usage, anthropicPricing);
      // Regular input: 1000 * $15/M = $0.015
      // Cache creation: 200 * $15/M * 1.25 = $0.00375
      // Output: 500 * $75/M = $0.0375
      expect(cost).toBe(0.05625);
    });

    it('adds web search cost per call', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        webSearchCalls: 3,
      };

      const cost = calculateAccurateCost(usage, anthropicPricing);
      // Input: 1000 * $15/M = $0.015
      // Output: 500 * $75/M = $0.0375
      // Web search: 3 * $0.01 = $0.03
      expect(cost).toBe(0.0825);
    });
  });

  describe('OpenAI cost calculation', () => {
    const openaiPricing: LlmPricing = {
      provider: 'openai',
      model: 'gpt-4',
      inputPricePerMillion: 10,
      outputPricePerMillion: 30,
      webSearchCostPerCall: 0.01,
      cacheReadMultiplier: 0.25,
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('calculates basic cost without cache or search', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
      };

      const cost = calculateAccurateCost(usage, openaiPricing);
      // Input: 1000 * $10/M = $0.01
      // Output: 500 * $30/M = $0.015
      expect(cost).toBe(0.025);
    });

    it('accounts for cached tokens with discount', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 600,
      };

      const cost = calculateAccurateCost(usage, openaiPricing);
      // Regular input: (1000 - 600) * $10/M = $0.004
      // Cached: 600 * $10/M * 0.25 = $0.0015
      // Output: 500 * $30/M = $0.015
      expect(cost).toBe(0.0205);
    });

    it('adds web search cost per call', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        webSearchCalls: 2,
      };

      const cost = calculateAccurateCost(usage, openaiPricing);
      // Input: 1000 * $10/M = $0.01
      // Output: 500 * $30/M = $0.015
      // Web search: 2 * $0.01 = $0.02
      expect(cost).toBe(0.045);
    });
  });

  describe('Google cost calculation', () => {
    const googlePricing: LlmPricing = {
      provider: 'google',
      model: 'gemini-pro',
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 5,
      groundingCostPerRequest: 0.035,
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('calculates basic cost without grounding', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
      };

      const cost = calculateAccurateCost(usage, googlePricing);
      // Input: 1000 * $1.25/M = $0.00125
      // Output: 500 * $5/M = $0.0025
      expect(cost).toBe(0.00375);
    });

    it('adds grounding cost when enabled', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        groundingEnabled: true,
      };

      const cost = calculateAccurateCost(usage, googlePricing);
      // Input: 1000 * $1.25/M = $0.00125
      // Output: 500 * $5/M = $0.0025
      // Grounding: $0.035
      expect(cost).toBe(0.03875);
    });
  });

  describe('default fallback', () => {
    it('uses basic calculation for unknown provider', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
      };
      const pricing: LlmPricing = {
        provider: 'perplexity',
        model: 'sonar-pro',
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const cost = calculateAccurateCost(usage, pricing);
      // Input: 1000 * $3/M = $0.003
      // Output: 500 * $15/M = $0.0075
      expect(cost).toBe(0.0105);
    });
  });

  describe('default multipliers when not provided in pricing', () => {
    it('uses default cache multipliers for Anthropic when not specified', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 400,
        cacheCreationTokens: 200,
        webSearchCalls: 1,
      };
      const pricing: LlmPricing = {
        provider: 'anthropic',
        model: 'claude-3-opus',
        inputPricePerMillion: 15,
        outputPricePerMillion: 75,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const cost = calculateAccurateCost(usage, pricing);
      // Regular input: (1000 - 400) * $15/M = $0.009
      // Cache read: 400 * $15/M * 0.1 (default) = $0.0006
      // Cache creation: 200 * $15/M * 1.25 (default) = $0.00375
      // Output: 500 * $75/M = $0.0375
      // Web search: 1 * $0.01 (default) = $0.01
      expect(cost).toBe(0.06085);
    });

    it('uses default cache multiplier for OpenAI when not specified', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 600,
        webSearchCalls: 1,
      };
      const pricing: LlmPricing = {
        provider: 'openai',
        model: 'gpt-4',
        inputPricePerMillion: 10,
        outputPricePerMillion: 30,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const cost = calculateAccurateCost(usage, pricing);
      // Regular input: (1000 - 600) * $10/M = $0.004
      // Cached: 600 * $10/M * 0.25 (default) = $0.0015
      // Output: 500 * $30/M = $0.015
      // Web search: 1 * $0.01 (default) = $0.01
      expect(cost).toBe(0.0305);
    });

    it('uses default grounding cost for Google when not specified', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        groundingEnabled: true,
      };
      const pricing: LlmPricing = {
        provider: 'google',
        model: 'gemini-pro',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 5,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const cost = calculateAccurateCost(usage, pricing);
      // Input: 1000 * $1.25/M = $0.00125
      // Output: 500 * $5/M = $0.0025
      // Grounding: $0.035 (default)
      expect(cost).toBe(0.03875);
    });
  });
});
