/**
 * Tests for modelExtractionPrompt module.
 * Verifies prompt building and response parsing for LLM model selection.
 */

import { describe, expect, it } from 'vitest';
import { LlmModels, LlmProviders, type ResearchModel } from '@intexuraos/llm-contract';
import {
  buildModelExtractionPrompt,
  parseModelExtractionResponse,
  MODEL_KEYWORDS,
  PROVIDER_DEFAULT_MODELS,
  SYNTHESIS_MODELS,
  DEFAULT_SYNTHESIS_MODEL,
  type ModelExtractionPromptDeps,
} from '../modelExtractionPrompt.js';

describe('buildModelExtractionPrompt', () => {
  const createTestDeps = (
    overrides?: Partial<ModelExtractionPromptDeps>
  ): ModelExtractionPromptDeps => ({
    userMessage: 'Research AI developments using gemini',
    availableModels: [
      {
        id: LlmModels.Gemini25Pro,
        provider: LlmProviders.Google,
        displayName: 'Gemini 2.5 Pro',
        keywords: ['gemini pro', 'gemini-pro', 'pro'],
        isProviderDefault: true,
      },
      {
        id: LlmModels.GPT52,
        provider: LlmProviders.OpenAI,
        displayName: 'GPT 5.2',
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
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('## User Message');
    expect(result).toContain('"My custom research query"');
  });

  it('lists available models with display names and providers', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('## Available Models');
    expect(result).toContain(`- ${LlmModels.Gemini25Pro}: Gemini 2.5 Pro (${LlmProviders.Google})`);
    expect(result).toContain(`- ${LlmModels.GPT52}: GPT 5.2 (${LlmProviders.OpenAI})`);
  });

  it('includes keywords for each model', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('Keywords: gemini pro, gemini-pro, pro');
    expect(result).toContain('Keywords: gpt, gpt-5, openai, chatgpt');
  });

  it('marks provider default models', () => {
    const deps = createTestDeps({
      availableModels: [
        {
          id: LlmModels.Gemini25Pro,
          provider: LlmProviders.Google,
          displayName: 'Gemini 2.5 Pro',
          keywords: ['gemini'],
          isProviderDefault: true,
        },
        {
          id: LlmModels.Gemini25Flash,
          provider: LlmProviders.Google,
          displayName: 'Gemini 2.5 Flash',
          keywords: ['flash'],
          isProviderDefault: false,
        },
      ],
    });
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain(
      `${LlmModels.Gemini25Pro}: Gemini 2.5 Pro (${LlmProviders.Google}) (provider default)`
    );
    expect(result).not.toContain(
      `${LlmModels.Gemini25Flash}: Gemini 2.5 Flash (${LlmProviders.Google}) (provider default)`
    );
  });

  it('includes synthesis models in constraints', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('## Constraints');
    expect(result).toContain(
      `Only these models can be used for synthesis: ${SYNTHESIS_MODELS.join(', ')}`
    );
  });

  it('includes default synthesis model fallback instruction', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain(
      `If user requests a model for synthesis that doesn't support it, use ${DEFAULT_SYNTHESIS_MODEL} instead`
    );
  });

  it('includes provider defaults section', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('## Provider Defaults');
    expect(result).toContain(`- ${LlmProviders.Google}: ${LlmModels.Gemini25Pro}`);
    expect(result).toContain(`- ${LlmProviders.OpenAI}: ${LlmModels.GPT52}`);
  });

  it('omits providers without defaults from provider defaults section', () => {
    const deps = createTestDeps({
      availableModels: [
        {
          id: LlmModels.Gemini25Flash,
          provider: LlmProviders.Google,
          displayName: 'Gemini 2.5 Flash',
          keywords: ['flash'],
          isProviderDefault: false, // Not a default
        },
      ],
    });
    const result = buildModelExtractionPrompt(deps);

    // Should not have google in defaults since no model is marked as default
    expect(result).not.toContain(`- ${LlmProviders.Google}:`);
  });

  it('includes special cases instructions', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('## Special Cases');
    expect(result).toContain('"all models"');
    expect(result).toContain('"all except X"');
    expect(result).toContain('No model mentioned: Return empty selectedModels');
  });

  it('includes response format specification', () => {
    const deps = createTestDeps();
    const result = buildModelExtractionPrompt(deps);

    expect(result).toContain('## Response Format');
    expect(result).toContain('"selectedModels": ["model-id-1", "model-id-2"]');
    expect(result).toContain('"synthesisModel": "model-id" or null');
  });

  it('handles multiple models from same provider', () => {
    const deps = createTestDeps({
      availableModels: [
        {
          id: LlmModels.Gemini25Pro,
          provider: LlmProviders.Google,
          displayName: 'Gemini 2.5 Pro',
          keywords: ['pro'],
          isProviderDefault: true,
        },
        {
          id: LlmModels.Gemini25Flash,
          provider: LlmProviders.Google,
          displayName: 'Gemini 2.5 Flash',
          keywords: ['flash'],
          isProviderDefault: false,
        },
      ],
    });
    const result = buildModelExtractionPrompt(deps);

    // Both models should be listed
    expect(result).toContain(LlmModels.Gemini25Pro);
    expect(result).toContain(LlmModels.Gemini25Flash);
    // But only one provider default
    expect(result).toContain(`- ${LlmProviders.Google}: ${LlmModels.Gemini25Pro}`);
  });
});

