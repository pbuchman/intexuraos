/**
 * Tests for PricingClient - HTTP client for fetching pricing from app-settings-service.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { ProviderPricing } from '@intexuraos/llm-contract';
import { PricingClient, createPricingClient } from '../../../infra/pricing/PricingClient.js';

describe('PricingClient', () => {
  const baseUrl = 'http://app-settings-service.local';
  const internalAuthToken = 'test-internal-token';

  const mockOpenAIPricing: ProviderPricing = {
    provider: 'openai',
    models: {
      'gpt-4o': {
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        cacheReadMultiplier: 0.5,
      },
      'gpt-4o-mini': {
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
      },
    },
    updatedAt: '2025-01-01T00:00:00Z',
  };

  const mockGooglePricing: ProviderPricing = {
    provider: 'google',
    models: {
      'gemini-2.5-flash': {
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
        groundingCostPerRequest: 0.035,
      },
    },
    updatedAt: '2025-01-01T00:00:00Z',
  };

  let client: PricingClient;

  beforeEach(() => {
    nock.cleanAll();
    client = createPricingClient({ baseUrl, internalAuthToken });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getForProvider', () => {
    it('returns pricing for provider on success', async () => {
      nock(baseUrl)
        .get('/internal/settings/pricing/openai')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, mockOpenAIPricing);

      const result = await client.getForProvider('openai');

      expect(result).toEqual(mockOpenAIPricing);
    });

    it('returns null when provider not found (404)', async () => {
      nock(baseUrl)
        .get('/internal/settings/pricing/perplexity')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(404);

      const result = await client.getForProvider('perplexity');

      expect(result).toBeNull();
    });

    it('returns null on non-404 error response without cache', async () => {
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(500, 'Internal Server Error');

      // Without cache, should return null on error
      const result = await client.getForProvider('openai');

      expect(result).toBeNull();
    });

    it('caches pricing and returns cached data on subsequent calls', async () => {
      const scope = nock(baseUrl)
        .get('/internal/settings/pricing/openai')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, mockOpenAIPricing);

      // First call - hits the API
      const result1 = await client.getForProvider('openai');
      expect(result1).toEqual(mockOpenAIPricing);
      expect(scope.isDone()).toBe(true);

      // Second call - should use cache, not hit API again
      const result2 = await client.getForProvider('openai');
      expect(result2).toEqual(mockOpenAIPricing);
    });

    it('returns expired cache data on network error', async () => {
      // First call - populate cache
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, mockOpenAIPricing);

      await client.getForProvider('openai');

      // Manually expire cache by manipulating time
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes - past 5 min TTL

      // Second call with network error - should return expired cache
      nock(baseUrl).get('/internal/settings/pricing/openai').replyWithError('Connection refused');

      const result = await client.getForProvider('openai');

      expect(result).toEqual(mockOpenAIPricing);

      vi.useRealTimers();
    });

    it('fetches fresh data after cache expires', async () => {
      const updatedPricing: ProviderPricing = {
        ...mockOpenAIPricing,
        updatedAt: '2025-01-02T00:00:00Z',
      };

      // First call
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, mockOpenAIPricing);

      await client.getForProvider('openai');

      // Advance time past TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Second call after expiry - should fetch fresh data
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, updatedPricing);

      const result = await client.getForProvider('openai');

      expect(result).toEqual(updatedPricing);

      vi.useRealTimers();
    });

    it('caches different providers separately', async () => {
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, mockOpenAIPricing);

      nock(baseUrl).get('/internal/settings/pricing/google').reply(200, mockGooglePricing);

      const openaiResult = await client.getForProvider('openai');
      const googleResult = await client.getForProvider('google');

      expect(openaiResult).toEqual(mockOpenAIPricing);
      expect(googleResult).toEqual(mockGooglePricing);
    });
  });

  describe('getModelPricing', () => {
    it('returns pricing for specific model', async () => {
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, mockOpenAIPricing);

      const result = await client.getModelPricing('openai', 'gpt-4o');

      expect(result).toEqual({
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
        cacheReadMultiplier: 0.5,
      });
    });

    it('returns null when provider not found', async () => {
      nock(baseUrl).get('/internal/settings/pricing/perplexity').reply(404);

      const result = await client.getModelPricing('perplexity', 'sonar-pro');

      expect(result).toBeNull();
    });

    it('returns null when model not found in provider', async () => {
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, mockOpenAIPricing);

      const result = await client.getModelPricing('openai', 'gpt-5');

      expect(result).toBeNull();
    });

    it('uses cached provider data for model lookups', async () => {
      const scope = nock(baseUrl)
        .get('/internal/settings/pricing/openai')
        .reply(200, mockOpenAIPricing);

      // First model lookup
      const result1 = await client.getModelPricing('openai', 'gpt-4o');
      expect(result1).not.toBeNull();
      expect(scope.isDone()).toBe(true);

      // Second model lookup for different model - should use cache
      const result2 = await client.getModelPricing('openai', 'gpt-4o-mini');
      expect(result2).toEqual({
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
      });
    });
  });

  describe('clearCache', () => {
    it('clears the cache and forces fresh fetch', async () => {
      // First call - populate cache
      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, mockOpenAIPricing);

      await client.getForProvider('openai');

      // Clear cache
      client.clearCache();

      // Next call should hit API again
      const updatedPricing: ProviderPricing = {
        ...mockOpenAIPricing,
        updatedAt: '2025-01-02T00:00:00Z',
      };

      nock(baseUrl).get('/internal/settings/pricing/openai').reply(200, updatedPricing);

      const result = await client.getForProvider('openai');

      expect(result).toEqual(updatedPricing);
    });
  });

  describe('createPricingClient', () => {
    it('creates a new PricingClient instance', () => {
      const instance = createPricingClient({ baseUrl, internalAuthToken });

      expect(instance).toBeInstanceOf(PricingClient);
    });
  });
});
