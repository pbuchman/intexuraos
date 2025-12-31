export type {
  LLMError as ClaudeError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface ClaudeConfig {
  apiKey: string;
  defaultModel?: string;
  validationModel?: string;
  researchModel?: string;
}

export const CLAUDE_DEFAULTS = {
  defaultModel: 'claude-sonnet-4-5-20250929',
  validationModel: 'claude-haiku-4-5-20251001',
  researchModel: 'claude-opus-4-5-20251101',
} as const;
