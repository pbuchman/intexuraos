import type { LlmProvider, ProviderPricing, ModelPricing } from '@intexuraos/llm-contract';
import type { PricingRepository } from '../repositories/pricingRepository.js';
import type { Logger } from '@intexuraos/common-core';

export interface PricingCache {
  getModelPricing(provider: LlmProvider, model: string, logger: Logger): Promise<ModelPricing | null>;
  invalidate(): void;
}

const DEFAULT_TTL_MS = 300_000; // 5 minutes

export function createPricingCache(repo: PricingRepository, ttlMs?: number): PricingCache {
  const effectiveTtl = ttlMs ?? DEFAULT_TTL_MS;
  let cache: Record<LlmProvider, ProviderPricing> | null = null;
  let loadedAt = 0;
  let loadingPromise: Promise<Record<LlmProvider, ProviderPricing>> | null = null;

  async function ensureLoaded(logger: Logger): Promise<Record<LlmProvider, ProviderPricing>> {
    const now = Date.now();
    if (cache !== null && now - loadedAt < effectiveTtl) {
      return cache;
    }

    // Thread-safe: if a reload is already in progress, reuse it
    if (loadingPromise !== null) {
      return await loadingPromise;
    }

    loadingPromise = repo.getAll().then((data) => {
      cache = data;
      loadedAt = Date.now();
      loadingPromise = null;
      return data;
    }).catch((error: unknown) => {
      loadingPromise = null;
      logger.error({ error }, 'Failed to load pricing data');
      throw error;
    });

    return await loadingPromise;
  }

  return {
    async getModelPricing(provider: LlmProvider, model: string, logger: Logger): Promise<ModelPricing | null> {
      const allPricing = await ensureLoaded(logger);
      const providerPricing = allPricing[provider];
      const modelPricing = providerPricing.models[model];
      return modelPricing ?? null;
    },

    invalidate(): void {
      cache = null;
      loadedAt = 0;
    },
  };
}
