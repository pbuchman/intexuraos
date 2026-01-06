export type {
  LLMError as ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
  ModelPricing,
} from '@intexuraos/llm-contract';

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  userId: string;
}

/**
 * V2 configuration with explicit pricing (no hardcoded values).
 */
export interface ClaudeConfigV2 {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
}
