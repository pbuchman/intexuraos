import { LlmProviders, type LlmProvider, type ProviderPricing } from '@intexuraos/llm-contract';
import type { PricingRepository } from '../domain/repositories/pricingRepository.js';

export class FakePricingRepository implements PricingRepository {
  readonly byProvider = new Map<LlmProvider, ProviderPricing>();

  async getByProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    return this.byProvider.get(provider) ?? null;
  }

  async getAll(): Promise<Record<LlmProvider, ProviderPricing>> {
    const providers = [
      LlmProviders.Google,
      LlmProviders.OpenAI,
      LlmProviders.Anthropic,
      LlmProviders.Perplexity,
      LlmProviders.OpenRouter,
    ] as const;
    const result: Partial<Record<LlmProvider, ProviderPricing>> = {};
    for (const p of providers) {
      const pricing = this.byProvider.get(p);
      if (pricing === undefined) {
        throw new Error(`Missing pricing for provider: ${p}`);
      }
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
