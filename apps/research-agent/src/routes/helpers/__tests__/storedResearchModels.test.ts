import { describe, expect, it } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  getUnsupportedHistoricalModels,
  isRetryableStoredResearchModel,
} from '../storedResearchModels.js';

describe('storedResearchModels', () => {
  it('treats allowlisted OpenRouter models as retryable historical models', () => {
    expect(isRetryableStoredResearchModel('or:openai/gpt-5.4')).toBe(true);
  });

  it('filters only unsupported historical models from mixed current and OpenRouter values', () => {
    expect(
      getUnsupportedHistoricalModels([
        LlmModels.Gemini25Pro,
        'or:openai/gpt-5.4',
        'glm-4.7',
        'or:unknown/model',
      ])
    ).toEqual(['glm-4.7', 'or:unknown/model']);
  });
});
