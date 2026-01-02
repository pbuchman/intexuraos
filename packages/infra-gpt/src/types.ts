export type {
  LLMError as GptError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GptConfig {
  apiKey: string;
  researchModel?: string;
  defaultModel?: string;
  evaluateModel?: string;
}

export const GPT_DEFAULTS = {
  researchModel: 'o4-mini-deep-research',
  defaultModel: 'gpt-5.2',
  evaluateModel: 'gpt-5-nano',
} as const;
