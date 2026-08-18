import { describe, expect, it } from 'vitest';
import {
  ALL_LLM_MODELS,
  ALL_FAST_MODELS,
  FAST_MODEL_DISPLAY_NAMES,
  MODEL_PROVIDER_MAP,
  getProviderForModel,
  isFastModel,
  isValidModel,
  isLegacyGoogleModel,
  LEGACY_GOOGLE_MODELS,
  LegacyGoogleModels,
  LlmModels,
  LlmProviders,
  isOpenRouterModel,
  createOpenRouterModelId,
  getOpenRouterRawId,
  isToolCallingModel,
  OpenRouterToolCallingModels,
  ALL_TOOL_CALLING_MODELS,
  DEFAULT_OPENROUTER_MODELS,
  DEFAULT_ELIGIBLE_STATIC_MODELS,
  isDefaultEligibleModel,
  DEFAULT_MODEL_DISPLAY_NAMES,
  ConversationAssistantModels,
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  CONVERSATION_ASSISTANT_MODEL_OPTIONS,
  CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES,
  isConversationAssistantModel,
  getConversationAssistantModelDisplayName,
  IntexAgentModels,
  DEFAULT_INTEX_AGENT_MODEL,
  DEFAULT_PLATFORM_LLM_MODEL,
  INTEX_AGENT_MODEL_OPTIONS,
  isIntexAgentModel,
  normalizeRetiredOpenRouterModel,
  type LLMModel,
  type ResearchModel,
  type ImageModel,
  type ValidationModel,
  type FastModel,
  type DefaultEligibleModel,
  type DefaultOpenRouterModel,
  type ConversationAssistantModelOption,
  type IntexAgentModel,
  type LegacyGoogleModel,
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
    expect(isOpenRouterModel('claude-opus-4-6')).toBe(false);
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

describe('Tool calling model helpers', () => {
  it('rejects the retired raw Gemini tool calling model', () => {
    expect(isToolCallingModel('gemini-2.5-flash')).toBe(false);
  });

  it('accepts OpenRouter model IDs for tool calling', () => {
    expect(isToolCallingModel(OpenRouterToolCallingModels.Gemini36Flash)).toBe(true);
    expect(isToolCallingModel('or:google/gemini-3-flash-preview')).toBe(false);
  });

  it('rejects non-tool-calling model IDs', () => {
    expect(isToolCallingModel('gemini-2.5-pro')).toBe(false);
    expect(isToolCallingModel('or:some/unknown-model')).toBe(false);
    expect(isToolCallingModel('or:')).toBe(false);
    expect(isToolCallingModel('not-a-model')).toBe(false);
  });
});

describe('IntexAgentModel', () => {
  it('exposes exactly the canonical model IDs in order', () => {
    expect(Object.values(IntexAgentModels)).toEqual([
      'or:deepseek/deepseek-v4-flash',
      'or:minimax/minimax-m3',
      'or:google/gemini-3.6-flash',
    ]);
  });

  it('exposes the exact ordered options with labels and providers', () => {
    expect(INTEX_AGENT_MODEL_OPTIONS).toEqual([
      {
        id: IntexAgentModels.DeepSeekV4Flash,
        label: 'DeepSeek V4 Flash',
        provider: 'DeepSeek',
      },
      {
        id: IntexAgentModels.MiniMaxM3,
        label: 'MiniMax M3',
        provider: 'MiniMax',
      },
      {
        id: IntexAgentModels.Gemini36Flash,
        label: 'Gemini 3.6 Flash',
        provider: 'Google',
      },
    ]);
  });

  it('defaults to DeepSeek V4 Flash', () => {
    expect(DEFAULT_INTEX_AGENT_MODEL).toBe(IntexAgentModels.DeepSeekV4Flash);
  });

  it('uses the stable OpenRouter platform default', () => {
    expect(DEFAULT_PLATFORM_LLM_MODEL).toBe(IntexAgentModels.MiniMaxM3);
    expect(getProviderForModel(DEFAULT_PLATFORM_LLM_MODEL)).toBe(LlmProviders.OpenRouter);
  });

  it('accepts exactly the three canonical model IDs', () => {
    for (const model of Object.values(IntexAgentModels)) {
      expect(isIntexAgentModel(model)).toBe(true);
    }
  });

  it('rejects unsafe and non-canonical values without throwing', () => {
    const unsafeValues: unknown[] = [
      undefined,
      null,
      '',
      'deepseek/deepseek-v4-flash',
      'or:deepseek/deepseek-v4-flash:free',
      'or:unknown/model',
      42,
      {},
      [],
      Symbol('model'),
    ];

    for (const value of unsafeValues) {
      expect(() => isIntexAgentModel(value)).not.toThrow();
      expect(isIntexAgentModel(value)).toBe(false);
    }
  });

  it('narrows accepted values to IntexAgentModel', () => {
    const value: unknown = IntexAgentModels.DeepSeekV4Flash;
    if (isIntexAgentModel(value)) {
      const typed: IntexAgentModel = value;
      expect(typed).toBe(IntexAgentModels.DeepSeekV4Flash);
    }
  });

  it('normalizes the retired Gemini preview id for rolling deployments', () => {
    expect(normalizeRetiredOpenRouterModel('or:google/gemini-3-flash-preview')).toBe(
      IntexAgentModels.Gemini36Flash
    );
    expect(normalizeRetiredOpenRouterModel(IntexAgentModels.DeepSeekV4Flash)).toBe(
      IntexAgentModels.DeepSeekV4Flash
    );
  });

  it('makes every canonical Intex Agent model eligible for tool calling', () => {
    for (const model of Object.values(IntexAgentModels)) {
      expect(ALL_TOOL_CALLING_MODELS).toContain(model);
      expect(isToolCallingModel(model)).toBe(true);
    }
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

  it('returns Google for explicit legacy-read model IDs', () => {
    expect(getProviderForModel(LegacyGoogleModels.Gemini25Pro)).toBe('google');
  });

  it('returns correct provider for executable static models', () => {
    expect(getProviderForModel(LlmModels.GPT54)).toBe('openai');
    expect(getProviderForModel(LlmModels.ClaudeOpus46)).toBe('anthropic');
    expect(getProviderForModel(LlmModels.Sonar)).toBe('perplexity');
  });

  it('rejects unknown model identifiers', () => {
    expect(() => getProviderForModel('unknown/model')).toThrow('Unknown LLM model: unknown/model');
  });
});

describe('supportedModels', () => {
  describe('ALL_LLM_MODELS', () => {
    it('contains all 11 executable static models', () => {
      expect(ALL_LLM_MODELS).toHaveLength(11);
    });

    it('does not contain retired direct-Google models', () => {
      for (const model of LEGACY_GOOGLE_MODELS) {
        expect(ALL_LLM_MODELS).not.toContain(model);
      }
    });

    it('contains all OpenAI models', () => {
      expect(ALL_LLM_MODELS).toContain('o4-mini-deep-research');
      expect(ALL_LLM_MODELS).toContain('gpt-5.4');
      expect(ALL_LLM_MODELS).toContain('gpt-4o-mini');
      expect(ALL_LLM_MODELS).toContain('gpt-image-1');
    });

    it('contains all Anthropic models', () => {
      expect(ALL_LLM_MODELS).toContain('claude-opus-4-6');
      expect(ALL_LLM_MODELS).toContain('claude-sonnet-4-6');
      expect(ALL_LLM_MODELS).toContain('claude-sonnet-4-7');
      expect(ALL_LLM_MODELS).toContain('claude-3-5-haiku-20241022');
    });

    it('contains all Perplexity models', () => {
      expect(ALL_LLM_MODELS).toContain('sonar');
      expect(ALL_LLM_MODELS).toContain('sonar-pro');
      expect(ALL_LLM_MODELS).toContain('sonar-deep-research');
    });
  });

  describe('MODEL_PROVIDER_MAP', () => {
    it('maps every model to a provider', () => {
      for (const model of ALL_LLM_MODELS) {
        expect(['openai', 'anthropic', 'perplexity']).toContain(MODEL_PROVIDER_MAP[model]);
      }
    });

    it('does not expose legacy Google IDs in the executable provider map', () => {
      for (const model of LEGACY_GOOGLE_MODELS) {
        expect(MODEL_PROVIDER_MAP).not.toHaveProperty(model);
      }
    });

    it('maps OpenAI models correctly', () => {
      expect(MODEL_PROVIDER_MAP['o4-mini-deep-research']).toBe('openai');
      expect(MODEL_PROVIDER_MAP['gpt-5.4']).toBe('openai');
      expect(MODEL_PROVIDER_MAP['gpt-4o-mini']).toBe('openai');
      expect(MODEL_PROVIDER_MAP['gpt-image-1']).toBe('openai');
    });

    it('maps Anthropic models correctly', () => {
      expect(MODEL_PROVIDER_MAP['claude-opus-4-6']).toBe('anthropic');
      expect(MODEL_PROVIDER_MAP['claude-sonnet-4-6']).toBe('anthropic');
      expect(MODEL_PROVIDER_MAP['claude-sonnet-4-7']).toBe('anthropic');
      expect(MODEL_PROVIDER_MAP['claude-3-5-haiku-20241022']).toBe('anthropic');
    });

    it('maps Perplexity models correctly', () => {
      expect(MODEL_PROVIDER_MAP['sonar']).toBe('perplexity');
      expect(MODEL_PROVIDER_MAP['sonar-pro']).toBe('perplexity');
      expect(MODEL_PROVIDER_MAP['sonar-deep-research']).toBe('perplexity');
    });
  });

  describe('LlmModels constants', () => {
    it('contains executable models only', () => {
      expect(LlmModels.GPT54).toBe('gpt-5.4');
      expect(LlmModels.ClaudeOpus46).toBe('claude-opus-4-6');
      expect(LlmModels.SonarPro).toBe('sonar-pro');
      expect(LlmModels).not.toHaveProperty('Gemini25Pro');
    });
  });

  describe('legacy Google model contract', () => {
    it('recognizes exactly the retired raw Gemini identifiers', () => {
      expect(LEGACY_GOOGLE_MODELS).toEqual([
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.5-flash-image',
      ]);
      for (const model of LEGACY_GOOGLE_MODELS) {
        expect(isLegacyGoogleModel(model)).toBe(true);
        expect(isValidModel(model)).toBe(false);
      }
    });

    it('narrows legacy values without making them executable', () => {
      const value = 'gemini-2.5-pro';
      if (isLegacyGoogleModel(value)) {
        const legacy: LegacyGoogleModel = value;
        expect(legacy).toBe(LegacyGoogleModels.Gemini25Pro);
      }
    });
  });

  describe('isValidModel', () => {
    it('returns true for valid models', () => {
      expect(isValidModel('claude-opus-4-6')).toBe(true);
      expect(isValidModel('o4-mini-deep-research')).toBe(true);
      expect(isValidModel('sonar-pro')).toBe(true);
      expect(isValidModel('gpt-image-1')).toBe(true);
    });

    it('returns false for invalid and legacy models (including GLM-4.7)', () => {
      expect(isValidModel('gemini-2.5-pro')).toBe(false);
      expect(isValidModel('gemini-2.5-flash')).toBe(false);
      expect(isValidModel('invalid-model')).toBe(false);
      expect(isValidModel('')).toBe(false);
      expect(isValidModel('gpt-4')).toBe(false);
      expect(isValidModel('glm-4.7')).toBe(false);
      expect(isValidModel('glm-4.7-flash')).toBe(false);
    });
  });

  describe('ALL_FAST_MODELS', () => {
    it('contains the 2 executable fast models', () => {
      expect(ALL_FAST_MODELS).toHaveLength(2);
    });

    it('contains expected models', () => {
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
      expect(FAST_MODEL_DISPLAY_NAMES[LlmModels.ClaudeHaiku35]).toBe('Claude 3.5 Haiku');
      expect(FAST_MODEL_DISPLAY_NAMES[LlmModels.GPT4oMini]).toBe('GPT-4o Mini');
    });
  });

  describe('isFastModel', () => {
    it('returns true for fast models', () => {
      expect(isFastModel('claude-3-5-haiku-20241022')).toBe(true);
      expect(isFastModel('gpt-4o-mini')).toBe(true);
    });

    it('returns false for non-fast models (including GLM-4.7-flash)', () => {
      expect(isFastModel('gemini-2.5-flash')).toBe(false);
      expect(isFastModel('gemini-2.0-flash')).toBe(false);
      expect(isFastModel('gemini-2.5-pro')).toBe(false);
      expect(isFastModel('gpt-5.4')).toBe(false);
      expect(isFastModel('claude-opus-4-6')).toBe(false);
      expect(isFastModel('sonar')).toBe(false);
      expect(isFastModel('glm-4.7-flash')).toBe(false);
      expect(isFastModel('invalid-model')).toBe(false);
      expect(isFastModel('')).toBe(false);
    });
  });

  describe('type compatibility', () => {
    it('allows ResearchModel where LLMModel is expected', () => {
      const researchModel: ResearchModel = 'claude-opus-4-6';
      const llmModel: LLMModel = researchModel;
      expect(llmModel).toBe('claude-opus-4-6');
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
      const fastModel: FastModel = 'gpt-4o-mini';
      const llmModel: LLMModel = fastModel;
      expect(llmModel).toBe('gpt-4o-mini');
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

  describe('new model identifiers (2026-04 migration)', () => {
    it('exposes GPT54 with id "gpt-5.4"', () => {
      expect(LlmModels.GPT54).toBe('gpt-5.4');
    });

    it('exposes ClaudeSonnet46 with id "claude-sonnet-4-6"', () => {
      expect(LlmModels.ClaudeSonnet46).toBe('claude-sonnet-4-6');
    });

    it('exposes ClaudeOpus46 with id "claude-opus-4-6"', () => {
      expect(LlmModels.ClaudeOpus46).toBe('claude-opus-4-6');
    });

    it('includes the three new models in ALL_LLM_MODELS', () => {
      expect(ALL_LLM_MODELS).toContain(LlmModels.GPT54);
      expect(ALL_LLM_MODELS).toContain(LlmModels.ClaudeSonnet46);
      expect(ALL_LLM_MODELS).toContain(LlmModels.ClaudeOpus46);
    });

    it('maps each new model to the correct provider', () => {
      expect(MODEL_PROVIDER_MAP[LlmModels.GPT54]).toBe(LlmProviders.OpenAI);
      expect(MODEL_PROVIDER_MAP[LlmModels.ClaudeSonnet46]).toBe(LlmProviders.Anthropic);
      expect(MODEL_PROVIDER_MAP[LlmModels.ClaudeOpus46]).toBe(LlmProviders.Anthropic);
    });
  });
});

describe('DefaultEligibleModel', () => {
  describe('DEFAULT_OPENROUTER_MODELS', () => {
    it('contains exactly 6 models', () => {
      expect(DEFAULT_OPENROUTER_MODELS).toHaveLength(6);
    });

    it('contains expected model IDs', () => {
      const ids = DEFAULT_OPENROUTER_MODELS.map((m) => m.id);
      expect(ids).toContain('google/gemma-4-31b-it:free');
      expect(ids).toContain('google/gemma-4-31b-it');
      expect(ids).toContain('google/gemini-3.6-flash');
      expect(ids).not.toContain('google/gemini-3-flash-preview');
      expect(ids).toContain('minimax/minimax-m3');
      expect(ids).toContain('qwen/qwen3.6-plus');
      expect(ids).toContain('nvidia/nemotron-3-super-120b-a12b:free');
    });

    it('each entry has id, name, and provider fields', () => {
      for (const model of DEFAULT_OPENROUTER_MODELS) {
        const m: DefaultOpenRouterModel = model;
        expect(typeof m.id).toBe('string');
        expect(typeof m.name).toBe('string');
        expect(typeof m.provider).toBe('string');
      }
    });
  });

  describe('isDefaultEligibleModel', () => {
    it('accepts non-Google fast models', () => {
      expect(isDefaultEligibleModel('claude-3-5-haiku-20241022')).toBe(true);
      expect(isDefaultEligibleModel('gpt-4o-mini')).toBe(true);
    });

    it('rejects raw Gemini defaults so Google models can only run through OpenRouter', () => {
      expect(isDefaultEligibleModel('gemini-2.5-flash')).toBe(false);
      expect(isDefaultEligibleModel('gemini-2.0-flash')).toBe(false);
    });

    it('accepts OpenRouter default models with or: prefix', () => {
      expect(isDefaultEligibleModel('or:google/gemma-4-31b-it:free')).toBe(true);
      expect(isDefaultEligibleModel('or:google/gemma-4-31b-it')).toBe(true);
      expect(isDefaultEligibleModel('or:google/gemini-3.6-flash')).toBe(true);
      expect(isDefaultEligibleModel('or:google/gemini-3-flash-preview')).toBe(false);
      expect(isDefaultEligibleModel('or:minimax/minimax-m3')).toBe(true);
      expect(isDefaultEligibleModel('or:qwen/qwen3.6-plus')).toBe(true);
      expect(isDefaultEligibleModel('or:nvidia/nemotron-3-super-120b-a12b:free')).toBe(true);
    });

    it('rejects unknown models', () => {
      expect(isDefaultEligibleModel('unknown-model')).toBe(false);
      expect(isDefaultEligibleModel('')).toBe(false);
      expect(isDefaultEligibleModel('or:some/unknown-model')).toBe(false);
    });

    it('rejects non-fast static models', () => {
      expect(isDefaultEligibleModel('gemini-2.5-pro')).toBe(false);
      expect(isDefaultEligibleModel('gpt-5.2')).toBe(false);
      expect(isDefaultEligibleModel('claude-opus-4-5-20251101')).toBe(false);
      expect(isDefaultEligibleModel('sonar')).toBe(false);
    });

    it('type guard narrows to DefaultEligibleModel', () => {
      const model = 'gpt-4o-mini';
      if (isDefaultEligibleModel(model)) {
        const _typed: DefaultEligibleModel = model;
        expect(_typed).toBe('gpt-4o-mini');
      }
    });
  });

  describe('DEFAULT_MODEL_DISPLAY_NAMES', () => {
    it('has entries for all eligible static models', () => {
      for (const model of DEFAULT_ELIGIBLE_STATIC_MODELS) {
        expect(DEFAULT_MODEL_DISPLAY_NAMES[model]).toBeDefined();
        expect(typeof DEFAULT_MODEL_DISPLAY_NAMES[model]).toBe('string');
      }
    });

    it('has entries for all default OpenRouter models', () => {
      for (const m of DEFAULT_OPENROUTER_MODELS) {
        const key = `or:${m.id}`;
        expect(DEFAULT_MODEL_DISPLAY_NAMES[key]).toBeDefined();
        expect(typeof DEFAULT_MODEL_DISPLAY_NAMES[key]).toBe('string');
      }
    });

    it('has correct display names for eligible static models', () => {
      expect(DEFAULT_MODEL_DISPLAY_NAMES[LlmModels.ClaudeHaiku35]).toBe('Claude 3.5 Haiku');
      expect(DEFAULT_MODEL_DISPLAY_NAMES[LlmModels.GPT4oMini]).toBe('GPT-4o Mini');
    });

    it('has correct display names for default OpenRouter models', () => {
      expect(DEFAULT_MODEL_DISPLAY_NAMES['or:google/gemma-4-31b-it:free']).toBe(
        'Gemma 4 31B IT (Free)'
      );
      expect(DEFAULT_MODEL_DISPLAY_NAMES['or:google/gemma-4-31b-it']).toBe('Gemma 4 31B IT');
      expect(DEFAULT_MODEL_DISPLAY_NAMES['or:google/gemini-3.6-flash']).toBe('Gemini 3.6 Flash');
      expect(DEFAULT_MODEL_DISPLAY_NAMES['or:minimax/minimax-m3']).toBe('MiniMax M3');
      expect(DEFAULT_MODEL_DISPLAY_NAMES['or:qwen/qwen3.6-plus']).toBe('Qwen 3.6 Plus');
      expect(DEFAULT_MODEL_DISPLAY_NAMES['or:nvidia/nemotron-3-super-120b-a12b:free']).toBe(
        'Nemotron 3 Super 120B'
      );
    });

    it('has exactly 8 entries (2 eligible static + 6 OpenRouter)', () => {
      expect(Object.keys(DEFAULT_MODEL_DISPLAY_NAMES)).toHaveLength(8);
    });
  });
});

describe('ConversationAssistantModel', () => {
  describe('ConversationAssistantModels', () => {
    it('exposes the expected typed model ids', () => {
      expect(ConversationAssistantModels.MiniMaxM3).toBe('or:minimax/minimax-m3');
      expect(ConversationAssistantModels.ClaudeSonnet5).toBe('or:anthropic/claude-sonnet-5');
      expect(ConversationAssistantModels.Gemini35FlashThinking).toBe('or:google/gemini-3.5-flash');
    });
  });

  describe('CONVERSATION_ASSISTANT_MODEL_OPTIONS', () => {
    it('contains exactly the curated Conversation Assistant models', () => {
      expect(CONVERSATION_ASSISTANT_MODEL_OPTIONS).toHaveLength(3);
    });

    it('contains the expected labels and providers', () => {
      expect(CONVERSATION_ASSISTANT_MODEL_OPTIONS).toEqual([
        {
          id: ConversationAssistantModels.MiniMaxM3,
          label: 'MiniMax M3',
          provider: 'MiniMax',
          supportsReasoning: true,
        },
        {
          id: ConversationAssistantModels.ClaudeSonnet5,
          label: 'Claude Sonnet 5',
          provider: 'Anthropic',
          supportsReasoning: true,
        },
        {
          id: ConversationAssistantModels.Gemini35FlashThinking,
          label: 'Gemini 3.5 Flash Thinking',
          provider: 'Google',
          supportsReasoning: true,
        },
      ] satisfies readonly ConversationAssistantModelOption[]);
    });
  });

  describe('DEFAULT_CONVERSATION_ASSISTANT_MODEL', () => {
    it('defaults to MiniMax M3', () => {
      expect(DEFAULT_CONVERSATION_ASSISTANT_MODEL).toBe('or:minimax/minimax-m3');
    });
  });

  describe('isConversationAssistantModel', () => {
    it('accepts each curated model id', () => {
      expect(isConversationAssistantModel('or:minimax/minimax-m3')).toBe(true);
      expect(isConversationAssistantModel('or:anthropic/claude-sonnet-5')).toBe(true);
      expect(isConversationAssistantModel('or:google/gemini-3.5-flash')).toBe(true);
    });

    it('rejects unknown model ids', () => {
      expect(isConversationAssistantModel('or:unknown/model')).toBe(false);
      expect(isConversationAssistantModel('')).toBe(false);
    });
  });

  describe('display names', () => {
    it('contains display names for each curated model', () => {
      expect(CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES).toEqual({
        'or:minimax/minimax-m3': 'MiniMax M3',
        'or:anthropic/claude-sonnet-5': 'Claude Sonnet 5',
        'or:google/gemini-3.5-flash': 'Gemini 3.5 Flash Thinking',
      });
    });

    it('returns the display name for curated models and raw text for unknown values', () => {
      expect(getConversationAssistantModelDisplayName('or:anthropic/claude-sonnet-5')).toBe(
        'Claude Sonnet 5'
      );
      expect(getConversationAssistantModelDisplayName('legacy/model')).toBe('legacy/model');
    });

    it('falls back to the model id when the display-name map is missing a curated entry', () => {
      const displayNames = CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES as Record<
        string,
        string | undefined
      >;
      const model = ConversationAssistantModels.MiniMaxM3;
      const original = displayNames[model];
      displayNames[model] = undefined;
      try {
        expect(getConversationAssistantModelDisplayName(model)).toBe(model);
      } finally {
        displayNames[model] = original;
      }
    });
  });
});
