/**
 * LLM Pricing Client.
 *
 * @packageDocumentation
 *
 * Fetches LLM pricing from llm-usage-service at startup and provides
 * runtime pricing lookups via {@link PricingContext}.
 *
 * @remarks
 * Pricing data is fetched from `/internal/pricing` endpoint
 * and cached in a `PricingContext` for efficient runtime access.
 *
 * @deprecated The fetch/retry/context functions in this module are slated for
 * removal once all apps have migrated away from client-side pricing. New code
 * should NOT depend on fetchAllPricing, fetchAllPricingWithRetry,
 * PricingContext, or createPricingContext.
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
 * Response from the llm-usage-service pricing endpoint.
 *
 * @remarks
 * Contains pricing data for all LLM providers. Each provider's pricing
 * includes models with their per-million-token input/output prices.
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
  /** OpenRouter pricing */
  openrouter: ProviderPricing;
}

/**
 * Error returned from pricing client operations.
 */
export interface PricingClientError {
  /** Network connectivity error */
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  /** Human-readable error message */
  message: string;
  /** HTTP status code (set for API_ERROR from HTTP responses) */
  statusCode?: number | undefined;
}

/**
 * Fetch all LLM pricing from llm-usage-service.
 *
 * @deprecated Will be removed once apps stop using client-side pricing.
 */
export async function fetchAllPricing(
  baseUrl: string,
  authToken: string
): Promise<Result<AllPricingResponse, PricingClientError>> {
  const url = `${baseUrl}/internal/pricing`;

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
        statusCode: response.status,
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
 * Configuration for retry behavior in {@link fetchAllPricingWithRetry}.
 *
 * @deprecated Will be removed once apps stop using client-side pricing.
 */
export interface PricingRetryOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number | undefined;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number | undefined;
  /** Maximum delay in milliseconds between retries (default: 15000) */
  maxDelayMs?: number | undefined;
  /** Optional logger for retry progress (default: process.stderr.write) */
  log?: ((message: string) => void) | undefined;
  /** Delay function for testability (default: setTimeout-based) */
  delayFn?: ((ms: number) => Promise<void>) | undefined;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 15000;

/**
 * Whether a pricing client error is transient and worth retrying.
 */
function isTransientError(error: PricingClientError): boolean {
  if (error.code === 'NETWORK_ERROR') return true;
  if (error.statusCode === undefined) return false;
  return error.statusCode === 404 || error.statusCode >= 500;
}

/**
 * Default delay using setTimeout.
 */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetch all LLM pricing with exponential backoff retries.
 *
 * @deprecated Will be removed once apps stop using client-side pricing.
 */
export async function fetchAllPricingWithRetry(
  baseUrl: string,
  authToken: string,
  options?: PricingRetryOptions
): Promise<Result<AllPricingResponse, PricingClientError>> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const log =
    options?.log ??
    ((msg: string): void => {
      process.stderr.write(msg);
    });
  const delayFn = options?.delayFn ?? defaultDelay;

  let lastResult: Result<AllPricingResponse, PricingClientError> | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fetchAllPricing(baseUrl, authToken);

    if (result.ok) return result;

    lastResult = result;

    // Non-transient errors fail immediately
    if (!isTransientError(result.error)) return result;

    // Last attempt — don't delay, just return the error
    if (attempt === maxRetries) break;

    const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
    log(
      `Pricing fetch failed (attempt ${String(attempt + 1)}/${String(maxRetries + 1)}): ${result.error.message}. ` +
        `Retrying in ${String(delayMs)}ms...\n`
    );
    await delayFn(delayMs);
  }

  // lastResult is always defined here because maxRetries >= 0, so the loop
  // runs at least once and sets lastResult before breaking.
  return lastResult as Result<AllPricingResponse, PricingClientError>;
}

/**
 * Interface for pricing context.
 *
 * @deprecated Will be removed once apps stop using client-side pricing.
 */
export interface IPricingContext {
  /** Get pricing for a model; returns zero pricing for unknown models with a warn for ops audit */
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
 * @deprecated Will be removed once apps stop using client-side pricing.
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
      LlmProviders.OpenRouter,
    ] as const) {
      const providerPricing = allPricing[provider];
      for (const [model, pricing] of Object.entries(providerPricing.models)) {
        if (isValidLLMModel(model)) {
          this.pricing.set(model, pricing);
        }
      }
    }
  }

  getPricing(model: LLMModel): ModelPricing {
    const pricing = this.pricing.get(model);
    if (pricing === undefined) {
      process.stderr.write(
        `[llm-pricing] No pricing for model ${model} — falling back to $0; emit-don't-skip policy\n`
      );
      return { inputPricePerMillion: 0, outputPricePerMillion: 0 };
    }
    return pricing;
  }

  hasPricing(model: LLMModel): boolean {
    return this.pricing.has(model);
  }

  validateModels(models: LLMModel[]): void {
    const missing = models.filter((m) => !this.pricing.has(m));
    if (missing.length > 0) {
      throw new Error(`Missing pricing for models: ${missing.join(', ')}`);
    }
  }

  validateAllModels(): void {
    this.validateModels(ALL_LLM_MODELS);
  }

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
 * @deprecated Will be removed once apps stop using client-side pricing.
 */
export function createPricingContext(
  allPricing: AllPricingResponse,
  requiredModels: LLMModel[] = ALL_LLM_MODELS
): PricingContext {
  const context = new PricingContext(allPricing);
  context.validateModels(requiredModels);
  return context;
}
