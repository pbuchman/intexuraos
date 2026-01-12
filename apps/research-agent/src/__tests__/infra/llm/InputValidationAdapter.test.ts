import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import { InputValidationAdapter } from '../../../infra/llm/InputValidationAdapter.js';

const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn(() => ({
    generate: mockGenerate,
  })),
}));

describe('InputValidationAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createAdapter = (): InputValidationAdapter =>
    new InputValidationAdapter(
      'test-api-key',
      LlmModels.Gemini25Flash,
      'user-123',
      { inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 }
    );

  describe('validateInput', () => {
    it('returns validation result for valid JSON response', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ quality: 2, reason: 'Clear and specific' }),
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.quality).toBe(2);
        expect(result.value.reason).toBe('Clear and specific');
        expect(result.value.usage.inputTokens).toBe(10);
        expect(result.value.usage.outputTokens).toBe(5);
        expect(result.value.usage.costUsd).toBe(0.001);
      }
    });

    it('handles markdown code blocks in response', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '```json\n{"quality": 1, "reason": "Weak but valid"}\n```',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.quality).toBe(1);
        expect(result.value.reason).toBe('Weak but valid');
      }
    });

    it('returns error when client generate fails', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'API call failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('API call failed');
      }
    });

    it('returns error for invalid JSON', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'not valid json',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('JSON parse error');
        expect(result.error.usage?.inputTokens).toBe(10);
      }
    });

    it('returns error for invalid schema', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ invalid: 'schema' }),
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Missing "quality" field');
      }
    });

    it('maps known error codes correctly', async () => {
      const errorCodes = ['TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;

      for (const code of errorCodes) {
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code, message: `${code} error` },
        });

        const adapter = createAdapter();
        const result = await adapter.validateInput('Test prompt');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(code);
        }
      }
    });

    it('maps unknown error codes to API_ERROR', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'UNKNOWN_ERROR', message: 'Unknown' },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('logs error when parsing fails', async () => {
      const mockLogger = { info: vi.fn(), error: vi.fn() };
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'invalid json',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = new InputValidationAdapter(
        'test-api-key',
        LlmModels.Gemini25Flash,
        'user-123',
        { inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 },
        mockLogger as unknown as import('@intexuraos/common-core').Logger
      );
      await adapter.validateInput('Test prompt');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ parseError: expect.any(String), rawContent: 'invalid json' }),
        'Input validation parse failed'
      );
    });
  });

  describe('improveInput', () => {
    it('returns improved prompt on success', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '  Improved version of the prompt  ',
          usage: { inputTokens: 15, outputTokens: 10, costUsd: 0.002 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.improvedPrompt).toBe('Improved version of the prompt');
        expect(result.value.usage.inputTokens).toBe(15);
        expect(result.value.usage.outputTokens).toBe(10);
        expect(result.value.usage.costUsd).toBe(0.002);
      }
    });

    it('returns error when client generate fails', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Too many requests');
      }
    });
  });

  describe('parseJson helper', () => {
    it('handles code block without json tag', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '```\n{"quality": 0, "reason": "Invalid"}\n```',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.quality).toBe(0);
        expect(result.value.reason).toBe('Invalid');
      }
    });
  });
});
