import { describe, it, expect } from 'vitest';
import { LegacyGoogleModels, LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  IMAGE_PROMPT_MODELS,
  isValidImagePromptModel,
  IMAGE_GENERATION_MODELS,
  isValidImageGenerationModel,
} from '../domain/index.js';

describe('ImagePromptModel', () => {
  it('does not expose a direct Gemini prompt model', () => {
    expect(isValidImagePromptModel(LegacyGoogleModels.Gemini25Pro)).toBe(false);
  });

  describe('IMAGE_PROMPT_MODELS', () => {
    it('has gpt-4.1 with openai provider', () => {
      expect(IMAGE_PROMPT_MODELS['gpt-4.1']).toEqual({
        provider: LlmProviders.OpenAI,
        modelId: 'gpt-4.1',
      });
    });

  });

  describe('isValidImagePromptModel', () => {
    it('returns true for gpt-4.1', () => {
      expect(isValidImagePromptModel('gpt-4.1')).toBe(true);
    });


    it('returns false for invalid model', () => {
      expect(isValidImagePromptModel('invalid-model')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidImagePromptModel('')).toBe(false);
    });
  });
});

describe('ImageGenerationModel', () => {
  it('does not expose a direct Gemini image model', () => {
    expect(isValidImageGenerationModel(LegacyGoogleModels.Gemini25FlashImage)).toBe(false);
  });

  describe('IMAGE_GENERATION_MODELS', () => {
    it('has gpt-image-1 with openai provider', () => {
      expect(IMAGE_GENERATION_MODELS[LlmModels.GPTImage1]).toEqual({
        provider: LlmProviders.OpenAI,
        modelId: LlmModels.GPTImage1,
      });
    });

  });

  describe('isValidImageGenerationModel', () => {
    it('returns true for gpt-image-1', () => {
      expect(isValidImageGenerationModel(LlmModels.GPTImage1)).toBe(true);
    });


    it('returns false for invalid model', () => {
      expect(isValidImageGenerationModel('invalid-model')).toBe(false);
    });
  });
});
