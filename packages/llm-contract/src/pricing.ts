/**
 * Pricing types for LLM cost calculation.
 *
 * Used by app-settings-service and infra-* packages.
 */

import type { TokenUsage } from './types.js';
import type { LlmProvider } from './supportedModels.js';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Partial<Record<ImageSize, number>>;
  useProviderCost?: boolean;
}

export interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string;
}

export interface CostCalculator {
  calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
  calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
}
