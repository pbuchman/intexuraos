import { describe, it, expect } from 'vitest';
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
        provider: 'openai',
        modelId: 'gpt-4.1',
      });
    });

    it('has gemini-2.5-pro with google provider', () => {
      expect(IMAGE_PROMPT_MODELS['gemini-2.5-pro']).toEqual({
        provider: 'google',
        modelId: 'gemini-2.5-pro',
      });
    });
  });

  describe('isValidImagePromptModel', () => {
    it('returns true for gpt-4.1', () => {
      expect(isValidImagePromptModel('gpt-4.1')).toBe(true);
    });

    it('returns true for gemini-2.5-pro', () => {
      expect(isValidImagePromptModel('gemini-2.5-pro')).toBe(true);
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
      expect(IMAGE_GENERATION_MODELS['gpt-image-1']).toEqual({
        provider: 'openai',
        modelId: 'gpt-image-1',
      });
    });

    it('has dall-e-3 with openai provider', () => {
      expect(IMAGE_GENERATION_MODELS['dall-e-3']).toEqual({
        provider: 'openai',
        modelId: 'dall-e-3',
      });
    });
  });

  describe('isValidImageGenerationModel', () => {
    it('returns true for gpt-image-1', () => {
      expect(isValidImageGenerationModel('gpt-image-1')).toBe(true);
    });

    it('returns true for dall-e-3', () => {
      expect(isValidImageGenerationModel('dall-e-3')).toBe(true);
    });

    it('returns false for invalid model', () => {
      expect(isValidImageGenerationModel('invalid-model')).toBe(false);
    });
  });
});
