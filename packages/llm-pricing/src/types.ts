import type { LlmProvider } from '@intexuraos/llm-contract';
/**
 * LLM Pricing Types.
 * Shared types for cost calculation across all LLM providers.
 */

export type { LlmProvider };

/**
 * Source of the cost figure stored on a usage event.
 *
 * - `pending`           — caller has not resolved cost yet (input only)
 * - `provider_reported` — provider returned a USD figure we accept verbatim
 * - `calculated`        — server priced the event from token counts
 * - `missing`           — the model has no pricing entry; cost defaulted to 0
 *                         and the event needs operator follow-up
 */
export type PricingSource = 'provider_reported' | 'calculated' | 'pending' | 'missing';

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
