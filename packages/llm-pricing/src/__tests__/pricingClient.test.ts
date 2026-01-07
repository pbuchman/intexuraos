import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderPricing } from '@intexuraos/llm-contract';
import { PricingContext, createPricingContext, fetchAllPricing, type AllPricingResponse } from '../pricingClient.js';

describe('pricingClient', () => {
  const mockGooglePricing: ProviderPricing = {
    provider: 'google',
    models: {
      'gemini-2.5-pro': {
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        groundingCostPerRequest: 0.035,
      },
      'gemini-2.5-flash': {
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
        groundingCostPerRequest: 0.035,
      },
      'gemini-2.0-flash': {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
        groundingCostPerRequest: 0.035,
      },
      'gemini-2.5-flash-image': {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.03 },
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockOpenaiPricing: ProviderPricing = {
    provider: 'openai',
    models: {
      'o4-mini-deep-research': {
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 8.0,
        cacheReadMultiplier: 0.25,
        webSearchCostPerCall: 0.01,
      },
      'gpt-5.2': {
        inputPricePerMillion: 1.75,
        outputPricePerMillion: 14.0,
        cacheReadMultiplier: 0.1,
      },
      'gpt-4o-mini': {
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
        cacheReadMultiplier: 0.5,
      },
      'gpt-image-1': {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.04 },
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockAnthropicPricing: ProviderPricing = {
    provider: 'anthropic',
    models: {
      'claude-opus-4-5-20251101': {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      },
      'claude-sonnet-4-5-20250929': {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
        webSearchCostPerCall: 0.03,
      },
      'claude-3-5-haiku-20241022': {
        inputPricePerMillion: 0.8,
        outputPricePerMillion: 4.0,
        cacheReadMultiplier: 0.1,
        cacheWriteMultiplier: 1.25,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockPerplexityPricing: ProviderPricing = {
    provider: 'perplexity',
    models: {
      sonar: {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 1.0,
        useProviderCost: true,
      },
      'sonar-pro': {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        useProviderCost: true,
      },
      'sonar-deep-research': {
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 8.0,
        useProviderCost: true,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const completeAllPricing: AllPricingResponse = {
    google: mockGooglePricing,
    openai: mockOpenaiPricing,
    anthropic: mockAnthropicPricing,
    perplexity: mockPerplexityPricing,
  };

  describe('fetchAllPricing', () => {
    const mockBaseUrl = 'http://localhost:3000';
    const mockAuthToken = 'test-auth-token';

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns pricing data on successful response', async () => {
      const mockResponse = {
        success: true,
        data: completeAllPricing,
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toEqual(completeAllPricing.google);
        expect(result.value.openai).toEqual(completeAllPricing.openai);
      }

      expect(fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/internal/settings/pricing`,
        { headers: { 'X-Internal-Auth': mockAuthToken } }
      );
    });

    it('returns API_ERROR when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 500');
        expect(result.error.message).toContain('Internal Server Error');
      }
    });

    it('returns API_ERROR when response body read fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => { throw new Error('Body read failed'); },
      } as unknown as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 404');
      }
    });

    it('returns API_ERROR when success is false', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Response success is false');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toBe('Network error');
      }
    });

    it('returns API_ERROR with empty body when response text is empty', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => '',
      } as Response);

      const result = await fetchAllPricing(mockBaseUrl, mockAuthToken);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 503');
      }
    });
  });

  describe('PricingContext', () => {
    it('stores pricing from all providers', () => {
      const context = new PricingContext(completeAllPricing);

      expect(context.hasPricing('gemini-2.5-pro')).toBe(true);
      expect(context.hasPricing('gpt-5.2')).toBe(true);
      expect(context.hasPricing('claude-opus-4-5-20251101')).toBe(true);
      expect(context.hasPricing('sonar-pro')).toBe(true);
    });

    it('returns correct pricing for a model', () => {
      const context = new PricingContext(completeAllPricing);

      const pricing = context.getPricing('gemini-2.5-pro');
      expect(pricing.inputPricePerMillion).toBe(1.25);
      expect(pricing.outputPricePerMillion).toBe(10.0);
      expect(pricing.groundingCostPerRequest).toBe(0.035);
    });

    it('throws when getting pricing for unknown model', () => {
      const context = new PricingContext(completeAllPricing);

      expect(() => context.getPricing('unknown-model' as 'gemini-2.5-pro')).toThrow('Pricing not found');
    });

    it('validates that specified models have pricing', () => {
      const context = new PricingContext(completeAllPricing);

      expect(() =>
        context.validateModels(['gemini-2.5-pro', 'gpt-5.2'])
      ).not.toThrow();
    });

    it('throws when validating models with missing pricing', () => {
      const incompletePricing: AllPricingResponse = {
        google: mockGooglePricing,
        openai: { provider: 'openai', models: {}, updatedAt: '' },
        anthropic: mockAnthropicPricing,
        perplexity: mockPerplexityPricing,
      };
      const context = new PricingContext(incompletePricing);

      expect(() => context.validateModels(['gemini-2.5-pro', 'gpt-5.2'])).toThrow(
        'Missing pricing for models: gpt-5.2'
      );
    });

    it('returns all models with pricing', () => {
      const context = new PricingContext(completeAllPricing);

      const models = context.getModelsWithPricing();
      expect(models).toHaveLength(14);
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gpt-5.2');
    });

    it('validateAllModels passes when all models have pricing', () => {
      const context = new PricingContext(completeAllPricing);

      expect(() => context.validateAllModels()).not.toThrow();
    });

    it('validateAllModels throws when models are missing', () => {
      const incompletePricing: AllPricingResponse = {
        google: mockGooglePricing,
        openai: { provider: 'openai', models: {}, updatedAt: '' },
        anthropic: mockAnthropicPricing,
        perplexity: mockPerplexityPricing,
      };
      const context = new PricingContext(incompletePricing);

      expect(() => context.validateAllModels()).toThrow('Missing pricing for models');
    });
  });

  describe('createPricingContext', () => {
    it('creates context and validates all models by default', () => {
      expect(() => createPricingContext(completeAllPricing)).not.toThrow();
    });

    it('throws if any model is missing pricing', () => {
      const incompletePricing: AllPricingResponse = {
        google: { provider: 'google', models: {}, updatedAt: '' },
        openai: mockOpenaiPricing,
        anthropic: mockAnthropicPricing,
        perplexity: mockPerplexityPricing,
      };

      expect(() => createPricingContext(incompletePricing)).toThrow('Missing pricing for models');
    });

    it('validates only specified models when provided', () => {
      const geminiFlashPricing = mockGooglePricing.models['gemini-2.5-flash'];
      if (geminiFlashPricing === undefined) {
        throw new Error('Test setup error: gemini-2.5-flash pricing missing');
      }
      const partialPricing: AllPricingResponse = {
        google: {
          provider: 'google',
          models: {
            'gemini-2.5-flash': geminiFlashPricing,
          },
          updatedAt: '',
        },
        openai: { provider: 'openai', models: {}, updatedAt: '' },
        anthropic: { provider: 'anthropic', models: {}, updatedAt: '' },
        perplexity: { provider: 'perplexity', models: {}, updatedAt: '' },
      };

      // Should not throw when only validating gemini-2.5-flash
      expect(() =>
        createPricingContext(partialPricing, ['gemini-2.5-flash'])
      ).not.toThrow();
    });
  });
});

