/**
 * Types for the Google Gemini client implementation.
 *
 * @packageDocumentation
 */

export type {
  LLMError as GeminiError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Configuration for creating a Gemini client.
 *
 * Extends {@link LLMConfig} with Google-specific pricing configuration.
 * Supports both text generation and image generation with separate pricing.
 *
 * @example
 * ```ts
 * import { createGeminiClient } from '@intexuraos/infra-gemini';
 *
 * const client = createGeminiClient({
 *   apiKey: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.5-flash',
 *   userId: 'user-123',
 *   pricing: {
 *     inputPricePerMillion: 0.075,
 *     outputPricePerMillion: 0.30,
 *     groundingCostPerRequest: 0.002,
 *   }
 * });
 * ```
 */
export interface GeminiConfig {
  /** Google API key from console.cloud.google.com */
  apiKey: string;
  /** Model identifier (e.g., 'gemini-2.5-pro', 'gemini-2.5-flash') */
  model: string;
  /** User ID for usage tracking and analytics */
  userId: string;
  /** Cost configuration per million tokens for text operations */
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Optional separate pricing for image generation (Gemini 2.5 Flash) */
  imagePricing?: import('@intexuraos/llm-contract').ModelPricing;
}
