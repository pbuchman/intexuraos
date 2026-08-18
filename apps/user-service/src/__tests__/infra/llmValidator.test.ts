/**
 * Tests for the OpenRouter-only LlmValidator implementation.
 */
import { err, ok, type Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmValidatorImpl } from '../../infra/llm/LlmValidatorImpl.js';

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterClient: vi.fn(),
  OPENROUTER_VALIDATION_MODEL: 'qwen/qwen3.5-flash-02-23',
}));

const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

describe('LlmValidatorImpl', () => {
  let validator: LlmValidatorImpl;
  let usageSink: FakeUsageSink;
  const userId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    usageSink = new FakeUsageSink();
    validator = new LlmValidatorImpl(mockLogger, usageSink);
  });

  describe('validateKey', () => {
    it('validates the key with the OpenRouter validation model', async () => {
      const validateKey = vi.fn().mockResolvedValue(
        ok({
          token: 'key-123',
          usage: 100,
          limit: null,
          expiresAt: null,
        })
      );
      vi.mocked(createOpenRouterClient).mockReturnValue({ validateKey } as never);

      const result = await validator.validateKey('openrouter', 'or-test-key', userId);

      expect(result).toEqual(ok(undefined));
      expect(createOpenRouterClient).toHaveBeenCalledWith({
        apiKey: 'or-test-key',
        model: 'qwen/qwen3.5-flash-02-23',
        evidenceModelId: 'or:qwen/qwen3.5-flash-02-23',
        userId,
        logger: mockLogger,
        usageSink,
      });
      expect(validateKey).toHaveBeenCalledWith('or-test-key');
    });

    it('maps an invalid OpenRouter key to INVALID_KEY', async () => {
      vi.mocked(createOpenRouterClient).mockReturnValue({
        validateKey: vi
          .fn()
          .mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid credentials' })),
      } as never);

      const result = await validator.validateKey('openrouter', 'bad-key', userId);

      expect(result).toEqual(
        err({ code: 'INVALID_KEY', message: 'Invalid OpenRouter API key' })
      );
    });

    it('maps other OpenRouter failures to API_ERROR', async () => {
      vi.mocked(createOpenRouterClient).mockReturnValue({
        validateKey: vi
          .fn()
          .mockResolvedValue(err({ code: 'RATE_LIMITED', message: 'Too fast' })),
      } as never);

      const result = await validator.validateKey('openrouter', 'or-test-key', userId);

      expect(result).toEqual(
        err({ code: 'API_ERROR', message: 'OpenRouter API error: Too fast' })
      );
    });
  });

  describe('testRequest', () => {
    it('returns generated OpenRouter content', async () => {
      const generate = vi.fn().mockResolvedValue(
        ok({
          content: 'Hello from OpenRouter!',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
        })
      );
      vi.mocked(createOpenRouterClient).mockReturnValue({ generate } as never);

      const result = await validator.testRequest(
        'openrouter',
        'or-test-key',
        'Say hello',
        userId
      );

      expect(result).toEqual(ok({ content: 'Hello from OpenRouter!' }));
      expect(generate).toHaveBeenCalledWith('Say hello', {
        promptType: 'user-service-validation',
      });
      expect(createOpenRouterClient).toHaveBeenCalledWith({
        apiKey: 'or-test-key',
        model: 'qwen/qwen3.5-flash-02-23',
        evidenceModelId: 'or:qwen/qwen3.5-flash-02-23',
        userId,
        logger: mockLogger,
        usageSink,
      });
    });

    it('returns API_ERROR when the OpenRouter test request fails', async () => {
      vi.mocked(createOpenRouterClient).mockReturnValue({
        generate: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Service error' })),
      } as never);

      const result = await validator.testRequest(
        'openrouter',
        'or-test-key',
        'Say hello',
        userId
      );

      expect(result).toEqual(err({ code: 'API_ERROR', message: 'Service error' }));
    });
  });
});
