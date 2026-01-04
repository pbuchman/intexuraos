import { describe, expect, it } from 'vitest';
import {
  getDisplayName,
  getModelsForProvider,
  getProviderForModel,
  isValidModel,
  SUPPORTED_MODELS,
  SYSTEM_DEFAULT_MODELS,
} from '../supportedModels.js';

describe('supportedModels', () => {
  describe('SUPPORTED_MODELS', () => {
    it('contains all expected models', () => {
      expect(Object.keys(SUPPORTED_MODELS)).toContain('gemini-2.5-pro');
      expect(Object.keys(SUPPORTED_MODELS)).toContain('claude-opus-4-5-20251101');
      expect(Object.keys(SUPPORTED_MODELS)).toContain('o4-mini-deep-research');
      expect(Object.keys(SUPPORTED_MODELS)).toContain('sonar-pro');
      expect(Object.keys(SUPPORTED_MODELS)).toContain('sonar-deep-research');
    });

    it('has provider for each model', () => {
      for (const config of Object.values(SUPPORTED_MODELS)) {
        expect(['google', 'openai', 'anthropic', 'perplexity']).toContain(config.provider);
      }
    });
  });

  describe('SYSTEM_DEFAULT_MODELS', () => {
    it('contains one model per provider', () => {
      expect(SYSTEM_DEFAULT_MODELS).toHaveLength(4);
      const providers = SYSTEM_DEFAULT_MODELS.map((m) => SUPPORTED_MODELS[m].provider);
      expect(new Set(providers).size).toBe(4);
    });
  });

  describe('getProviderForModel', () => {
    it('returns correct provider for Google models', () => {
      expect(getProviderForModel('gemini-2.5-pro')).toBe('google');
      expect(getProviderForModel('gemini-2.5-flash')).toBe('google');
    });

    it('returns correct provider for Anthropic models', () => {
      expect(getProviderForModel('claude-opus-4-5-20251101')).toBe('anthropic');
      expect(getProviderForModel('claude-sonnet-4-5-20250929')).toBe('anthropic');
    });

    it('returns correct provider for OpenAI models', () => {
      expect(getProviderForModel('o4-mini-deep-research')).toBe('openai');
      expect(getProviderForModel('gpt-5.2')).toBe('openai');
    });

    it('returns correct provider for Perplexity models', () => {
      expect(getProviderForModel('sonar-pro')).toBe('perplexity');
      expect(getProviderForModel('sonar-deep-research')).toBe('perplexity');
    });
  });

  describe('isValidModel', () => {
    it('returns true for valid models', () => {
      expect(isValidModel('gemini-2.5-pro')).toBe(true);
      expect(isValidModel('claude-opus-4-5-20251101')).toBe(true);
      expect(isValidModel('o4-mini-deep-research')).toBe(true);
      expect(isValidModel('sonar-pro')).toBe(true);
      expect(isValidModel('sonar-deep-research')).toBe(true);
    });

    it('returns false for invalid models', () => {
      expect(isValidModel('invalid-model')).toBe(false);
      expect(isValidModel('')).toBe(false);
      expect(isValidModel('gpt-4')).toBe(false);
    });
  });

  describe('getModelsForProvider', () => {
    it('returns Google models', () => {
      const models = getModelsForProvider('google');
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-2.5-flash');
      expect(models).toHaveLength(2);
    });

    it('returns Anthropic models', () => {
      const models = getModelsForProvider('anthropic');
      expect(models).toContain('claude-opus-4-5-20251101');
      expect(models).toContain('claude-sonnet-4-5-20250929');
      expect(models).toHaveLength(2);
    });

    it('returns OpenAI models', () => {
      const models = getModelsForProvider('openai');
      expect(models).toContain('o4-mini-deep-research');
      expect(models).toContain('gpt-5.2');
      expect(models).toHaveLength(2);
    });

    it('returns Perplexity models', () => {
      const models = getModelsForProvider('perplexity');
      expect(models).toContain('sonar');
      expect(models).toContain('sonar-pro');
      expect(models).toContain('sonar-deep-research');
      expect(models).toHaveLength(3);
    });
  });

  describe('getDisplayName', () => {
    it('returns display name for models', () => {
      expect(getDisplayName('gemini-2.5-pro')).toBe('Gemini Pro (research)');
      expect(getDisplayName('claude-opus-4-5-20251101')).toBe('Claude Opus (research)');
      expect(getDisplayName('o4-mini-deep-research')).toBe('O4 Mini (research)');
      expect(getDisplayName('sonar-pro')).toBe('Perplexity Sonar Pro');
      expect(getDisplayName('sonar-deep-research')).toBe('Perplexity Deep Research');
    });
  });
});
