import { describe, expect, it } from 'vitest';
import { LegacyGoogleModels, LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  getProviderForStoredModel,
  isSelectableModel,
} from '../researchAgentApi.types.js';

describe('researchAgentApi stored model helpers', () => {
  it('treats only OpenRouter IDs as newly selectable', () => {
    expect(getProviderForStoredModel(LlmModels.Sonar)).toBeNull();
    expect(isSelectableModel(LlmModels.Sonar)).toBe(false);
    expect(getProviderForStoredModel('or:openai/gpt-4.1')).toBe(LlmProviders.OpenRouter);
    expect(isSelectableModel('or:openai/gpt-4.1')).toBe(true);
  });

  it('treats retired historical models as non-selectable', () => {
    expect(getProviderForStoredModel('glm-4.7')).toBeNull();
    expect(isSelectableModel('glm-4.7')).toBe(false);
    expect(isSelectableModel(LegacyGoogleModels.Gemini25Pro)).toBe(false);
  });
});
