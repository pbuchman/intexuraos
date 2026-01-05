export type {
  LLMError as GeminiError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  userId: string;
}
