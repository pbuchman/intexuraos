import { describe, expect, it } from 'vitest';
import {
  ALL_LLM_MODELS,
  MODEL_PROVIDER_MAP,
  getProviderForModel,
  isValidModel,
  LlmModels,
  LlmProviders,
  type LLMModel,
  type ResearchModel,
  type ImageModel,
  type ValidationModel,
  type FastModel,
} from '../supportedModels.js';

describe('supportedModels', () => {
  describe('ALL_LLM_MODELS', () => {
    it('contains all 15 expected models', () => {
      expect(ALL_LLM_MODELS).toHaveLength(15);
    });

    it('contains all Google models', () => {
      expect(ALL_LLM_MODELS).toContain('gemini-2.5-pro');
      expect(ALL_LLM_MODELS).toContain('gemini-2.5-flash');
      expect(ALL_LLM_MODELS).toContain('gemini-2.0-flash');
      expect(ALL_LLM_MODELS).toContain('gemini-2.5-flash-image');
    });

    it('contains all OpenAI models', () => {
      expect(ALL_LLM_MODELS).toContain('o4-mini-deep-research');
      expect(ALL_LLM_MODELS).toContain('gpt-5.2');
      expect(ALL_LLM_MODELS).toContain('gpt-4o-mini');
      expect(ALL_LLM_MODELS).toContain('gpt-image-1');
    });

    it('contains all Anthropic models', () => {
      expect(ALL_LLM_MODELS).toContain('claude-opus-4-5-20251101');
      expect(ALL_LLM_MODELS).toContain('claude-sonnet-4-5-20250929');
      expect(ALL_LLM_MODELS).toContain('claude-3-5-haiku-20241022');
    });

    it('contains all Perplexity models', () => {
      expect(ALL_LLM_MODELS).toContain('sonar');
      expect(ALL_LLM_MODELS).toContain('sonar-pro');
      expect(ALL_LLM_MODELS).toContain('sonar-deep-research');
    });

    it('contains all Zhipu models', () => {
      expect(ALL_LLM_MODELS).toContain('glm-4.7');
    });
  });

  describe('MODEL_PROVIDER_MAP', () => {
    it('maps every model to a provider', () => {
      for (const model of ALL_LLM_MODELS) {
        expect(['google', 'openai', 'anthropic', 'perplexity', 'zhipu']).toContain(
          MODEL_PROVIDER_MAP[model]
        );
      }
    });

    it('maps Google models correctly', () => {
      expect(MODEL_PROVIDER_MAP['gemini-2.5-pro']).toBe('google');
      expect(MODEL_PROVIDER_MAP['gemini-2.5-flash']).toBe('google');
      expect(MODEL_PROVIDER_MAP['gemini-2.0-flash']).toBe('google');
      expect(MODEL_PROVIDER_MAP['gemini-2.5-flash-image']).toBe('google');
    });

    it('maps OpenAI models correctly', () => {
      expect(MODEL_PROVIDER_MAP['o4-mini-deep-research']).toBe('openai');
      expect(MODEL_PROVIDER_MAP['gpt-5.2']).toBe('openai');
      expect(MODEL_PROVIDER_MAP['gpt-4o-mini']).toBe('openai');
      expect(MODEL_PROVIDER_MAP['gpt-image-1']).toBe('openai');
    });

    it('maps Anthropic models correctly', () => {
      expect(MODEL_PROVIDER_MAP['claude-opus-4-5-20251101']).toBe('anthropic');
      expect(MODEL_PROVIDER_MAP['claude-sonnet-4-5-20250929']).toBe('anthropic');
      expect(MODEL_PROVIDER_MAP['claude-3-5-haiku-20241022']).toBe('anthropic');
    });

    it('maps Perplexity models correctly', () => {
      expect(MODEL_PROVIDER_MAP['sonar']).toBe('perplexity');
      expect(MODEL_PROVIDER_MAP['sonar-pro']).toBe('perplexity');
      expect(MODEL_PROVIDER_MAP['sonar-deep-research']).toBe('perplexity');
    });

    it('maps Zhipu models correctly', () => {
      expect(MODEL_PROVIDER_MAP['glm-4.7']).toBe('zhipu');
    });
  });

  describe('LlmModels constants', () => {
    it('contains all models', () => {
      expect(LlmModels.Gemini25Pro).toBe('gemini-2.5-pro');
      expect(LlmModels.Gemini25Flash).toBe('gemini-2.5-flash');
      expect(LlmModels.GPT52).toBe('gpt-5.2');
      expect(LlmModels.ClaudeOpus45).toBe('claude-opus-4-5-20251101');
      expect(LlmModels.SonarPro).toBe('sonar-pro');
      expect(LlmModels.Glm47).toBe('glm-4.7');
    });
  });

  describe('LlmProviders constants', () => {
    it('contains all providers', () => {
      expect(LlmProviders.Google).toBe('google');
      expect(LlmProviders.OpenAI).toBe('openai');
      expect(LlmProviders.Anthropic).toBe('anthropic');
      expect(LlmProviders.Perplexity).toBe('perplexity');
      expect(LlmProviders.Zhipu).toBe('zhipu');
    });
  });

  describe('getProviderForModel', () => {
    it('returns correct provider for all models', () => {
      expect(getProviderForModel('gemini-2.5-pro')).toBe('google');
      expect(getProviderForModel('claude-opus-4-5-20251101')).toBe('anthropic');
      expect(getProviderForModel('gpt-5.2')).toBe('openai');
      expect(getProviderForModel('sonar-pro')).toBe('perplexity');
      expect(getProviderForModel('glm-4.7')).toBe('zhipu');
    });
  });

  describe('isValidModel', () => {
    it('returns true for valid models', () => {
      expect(isValidModel('gemini-2.5-pro')).toBe(true);
      expect(isValidModel('claude-opus-4-5-20251101')).toBe(true);
      expect(isValidModel('o4-mini-deep-research')).toBe(true);
      expect(isValidModel('sonar-pro')).toBe(true);
      expect(isValidModel('gpt-image-1')).toBe(true);
      expect(isValidModel('glm-4.7')).toBe(true);
    });

    it('returns false for invalid models', () => {
      expect(isValidModel('invalid-model')).toBe(false);
      expect(isValidModel('')).toBe(false);
      expect(isValidModel('gpt-4')).toBe(false);
    });
  });

  describe('type compatibility', () => {
    it('allows ResearchModel where LLMModel is expected', () => {
      const researchModel: ResearchModel = 'gemini-2.5-pro';
      const llmModel: LLMModel = researchModel;
      expect(llmModel).toBe('gemini-2.5-pro');
    });

    it('allows ImageModel where LLMModel is expected', () => {
      const imageModel: ImageModel = 'gpt-image-1';
      const llmModel: LLMModel = imageModel;
      expect(llmModel).toBe('gpt-image-1');
    });

    it('allows ValidationModel where LLMModel is expected', () => {
      const validationModel: ValidationModel = 'gpt-4o-mini';
      const llmModel: LLMModel = validationModel;
      expect(llmModel).toBe('gpt-4o-mini');
    });

    it('allows FastModel where LLMModel is expected', () => {
      const fastModel: FastModel = 'gemini-2.5-flash';
      const llmModel: LLMModel = fastModel;
      expect(llmModel).toBe('gemini-2.5-flash');
    });
  });
});
