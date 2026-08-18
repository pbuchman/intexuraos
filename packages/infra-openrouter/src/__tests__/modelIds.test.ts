import { describe, expect, it } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  OPENROUTER_GPT_4_1,
  OPENROUTER_GPT_IMAGE_1,
  OPENROUTER_TEXT_EMBEDDING_3_SMALL,
} from '../modelIds.js';

describe('OpenRouter modality model identifiers', () => {
  it('keeps the execution, evidence, and persisted embedding identifiers distinct', () => {
    expect(OPENROUTER_TEXT_EMBEDDING_3_SMALL).toEqual({
      apiModelId: 'openai/text-embedding-3-small',
      dimensions: 1536,
      evidenceModelId: 'or:openai/text-embedding-3-small',
      persistedModelId: 'text-embedding-3-small',
    });
  });

  it('keeps public image aliases while routing execution and evidence through OpenRouter', () => {
    expect(OPENROUTER_GPT_IMAGE_1).toEqual({
      apiModelId: 'openai/gpt-image-1',
      evidenceModelId: 'or:openai/gpt-image-1',
      publicModelId: LlmModels.GPTImage1,
    });
    expect(OPENROUTER_GPT_4_1).toEqual({
      apiModelId: 'openai/gpt-4.1',
      evidenceModelId: 'or:openai/gpt-4.1',
      publicModelId: 'gpt-4.1',
    });
  });
});
