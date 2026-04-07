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
    it('returns ok result with generated content on success', async () => {
      const client = createMockClient({
        ok: true,
        value: { content: '# Great Blog Post\n\nHere is content.' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(
        emptyState(), null, 'Write a blog', null, [], 'general', logger
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('# Great Blog Post\n\nHere is content.');
      }
    });

    it('returns error result on LLM failure', async () => {
      const client = createMockClient({
        ok: false,
        error: { code: 'API_ERROR', message: 'Failed' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(
        emptyState(), '# Prior Draft', 'Improve it', null, [], 'general', logger
      );

      expect(result.ok).toBe(false);
    });

    it('returns error result when no prior draft exists', async () => {
      const client = createMockClient({
        ok: false,
        error: { code: 'API_ERROR', message: 'Failed' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(
        emptyState(), null, 'Write it', null, [], 'general', logger
      );

      expect(result.ok).toBe(false);
    });

    it('passes style instructions and samples to prompt', async () => {
      const client = createMockClient({
        ok: true,
        value: { content: '# LinkedIn Post' },
      });
      const generator = new GeminiDraftGenerator(client);

      const result = await generator.generate(
        emptyState(), null, 'Write', 'Be professional', ['Sample text'], 'linkedin', logger
      );

      expect(result.ok).toBe(true);
      expect(client.generate).toHaveBeenCalledTimes(1);
      const prompt = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(prompt).toContain('Be professional');
      expect(prompt).toContain('Sample text');
      expect(prompt).toContain('LinkedIn');
    });
  });
});
