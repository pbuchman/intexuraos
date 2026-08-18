/**
 * Tests for modelExtractionPrompt module.
 * Verifies prompt building and response parsing for LLM model selection.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import {
  ConversationAssistantModels,
  DEFAULT_PLATFORM_LLM_MODEL,
  IntexAgentModels,
  LegacyGoogleModels,
  LlmModels,
  LlmProviders,
  type ResearchModel,
} from '@intexuraos/llm-contract';
import {
  modelExtractionPrompt,
  parseModelExtractionResponse,
  parseModelExtractionResponseWithLogging,
  MODEL_KEYWORDS,
  PROVIDER_DEFAULT_MODELS,
  SYNTHESIS_MODELS,
  DEFAULT_SYNTHESIS_MODEL,
  type ModelExtractionPromptDeps,
} from '../modelExtractionPrompt.js';

describe('modelExtractionPrompt metadata', () => {
  it('has correct metadata', () => {
    expect(modelExtractionPrompt.name).toBe('research-model-extraction');
    expect(modelExtractionPrompt.description).toContain('model');
    expect(modelExtractionPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('modelExtractionPrompt.build', () => {
  const createTestDeps = (
    overrides?: Partial<ModelExtractionPromptDeps>
  ): ModelExtractionPromptDeps => ({
    userMessage: 'Research AI developments using gemini',
    availableModels: [
      {
        id: IntexAgentModels.Gemini36Flash,
        provider: LlmProviders.Google,
        displayName: 'Gemini 3.6 Flash',
        keywords: ['gemini pro', 'gemini-pro', 'pro'],
        isProviderDefault: true,
      },
      {
        id: LlmModels.GPT54,
        provider: LlmProviders.OpenAI,
        displayName: 'GPT 5.4',
        keywords: ['gpt', 'gpt-5', 'openai', 'chatgpt'],
        isProviderDefault: true,
      },
    ],
    synthesisModels: SYNTHESIS_MODELS,
    defaultSynthesisModel: DEFAULT_SYNTHESIS_MODEL,
    ...overrides,
  });

  it('includes user message in prompt', () => {
    const deps = createTestDeps({ userMessage: 'My custom research query' });
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('## User Message');
    expect(result).toContain('"My custom research query"');
  });

  it('lists available models with display names and providers', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('## Available Models');
    expect(result).toContain(
      `- ${IntexAgentModels.Gemini36Flash}: Gemini 3.6 Flash (${LlmProviders.Google})`
    );
    expect(result).toContain(`- ${LlmModels.GPT54}: GPT 5.4 (${LlmProviders.OpenAI})`);
  });

  it('includes keywords for each model', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('Keywords: gemini pro, gemini-pro, pro');
    expect(result).toContain('Keywords: gpt, gpt-5, openai, chatgpt');
  });

  it('marks provider default models', () => {
    const deps = createTestDeps({
      availableModels: [
        {
          id: IntexAgentModels.Gemini36Flash,
          provider: LlmProviders.Google,
          displayName: 'Gemini 3.6 Flash',
          keywords: ['gemini'],
          isProviderDefault: true,
        },
        {
          id: ConversationAssistantModels.Gemini35FlashThinking,
          provider: LlmProviders.Google,
          displayName: 'Gemini 3.5 Flash Thinking',
          keywords: ['flash'],
          isProviderDefault: false,
        },
      ],
    });
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain(
      `${IntexAgentModels.Gemini36Flash}: Gemini 3.6 Flash (${LlmProviders.Google}) (provider default)`
    );
    expect(result).not.toContain(
      `${ConversationAssistantModels.Gemini35FlashThinking}: Gemini 3.5 Flash Thinking (${LlmProviders.Google}) (provider default)`
    );
  });

  it('includes synthesis models in constraints', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('## Constraints');
    expect(result).toContain(
      `Only these models can be used for synthesis: ${SYNTHESIS_MODELS.join(', ')}`
    );
  });

  it('includes default synthesis model fallback instruction', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain(
      `If user requests a model for synthesis that doesn't support it, use ${DEFAULT_SYNTHESIS_MODEL} instead`
    );
  });

  it('includes provider defaults section', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('## Provider Defaults');
    expect(result).toContain(`- ${LlmProviders.Google}: ${IntexAgentModels.Gemini36Flash}`);
    expect(result).toContain(`- ${LlmProviders.OpenAI}: ${LlmModels.GPT54}`);
  });

  it('omits providers without defaults from provider defaults section', () => {
    const deps = createTestDeps({
      availableModels: [
        {
          id: ConversationAssistantModels.Gemini35FlashThinking,
          provider: LlmProviders.Google,
          displayName: 'Gemini 3.5 Flash Thinking',
          keywords: ['flash'],
          isProviderDefault: false, // Not a default
        },
      ],
    });
    const result = modelExtractionPrompt.build(deps);

    // Should not have google in defaults since no model is marked as default
    expect(result).not.toContain(`- ${LlmProviders.Google}:`);
  });

  it('includes special cases instructions', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('## Special Cases');
    expect(result).toContain('"all models"');
    expect(result).toContain('"all except X"');
    expect(result).toContain('No model mentioned: Return empty selectedModels');
  });

  it('includes response format specification', () => {
    const deps = createTestDeps();
    const result = modelExtractionPrompt.build(deps);

    expect(result).toContain('## Response Format');
    expect(result).toContain('"selectedModels": ["model-id-1", "model-id-2"]');
    expect(result).toContain('"synthesisModel": "model-id" or null');
  });

  it('handles multiple models from same provider', () => {
    const deps = createTestDeps({
      availableModels: [
        {
          id: IntexAgentModels.Gemini36Flash,
          provider: LlmProviders.Google,
          displayName: 'Gemini 3.6 Flash',
          keywords: ['pro'],
          isProviderDefault: true,
        },
        {
          id: ConversationAssistantModels.Gemini35FlashThinking,
          provider: LlmProviders.Google,
          displayName: 'Gemini 3.5 Flash Thinking',
          keywords: ['flash'],
          isProviderDefault: false,
        },
      ],
    });
    const result = modelExtractionPrompt.build(deps);

    // Both models should be listed
    expect(result).toContain(IntexAgentModels.Gemini36Flash);
    expect(result).toContain(ConversationAssistantModels.Gemini35FlashThinking);
    // But only one provider default
    expect(result).toContain(`- ${LlmProviders.Google}: ${IntexAgentModels.Gemini36Flash}`);
  });
});

describe('parseModelExtractionResponse', () => {
  const validModels: ResearchModel[] = [
    IntexAgentModels.Gemini36Flash,
    LlmModels.GPT54,
    LlmModels.ClaudeSonnet46,
    LlmModels.SonarPro,
  ];

  describe('valid responses', () => {
    it('parses valid JSON with selected models', () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash, LlmModels.GPT54],
        synthesisModel: IntexAgentModels.Gemini36Flash,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([IntexAgentModels.Gemini36Flash, LlmModels.GPT54]);
      expect(result?.synthesisModel).toBe(IntexAgentModels.Gemini36Flash);
    });

    it('parses response with null synthesisModel', () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.synthesisModel).toBeNull();
    });

    it('parses response with empty selectedModels array', () => {
      const response = JSON.stringify({
        selectedModels: [],
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([]);
    });

    it('extracts JSON from surrounding text', () => {
      const response = `Based on your request, here is my analysis:
      {"selectedModels": ["${IntexAgentModels.Gemini36Flash}"], "synthesisModel": null}
      I hope this helps!`;

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([IntexAgentModels.Gemini36Flash]);
    });

    it('extracts JSON with whitespace and newlines', () => {
      const response = `{
        "selectedModels": ["${IntexAgentModels.Gemini36Flash}"],
        "synthesisModel": "${LlmModels.GPT54}"
      }`;

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([IntexAgentModels.Gemini36Flash]);
      expect(result?.synthesisModel).toBe(LlmModels.GPT54);
    });
  });

  describe('filtering invalid models', () => {
    it('filters out invalid model IDs from selectedModels', () => {
      const response = JSON.stringify({
        selectedModels: ['invalid-model', IntexAgentModels.Gemini36Flash, 'another-invalid'],
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([IntexAgentModels.Gemini36Flash]);
    });

    it('filters out non-string values from selectedModels', () => {
      const response = JSON.stringify({
        selectedModels: [123, IntexAgentModels.Gemini36Flash, null, { model: 'test' }],
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([IntexAgentModels.Gemini36Flash]);
    });

    it('returns null synthesisModel for invalid synthesis model ID', () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: 'invalid-synthesis-model',
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.synthesisModel).toBeNull();
    });

    it('returns null synthesisModel for non-string synthesis model', () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: 123,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.synthesisModel).toBeNull();
    });
  });

  describe('invalid responses', () => {
    it('returns null when no JSON found in response', () => {
      const response = 'This response has no JSON at all';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when JSON is malformed', () => {
      const response = '{ "selectedModels": [ missing closing bracket }';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when parsed value is not an object', () => {
      const response = '"just a string"';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when parsed value is null', () => {
      const response = 'null';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when parsed value is an array', () => {
      const response = '["array", "not", "object"]';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when selectedModels is missing', () => {
      const response = JSON.stringify({
        synthesisModel: IntexAgentModels.Gemini36Flash,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when selectedModels is not an array', () => {
      const response = JSON.stringify({
        selectedModels: 'not-an-array',
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null when selectedModels is an object', () => {
      const response = JSON.stringify({
        selectedModels: { model: IntexAgentModels.Gemini36Flash },
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty validModels list', () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: IntexAgentModels.Gemini36Flash,
      });

      const result = parseModelExtractionResponse(response, []);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([]);
      expect(result?.synthesisModel).toBeNull();
    });

    it('handles response with additional unknown properties', () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: null,
        unknownField: 'should be ignored',
        anotherField: 123,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([IntexAgentModels.Gemini36Flash]);
    });

    it('handles deeply nested JSON by extracting first match', () => {
      const response =
        'Some text {"outer": {"selectedModels": [], "synthesisModel": null}} more text';

      const result = parseModelExtractionResponse(response, validModels);

      // Should extract the outer JSON
      expect(result).toBeNull(); // selectedModels not at root level
    });

    it('returns null for malformed JSON causing parse error', () => {
      const response = '{"selectedModels": [model1], "synthesisModel": "model"';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null for JSON with circular references (parse error)', () => {
      const response = '{"selectedModels": incomplete';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null for response with only opening brace', () => {
      const response = '{';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });

    it('returns null for response with only opening bracket', () => {
      const response = '[';

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });
  });
});

describe('exported constants', () => {
  describe('MODEL_KEYWORDS', () => {
    it('has keywords only for executable research models', () => {
      expect(Object.hasOwn(MODEL_KEYWORDS, LegacyGoogleModels.Gemini25Pro)).toBe(false);
      expect(Object.hasOwn(MODEL_KEYWORDS, LegacyGoogleModels.Gemini25Flash)).toBe(false);
      expect(MODEL_KEYWORDS[IntexAgentModels.Gemini36Flash]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.ClaudeOpus46]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.ClaudeSonnet46]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.O4MiniDeepResearch]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.GPT54]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.Sonar]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.SonarPro]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.SonarDeepResearch]).toBeDefined();
    });

    it('each model has at least one keyword', () => {
      for (const [_model, keywords] of Object.entries(MODEL_KEYWORDS)) {
        expect(keywords?.length).toBeGreaterThan(0);
      }
    });
  });

  describe('PROVIDER_DEFAULT_MODELS', () => {
    it('has defaults for all major providers', () => {
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Google]).toBe(IntexAgentModels.Gemini36Flash);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Anthropic]).toBe(LlmModels.ClaudeSonnet46);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.OpenAI]).toBe(LlmModels.GPT54);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Perplexity]).toBe(LlmModels.SonarPro);
    });
  });

  describe('SYNTHESIS_MODELS', () => {
    it('includes only OpenRouter platform default and GPT 5.4', () => {
      expect(SYNTHESIS_MODELS).toContain(DEFAULT_PLATFORM_LLM_MODEL);
      expect(SYNTHESIS_MODELS).not.toContain(LegacyGoogleModels.Gemini25Pro);
      expect(SYNTHESIS_MODELS).toContain(LlmModels.GPT54);
    });

    it('does not include non-synthesis models', () => {
      expect(SYNTHESIS_MODELS).not.toContain(LlmModels.ClaudeSonnet46);
      expect(SYNTHESIS_MODELS).not.toContain(LlmModels.SonarPro);
    });
  });

  describe('DEFAULT_SYNTHESIS_MODEL', () => {
    it('is the platform OpenRouter default', () => {
      expect(DEFAULT_SYNTHESIS_MODEL).toBe(DEFAULT_PLATFORM_LLM_MODEL);
    });

    it('is in SYNTHESIS_MODELS', () => {
      expect(SYNTHESIS_MODELS).toContain(DEFAULT_SYNTHESIS_MODEL);
    });
  });
});

describe('parseModelExtractionResponseWithLogging', () => {
  const mockLogger: Logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  const validModels: ResearchModel[] = [IntexAgentModels.Gemini36Flash, LlmModels.GPT54];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns valid response and does not log', () => {
    const response = JSON.stringify({
      selectedModels: [IntexAgentModels.Gemini36Flash],
      synthesisModel: LlmModels.GPT54,
    });

    const result = parseModelExtractionResponseWithLogging(response, validModels, mockLogger);

    expect(result.selectedModels).toEqual([IntexAgentModels.Gemini36Flash]);
    expect(result.synthesisModel).toBe(LlmModels.GPT54);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('throws and logs warning when response does not match schema (no JSON)', () => {
    const response = 'This is just text without any JSON';

    expect(() =>
      parseModelExtractionResponseWithLogging(response, validModels, mockLogger)
    ).toThrow('Failed to parse model extraction');
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseModelExtractionResponse',
        llmResponse: response,
        responseLength: response.length,
      }),
      expect.stringContaining('LLM parse error in parseModelExtractionResponse')
    );
  });

  it('throws and logs warning for invalid JSON', () => {
    const response = '{"selectedModels": [model1], "synthesisModel": "model"';

    expect(() =>
      parseModelExtractionResponseWithLogging(response, validModels, mockLogger)
    ).toThrow();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseModelExtractionResponse',
      }),
      expect.stringContaining('LLM parse error in parseModelExtractionResponse')
    );
  });

  it('throws and logs warning for malformed JSON', () => {
    const response = '{invalid json';

    expect(() =>
      parseModelExtractionResponseWithLogging(response, validModels, mockLogger)
    ).toThrow();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('throws and logs warning for response with missing selectedModels', () => {
    const response = JSON.stringify({ synthesisModel: IntexAgentModels.Gemini36Flash });

    expect(() =>
      parseModelExtractionResponseWithLogging(response, validModels, mockLogger)
    ).toThrow();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});
