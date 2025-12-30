/**
 * Tests for LlmValidatorImpl.
 * Uses vi.mock to mock the infra packages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { LlmValidatorImpl } from '../../infra/llm/LlmValidatorImpl.js';

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

// Import mocked modules after vi.mock
const { createGeminiClient } = await import('@intexuraos/infra-gemini');
const { createGptClient } = await import('@intexuraos/infra-gpt');
const { createClaudeClient } = await import('@intexuraos/infra-claude');

describe('LlmValidatorImpl', () => {
  let validator: LlmValidatorImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new LlmValidatorImpl();
  });

  describe('validateKey', () => {
    describe('google provider', () => {
      it('returns ok when validation succeeds', async () => {
        const mockClient = {
          validateKey: vi.fn().mockResolvedValue(ok(undefined)),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('google', 'test-api-key');

        expect(result.ok).toBe(true);
        expect(createGeminiClient).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
        expect(mockClient.validateKey).toHaveBeenCalled();
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          validateKey: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('google', 'bad-key');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid Google API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          validateKey: vi
            .fn()
            .mockResolvedValue(err({ code: 'NETWORK_ERROR', message: 'Connection failed' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('google', 'test-key');

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
          validateKey: vi.fn().mockResolvedValue(ok(undefined)),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('openai', 'sk-test-key');

        expect(result.ok).toBe(true);
        expect(createGptClient).toHaveBeenCalledWith({ apiKey: 'sk-test-key' });
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          validateKey: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('openai', 'bad-key');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid OpenAI API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          validateKey: vi.fn().mockResolvedValue(err({ code: 'RATE_LIMIT', message: 'Too fast' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('openai', 'test-key');

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
          validateKey: vi.fn().mockResolvedValue(ok(undefined)),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('anthropic', 'sk-ant-key');

        expect(result.ok).toBe(true);
        expect(createClaudeClient).toHaveBeenCalledWith({ apiKey: 'sk-ant-key' });
      });

      it('returns INVALID_KEY error when key is invalid', async () => {
        const mockClient = {
          validateKey: vi.fn().mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('anthropic', 'bad-key');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_KEY');
          expect(result.error.message).toBe('Invalid Anthropic API key');
        }
      });

      it('returns API_ERROR when other errors occur', async () => {
        const mockClient = {
          validateKey: vi
            .fn()
            .mockResolvedValue(err({ code: 'SERVICE_ERROR', message: 'Unavailable' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.validateKey('anthropic', 'test-key');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain('Anthropic API error');
        }
      });
    });
  });

  describe('testRequest', () => {
    const testPrompt = 'Say hello';

    describe('google provider', () => {
      it('returns content when test succeeds', async () => {
        const mockClient = {
          research: vi.fn().mockResolvedValue(ok({ content: 'Hello from Gemini!' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('google', 'test-key', testPrompt);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from Gemini!');
        }
        expect(mockClient.research).toHaveBeenCalledWith(testPrompt);
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          research: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Failed to respond' })),
        };
        vi.mocked(createGeminiClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('google', 'test-key', testPrompt);

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
          research: vi.fn().mockResolvedValue(ok({ content: 'Hello from GPT!' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('openai', 'sk-key', testPrompt);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from GPT!');
        }
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          research: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Rate limited' })),
        };
        vi.mocked(createGptClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('openai', 'sk-key', testPrompt);

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
          research: vi.fn().mockResolvedValue(ok({ content: 'Hello from Claude!' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('anthropic', 'sk-ant-key', testPrompt);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Hello from Claude!');
        }
      });

      it('returns API_ERROR when test fails', async () => {
        const mockClient = {
          research: vi.fn().mockResolvedValue(err({ code: 'ERROR', message: 'Service down' })),
        };
        vi.mocked(createClaudeClient).mockReturnValue(mockClient as never);

        const result = await validator.testRequest('anthropic', 'sk-ant-key', testPrompt);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toBe('Service down');
        }
      });
    });
  });
});
