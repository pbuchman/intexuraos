import type { LlmProvider, ModelPricing } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { PricingCache } from '../domain/services/pricingCache.js';

/**
 * In-memory fake for PricingCache, used in tests.
 *
 * Callers seed pricing via `setPricing(provider, model, pricing)` and the cache
 * returns it immediately without any TTL behavior.
 */
export class FakePricingCache implements PricingCache {
  private readonly data = new Map<string, ModelPricing>();

  private makeKey(provider: LlmProvider, model: string): string {
    return `${provider}::${model}`;
  }

  setPricing(provider: LlmProvider, model: string, pricing: ModelPricing): void {
    this.data.set(this.makeKey(provider, model), pricing);
  }

  async getModelPricing(provider: LlmProvider, model: string, _logger: Logger): Promise<ModelPricing | null> {
    return this.data.get(this.makeKey(provider, model)) ?? null;
  }

  invalidate(): void {
    this.data.clear();
  }
}
