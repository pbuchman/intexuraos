/**
 * Pricing types for LLM cost calculation.
 *
 * Used by app-settings-service (for fetching/storing prices) and infra-*
 * packages (for calculating request costs).
 *
 * @packageDocumentation
 */

import type { TokenUsage } from './types.js';
import type { LlmProvider } from './supportedModels.js';

/** Supported image generation dimensions */
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

/**
 * Pricing configuration for a single LLM model.
 *
 * Prices are per million tokens for input/output. Optional multipliers
 * apply for cached tokens and additional features.
 *
 * @example
 * ```ts
 * const claudePricing: ModelPricing = {
 *   inputPricePerMillion: 3.00,
 *   outputPricePerMillion: 15.00,
 *   cacheReadMultiplier: 0.1,  // 10% of base price for cache hits
 *   cacheWriteMultiplier: 1.25, // 125% of base price for cache writes
 *   webSearchCostPerCall: 0.0035, // $0.0035 per web search call
 * };
 *
 * // Calculate cost for a request:
 * const cost = calculateTextCost(usage, claudePricing);
 * ```
 */
export interface ModelPricing {
  /** Input token price per million tokens (in USD) */
  inputPricePerMillion: number;
  /** Output token price per million tokens (in USD) */
  outputPricePerMillion: number;
  /**
   * Multiplier for prompt cache read tokens.
   *
   * Cache reads are typically discounted (e.g., 0.1 = 10% of base price).
   * Only used by Anthropic Claude.
   */
  cacheReadMultiplier?: number;
  /**
   * Multiplier for prompt cache creation tokens.
   *
   * Cache writes are typically surcharged (e.g., 1.25 = 125% of base price).
   * Only used by Anthropic Claude.
   */
  cacheWriteMultiplier?: number;
  /** Cost per web search tool call (in USD) */
  webSearchCostPerCall?: number;
  /** Cost per grounding request for Gemini (in USD) */
  groundingCostPerRequest?: number;
  /** Per-size pricing for image generation (in USD) */
  imagePricing?: Partial<Record<ImageSize, number>>;
  /**
   * When true, use the cost reported by the provider instead of calculating.
   *
   * Useful when provider returns accurate pricing in the response.
   */
  useProviderCost?: boolean;
}

/**
 * Pricing configuration for all models from a single provider.
 *
 * Used by app-settings-service to store and retrieve pricing data.
 * The `updatedAt` field is used to invalidate stale pricing.
 */
export interface ProviderPricing {
  /** Provider identifier (e.g., 'anthropic', 'openai') */
  provider: LlmProvider;
  /** Map of model ID to pricing configuration */
  models: Record<string, ModelPricing>;
  /** ISO timestamp of last pricing update */
  updatedAt: string;
}

/**
 * Interface for calculating LLM operation costs.
 *
 * Implemented by individual provider packages (infra-claude, infra-gpt, etc.)
 * to handle provider-specific cost calculations.
 */
export interface CostCalculator {
  /**
   * Calculate text generation cost from token usage.
   *
   * @param usage - Raw token usage from provider response
   * @param pricing - Model pricing configuration
   * @returns Cost in USD
   */
  calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;

  /**
   * Calculate image generation cost.
   *
   * @param size - Image dimensions
   * @param pricing - Model pricing configuration (must include imagePricing)
   * @returns Cost in USD
   */
  calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
}
