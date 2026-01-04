export type {
  LLMError as ClaudeError,
  ResearchResult,
  GenerateResult,
  SynthesisInput,
  UsageLogger,
} from '@intexuraos/llm-contract';

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  usageLogger?: import('@intexuraos/llm-contract').UsageLogger;
  userId?: string;
}
