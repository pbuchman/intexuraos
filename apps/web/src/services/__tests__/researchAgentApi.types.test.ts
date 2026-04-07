import { describe, expect, it } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  getProviderForStoredModel,
  isSelectableModel,
} from '../researchAgentApi.types.js';

describe('researchAgentApi stored model helpers', () => {
  it('maps current supported and OpenRouter stored models to providers', () => {
    expect(getProviderForStoredModel(LlmModels.Sonar)).toBe(LlmProviders.Perplexity);
    expect(getProviderForStoredModel('or:openai/gpt-4.1')).toBe(LlmProviders.OpenRouter);
  });

  it('treats retired historical models as non-selectable', () => {
    expect(getProviderForStoredModel('glm-4.7')).toBeNull();
    expect(isSelectableModel('glm-4.7')).toBe(false);
    expect(isSelectableModel(LlmModels.Gemini25Pro)).toBe(true);
  });
});
