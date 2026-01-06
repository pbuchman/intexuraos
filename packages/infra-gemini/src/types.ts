export type {
  LLMError as GeminiError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  userId: string;
}

/**
 * V2 configuration with explicit pricing (no hardcoded values).
 */
export interface GeminiConfigV2 {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  imagePricing?: import('@intexuraos/llm-contract').ModelPricing;
}

