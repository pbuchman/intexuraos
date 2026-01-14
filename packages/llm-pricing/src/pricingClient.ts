/**
 * LLM Pricing Client.
 *
 * @packageDocumentation
 *
 * Fetches LLM pricing from app-settings-service at startup and provides
 * runtime pricing lookups via {@link PricingContext}.
 *
 * @remarks
 * Pricing data is fetched from `/internal/settings/pricing` endpoint
 * and cached in a `PricingContext` for efficient runtime access.
 *
 * @example
 * ```ts
 * import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
 *
 * // Fetch pricing from app-settings-service
 * const result = await fetchAllPricing(
 *   'http://app-settings-service/internal',
 *   'internal-auth-token'
 * );
 *
 * if (result.ok) {
 *   const pricingContext = createPricingContext(result.data);
 *   const pricing = pricingContext.getPricing('claude-sonnet-4-5');
 *   console.log(pricing.inputPricePerMillion); // 3.00
 * }
 * ```
 */

import {
  ALL_LLM_MODELS,
  LlmProviders,
  type LLMModel,
  type ModelPricing,
  type ProviderPricing,
} from '@intexuraos/llm-contract';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';

/**
 * Response from the app-settings-service pricing endpoint.
 *
 * @remarks
 * Contains pricing data for all LLM providers. Each provider's pricing
 * includes models with their per-million-token input/output prices.
 *
 * @example
 * ```ts
 * const response: AllPricingResponse = {
 *   anthropic: {
 *     models: {
 *       'claude-sonnet-4-5': {
 *         inputPricePerMillion: 3.00,
 *         outputPricePerMillion: 15.00,
 *         cacheReadMultiplier: 0.1,
 *         cacheWriteMultiplier: 1.25,
 *       },
 *     },
 *     updatedAt: '2026-01-13T00:00:00Z',
 *   },
 *   // ... other providers
 * };
 * ```
 */
export interface AllPricingResponse {
  /** Google Gemini pricing */
  google: ProviderPricing;
  /** OpenAI GPT pricing */
  openai: ProviderPricing;
  /** Anthropic Claude pricing */
  anthropic: ProviderPricing;
  /** Perplexity pricing */
  perplexity: ProviderPricing;
  /** Zhipu GLM pricing */
  zhipu: ProviderPricing;
}

/**
 * Error returned from pricing client operations.
 *
 * @example
 * ```ts
 * if (!result.ok) {
 *   switch (result.error.code) {
 *     case 'NETWORK_ERROR':
 *       console.error('Network error:', result.error.message);
 *       break;
 *     case 'API_ERROR':
 *       console.error('API error:', result.error.message);
 *       break;
 *   }
 * }
 * ```
 */
export interface PricingClientError {
  /** Network connectivity error */
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  /** Human-readable error message */
  message: string;
}

/**
 * Fetch all LLM pricing from app-settings-service.
 *
 * @remarks
 * Calls `/internal/settings/pricing` with `X-Internal-Auth` header.
 * Returns a {@link Result} type - use pattern matching to handle errors.
 *
 * @param baseUrl - Base URL of app-settings-service (e.g., `'http://app-settings-service/internal'`)
 * @param authToken - Internal auth token for `X-Internal-Auth` header
 * @returns Result with all provider pricing or error
 *
 * @example
 * ```ts
 * const result = await fetchAllPricing(
 *   'http://app-settings-service/internal',
 *   process.env.INTERNAL_AUTH_TOKEN
 * );
 *
 * if (result.ok) {
 *   console.log('Pricing loaded:', Object.keys(result.data.anthropic.models));
 * } else {
 *   console.error('Failed to fetch pricing:', result.error.message);
 * }
 * ```
 */
export async function fetchAllPricing(
  baseUrl: string,
  authToken: string
): Promise<Result<AllPricingResponse, PricingClientError>> {
  const url = `${baseUrl}/internal/settings/pricing`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Internal-Auth': authToken,
      },
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        const body = await response.text();
        errorDetails = body.length > 0 ? `: ${body.substring(0, 200)}` : '';
      } catch {
        // Ignore body read errors
      }

      return err({
        code: 'API_ERROR',
        message: `HTTP ${String(response.status)}${errorDetails}`,
      });
    }

    const data = (await response.json()) as { success: boolean; data: AllPricingResponse };

    if (!data.success) {
      return err({
        code: 'API_ERROR',
        message: 'Response success is false',
      });
    }

    return ok(data.data);
  } catch (error) {
    return err({
      code: 'NETWORK_ERROR',
      message: getErrorMessage(error),
    });
  }
}

