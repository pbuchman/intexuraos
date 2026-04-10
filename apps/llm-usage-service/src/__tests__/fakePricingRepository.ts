import type { LlmProvider, ProviderPricing } from '@intexuraos/llm-contract';
import type { PricingRepository } from '../domain/repositories/pricingRepository.js';

export class FakePricingRepository implements PricingRepository {
  readonly byProvider = new Map<LlmProvider, ProviderPricing>();

  async getByProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    return this.byProvider.get(provider) ?? null;
  }

  async getAll(): Promise<Record<LlmProvider, ProviderPricing>> {
    const result: Partial<Record<LlmProvider, ProviderPricing>> = {};
    for (const [p, pricing] of this.byProvider) {
      result[p] = pricing;
    }
    return result as Record<LlmProvider, ProviderPricing>;
  }

  async setByProvider(provider: LlmProvider, pricing: ProviderPricing): Promise<void> {
    this.byProvider.set(provider, pricing);
  }

  clear(): void {
    this.byProvider.clear();
  }
}
