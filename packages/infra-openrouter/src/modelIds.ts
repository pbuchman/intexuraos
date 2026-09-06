import { LlmModels } from '@intexuraos/llm-contract';

/** Canonical identifiers for modalities routed through OpenRouter. */
export const OPENROUTER_TEXT_EMBEDDING_3_SMALL = {
  apiModelId: 'openai/text-embedding-3-small',
  dimensions: 1536,
  evidenceModelId: 'or:openai/text-embedding-3-small',
  persistedModelId: 'text-embedding-3-small',
} as const;

/** Canonical identifiers for the existing public GPT image model alias. */
export const OPENROUTER_GPT_IMAGE_1 = {
  apiModelId: 'openai/gpt-image-1',
  evidenceModelId: 'or:openai/gpt-image-1',
  publicModelId: LlmModels.GPTImage1,
} as const;

/** Canonical identifiers for the existing public GPT prompt model alias. */
export const OPENROUTER_GPT_4_1 = {
  apiModelId: 'openai/gpt-4.1',
  evidenceModelId: 'or:openai/gpt-4.1',
  publicModelId: 'gpt-4.1',
} as const;
