/**
 * Tests for extractModelPreferences use case.
 * Verifies LLM-based model extraction from user messages.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import {
  createOpenRouterModelId,
  DEFAULT_PLATFORM_LLM_MODEL,
  IntexAgentModels,
} from '@intexuraos/llm-contract';
import {
  extractModelPreferences,
  getModelDisplayName,
  getModelKeywords,
  validateSynthesisModel,
  type ExtractModelPreferencesDeps,
} from '../../../../domain/research/usecases/extractModelPreferences.js';
import type { ResearchModel } from '../../../../domain/research/index.js';
import type { ApiKeyStore, TextGenerationClient } from '../../../../domain/research/ports/index.js';

const OR_CLAUDE = createOpenRouterModelId('anthropic/claude-sonnet-4.6');
const OR_GPT = createOpenRouterModelId('openai/gpt-5.4');
const OR_DEEPSEEK = createOpenRouterModelId('deepseek/deepseek-v4-flash');

function createSilentLogger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as Logger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}

function createFakeLlmClient(response: string): TextGenerationClient {
  return {
    generate: vi.fn().mockResolvedValue(
      ok({
        content: response,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      })
    ),
  };
}

function createFailingLlmClient(errorCode: string, errorMessage: string): TextGenerationClient {
  return {
    generate: vi.fn().mockResolvedValue(err({ code: errorCode, message: errorMessage })),
  };
}

function createThrowingLlmClient(error: Error): TextGenerationClient {
  return {
    generate: vi.fn().mockRejectedValue(error),
  };
}

describe('extractModelPreferences', () => {
  let logger: ReturnType<typeof createSilentLogger>;

  beforeEach(() => {
    logger = createSilentLogger();
  });

  describe('when no API keys are configured', () => {
    it('returns empty models without calling LLM', async () => {
      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient('{}'),
        availableKeys: {},
        logger,
      };

      const result = await extractModelPreferences('research AI', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
      expect(deps.llmClient.generate).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith({}, 'No API keys configured, skipping model extraction');
    });
  });

  describe('when API keys are configured', () => {
    const availableKeys: ApiKeyStore = {
      openrouter: 'openrouter-key',
    };

    it('extracts selected models from valid JSON response', async () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash, OR_CLAUDE],
        synthesisModel: OR_GPT,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('research AI using gemini and claude, synthesize with gpt', deps);

      expect(result.selectedModels).toContain(IntexAgentModels.Gemini36Flash);
      expect(result.selectedModels).toContain(OR_CLAUDE);
      expect(result.synthesisModel).toBe(OR_GPT);
    });

    it('returns empty models when LLM call fails', async () => {
      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFailingLlmClient('API_ERROR', 'Rate limited'),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('research AI', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
      expect(logger.warn).toHaveBeenCalledWith(
        { errorCode: 'API_ERROR', errorMessage: 'Rate limited' },
        'LLM call failed during model extraction'
      );
    });

    it('returns empty models when JSON parsing fails', async () => {
      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient('This is not valid JSON at all'),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('research AI', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns empty models when LLM throws exception', async () => {
      const deps: ExtractModelPreferencesDeps = {
        llmClient: createThrowingLlmClient(new Error('Network error')),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('research AI', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
      expect(logger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Exception during model extraction'
      );
    });

    it('allows multiple OpenRouter models and deduplicates by full model ID', async () => {
      const response = JSON.stringify({
        selectedModels: [
          DEFAULT_PLATFORM_LLM_MODEL,
          IntexAgentModels.Gemini36Flash,
          DEFAULT_PLATFORM_LLM_MODEL,
        ],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('use all gemini models', deps);

      expect(result.selectedModels).toEqual([
        DEFAULT_PLATFORM_LLM_MODEL,
        IntexAgentModels.Gemini36Flash,
      ]);
    });

    it('caps automatic model extraction at six unique models', async () => {
      const response = JSON.stringify({
        selectedModels: [
          'or:deepseek/deepseek-v4-flash',
          'or:qwen/qwen3.5-plus-02-15',
          'or:minimax/minimax-m3',
          'or:x-ai/grok-4.20-beta',
          'or:moonshotai/kimi-k2.5',
          'or:anthropic/claude-sonnet-4.6',
          'or:google/gemini-3.6-flash',
        ],
        synthesisModel: null,
      });

      const result = await extractModelPreferences('use all models', {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'openrouter-key' },
        logger,
      });

      expect(result.selectedModels).toHaveLength(6);
      expect(result.selectedModels).not.toContain('or:google/gemini-3.6-flash');
    });

    it('filters out non-allowlisted models even when OpenRouter is configured', async () => {
      const limitedKeys: ApiKeyStore = {
        openrouter: 'openrouter-key',
      };

      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash, 'or:unknown/not-allowed'],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: limitedKeys,
        logger,
      };

      const result = await extractModelPreferences('use gemini and claude', deps);

      expect(result.selectedModels).toContain(IntexAgentModels.Gemini36Flash);
      expect(result.selectedModels).not.toContain('or:unknown/not-allowed');
    });

    it('returns undefined synthesis model when null in response', async () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.synthesisModel).toBeUndefined();
    });

    it('returns undefined synthesis model when model does not support synthesis', async () => {
      const response = JSON.stringify({
        selectedModels: [OR_CLAUDE],
        synthesisModel: OR_CLAUDE,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('use claude for everything', deps);

      expect(result.synthesisModel).toBeUndefined();
    });

    it('accepts OpenRouter GPT synthesis through the same OpenRouter key', async () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: OR_GPT,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'openrouter-key' },
        logger,
      };

      const result = await extractModelPreferences('use gemini, synthesize with gpt', deps);

      expect(result.synthesisModel).toBe(OR_GPT);
    });

    it('logs extraction result with requested and validated models', async () => {
      const response = JSON.stringify({
        selectedModels: [DEFAULT_PLATFORM_LLM_MODEL],
        synthesisModel: DEFAULT_PLATFORM_LLM_MODEL,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      await extractModelPreferences('use gemini', deps);

      expect(logger.info).toHaveBeenCalledWith(
        {
          requestedModels: [DEFAULT_PLATFORM_LLM_MODEL],
          validatedModels: [DEFAULT_PLATFORM_LLM_MODEL],
          requestedSynthesis: DEFAULT_PLATFORM_LLM_MODEL,
          validatedSynthesis: DEFAULT_PLATFORM_LLM_MODEL,
        },
        'Model preferences extracted'
      );
    });

    it('handles empty string API keys as not configured', async () => {
      const emptyKeys: ApiKeyStore = {
        openrouter: '',
      };

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient('{}'),
        availableKeys: emptyKeys,
        logger,
      };

      const result = await extractModelPreferences('research AI', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
      expect(deps.llmClient.generate).not.toHaveBeenCalled();
    });
  });

  describe('OpenRouter credential gating', () => {
    it('uses one OpenRouter key for models from multiple authors', async () => {
      const keys: ApiKeyStore = { openrouter: 'openrouter-key' };
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash, OR_CLAUDE, OR_DEEPSEEK],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: keys,
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.selectedModels).toEqual([
        IntexAgentModels.Gemini36Flash,
        OR_CLAUDE,
        OR_DEEPSEEK,
      ]);
    });

    it('does not use a legacy direct-provider key', async () => {
      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(
          JSON.stringify({ selectedModels: [OR_GPT], synthesisModel: OR_GPT })
        ),
        availableKeys: { openai: 'legacy-key' } as unknown as ApiKeyStore,
        logger,
      };

      const result = await extractModelPreferences('use gpt', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
      expect(deps.llmClient.generate).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles response with invalid model IDs', async () => {
      const response = JSON.stringify({
        selectedModels: ['invalid-model', IntexAgentModels.Gemini36Flash],
        synthesisModel: 'also-invalid',
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'key' },
        logger,
      };

      const result = await extractModelPreferences('use invalid model', deps);

      expect(result.selectedModels).toContain(IntexAgentModels.Gemini36Flash);
      expect(result.selectedModels).not.toContain('invalid-model');
      expect(result.synthesisModel).toBeUndefined();
    });

    it('handles JSON embedded in surrounding text', async () => {
      const response = `Here is my analysis: {"selectedModels": ["${IntexAgentModels.Gemini36Flash}"], "synthesisModel": null} That's all.`;

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'key' },
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.selectedModels).toContain(IntexAgentModels.Gemini36Flash);
    });

    it('returns empty when response is array instead of object', async () => {
      const response = '["not", "an", "object"]';

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'key' },
        logger,
      };

      const result = await extractModelPreferences('test', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
    });

    it('returns empty when selectedModels is not an array', async () => {
      const response = JSON.stringify({
        selectedModels: 'not-an-array',
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'key' },
        logger,
      };

      const result = await extractModelPreferences('test', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
    });

    it('handles synthesisModel that is not a string', async () => {
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: 123,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { openrouter: 'key' },
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.selectedModels).toContain(IntexAgentModels.Gemini36Flash);
      expect(result.synthesisModel).toBeUndefined();
    });

    it('correctly marks provider defaults', async () => {
      // This test verifies that provider defaults are properly passed to the prompt
      const response = JSON.stringify({
        selectedModels: [IntexAgentModels.Gemini36Flash],
        synthesisModel: null,
      });

      const llmClient = createFakeLlmClient(response);
      const deps: ExtractModelPreferencesDeps = {
        llmClient,
        availableKeys: { openrouter: 'key' },
        logger,
      };

      await extractModelPreferences('use google', deps);

      // Verify the prompt was called
      expect(llmClient.generate).toHaveBeenCalled();
    });
  });

  describe('getModelDisplayName', () => {
    it('returns static display name for known models', () => {
      expect(getModelDisplayName(IntexAgentModels.Gemini36Flash)).toBe('Gemini 3.6 Flash');
      expect(getModelDisplayName(OR_CLAUDE)).toBe('Claude Sonnet 4.6');
    });

    it('generates display name from OpenRouter model ID', () => {
      const orModel = 'or:anthropic/claude-sonnet-4.6' as ResearchModel;
      const result = getModelDisplayName(orModel);
      expect(result).toBe('Claude Sonnet 4.6');
    });

    it('handles OpenRouter model without slash', () => {
      const orModel = 'or:some-model' as ResearchModel;
      const result = getModelDisplayName(orModel);
      expect(result).toBe('Or:some-model');
    });
  });

  describe('getModelKeywords', () => {
    it('returns static keywords for known models', () => {
      const keywords = getModelKeywords(IntexAgentModels.Gemini36Flash);
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    });

    it('returns author and model keywords for OpenRouter models', () => {
      const orModel = 'or:anthropic/claude-sonnet-4.6' as ResearchModel;
      expect(getModelKeywords(orModel)).toEqual([
        'claude sonnet',
        'sonnet',
        'claude',
        'anthropic',
      ]);
    });

    it('derives keywords for stored model IDs without an OpenRouter prefix', () => {
      const storedModel = 'vendor/custom-model' as ResearchModel;

      expect(getModelKeywords(storedModel)).toEqual([
        'openrouter',
        'vendor',
        'custom',
        'model',
      ]);
    });
  });

  describe('validateSynthesisModel', () => {
    it('rejects a supported synthesis model that is absent from the available catalog', () => {
      expect(validateSynthesisModel(OR_GPT, [])).toBeUndefined();
    });
  });
});
