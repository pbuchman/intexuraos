export type {
  LLMError as GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * GPT client configuration with explicit pricing.
 */
export interface GptConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  imagePricing?: import('@intexuraos/llm-contract').ModelPricing;
}
