import type { LlmProvider, ProviderPricing } from '@intexuraos/llm-contract';

export interface PricingRepository {
  getByProvider(provider: LlmProvider): Promise<ProviderPricing | null>;
  getAll(): Promise<Record<LlmProvider, ProviderPricing>>;
  setByProvider(provider: LlmProvider, pricing: ProviderPricing): Promise<void>;
}
