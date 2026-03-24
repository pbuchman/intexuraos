import { describe, expect, it } from 'vitest';
import {
  ALL_LLM_MODELS,
  ALL_FAST_MODELS,
  FAST_MODEL_DISPLAY_NAMES,
  MODEL_PROVIDER_MAP,
  getProviderForModel,
  isFastModel,
  isValidModel,
  LlmModels,
  LlmProviders,
  isOpenRouterModel,
  createOpenRouterModelId,
  getOpenRouterRawId,
  type LLMModel,
  type ResearchModel,
  type ImageModel,
  type ValidationModel,
  type FastModel,
} from '../supportedModels.js';

describe('OpenRouter model helpers', () => {
  it('isOpenRouterModel returns true for or: prefixed models', () => {
    expect(isOpenRouterModel('or:anthropic/claude-sonnet-4')).toBe(true);
    expect(isOpenRouterModel('or:meta-llama/llama-3.1-70b-instruct')).toBe(true);
    expect(isOpenRouterModel('or:qwen/qwen3.5-plus-02-15')).toBe(true);
  });

  it('isOpenRouterModel returns false for static models', () => {
    expect(isOpenRouterModel('gemini-2.5-pro')).toBe(false);
    expect(isOpenRouterModel('')).toBe(false);
    expect(isOpenRouterModel('sonar')).toBe(false);
    expect(isOpenRouterModel('claude-opus-4-5-20251101')).toBe(false);
  });

  it('createOpenRouterModelId adds or: prefix', () => {
    const id = createOpenRouterModelId('anthropic/claude-sonnet-4');
    expect(id).toBe('or:anthropic/claude-sonnet-4');
    expect(isOpenRouterModel(id)).toBe(true);
  });

  it('getOpenRouterRawId strips or: prefix', () => {
    const id = createOpenRouterModelId('meta-llama/llama-3.1-70b');
    expect(getOpenRouterRawId(id)).toBe('meta-llama/llama-3.1-70b');
  });

  it('getOpenRouterRawId returns input for non-OpenRouter models', () => {
    expect(getOpenRouterRawId('gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });
});

describe('LlmProviders constants', () => {
  it('contains all 5 providers (including OpenRouter)', () => {
    expect(LlmProviders.Google).toBe('google');
    expect(LlmProviders.OpenAI).toBe('openai');
    expect(LlmProviders.Anthropic).toBe('anthropic');
    expect(LlmProviders.Perplexity).toBe('perplexity');
    expect(LlmProviders.OpenRouter).toBe('openrouter');
  });
});

describe('getProviderForModel', () => {
  it('returns openrouter for OpenRouter model IDs', () => {
    const orModel = createOpenRouterModelId('anthropic/claude-sonnet-4');
    expect(getProviderForModel(orModel)).toBe('openrouter');
  });

  it('returns correct provider for static models (unchanged)', () => {
    expect(getProviderForModel(LlmModels.Gemini25Pro)).toBe('google');
    expect(getProviderForModel(LlmModels.GPT52)).toBe('openai');
    expect(getProviderForModel(LlmModels.ClaudeOpus45)).toBe('anthropic');
    expect(getProviderForModel(LlmModels.Sonar)).toBe('perplexity');
  });
});

describe('supportedModels', () => {
  describe('ALL_LLM_MODELS', () => {
    it('contains all 14 expected models (no ZAI)', () => {
      expect(ALL_LLM_MODELS).toHaveLength(14);
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

    it('does NOT contain ZAI/GLM-4.7 models', () => {
      expect(ALL_LLM_MODELS).not.toContain('glm-4.7');
      expect(ALL_LLM_MODELS).not.toContain('glm-4.7-flash');
    });
  });

  describe('MODEL_PROVIDER_MAP', () => {
    it('maps every model to a provider', () => {
      for (const model of ALL_LLM_MODELS) {
        expect(['google', 'openai', 'anthropic', 'perplexity']).toContain(
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
  });

  describe('LlmModels constants', () => {
    it('contains all models', () => {
      expect(LlmModels.Gemini25Pro).toBe('gemini-2.5-pro');
      expect(LlmModels.Gemini25Flash).toBe('gemini-2.5-flash');
      expect(LlmModels.GPT52).toBe('gpt-5.2');
      expect(LlmModels.ClaudeOpus45).toBe('claude-opus-4-5-20251101');
      expect(LlmModels.SonarPro).toBe('sonar-pro');
    });
  });

  describe('isValidModel', () => {
    it('returns true for valid models', () => {
      expect(isValidModel('gemini-2.5-pro')).toBe(true);
      expect(isValidModel('claude-opus-4-5-20251101')).toBe(true);
      expect(isValidModel('o4-mini-deep-research')).toBe(true);
      expect(isValidModel('sonar-pro')).toBe(true);
      expect(isValidModel('gpt-image-1')).toBe(true);
    });

    it('returns false for invalid models (including GLM-4.7)', () => {
      expect(isValidModel('invalid-model')).toBe(false);
      expect(isValidModel('')).toBe(false);
      expect(isValidModel('gpt-4')).toBe(false);
      expect(isValidModel('glm-4.7')).toBe(false);
      expect(isValidModel('glm-4.7-flash')).toBe(false);
    });
  });

  describe('ALL_FAST_MODELS', () => {
    it('contains all 4 fast models (no GLM-4.7)', () => {
      expect(ALL_FAST_MODELS).toHaveLength(4);
    });

    it('contains expected models', () => {
      expect(ALL_FAST_MODELS).toContain('gemini-2.5-flash');
      expect(ALL_FAST_MODELS).toContain('gemini-2.0-flash');
      expect(ALL_FAST_MODELS).toContain('claude-3-5-haiku-20241022');
      expect(ALL_FAST_MODELS).toContain('gpt-4o-mini');
    });

    it('does NOT contain GLM-4.7-flash', () => {
      expect(ALL_FAST_MODELS).not.toContain('glm-4.7-flash');
    });
  });

  describe('FAST_MODEL_DISPLAY_NAMES', () => {
    it('has a display name for each fast model', () => {
      for (const model of ALL_FAST_MODELS) {
        expect(FAST_MODEL_DISPLAY_NAMES[model]).toBeDefined();
        expect(typeof FAST_MODEL_DISPLAY_NAMES[model]).toBe('string');
      }
    });

    it('returns expected display names', () => {
      expect(FAST_MODEL_DISPLAY_NAMES[LlmModels.Gemini25Flash]).toBe('Gemini 2.5 Flash');
      expect(FAST_MODEL_DISPLAY_NAMES[LlmModels.ClaudeHaiku35]).toBe('Claude 3.5 Haiku');
      expect(FAST_MODEL_DISPLAY_NAMES[LlmModels.GPT4oMini]).toBe('GPT-4o Mini');
    });
  });

  describe('isFastModel', () => {
    it('returns true for fast models', () => {
      expect(isFastModel('gemini-2.5-flash')).toBe(true);
      expect(isFastModel('gemini-2.0-flash')).toBe(true);
      expect(isFastModel('claude-3-5-haiku-20241022')).toBe(true);
      expect(isFastModel('gpt-4o-mini')).toBe(true);
    });

    it('returns false for non-fast models (including GLM-4.7-flash)', () => {
      expect(isFastModel('gemini-2.5-pro')).toBe(false);
      expect(isFastModel('gpt-5.2')).toBe(false);
      expect(isFastModel('claude-opus-4-5-20251101')).toBe(false);
      expect(isFastModel('sonar')).toBe(false);
      expect(isFastModel('glm-4.7-flash')).toBe(false);
      expect(isFastModel('invalid-model')).toBe(false);
      expect(isFastModel('')).toBe(false);
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

    it('allows ClaudeHaiku35 as FastModel', () => {
      const fastModel: FastModel = 'claude-3-5-haiku-20241022';
      const llmModel: LLMModel = fastModel;
      expect(llmModel).toBe('claude-3-5-haiku-20241022');
    });

    it('allows GPT4oMini as FastModel', () => {
      const fastModel: FastModel = 'gpt-4o-mini';
      const llmModel: LLMModel = fastModel;
      expect(llmModel).toBe('gpt-4o-mini');
    });

    it('allows OpenRouterModelId where ResearchModel is expected', () => {
      const openRouterModel = createOpenRouterModelId('anthropic/claude-sonnet-4.6');
      const researchModel: ResearchModel = openRouterModel;
      expect(researchModel).toBe('or:anthropic/claude-sonnet-4.6');
    });
  });
});
