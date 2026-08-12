import { describe, expect, it } from 'vitest';
import { LegacyGoogleModels } from '@intexuraos/llm-contract';
import {
  getUnsupportedHistoricalModels,
  getUnsupportedRetryMessage,
  getUnsupportedSynthesisMessage,
  isRetryableStoredResearchModel,
} from '../storedResearchModels.js';

describe('storedResearchModels', () => {
  it('treats allowlisted OpenRouter models as retryable historical models', () => {
    expect(isRetryableStoredResearchModel('or:openai/gpt-5.4')).toBe(true);
  });

  it('rejects historical direct Google models', () => {
    expect(isRetryableStoredResearchModel(LegacyGoogleModels.Gemini25Pro)).toBe(false);
  });

  it('filters only unsupported historical models from mixed current and OpenRouter values', () => {
    expect(
      getUnsupportedHistoricalModels([
        LegacyGoogleModels.Gemini25Pro,
        'or:openai/gpt-5.4',
        'glm-4.7',
        'or:unknown/model',
      ])
    ).toEqual([LegacyGoogleModels.Gemini25Pro, 'glm-4.7', 'or:unknown/model']);
  });

  it('formats the retry block message listing all unsupported models', () => {
    expect(getUnsupportedRetryMessage(['glm-4.7', 'or:foo/bar'])).toBe(
      'Cannot retry research because these historical models are no longer supported: glm-4.7, or:foo/bar',
    );
  });

  it('formats the synthesis block message for a single unsupported model', () => {
    expect(getUnsupportedSynthesisMessage('glm-4.7')).toBe(
      'Cannot run synthesis because the historical synthesis model is no longer supported: glm-4.7',
    );
  });
});
