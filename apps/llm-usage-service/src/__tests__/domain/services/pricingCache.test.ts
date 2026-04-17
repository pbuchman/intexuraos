import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmProviders, LlmModels } from '@intexuraos/llm-contract';
import type { ProviderPricing } from '@intexuraos/llm-contract';
import { createPricingCache } from '../../../domain/services/pricingCache.js';
import { FakePricingRepository } from '../../fakePricingRepository.js';

const mockAnthropicPricing: ProviderPricing = {
  provider: LlmProviders.Anthropic,
  models: {
    'claude-sonnet-4-20250514': {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockGooglePricing: ProviderPricing = {
  provider: LlmProviders.Google,
  models: {
    [LlmModels.Gemini25Pro]: {
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 10.0,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockOpenaiPricing: ProviderPricing = {
  provider: LlmProviders.OpenAI,
  models: {},
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockPerplexityPricing: ProviderPricing = {
  provider: LlmProviders.Perplexity,
  models: {},
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockOpenRouterPricing: ProviderPricing = {
  provider: LlmProviders.OpenRouter,
  models: {},
  updatedAt: '2026-04-10T12:00:00Z',
};

function populateRepo(repo: FakePricingRepository): void {
  repo.byProvider.set(LlmProviders.Anthropic, mockAnthropicPricing);
  repo.byProvider.set(LlmProviders.Google, mockGooglePricing);
  repo.byProvider.set(LlmProviders.OpenAI, mockOpenaiPricing);
  repo.byProvider.set(LlmProviders.Perplexity, mockPerplexityPricing);
  repo.byProvider.set(LlmProviders.OpenRouter, mockOpenRouterPricing);
}

describe('pricingCache', () => {
  let repo: FakePricingRepository;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

  beforeEach(() => {
    repo = new FakePricingRepository();
    populateRepo(repo);
  });

  it('returns model pricing on first access (loads from repo)', async () => {
    const cache = createPricingCache(repo);

    const pricing = await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);

    expect(pricing).not.toBeNull();
    expect(pricing?.inputPricePerMillion).toBe(3.0);
    expect(pricing?.outputPricePerMillion).toBe(15.0);
  });

  it('returns null for unknown model', async () => {
    const cache = createPricingCache(repo);

    const pricing = await cache.getModelPricing(LlmProviders.Anthropic, 'unknown-model', logger);

    expect(pricing).toBeNull();
  });

  it('caches data and does not call repo on subsequent access within TTL', async () => {
    const getAllSpy = vi.spyOn(repo, 'getAll');
    const cache = createPricingCache(repo, 60_000);

    await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);
    await cache.getModelPricing(LlmProviders.Google, LlmModels.Gemini25Pro, logger);

    expect(getAllSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads from repo after TTL expires', async () => {
    const getAllSpy = vi.spyOn(repo, 'getAll');
    // Use a very short TTL
    const cache = createPricingCache(repo, 1);

    await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);
    expect(getAllSpy).toHaveBeenCalledTimes(1);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 5));

    await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);
    expect(getAllSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidate() forces reload on next access', async () => {
    const getAllSpy = vi.spyOn(repo, 'getAll');
    const cache = createPricingCache(repo, 60_000);

    await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);
    expect(getAllSpy).toHaveBeenCalledTimes(1);

    cache.invalidate();

    await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);
    expect(getAllSpy).toHaveBeenCalledTimes(2);
  });

  it('concurrent calls trigger only one repo fetch', async () => {
    const getAllSpy = vi.spyOn(repo, 'getAll');
    const cache = createPricingCache(repo, 60_000);

    // Fire multiple concurrent requests
    const [r1, r2, r3] = await Promise.all([
      cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger),
      cache.getModelPricing(LlmProviders.Google, LlmModels.Gemini25Pro, logger),
      cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger),
    ]);

    expect(getAllSpy).toHaveBeenCalledTimes(1);
    expect(r1?.inputPricePerMillion).toBe(3.0);
    expect(r2?.inputPricePerMillion).toBe(1.25);
    expect(r3?.inputPricePerMillion).toBe(3.0);
  });

  it('propagates repo errors and allows retry', async () => {
    const failingRepo = new FakePricingRepository();
    // Don't populate — getAll() will throw because providers are missing
    const cache = createPricingCache(failingRepo, 60_000);

    await expect(
      cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger),
    ).rejects.toThrow();

    // After failure, next call should retry (loadingPromise cleared)
    populateRepo(failingRepo);
    const pricing = await cache.getModelPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', logger);
    expect(pricing?.inputPricePerMillion).toBe(3.0);
  });
});
