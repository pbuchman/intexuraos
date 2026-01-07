/**
 * Pricing Client.
 *
 * Fetches LLM pricing from app-settings-service at startup.
 * Provides PricingContext for runtime pricing lookups.
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
 * Response from /internal/settings/pricing endpoint.
 */
export interface AllPricingResponse {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
}

/**
 * Error from pricing client.
 */
export interface PricingClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  message: string;
}

/**
 * Fetch all pricing from app-settings-service.
 *
 * @param baseUrl - Base URL of app-settings-service
 * @param authToken - Internal auth token
 * @returns All provider pricing or error
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
 * Interface for pricing context (allows test fakes).
 */
export interface IPricingContext {
  getPricing(model: LLMModel): ModelPricing;
  hasPricing(model: LLMModel): boolean;
  validateModels(models: LLMModel[]): void;
  validateAllModels(): void;
  getModelsWithPricing(): LLMModel[];
}

/**
 * Pricing context for runtime pricing lookups.
 * Created at application startup with fetched pricing.
 */
export class PricingContext implements IPricingContext {
  readonly pricing: Map<LLMModel, ModelPricing>;

  constructor(allPricing: AllPricingResponse) {
    this.pricing = new Map();

    // Flatten all provider pricing into a single map
    for (const provider of [LlmProviders.Google, LlmProviders.OpenAI, LlmProviders.Anthropic, LlmProviders.Perplexity] as const) {
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
 * Validates that all required models have pricing.
 *
 * @param allPricing - Pricing response from app-settings-service
 * @param requiredModels - Models that must have pricing (default: all models)
 * @throws Error if validation fails
 */
export function createPricingContext(
  allPricing: AllPricingResponse,
  requiredModels: LLMModel[] = ALL_LLM_MODELS
): PricingContext {
  const context = new PricingContext(allPricing);
  context.validateModels(requiredModels);
  return context;
}

