export type {
  LLMError as ClaudeError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface ClaudeConfig {
  apiKey: string;
  researchModel?: string;
  defaultModel?: string;
  evaluateModel?: string;
}

export const CLAUDE_DEFAULTS = {
  researchModel: 'claude-opus-4-5-20251101',
  defaultModel: 'claude-sonnet-4-5-20250929',
  evaluateModel: 'claude-haiku-4-5-20251001',
} as const;
