export type {
  LLMError as ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Claude client configuration with explicit pricing.
 */
export interface ClaudeConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
}
