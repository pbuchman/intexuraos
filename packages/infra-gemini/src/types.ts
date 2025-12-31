export type {
  LLMError as GeminiError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GeminiConfig {
  apiKey: string;
  defaultModel?: string;
  validationModel?: string;
  researchModel?: string;
}

export const GEMINI_DEFAULTS = {
  defaultModel: 'gemini-2.5-flash',
  validationModel: 'gemini-2.5-flash-lite',
  researchModel: 'gemini-2.5-pro',
} as const;
