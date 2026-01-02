export type {
  LLMError as GptError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GptConfig {
  apiKey: string;
  defaultModel?: string;
  validationModel?: string;
  researchModel?: string;
}

export const GPT_DEFAULTS = {
  defaultModel: 'gpt-5.2',
  validationModel: 'gpt-4.1',
  researchModel: 'o4-mini-deep-research',
} as const;