/**
 * Interface for pricing context.
 *
 * @remarks
 * Allows test fakes by defining the pricing lookup contract.
 * Implemented by {@link PricingContext}.
 */
export interface IPricingContext {
  /** Get pricing for a model, throws if not found */
  getPricing(model: LLMModel): ModelPricing;
  /** Check if pricing exists for a model */
  hasPricing(model: LLMModel): boolean;
  /** Validate that all specified models have pricing */
  validateModels(models: LLMModel[]): void;
  /** Validate that ALL known models have pricing */
  validateAllModels(): void;
  /** Get all models that have pricing defined */
  getModelsWithPricing(): LLMModel[];
}

/**
 * Runtime pricing lookup context.
 *
 * @remarks
 * Created at application startup with fetched pricing from app-settings-service.
 * Caches all pricing in a Map for O(1) lookups during LLM operations.
 *
 * @example
 * ```ts
 * import { createPricingContext } from '@intexuraos/llm-pricing';
 *
 * const context = createPricingContext(allPricingResponse);
 *
 * // Get pricing for a specific model
 * const pricing = context.getPricing('claude-sonnet-4-5');
 * console.log(pricing.inputPricePerMillion);
 *
 * // Check if pricing exists
 * if (context.hasPricing('claude-opus-4-5')) {
 *   // Model is available
 * }
 *
 * // Validate before using
 * context.validateModels(['claude-sonnet-4-5', 'gpt-4.1']);
 * ```
 */
export class PricingContext implements IPricingContext {
  /** Map of model to pricing for O(1) lookups */
  readonly pricing: Map<LLMModel, ModelPricing>;

  constructor(allPricing: AllPricingResponse) {
    this.pricing = new Map();

    // Flatten all provider pricing into a single map
    for (const provider of [
      LlmProviders.Google,
      LlmProviders.OpenAI,
      LlmProviders.Anthropic,
      LlmProviders.Perplexity,
      LlmProviders.Zhipu,
    ] as const) {
      const providerPricing = allPricing[provider];
      for (const [model, pricing] of Object.entries(providerPricing.models)) {
        if (isValidLLMModel(model)) {
          this.pricing.set(model, pricing);
        }
      }
    }
  }

  /**
   * Get pricing for a model.
   * @throws Error if model pricing not found
   */
  getPricing(model: LLMModel): ModelPricing {
    const pricing = this.pricing.get(model);
    if (pricing === undefined) {
      throw new Error(`Pricing not found for model: ${model}`);
    }
    return pricing;
  }

  /**
   * Check if pricing exists for a model.
   */
  hasPricing(model: LLMModel): boolean {
    return this.pricing.has(model);
  }

  /**
   * Validate that all specified models have pricing.
   * @throws Error listing missing models
   */
  validateModels(models: LLMModel[]): void {
    const missing = models.filter((m) => !this.pricing.has(m));
    if (missing.length > 0) {
      throw new Error(`Missing pricing for models: ${missing.join(', ')}`);
    }
  }

  /**
   * Validate that ALL LLM models have pricing defined.
   * Used by app-settings-service at startup.
   * @throws Error listing missing models
   */
  validateAllModels(): void {
    this.validateModels(ALL_LLM_MODELS);
  }

  /**
   * Get all models that have pricing defined.
   */
  getModelsWithPricing(): LLMModel[] {
    return Array.from(this.pricing.keys());
  }
}

/**
 * Check if a string is a valid LLMModel.
 */
function isValidLLMModel(model: string): model is LLMModel {
  return ALL_LLM_MODELS.includes(model as LLMModel);
}

/**
 * Create a PricingContext from fetched pricing.
 *
 * @remarks
 * Validates that all required models have pricing defined before returning.
 * Throws an error listing missing models if validation fails.
 *
 * @param allPricing - Pricing response from app-settings-service
 * @param requiredModels - Models that must have pricing (default: all models)
 * @returns Validated pricing context
 * @throws Error if any required model is missing pricing
 *
 * @example
 * ```ts
 * import { createPricingContext } from '@intexuraos/llm-pricing';
 *
 * // Validate all models have pricing (for app-settings-service)
 * const context = createPricingContext(allPricing);
 *
 * // Validate only specific models (for client services)
 * const clientContext = createPricingContext(allPricing, [
 *   'claude-sonnet-4-5',
 *   'claude-opus-4-5',
 *   'gpt-4.1',
 * ]);
 * ```
 */
export function createPricingContext(
  allPricing: AllPricingResponse,
  requiredModels: LLMModel[] = ALL_LLM_MODELS
): PricingContext {
  const context = new PricingContext(allPricing);
  context.validateModels(requiredModels);
  return context;
}
