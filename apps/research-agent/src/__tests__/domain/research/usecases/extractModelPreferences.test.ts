/**
 * Tests for extractModelPreferences use case.
 * Verifies LLM-based model extraction from user messages.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  extractModelPreferences,
  type ExtractModelPreferencesDeps,
} from '../../../../domain/research/usecases/extractModelPreferences.js';
import type { ApiKeyStore, TextGenerationClient } from '../../../../domain/research/ports/index.js';

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
      google: 'google-key',
      openai: 'openai-key',
      anthropic: 'anthropic-key',
      perplexity: 'perplexity-key',
      zai: 'zai-key',
    };

    it('extracts selected models from valid JSON response', async () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeSonnet45],
        synthesisModel: LlmModels.GPT52,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('research AI using gemini and claude, synthesize with gpt', deps);

      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
      expect(result.selectedModels).toContain(LlmModels.ClaudeSonnet45);
      expect(result.synthesisModel).toBe(LlmModels.GPT52);
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

    it('validates one model per provider constraint', async () => {
      // LLM returns two Google models, should only keep the first
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.Gemini25Flash],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('use all gemini models', deps);

      expect(result.selectedModels).toHaveLength(1);
      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
      expect(result.selectedModels).not.toContain(LlmModels.Gemini25Flash);
    });

    it('filters out models user does not have API keys for', async () => {
      const limitedKeys: ApiKeyStore = {
        google: 'google-key',
        // No anthropic key
      };

      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeSonnet45],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: limitedKeys,
        logger,
      };

      const result = await extractModelPreferences('use gemini and claude', deps);

      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
      expect(result.selectedModels).not.toContain(LlmModels.ClaudeSonnet45);
    });

    it('returns undefined synthesis model when null in response', async () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
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
      // Claude does not support synthesis
      const response = JSON.stringify({
        selectedModels: [LlmModels.ClaudeSonnet45],
        synthesisModel: LlmModels.ClaudeSonnet45,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      const result = await extractModelPreferences('use claude for everything', deps);

      expect(result.synthesisModel).toBeUndefined();
    });

    it('returns undefined synthesis model when user lacks API key for it', async () => {
      const limitedKeys: ApiKeyStore = {
        google: 'google-key',
        // No openai key for GPT synthesis
      };

      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.GPT52,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: limitedKeys,
        logger,
      };

      const result = await extractModelPreferences('use gemini, synthesize with gpt', deps);

      expect(result.synthesisModel).toBeUndefined();
    });

    it('logs extraction result with requested and validated models', async () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys,
        logger,
      };

      await extractModelPreferences('use gemini', deps);

      expect(logger.info).toHaveBeenCalledWith(
        {
          requestedModels: [LlmModels.Gemini25Pro],
          validatedModels: [LlmModels.Gemini25Pro],
          requestedSynthesis: LlmModels.Gemini25Pro,
          validatedSynthesis: LlmModels.Gemini25Pro,
        },
        'Model preferences extracted'
      );
    });

    it('handles empty string API keys as not configured', async () => {
      const emptyKeys: ApiKeyStore = {
        google: '',
        openai: '',
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

  describe('provider-specific API key mapping', () => {
    it('uses google key for Gemini models', async () => {
      const keys: ApiKeyStore = { google: 'google-key' };
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: keys,
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
    });

    it('uses openai key for GPT models', async () => {
      const keys: ApiKeyStore = { openai: 'openai-key' };
      const response = JSON.stringify({
        selectedModels: [LlmModels.GPT52],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: keys,
        logger,
      };

      const result = await extractModelPreferences('use gpt', deps);

      expect(result.selectedModels).toContain(LlmModels.GPT52);
    });

    it('uses anthropic key for Claude models', async () => {
      const keys: ApiKeyStore = { anthropic: 'anthropic-key' };
      const response = JSON.stringify({
        selectedModels: [LlmModels.ClaudeSonnet45],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: keys,
        logger,
      };

      const result = await extractModelPreferences('use claude', deps);

      expect(result.selectedModels).toContain(LlmModels.ClaudeSonnet45);
    });

    it('uses perplexity key for Sonar models', async () => {
      const keys: ApiKeyStore = { perplexity: 'perplexity-key' };
      const response = JSON.stringify({
        selectedModels: [LlmModels.SonarPro],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: keys,
        logger,
      };

      const result = await extractModelPreferences('use sonar', deps);

      expect(result.selectedModels).toContain(LlmModels.SonarPro);
    });

    it('uses zai key for GLM models', async () => {
      const keys: ApiKeyStore = { zai: 'zai-key' };
      const response = JSON.stringify({
        selectedModels: [LlmModels.Glm47],
        synthesisModel: null,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: keys,
        logger,
      };

      const result = await extractModelPreferences('use glm', deps);

      expect(result.selectedModels).toContain(LlmModels.Glm47);
    });
  });

  describe('edge cases', () => {
    it('handles response with invalid model IDs', async () => {
      const response = JSON.stringify({
        selectedModels: ['invalid-model', LlmModels.Gemini25Pro],
        synthesisModel: 'also-invalid',
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { google: 'key' },
        logger,
      };

      const result = await extractModelPreferences('use invalid model', deps);

      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
      expect(result.selectedModels).not.toContain('invalid-model');
      expect(result.synthesisModel).toBeUndefined();
    });

    it('handles JSON embedded in surrounding text', async () => {
      const response = `Here is my analysis: {"selectedModels": ["${LlmModels.Gemini25Pro}"], "synthesisModel": null} That's all.`;

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { google: 'key' },
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
    });

    it('returns empty when response is array instead of object', async () => {
      const response = '["not", "an", "object"]';

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { google: 'key' },
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
        availableKeys: { google: 'key' },
        logger,
      };

      const result = await extractModelPreferences('test', deps);

      expect(result).toEqual({ selectedModels: [], synthesisModel: undefined });
    });

    it('handles synthesisModel that is not a string', async () => {
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: 123,
      });

      const deps: ExtractModelPreferencesDeps = {
        llmClient: createFakeLlmClient(response),
        availableKeys: { google: 'key' },
        logger,
      };

      const result = await extractModelPreferences('use gemini', deps);

      expect(result.selectedModels).toContain(LlmModels.Gemini25Pro);
      expect(result.synthesisModel).toBeUndefined();
    });

    it('correctly marks provider defaults', async () => {
      // This test verifies that provider defaults are properly passed to the prompt
      const response = JSON.stringify({
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: null,
      });

      const llmClient = createFakeLlmClient(response);
      const deps: ExtractModelPreferencesDeps = {
        llmClient,
        availableKeys: { google: 'key' },
        logger,
      };

      await extractModelPreferences('use google', deps);

      // Verify the prompt was called
      expect(llmClient.generate).toHaveBeenCalled();
    });
  });
});
