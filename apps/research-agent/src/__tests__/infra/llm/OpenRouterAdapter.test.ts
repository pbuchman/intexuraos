/**
 * Tests for OpenRouterAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModelPricing } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';

const TEST_MODEL = 'or:deepseek/deepseek-v3-0324';
const EXPECTED_RAW_MODEL = 'deepseek/deepseek-v3-0324';

const mockResearch = vi.fn();
const mockGenerate = vi.fn();

const mockCreateOpenRouterClient = vi.fn().mockReturnValue({
  research: mockResearch,
  generate: mockGenerate,
});

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterClient: mockCreateOpenRouterClient,
}));

const { OpenRouterAdapter } = await import('../../../infra/llm/OpenRouterAdapter.js');

const testPricing: ModelPricing = {
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  useProviderCost: true,
};

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

describe('OpenRouterAdapter', () => {
  let adapter: InstanceType<typeof OpenRouterAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter(
      'test-key',
      TEST_MODEL,
      'test-user-id',
      testPricing,
      mockLogger
    );
  });

  describe('constructor', () => {
    it('passes apiKey and model to client', () => {
      mockCreateOpenRouterClient.mockClear();
      new OpenRouterAdapter(
        'test-key',
        TEST_MODEL,
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect(mockCreateOpenRouterClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: EXPECTED_RAW_MODEL,
        userId: 'test-user-id',
        pricing: testPricing,
        logger: mockLogger,
      });
    });

    it('passes non-OpenRouter model directly without stripping prefix', () => {
      mockCreateOpenRouterClient.mockClear();
      const nonOpenRouterModel = 'google/gemini-2.0-flash';
      new OpenRouterAdapter(
        'test-key',
        nonOpenRouterModel,
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect(mockCreateOpenRouterClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        model: nonOpenRouterModel,
        userId: 'test-user-id',
        pricing: testPricing,
        logger: mockLogger,
      });
    });
  });

  describe('research', () => {
    it('delegates to OpenRouter client', async () => {
      mockResearch.mockResolvedValue({
        ok: true,
        value: {
          content: 'Research result',
          sources: ['https://source.com'],
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.00105 },
        },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research result');
        expect(result.value.sources).toContain('https://source.com');
      }
      expect(mockResearch).toHaveBeenCalledWith(expect.stringContaining('Test prompt'));
    });

    it('maps RATE_LIMITED error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Too many requests');
      }
    });

    it('maps INVALID_KEY error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps TIMEOUT error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps OVERLOADED error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'OVERLOADED', message: 'Service overloaded' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('maps API_ERROR error code correctly', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'API error' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'UNKNOWN_CODE', message: 'Unknown error' },
      });

      const result = await adapter.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });

    it('logs error when research fails', async () => {
      mockResearch.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      await adapter.research('Test prompt');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
          errorCode: 'RATE_LIMITED',
          errorMessage: 'Too many requests',
        }),
        'OpenRouter research failed'
      );
    });
  });

  describe('synthesize', () => {
    const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

    it('builds synthesis prompt and calls generate', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Synthesized result', usage: mockUsage },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude result' }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Synthesized result');
        expect(result.value.usage).toEqual({
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0.001,
        });
      }
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Prompt'));
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Claude result'));
    });

    it('includes external reports in synthesis prompt', async () => {
      mockGenerate.mockResolvedValue({ ok: true, value: { content: 'Result', usage: mockUsage } });

      await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }], [
        { content: 'External context' },
      ]);

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('External context'));
    });

    it('uses synthesis context when provided', async () => {
      mockGenerate.mockResolvedValue({ ok: true, value: { content: 'Result', usage: mockUsage } });

      await adapter.synthesize(
        'Prompt',
        [{ model: 'claude', content: 'Claude' }],
        undefined,
        {
          language: 'en',
          domain: 'general',
          mode: 'standard',
          synthesis_goals: ['merge'],
          missing_sections: [],
          detected_conflicts: [],
          source_preference: {
            prefer_official_over_aggregators: true,
            prefer_recent_when_time_sensitive: true,
          },
          defaults_applied: [],
          assumptions: [],
          output_format: { wants_table: false, wants_actionable_summary: true },
          safety: { high_stakes: false, required_disclaimers: [], user_exclusions: [] },
          red_flags: [],
        }
      );

      expect(mockGenerate).toHaveBeenCalled();
    });

    it('maps RATE_LIMITED error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps TIMEOUT error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps OVERLOADED error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'OVERLOADED', message: 'Service overloaded' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('maps INVALID_KEY error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps API_ERROR error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'API error' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'UNKNOWN_CODE', message: 'Unknown error' },
      });

      const result = await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });

    it('logs error when synthesis fails', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      await adapter.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
          errorCode: 'TIMEOUT',
          errorMessage: 'Request timed out',
        }),
        'OpenRouter synthesis failed'
      );
    });

    it('logs synthesis start with undefined additionalSources (nullish coalescing)', async () => {
      const mockLoggerLocal = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };
      const adapterWithLogger = new OpenRouterAdapter(
        'test-key',
        TEST_MODEL,
        'test-user-id',
        testPricing,
        mockLoggerLocal
      );

      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: 'Result', usage: mockUsage },
      });

      await adapterWithLogger.synthesize('Prompt', [{ model: 'claude', content: 'Claude' }]);

      expect(mockLoggerLocal.info).toHaveBeenCalledWith(
        { model: TEST_MODEL, reportCount: 1, sourceCount: 0 },
        'OpenRouter synthesis started'
      );
    });
  });

  describe('generateTitle', () => {
    const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

    it('delegates to generate with title prompt', async () => {
      mockGenerate.mockResolvedValue({
        ok: true,
        value: { content: '  Generated Title  ', usage: mockUsage },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Generated Title');
        expect(result.value.usage.costUsd).toBe(0.001);
      }
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.stringContaining('Generate a short, concise title')
      );
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('SAME LANGUAGE'));
      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Test prompt'));
    });

    it('maps RATE_LIMITED error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps TIMEOUT error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps OVERLOADED error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'OVERLOADED', message: 'Service overloaded' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('maps INVALID_KEY error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps API_ERROR error correctly', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'API_ERROR', message: 'API error' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'UNKNOWN_CODE', message: 'Unknown error' },
      });

      const result = await adapter.generateTitle('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });

    it('logs error when title generation fails', async () => {
      mockGenerate.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      });

      await adapter.generateTitle('Test prompt');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
          errorCode: 'INVALID_KEY',
          errorMessage: 'Invalid API key',
        }),
        'OpenRouter title generation failed'
      );
    });
  });
});
