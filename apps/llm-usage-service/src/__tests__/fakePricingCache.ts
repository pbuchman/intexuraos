import { LlmProviders, type LlmProvider, type ModelPricing } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { PricingCache } from '../domain/services/pricingCache.js';

/**
 * In-memory fake for PricingCache, used in tests.
 *
 * Callers seed pricing via `setPricing(provider, model, pricing)` and the cache
 * returns it immediately without any TTL behavior.
 *
 * The constructor seeds the default test fixture model
 * (`anthropic/claude-sonnet-4-20250514`) so that route-level tests using the
 * default `createTestEventInput()` payload do not trip the dev-mode unknown-model
 * fail-fast in `ingestUsageEvents`. Tests that need a different model must call
 * `setPricing` explicitly, and tests covering the unknown-model branch should
 * use a model that has not been seeded.
 */
export class FakePricingCache implements PricingCache {
  private readonly data = new Map<string, ModelPricing>();

  constructor() {
    // Seed the default fixture model so tests that don't care about pricing
    // don't need to wire it up (and don't trip the unknown-model fail-fast).
    this.setPricing(LlmProviders.Anthropic, 'claude-sonnet-4-20250514', {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    });
  }

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
