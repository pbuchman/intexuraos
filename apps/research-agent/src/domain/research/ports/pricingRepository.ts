import type { LlmProvider } from '../models/index.js';

export interface LlmPricing {
  provider: LlmProvider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  cacheWriteMultiplier?: number;
  cacheReadMultiplier?: number;
  updatedAt: string;
}

export interface PricingRepository {
  findByProviderAndModel(provider: LlmProvider, model: string): Promise<LlmPricing | null>;
}
