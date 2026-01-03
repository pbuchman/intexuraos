export type {
  LLMError as GeminiError,
  ResearchResult,
  SynthesisInput,
} from '@intexuraos/llm-contract';

export interface GeminiConfig {
  apiKey: string;
  researchModel?: string;
  defaultModel?: string;
  evaluateModel?: string;
}

export const GEMINI_DEFAULTS = {
  researchModel: 'gemini-2.5-pro',
  defaultModel: 'gemini-2.5-flash',
  evaluateModel: 'gemini-2.5-flash-lite',
} as const;
