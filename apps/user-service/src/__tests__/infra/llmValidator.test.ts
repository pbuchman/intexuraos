/**
 * Tests for LlmValidatorImpl.
 * Uses vi.mock to mock the infra packages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { LlmValidatorImpl, type ValidationPricing } from '../../infra/llm/LlmValidatorImpl.js';

// Mock the infra packages
vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn(),
}));

vi.mock('@intexuraos/infra-gpt', () => ({
  createGptClient: vi.fn(),
}));

vi.mock('@intexuraos/infra-claude', () => ({
  createClaudeClient: vi.fn(),
}));

vi.mock('@intexuraos/infra-perplexity', () => ({
  createPerplexityClient: vi.fn(),
}));

// Import mocked modules after vi.mock
const { createGeminiClient } = await import('@intexuraos/infra-gemini');
const { createGptClient } = await import('@intexuraos/infra-gpt');
const { createClaudeClient } = await import('@intexuraos/infra-claude');
const { createPerplexityClient } = await import('@intexuraos/infra-perplexity');

const testPricing: ValidationPricing = {
  google: { inputPricePerMillion: 0.1, outputPricePerMillion: 0.4 },
  openai: { inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
  anthropic: { inputPricePerMillion: 0.8, outputPricePerMillion: 4.0 },
  perplexity: { inputPricePerMillion: 1.0, outputPricePerMillion: 1.0, useProviderCost: true },
};

describe('LlmValidatorImpl', () => {
  let validator: LlmValidatorImpl;
  const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };
  const testUserId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new LlmValidatorImpl(testPricing);
  });

  describe('validateKey', () => {
    describe('google provider', () => {
      it('returns ok when validation succeeds', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(ok({ content: 'validated', usage: mockUsage })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('google', 'test-api-key', testUserId);

        expect(result.ok).toBe(true);
        expect(createGeminiClient).toHaveBeenCalledWith({
          apiKey: 'test-api-key',
          model: 'gemini-2.0-flash',
          userId: testUserId,
          pricing: testPricing.google,
        });
        expect(mockClient.generate).toHaveBeenCalled();
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('google', 'bad-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid Google API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          generate: vi
            .fn()
            .mockResolvedValue(err({ code: 'NETWORK_ERROR', message: 'Connection failed' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('google', 'test-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain('Google API error');
        }
      });
    });

    describe('openai provider', () => {
      it('returns ok when validation succeeds', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(ok({ content: 'validated', usage: mockUsage })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('openai', 'sk-test-key', testUserId);

        expect(result.ok).toBe(true);
        expect(createGptClient).toHaveBeenCalledWith({
          apiKey: 'sk-test-key',
          model: 'gpt-4o-mini',
          userId: testUserId,
          pricing: testPricing.openai,
        });
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('openai', 'bad-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid OpenAI API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'RATE_LIMIT', message: 'Too fast' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('openai', 'test-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain('OpenAI API error');
        }
      });
    });

    describe('anthropic provider', () => {
      it('returns ok when validation succeeds', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(ok({ content: 'validated', usage: mockUsage })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('anthropic', 'sk-ant-key', testUserId);

        expect(result.ok).toBe(true);
        expect(createClaudeClient).toHaveBeenCalledWith({
          apiKey: 'sk-ant-key',
          model: 'claude-3-5-haiku-20241022',
          userId: testUserId,
          pricing: testPricing.anthropic,
        });
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('anthropic', 'bad-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid Anthropic API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          generate: vi
            .fn()
            .mockResolvedValue(err({ code: 'SERVICE_ERROR', message: 'Unavailable' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('anthropic', 'test-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain('Anthropic API error');
        }
      });
    });

    describe('perplexity provider', () => {
      it('returns ok when validation succeeds', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(ok({ content: 'validated', usage: mockUsage })),
        };
        vi.mocked(createPerplexityClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('perplexity', 'pplx-test-key', testUserId);

        expect(result.ok).toBe(true);
        expect(createPerplexityClient).toHaveBeenCalledWith({
          apiKey: 'pplx-test-key',
          model: 'sonar',
          userId: testUserId,
          pricing: testPricing.perplexity,
        });
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createPerplexityClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('perplexity', 'bad-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid Perplexity API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'RATE_LIMIT', message: 'Too fast' })),
        };
        vi.mocked(createPerplexityClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('perplexity', 'test-key', testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain('Perplexity API error');
        }
      });
    });
  });

  describe('testRequest', () => {
    const testPrompt = 'Say hello';

    describe('google provider', () => {
      it('returns content when test succeeds', async () => {
        const mockClient = {
          generate: vi
            .fn()
            .mockResolvedValue(ok({ content: 'Hello from Gemini!', usage: mockUsage })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('google', 'test-key', testPrompt, testUserId);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from Gemini!');
        }
        expect(mockClient.generate).toHaveBeenCalledWith(testPrompt);
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Failed to respond' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('google', 'test-key', testPrompt, testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toBe('Failed to respond');
        }
      });
    });

    describe('openai provider', () => {
      it('returns content when test succeeds', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(ok({ content: 'Hello from GPT!', usage: mockUsage })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('openai', 'sk-key', testPrompt, testUserId);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from GPT!');
        }
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Rate limited' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('openai', 'sk-key', testPrompt, testUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toBe('Rate limited');
        }
      });
    });

    describe('anthropic provider', () => {
      it('returns content when test succeeds', async () => {
        const mockClient = {
          generate: vi
            .fn()
            .mockResolvedValue(ok({ content: 'Hello from Claude!', usage: mockUsage })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest(
          'anthropic',
          'sk-ant-key',
          testPrompt,
          testUserId
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from Claude!');
        }
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Service down' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest(
          'anthropic',
          'sk-ant-key',
          testPrompt,
          testUserId
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toBe('Service down');
        }
      });
    });

    describe('perplexity provider', () => {
      it('returns content when test succeeds', async () => {
        const mockClient = {
          generate: vi
            .fn()
            .mockResolvedValue(ok({ content: 'Hello from Perplexity!', usage: mockUsage })),
        };
        vi.mocked(createPerplexityClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest(
          'perplexity',
          'pplx-key',
          testPrompt,
          testUserId
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from Perplexity!');
        }
        expect(mockClient.generate).toHaveBeenCalledWith(testPrompt);
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          generate: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Search failed' })),
        };
        vi.mocked(createPerplexityClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest(
          'perplexity',
          'pplx-key',
          testPrompt,
          testUserId
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toBe('Search failed');
        }
      });
    });
  });
});
