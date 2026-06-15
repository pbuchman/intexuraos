import { describe, it, expect } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { IntexuraOSError } from '@intexuraos/common-core';
import { calculateCost, type UsageTokens } from '../../../domain/services/costCalculation.js';

function makeUsage(overrides?: Partial<UsageTokens>): UsageTokens {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    webSearchCalls: 0,
    groundingEnabled: false,
    imageCount: 0,
    ...overrides,
  };
}

function makePricing(overrides?: Partial<ModelPricing>): ModelPricing {
  return {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    ...overrides,
  };
}

describe('calculateCost', () => {
  // =========================================================================
  // Anthropic
  // =========================================================================
  describe('anthropic', () => {
    it('calculates basic input/output cost', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500 });
      const pricing = makePricing({
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      });
      // regularCost = 1000 * 3 = 3000
      // outputCost = 500 * 15 = 7500
      // total = (3000 + 7500) / 1_000_000 = 0.0105
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0.0105);
    });

    it('applies cache read multiplier (default 0.1)', () => {
      const usage = makeUsage({ inputTokens: 1000, cacheReadTokens: 2000, outputTokens: 0 });
      const pricing = makePricing({ inputPricePerMillion: 10.0, outputPricePerMillion: 0 });
      // regularCost = 1000 * 10 = 10000
      // readCost = 2000 * 10 * 0.1 = 2000
      // total = 12000 / 1_000_000 = 0.012
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0.012);
    });

    it('applies custom cache read multiplier from pricing', () => {
      const usage = makeUsage({ inputTokens: 0, cacheReadTokens: 1000, outputTokens: 0 });
      const pricing = makePricing({
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 0,
        cacheReadMultiplier: 0.2,
      });
      // readCost = 1000 * 10 * 0.2 = 2000
      // total = 2000 / 1_000_000 = 0.002
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0.002);
    });

    it('applies cache write multiplier (default 1.25)', () => {
      const usage = makeUsage({ inputTokens: 0, cacheWriteTokens: 1000, outputTokens: 0 });
      const pricing = makePricing({ inputPricePerMillion: 10.0, outputPricePerMillion: 0 });
      // writeCost = 1000 * 10 * 1.25 = 12500
      // total = 12500 / 1_000_000 = 0.0125
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0.0125);
    });

    it('applies custom cache write multiplier from pricing', () => {
      const usage = makeUsage({ inputTokens: 0, cacheWriteTokens: 1000, outputTokens: 0 });
      const pricing = makePricing({
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 0,
        cacheWriteMultiplier: 1.5,
      });
      // writeCost = 1000 * 10 * 1.5 = 15000
      // total = 15000 / 1_000_000 = 0.015
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0.015);
    });

    it('includes web search cost', () => {
      const usage = makeUsage({ inputTokens: 0, outputTokens: 0, webSearchCalls: 2 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        webSearchCostPerCall: 0.005,
      });
      // searchCostScaled = 2 * 0.005 * 1_000_000 = 10000
      // total = 10000 / 1_000_000 = 0.01
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0.01);
    });

    it('returns 0 for zero usage', () => {
      const usage = makeUsage();
      const pricing = makePricing();
      expect(calculateCost(LlmProviders.Anthropic, usage, pricing)).toBe(0);
    });
  });

  // =========================================================================
  // Google
  // =========================================================================
  describe('google', () => {
    it('calculates basic input/output cost', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500 });
      const pricing = makePricing({
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
      });
      // inputCost = 1000 * 1.25 = 1250
      // outputCost = 500 * 10 = 5000
      // total = 6250 / 1_000_000 = 0.00625
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.00625);
    });

    it('includes thinking tokens at output price', () => {
      const usage = makeUsage({ inputTokens: 0, outputTokens: 100, thinkingTokens: 500 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 10.0,
      });
      // outputCost = 100 * 10 = 1000
      // thinkingCost = 500 * 10 = 5000
      // total = 6000 / 1_000_000 = 0.006
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.006);
    });

    it('includes grounding cost when enabled', () => {
      const usage = makeUsage({ inputTokens: 0, outputTokens: 0, groundingEnabled: true });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        groundingCostPerRequest: 0.035,
      });
      // groundingCostScaled = 0.035 * 1_000_000 = 35000
      // total = 35000 / 1_000_000 = 0.035
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.035);
    });

    it('does not include grounding cost when disabled', () => {
      const usage = makeUsage({ inputTokens: 100, outputTokens: 100, groundingEnabled: false });
      const pricing = makePricing({
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 1.0,
        groundingCostPerRequest: 0.035,
      });
      // inputCost = 100, outputCost = 100
      // total = 200 / 1_000_000 = 0.0002
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.0002);
    });

    it('returns 0 for zero usage', () => {
      const usage = makeUsage();
      const pricing = makePricing({ inputPricePerMillion: 0, outputPricePerMillion: 0 });
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0);
    });

    it('includes image cost when imageCount > 0 and imagePricing is set', () => {
      const usage = makeUsage({ imageCount: 2 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
      });
      // imageCost = 2 * 0.04 = 0.08
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.08);
    });

    it('uses imageSize when pricing an image generation event', () => {
      const usage = makeUsage({ imageCount: 2, imageSize: '1536x1024' });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
      });

      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.16);
    });

    it('returns 0 image cost when imagePricing is undefined', () => {
      const usage = makeUsage({ imageCount: 3 });
      const pricing = makePricing({ inputPricePerMillion: 0, outputPricePerMillion: 0 });
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0);
    });

    it('adds image cost to token cost', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500, imageCount: 1 });
      const pricing = makePricing({
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        imagePricing: { '1024x1024': 0.03 },
      });
      // tokenCost = (1000*1.25 + 500*10) / 1_000_000 = 6250/1_000_000 = 0.00625
      // imageCost = 1 * 0.03 = 0.03
      // total = 0.03625
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0.03625);
    });

    it('returns 0 image cost when imagePricing has no default size entry', () => {
      const usage = makeUsage({ imageCount: 2 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1536x1024': 0.08 },
      });
      // Default size 1024x1024 is not in imagePricing → perImagePrice = 0
      expect(calculateCost(LlmProviders.Google, usage, pricing)).toBe(0);
    });
  });

  // =========================================================================
  // OpenAI
  // =========================================================================
  describe('openai', () => {
    it('calculates basic input/output cost', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500 });
      const pricing = makePricing({
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
      });
      // regularInputCost = 1000 * 2.5 = 2500
      // outputCost = 500 * 10 = 5000
      // total = 7500 / 1_000_000 = 0.0075
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.0075);
    });

    it('applies cached token discount (default 0.5)', () => {
      const usage = makeUsage({ inputTokens: 1000, cachedTokens: 400, outputTokens: 0 });
      const pricing = makePricing({
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 0,
      });
      // regularInput = max(0, 1000 - 400) = 600
      // regularCost = 600 * 10 = 6000
      // cachedCost = 400 * 10 * 0.5 = 2000
      // total = 8000 / 1_000_000 = 0.008
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.008);
    });

    it('applies custom cache multiplier from pricing', () => {
      const usage = makeUsage({ inputTokens: 1000, cachedTokens: 500, outputTokens: 0 });
      const pricing = makePricing({
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 0,
        cacheReadMultiplier: 0.25,
      });
      // regularInput = max(0, 1000 - 500) = 500
      // regularCost = 500 * 10 = 5000
      // cachedCost = 500 * 10 * 0.25 = 1250
      // total = 6250 / 1_000_000 = 0.00625
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.00625);
    });

    it('clamps regularInput to 0 if cachedTokens > inputTokens', () => {
      const usage = makeUsage({ inputTokens: 100, cachedTokens: 200, outputTokens: 0 });
      const pricing = makePricing({
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 0,
      });
      // regularInput = max(0, 100 - 200) = 0
      // cachedCost = 200 * 10 * 0.5 = 1000
      // total = 1000 / 1_000_000 = 0.001
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.001);
    });

    it('includes web search cost', () => {
      const usage = makeUsage({ inputTokens: 0, outputTokens: 0, webSearchCalls: 3 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        webSearchCostPerCall: 0.0025,
      });
      // searchCostScaled = 3 * 0.0025 * 1_000_000 = 7500
      // total = 7500 / 1_000_000 = 0.0075
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.0075);
    });

    it('returns 0 for zero usage', () => {
      const usage = makeUsage();
      const pricing = makePricing({ inputPricePerMillion: 0, outputPricePerMillion: 0 });
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0);
    });

    it('includes image cost when imageCount > 0 and imagePricing is set', () => {
      const usage = makeUsage({ imageCount: 3 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
      });
      // imageCost = 3 * 0.04 = 0.12
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.12);
    });

    it('uses imageSize when pricing OpenAI image generation', () => {
      const usage = makeUsage({ imageCount: 1, imageSize: '1024x1536' });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.09 },
      });

      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.09);
    });

    it('adds image cost to token cost', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500, imageCount: 2 });
      const pricing = makePricing({
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        imagePricing: { '1024x1024': 0.04 },
      });
      // tokenCost = (1000*2.5 + 500*10) / 1_000_000 = 7500/1_000_000 = 0.0075
      // imageCost = 2 * 0.04 = 0.08
      // total = 0.0875
      expect(calculateCost(LlmProviders.OpenAI, usage, pricing)).toBe(0.0875);
    });
  });

  // =========================================================================
  // Perplexity
  // =========================================================================
  describe('perplexity', () => {
    it('calculates token-based cost with request fee', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500, webSearchCalls: 1 });
      const pricing = makePricing({
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 1.0,
        webSearchCostPerCall: 0.005,
      });
      // inputCost = 1000 * 1 = 1000
      // outputCost = 500 * 1 = 500
      // requestCostScaled = 1 * 0.005 * 1_000_000 = 5000
      // total = 6500 / 1_000_000 = 0.0065
      expect(calculateCost(LlmProviders.Perplexity, usage, pricing)).toBe(0.0065);
    });

    it('defaults webSearchCalls to 1 for request fee', () => {
      const usage = makeUsage({ inputTokens: 0, outputTokens: 0, webSearchCalls: 0 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        webSearchCostPerCall: 0.005,
      });
      // requests = max(webSearchCalls, 1) = 1 (Perplexity always charges at least 1 request)
      // requestCostScaled = 1 * 0.005 * 1_000_000 = 5000
      // total = 5000 / 1_000_000 = 0.005
      expect(calculateCost(LlmProviders.Perplexity, usage, pricing)).toBe(0.005);
    });

    it('uses multiple webSearchCalls when > 0', () => {
      const usage = makeUsage({ inputTokens: 0, outputTokens: 0, webSearchCalls: 3 });
      const pricing = makePricing({
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        webSearchCostPerCall: 0.005,
      });
      // requests = 3 (> 0 so use actual value)
      // requestCostScaled = 3 * 0.005 * 1_000_000 = 15000
      // total = 15000 / 1_000_000 = 0.015
      expect(calculateCost(LlmProviders.Perplexity, usage, pricing)).toBe(0.015);
    });

    it('returns 0 when no request fee and no tokens', () => {
      const usage = makeUsage();
      const pricing = makePricing({ inputPricePerMillion: 0, outputPricePerMillion: 0 });
      // requests defaults to 1, but requestFee is 0
      expect(calculateCost(LlmProviders.Perplexity, usage, pricing)).toBe(0);
    });
  });

  // =========================================================================
  // OpenRouter
  // =========================================================================
  describe('openrouter', () => {
    it('calculates token-based cost with per-million prices', () => {
      const usage = makeUsage({ inputTokens: 1000, outputTokens: 500 });
      const pricing = makePricing({
        inputPricePerMillion: 0.26,
        outputPricePerMillion: 1.56,
      });
      // inputCost = 1000 * (0.26 / 1_000_000) = 0.00026
      // outputCost = 500 * (1.56 / 1_000_000) = 0.00078
      // total = round((0.00026 + 0.00078) * 1_000_000) / 1_000_000
      //       = round(1040) / 1_000_000 = 0.00104
      expect(calculateCost(LlmProviders.OpenRouter, usage, pricing)).toBe(0.00104);
    });

    it('returns 0 for zero usage', () => {
      const usage = makeUsage();
      const pricing = makePricing({ inputPricePerMillion: 0, outputPricePerMillion: 0 });
      expect(calculateCost(LlmProviders.OpenRouter, usage, pricing)).toBe(0);
    });
  });

  // =========================================================================
  // Unknown provider
  // =========================================================================
  describe('unknown provider', () => {
    it('throws for unsupported provider', () => {
      const usage = makeUsage();
      const pricing = makePricing();
      expect(() =>
        calculateCost('unknown' as never, usage, pricing)
      ).toThrow('Unsupported provider: unknown');
    });

    it('throws IntexuraOSError with INTERNAL_ERROR/500 for unsupported provider', () => {
      const usage = makeUsage();
      const pricing = makePricing();
      try {
        calculateCost('unknown' as never, usage, pricing);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(IntexuraOSError);
        expect((e as IntexuraOSError).code).toBe('INTERNAL_ERROR');
        expect((e as IntexuraOSError).httpStatus).toBe(500);
      }
    });
  });
});
