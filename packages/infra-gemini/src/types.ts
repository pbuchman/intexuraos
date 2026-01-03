export type {
  LLMError as GeminiError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GeminiConfig {
  apiKey: string;
  model: string;
}
