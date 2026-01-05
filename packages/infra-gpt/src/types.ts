export type {
  LLMError as GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GptConfig {
  apiKey: string;
  model: string;
  userId: string;
}
