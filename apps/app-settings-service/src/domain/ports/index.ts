/**
 * Domain ports for app-settings-service.
 */

import type { LlmProvider } from '@intexuraos/llm-contract';
export type { LlmProvider };

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Record<ImageSize, number>;
  useProviderCost?: boolean;
}

export interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string;
}

export interface PricingRepository {
  getByProvider(provider: LlmProvider): Promise<ProviderPricing | null>;
}
