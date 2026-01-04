export type {
  LLMError as GeminiError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  UsageLogger,
} from '@intexuraos/llm-contract';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  usageLogger?: import('@intexuraos/llm-contract').UsageLogger;
  userId?: string;
}
