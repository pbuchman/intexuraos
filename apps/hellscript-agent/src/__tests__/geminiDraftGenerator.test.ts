import { describe, it, expect, vi } from 'vitest';
import { GeminiDraftGenerator } from '../infra/llm/geminiDraftGenerator.js';
import { emptyState } from '../domain/models/materializedBufferState.js';
import type { GeminiClient } from '@intexuraos/infra-gemini';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function createMockClient(response: { ok: boolean; value?: { content: string }; error?: unknown }): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(response),
    research: vi.fn().mockResolvedValue({ ok: false, error: { code: 'UNSUPPORTED', message: 'Not implemented' } }),
  };
}

describe('GeminiDraftGenerator', () => {
  describe('generate', () => {
    it('returns generated content on success', async () => {
      const client = createMockClient({
        ok: true,
        value: { content: '# Great Blog Post\n\nHere is content.' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(emptyState(), null, 'Write a blog', logger);

      expect(result).toBe('# Great Blog Post\n\nHere is content.');
    });

    it('returns prior draft on failure when available', async () => {
      const client = createMockClient({
        ok: false,
        error: { code: 'API_ERROR', message: 'Failed' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(
        emptyState(),
        '# Prior Draft',
        'Improve it',
        logger
      );

      expect(result).toBe('# Prior Draft');
    });

    it('returns fallback message on failure when no prior draft', async () => {
      const client = createMockClient({
        ok: false,
        error: { code: 'API_ERROR', message: 'Failed' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(emptyState(), null, 'Write it', logger);

      expect(result).toContain('Generation failed');
    });
  });
});
