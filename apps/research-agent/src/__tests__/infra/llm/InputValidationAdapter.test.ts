import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { InputValidationAdapter } from '../../../infra/llm/InputValidationAdapter.js';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

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
      { inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 },
      mockLogger
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

    it('returns error for invalid JSON (repair also fails)', async () => {
      // Initial call returns invalid JSON
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'not valid json',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      // Repair attempt also fails
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('JSON parse error');
        expect(result.error.message).toContain('Repair: Repair failed');
        expect(result.error.usage?.inputTokens).toBe(10);
      }
    });

    it('returns error for invalid schema (repair also fails)', async () => {
      // Initial call returns invalid schema
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ invalid: 'schema' }),
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      // Repair attempt also returns invalid schema
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ still: 'invalid' }),
          usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.0008 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('expected');
        expect(result.error.message).toContain('Repair:');
        expect(result.error.usage?.inputTokens).toBe(10);
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
      const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'invalid json',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      // Repair attempt also fails
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = new InputValidationAdapter(
        'test-api-key',
        LlmModels.Gemini25Flash,
        'user-123',
        { inputPricePerMillion: 0.1, outputPricePerMillion: 0.2 },
        mockLogger as unknown as import('@intexuraos/common-core').Logger
      );
      await adapter.validateInput('Test prompt');

      expect(mockLogger.warn).toHaveBeenCalled();
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

  describe('improveInput - validation errors', () => {
    it('returns error when improved prompt is empty after cleaning', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '   ',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Response is empty after cleaning');
      }
    });

    it('returns error when improved prompt is too long', async () => {
      const longResponse = 'a'.repeat(501);
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: longResponse,
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Response is too long');
      }
    });

    it('returns error when response starts with unwanted prefix "here is"', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'here is the improved prompt for you',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('unwanted prefix');
      }
    });

    it('returns error when response contains JSON format', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '{"improved": "prompt here"}',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('JSON format');
      }
    });

    it('returns error when response includes explanatory text', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'explanation: this is my analysis of the prompt',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: false,
        error: { code: 'API_ERROR', message: 'Repair failed' },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('explanatory text');
      }
    });

    it('cleans markdown code blocks from improved prompt', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '```\nClean improved prompt\n```',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.improvedPrompt).toBe('Clean improved prompt');
      }
    });

    it('cleans json code block markers from improved prompt', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '```json\nClean improved prompt\n```',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.improvedPrompt).toBe('Clean improved prompt');
      }
    });

    it('cleans "Improved:" prefix from improved prompt', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'Improved: Clean improved prompt',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.improvedPrompt).toBe('Clean improved prompt');
      }
    });

    it('cleans quotes from improved prompt', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '"Clean improved prompt"',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.improvedPrompt).toBe('Clean improved prompt');
      }
    });
  });

  describe('improveInput - semantic checks (F-015)', () => {
    describe('multi-option detection', () => {
      it('rejects response with numbered options (1. / 2.)', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: '1. What are the best travel tips for Europe?\n2. What are the best travel tips for Asia?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('multiple options');
        }
      });

      it('rejects response with "Option 1:" / "Option 2:" labels', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'Option 1: Budget travel in Europe. Option 2: Luxury travel in Asia.',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('multiple options');
        }
      });

      it('rejects response with "OR" separator between alternatives', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best budget airlines in Europe? OR What are the cheapest train routes across Europe?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('multiple options');
        }
      });

      it('rejects response with bullet-point alternatives (- or •)', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: '- What are the best travel tips for Europe?\n- What are the best travel tips for Asia?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('multiple options');
        }
      });

      it('accepts a single well-formed prompt that happens to contain the word "or"', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best budget airlines for travel to Europe or Asia in 2026?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips');

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.improvedPrompt).toContain('budget airlines');
        }
      });
    });

    describe('language drift detection', () => {
      it('rejects English output when input is in Cyrillic script', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best budget travel destinations in 2026?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('Какие лучшие направления для путешествий');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('language');
        }
      });

      it('rejects English output when input is in CJK script', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best travel tips for Japan in 2026?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('日本旅行のヒント');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('language');
        }
      });

      it('rejects English output when input is in Arabic script', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best travel tips for the Middle East?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('نصائح السفر في الشرق الأوسط');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('language');
        }
      });

      it('accepts output that preserves the same non-Latin script', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'Какие лучшие бюджетные направления для путешествий в Европу в 2026 году?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('Какие лучшие направления для путешествий');

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.improvedPrompt).toContain('направления');
        }
      });

      it('skips language drift check when original prompt has no letter characters', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best options for 123 type products in 2026?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('123 456 ???');

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.improvedPrompt).toContain('2026');
        }
      });

      it('accepts English-to-English improvement (no drift)', async () => {
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best budget travel tips for solo travelers in Southeast Asia in 2026?',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
          },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips');

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.improvedPrompt).toContain('travel tips');
        }
      });
    });

    describe('F-015 contract test', () => {
      it('output contract matches parser expectations after semantic checks', async () => {
        // Valid single-option, same-language response should still return the expected shape
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the best budget travel destinations in Europe for solo travelers in 2026?',
            usage: { inputTokens: 15, outputTokens: 10, costUsd: 0.002 },
          },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('travel tips europe');

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveProperty('improvedPrompt');
          expect(result.value).toHaveProperty('usage');
          expect(result.value.usage).toHaveProperty('inputTokens');
          expect(result.value.usage).toHaveProperty('outputTokens');
          expect(result.value.usage).toHaveProperty('costUsd');
          expect(typeof result.value.improvedPrompt).toBe('string');
          expect(result.value.improvedPrompt.length).toBeGreaterThan(0);
        }
      });
    });

    describe('F-015 regression test', () => {
      it('rejects previously-accepted multi-option response that violated prompt contract', async () => {
        // This would have passed the old validator (structure-only checks)
        // but violates "NO options or variations - just ONE improved version"
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: '1. Compare the most affordable European destinations for solo backpackers in 2026\n2. Evaluate budget-friendly hostels and travel routes across Western Europe for 2026',
            usage: { inputTokens: 15, outputTokens: 12, costUsd: 0.002 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('cheap europe travel');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('multiple options');
        }
      });

      it('rejects previously-accepted language-drifted response', async () => {
        // Original is in Cyrillic, response is in English — old validator would accept
        mockGenerate.mockResolvedValueOnce({
          ok: true,
          value: {
            content: 'What are the most effective and safe weight loss methods for adults in 2026, considering diet, physical activity, and long-term sustainability?',
            usage: { inputTokens: 15, outputTokens: 12, costUsd: 0.002 },
          },
        });
        mockGenerate.mockResolvedValueOnce({
          ok: false,
          error: { code: 'API_ERROR', message: 'Repair failed' },
        });

        const adapter = createAdapter();
        const result = await adapter.improveInput('как похудеть безопасно');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('language');
        }
      });
    });
  });

  describe('repair success paths', () => {
    it('repairs validation response successfully on second attempt', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'invalid json',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ quality: 2, reason: 'Repaired response' }),
          usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.0008 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.validateInput('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.quality).toBe(2);
        expect(result.value.reason).toBe('Repaired response');
      }
    });

    it('repairs improvement response successfully on second attempt', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'here is the improved version',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'Clean repaired prompt',
          usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.0008 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.improvedPrompt).toBe('Clean repaired prompt');
      }
    });

    it('fails improvement repair when repaired response also has validation error', async () => {
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'here is the improved version',
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        },
      });
      mockGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: '{"still": "json"}',
          usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.0008 },
        },
      });

      const adapter = createAdapter();
      const result = await adapter.improveInput('Original prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Repair:');
        expect(result.error.message).toContain('JSON format');
      }
    });
  });
});
