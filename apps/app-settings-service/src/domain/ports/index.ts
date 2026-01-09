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

// Usage stats types for LLM cost visualization
export interface DailyCost {
  date: string;
  costUsd: number;
  calls: number;
}

export interface MonthlyCost {
  month: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;
}

export interface ModelCost {
  model: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

export interface CallTypeCost {
  callType: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

export interface AggregatedCosts {
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  monthlyBreakdown: MonthlyCost[];
  byModel: ModelCost[];
  byCallType: CallTypeCost[];
}

export interface UsageStatsRepository {
  getUserCosts(userId: string, days?: number): Promise<AggregatedCosts>;
}
