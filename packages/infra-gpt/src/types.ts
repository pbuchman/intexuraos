export type {
  LLMError as GptError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GptConfig {
  apiKey: string;
  model: string;
}
