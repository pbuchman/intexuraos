export type {
  LLMError as ClaudeError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface ClaudeConfig {
  apiKey: string;
  model: string;
}
