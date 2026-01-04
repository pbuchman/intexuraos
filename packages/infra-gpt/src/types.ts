export type {
  LLMError as GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  UsageLogger,
} from '@intexuraos/llm-contract';

export interface GptConfig {
  apiKey: string;
  model: string;
  usageLogger?: import('@intexuraos/llm-contract').UsageLogger;
  userId?: string;
}
