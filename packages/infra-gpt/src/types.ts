export type {
  LLMError as GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

export interface GptConfig {
  apiKey: string;
  model: string;
  userId: string;
}

/**
 * V2 configuration with explicit pricing (no hardcoded values).
 */
export interface GptConfigV2 {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  imagePricing?: import('@intexuraos/llm-contract').ModelPricing;
}
