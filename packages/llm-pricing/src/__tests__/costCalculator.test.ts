import { describe, expect, it } from 'vitest';
import { calculateCost, calculateAccurateCost } from '../costCalculator.js';
import type { LlmPricing } from '../types.js';
import type { TokenUsage } from '@intexuraos/llm-contract';

describe('costCalculator', () => {
  describe('calculateCost', () => {
    it('calculates cost based on input and output tokens', () => {
      const pricing: LlmPricing = {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini20Flash,
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
        updatedAt: '2024-01-01',
      };

      const cost = calculateCost(1000, 500, pricing);
      expect(cost).toBe(0.0003);
    });

    it('rounds to 6 decimal places', () => {
      const pricing: LlmPricing = {
        provider: LlmProviders.OpenAI,
        model: 'gpt-4o',
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        updatedAt: '2024-01-01',
      };

      const cost = calculateCost(1234567, 987654, pricing);
      expect(cost).toBeCloseTo(12.962958, 6);
    });

    it('handles zero tokens', () => {
      const pricing: LlmPricing = {
        provider: LlmProviders.Anthropic,
        model: 'claude-3-sonnet',
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        updatedAt: '2024-01-01',
      };

      const cost = calculateCost(0, 0, pricing);
      expect(cost).toBe(0);
    });
  });

  describe('calculateAccurateCost', () => {
    it('returns providerCost when present', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        providerCost: 0.05,
      };
      const pricing: LlmPricing = {
        provider: LlmProviders.Perplexity,
        model: LlmModels.SonarPro,
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        updatedAt: '2024-01-01',
      };

      const cost = calculateAccurateCost(usage, pricing);
      expect(cost).toBe(0.05);
    });

    describe('anthropic provider', () => {
      const anthropicPricing: LlmPricing = {
        provider: LlmProviders.Anthropic,
        model: 'claude-3-5-sonnet',
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        updatedAt: '2024-01-01',
      };

      it('calculates cost with cache read tokens', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
        };

        const cost = calculateAccurateCost(usage, anthropicPricing);
        expect(cost).toBeGreaterThan(0);
      });

      it('calculates cost with cache creation tokens', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 300,
        };

        const cost = calculateAccurateCost(usage, anthropicPricing);
        expect(cost).toBeGreaterThan(0);
      });

      it('calculates cost with web search calls', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          webSearchCalls: 2,
        };

        const cost = calculateAccurateCost(usage, anthropicPricing);
        expect(cost).toBeGreaterThan(0.01);
      });

      it('uses custom multipliers when provided', () => {
        const customPricing: LlmPricing = {
          ...anthropicPricing,
          cacheReadMultiplier: 0.05,
          cacheWriteMultiplier: 1.5,
          webSearchCostPerCall: 0.03,
        };
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheCreationTokens: 100,
          webSearchCalls: 1,
        };

        const cost = calculateAccurateCost(usage, customPricing);
        expect(cost).toBeGreaterThan(0);
      });
    });

    describe('openai provider', () => {
      const openaiPricing: LlmPricing = {
        provider: LlmProviders.OpenAI,
        model: 'gpt-4o',
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        updatedAt: '2024-01-01',
      };

      it('calculates cost with cached tokens', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 300,
        };

        const cost = calculateAccurateCost(usage, openaiPricing);
        expect(cost).toBeGreaterThan(0);
      });

      it('calculates cost with web search calls', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          webSearchCalls: 3,
        };

        const cost = calculateAccurateCost(usage, openaiPricing);
        expect(cost).toBeGreaterThan(0.03);
      });

      it('uses custom cache multiplier when provided', () => {
        const customPricing: LlmPricing = {
          ...openaiPricing,
          cacheReadMultiplier: 0.5,
          webSearchCostPerCall: 0.025,
        };
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 400,
          webSearchCalls: 2,
        };

        const cost = calculateAccurateCost(usage, customPricing);
        expect(cost).toBeGreaterThan(0);
      });
    });

    describe('google provider', () => {
      const googlePricing: LlmPricing = {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini25Pro,
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        updatedAt: '2024-01-01',
      };

      it('calculates cost without grounding', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
        };

        const cost = calculateAccurateCost(usage, googlePricing);
        expect(cost).toBeGreaterThan(0);
        expect(cost).toBeLessThan(0.035);
      });

      it('calculates cost with grounding enabled', () => {
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          groundingEnabled: true,
        };

        const cost = calculateAccurateCost(usage, googlePricing);
        expect(cost).toBeGreaterThan(0.035);
      });

      it('uses custom grounding cost when provided', () => {
        const customPricing: LlmPricing = {
          ...googlePricing,
          groundingCostPerRequest: 0.05,
        };
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
          groundingEnabled: true,
        };

        const costWithCustom = calculateAccurateCost(usage, customPricing);
        const costWithDefault = calculateAccurateCost(usage, googlePricing);
        expect(costWithCustom).toBeGreaterThan(costWithDefault);
      });
    });

    describe('perplexity provider (default)', () => {
      it('calculates basic cost for perplexity', () => {
        const pricing: LlmPricing = {
          provider: LlmProviders.Perplexity,
          model: LlmModels.Sonar,
          inputPricePerMillion: 1.0,
          outputPricePerMillion: 1.0,
          updatedAt: '2024-01-01',
        };
        const usage: TokenUsage = {
          inputTokens: 1000,
          outputTokens: 500,
        };

        const cost = calculateAccurateCost(usage, pricing);
        expect(cost).toBe(0.0015);
      });
    });

    it('rounds result to 6 decimal places', () => {
      const pricing: LlmPricing = {
        provider: LlmProviders.Perplexity,
        model: LlmModels.Sonar,
        inputPricePerMillion: 1.111111,
        outputPricePerMillion: 2.222222,
        updatedAt: '2024-01-01',
      };
      const usage: TokenUsage = {
        inputTokens: 1234567,
        outputTokens: 987654,
      };

      const cost = calculateAccurateCost(usage, pricing);
      const decimalPlaces = cost.toString().split('.')[1]?.length ?? 0;
      expect(decimalPlaces).toBeLessThanOrEqual(6);
    });
  });
});
