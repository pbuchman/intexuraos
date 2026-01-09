import { describe, it, expect } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import {
  IMAGE_PROMPT_MODELS,
  isValidImagePromptModel,
  IMAGE_GENERATION_MODELS,
  isValidImageGenerationModel,
} from '../domain/index.js';

describe('ImagePromptModel', () => {
  describe('IMAGE_PROMPT_MODELS', () => {
    it('has gpt-4.1 with openai provider', () => {
      expect(IMAGE_PROMPT_MODELS['gpt-4.1']).toEqual({
        provider: LlmProviders.OpenAI,
        modelId: 'gpt-4.1',
      });
    });

    it('has gemini-2.5-pro with google provider', () => {
      expect(IMAGE_PROMPT_MODELS[LlmModels.Gemini25Pro]).toEqual({
        provider: LlmProviders.Google,
        modelId: LlmModels.Gemini25Pro,
      });
    });
  });

  describe('isValidImagePromptModel', () => {
    it('returns true for gpt-4.1', () => {
      expect(isValidImagePromptModel('gpt-4.1')).toBe(true);
    });

    it('returns true for gemini-2.5-pro', () => {
      expect(isValidImagePromptModel(LlmModels.Gemini25Pro)).toBe(true);
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
  describe('IMAGE_GENERATION_MODELS', () => {
    it('has gpt-image-1 with openai provider', () => {
      expect(IMAGE_GENERATION_MODELS[LlmModels.GPTImage1]).toEqual({
        provider: LlmProviders.OpenAI,
        modelId: LlmModels.GPTImage1,
      });
    });

    it('has gemini-2.5-flash-image with google provider', () => {
      expect(IMAGE_GENERATION_MODELS[LlmModels.Gemini25FlashImage]).toEqual({
        provider: LlmProviders.Google,
        modelId: LlmModels.Gemini25FlashImage,
      });
    });
  });

  describe('isValidImageGenerationModel', () => {
    it('returns true for gpt-image-1', () => {
      expect(isValidImageGenerationModel(LlmModels.GPTImage1)).toBe(true);
    });

    it('returns true for gemini-2.5-flash-image', () => {
      expect(isValidImageGenerationModel(LlmModels.Gemini25FlashImage)).toBe(true);
    });

    it('returns false for invalid model', () => {
      expect(isValidImageGenerationModel('invalid-model')).toBe(false);
    });
  });
});
