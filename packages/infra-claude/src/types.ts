export type {
  LLMError as ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  userId: string;
}