describe('parseModelExtractionResponse', () => {
  const validModels: ResearchModel[] = [
    LlmModels.Gemini25Pro,
    LlmModels.GPT52,
    LlmModels.ClaudeSonnet45,
    LlmModels.SonarPro,
  ];

  describe('valid responses', () => {
    it('parses valid JSON with selected models', () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.GPT52],
        synthesisModel: LlmModels.Gemini25Pro,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([LlmModels.Gemini25Pro, LlmModels.GPT52]);
      expect(result?.synthesisModel).toBe(LlmModels.Gemini25Pro);
    });

    it('parses response with null synthesisModel', () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
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
      {"selectedModels": ["${LlmModels.Gemini25Pro}"], "synthesisModel": null}
      I hope this helps!`;

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([LlmModels.Gemini25Pro]);
    });

    it('extracts JSON with whitespace and newlines', () => {
      const response = `{
        "selectedModels": ["${LlmModels.Gemini25Pro}"],
        "synthesisModel": "${LlmModels.GPT52}"
      }`;

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([LlmModels.Gemini25Pro]);
      expect(result?.synthesisModel).toBe(LlmModels.GPT52);
    });
  });

  describe('filtering invalid models', () => {
    it('filters out invalid model IDs from selectedModels', () => {
      const response = JSON.stringify({
        selectedModels: ['invalid-model', LlmModels.Gemini25Pro, 'another-invalid'],
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([LlmModels.Gemini25Pro]);
    });

    it('filters out non-string values from selectedModels', () => {
      const response = JSON.stringify({
        selectedModels: [123, LlmModels.Gemini25Pro, null, { model: 'test' }],
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([LlmModels.Gemini25Pro]);
    });

    it('returns null synthesisModel for invalid synthesis model ID', () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: 'invalid-synthesis-model',
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.synthesisModel).toBeNull();
    });

    it('returns null synthesisModel for non-string synthesis model', () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
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
        synthesisModel: LlmModels.Gemini25Pro,
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
        selectedModels: { model: LlmModels.Gemini25Pro },
        synthesisModel: null,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty validModels list', () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
      });

      const result = parseModelExtractionResponse(response, []);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([]);
      expect(result?.synthesisModel).toBeNull();
    });

    it('handles response with additional unknown properties', () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: null,
        unknownField: 'should be ignored',
        anotherField: 123,
      });

      const result = parseModelExtractionResponse(response, validModels);

      expect(result).not.toBeNull();
      expect(result?.selectedModels).toEqual([LlmModels.Gemini25Pro]);
    });

    it('handles deeply nested JSON by extracting first match', () => {
      const response =
        'Some text {"outer": {"selectedModels": [], "synthesisModel": null}} more text';

      const result = parseModelExtractionResponse(response, validModels);

      // Should extract the outer JSON
      expect(result).toBeNull(); // selectedModels not at root level
    });
  });
});

describe('exported constants', () => {
  describe('MODEL_KEYWORDS', () => {
    it('has keywords for all research models', () => {
      expect(MODEL_KEYWORDS[LlmModels.Gemini25Pro]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.Gemini25Flash]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.ClaudeOpus45]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.ClaudeSonnet45]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.O4MiniDeepResearch]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.GPT52]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.Sonar]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.SonarPro]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.SonarDeepResearch]).toBeDefined();
      expect(MODEL_KEYWORDS[LlmModels.Glm47]).toBeDefined();
    });

    it('each model has at least one keyword', () => {
      for (const [_model, keywords] of Object.entries(MODEL_KEYWORDS)) {
        expect(keywords.length).toBeGreaterThan(0);
      }
    });
  });

  describe('PROVIDER_DEFAULT_MODELS', () => {
    it('has defaults for all major providers', () => {
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Google]).toBe(LlmModels.Gemini25Pro);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Anthropic]).toBe(LlmModels.ClaudeSonnet45);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.OpenAI]).toBe(LlmModels.GPT52);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Perplexity]).toBe(LlmModels.SonarPro);
      expect(PROVIDER_DEFAULT_MODELS[LlmProviders.Zai]).toBe(LlmModels.Glm47);
    });
  });

  describe('SYNTHESIS_MODELS', () => {
    it('includes Gemini Pro and GPT 5.2', () => {
      expect(SYNTHESIS_MODELS).toContain(LlmModels.Gemini25Pro);
      expect(SYNTHESIS_MODELS).toContain(LlmModels.GPT52);
    });

    it('does not include non-synthesis models', () => {
      expect(SYNTHESIS_MODELS).not.toContain(LlmModels.ClaudeSonnet45);
      expect(SYNTHESIS_MODELS).not.toContain(LlmModels.SonarPro);
    });
  });

  describe('DEFAULT_SYNTHESIS_MODEL', () => {
    it('is Gemini Pro', () => {
      expect(DEFAULT_SYNTHESIS_MODEL).toBe(LlmModels.Gemini25Pro);
    });

    it('is in SYNTHESIS_MODELS', () => {
      expect(SYNTHESIS_MODELS).toContain(DEFAULT_SYNTHESIS_MODEL);
    });
  });
});
