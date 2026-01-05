/**
 * LLM Pricing Types.
 * Shared types for cost calculation across all LLM providers.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';

export interface LlmPricing {
  provider: LlmProvider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  cacheWriteMultiplier?: number;
  cacheReadMultiplier?: number;
  imageCostPerGeneration?: number;
  updatedAt: string;
}
