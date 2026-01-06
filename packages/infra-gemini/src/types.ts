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
 * Gemini client configuration with explicit pricing.
 */
export interface GeminiConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  imagePricing?: import('@intexuraos/llm-contract').ModelPricing;
}
