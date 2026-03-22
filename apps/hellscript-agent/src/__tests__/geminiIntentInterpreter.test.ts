import { describe, it, expect, vi } from 'vitest';
import { GeminiIntentInterpreter } from '../infra/llm/geminiIntentInterpreter.js';
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

describe('GeminiIntentInterpreter', () => {
  describe('interpret', () => {
    it('parses valid append_thought response', async () => {
      const client = createMockClient({
        ok: true,
        value: {
          content: JSON.stringify({
            kind: 'append_thought',
            payload: { text: 'A new idea' },
          }),
        },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('A new idea', emptyState(), logger);

      expect(result.kind).toBe('append_thought');
      expect(result.payload['text']).toBe('A new idea');
    });

    it('parses response with extra text around JSON', async () => {
      const client = createMockClient({
        ok: true,
        value: {
          content: 'Here is the result:\n```json\n{"kind":"update_draft","payload":{"text":"write it","category":"general"}}\n```',
        },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('write it', emptyState(), logger);

      expect(result.kind).toBe('update_draft');
      expect(result.payload['text']).toBe('write it');
      expect(result.payload['category']).toBe('general');
    });

    it('returns fallback on LLM call failure', async () => {
      const client = createMockClient({
        ok: false,
        error: { code: 'API_ERROR', message: 'Service unavailable' },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('test utterance', emptyState(), logger);

      expect(result.kind).toBe('fallback_append');
      expect(result.payload['text']).toBe('test utterance');
      expect(result.fallbackReason).toBe('LLM call failed');
    });

    it('returns fallback on invalid JSON response', async () => {
      const client = createMockClient({
        ok: true,
        value: { content: 'This is not JSON at all' },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('test', emptyState(), logger);

      expect(result.kind).toBe('fallback_append');
      expect(result.fallbackReason).toContain('parse');
    });

    it('returns fallback on invalid intent kind', async () => {
      const client = createMockClient({
        ok: true,
        value: {
          content: JSON.stringify({
            kind: 'invalid_kind',
            payload: {},
          }),
        },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('test', emptyState(), logger);

      expect(result.kind).toBe('fallback_append');
      expect(result.fallbackReason).toContain('Invalid response shape');
    });

    it('returns fallback when payload is missing', async () => {
      const client = createMockClient({
        ok: true,
        value: {
          content: JSON.stringify({
            kind: 'append_thought',
          }),
        },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('test', emptyState(), logger);

      expect(result.kind).toBe('fallback_append');
    });

    it('preserves fallbackReason from LLM response', async () => {
      const client = createMockClient({
        ok: true,
        value: {
          content: JSON.stringify({
            kind: 'fallback_append',
            payload: { text: 'unclear' },
            fallbackReason: 'Ambiguous input',
          }),
        },
      });
      const interpreter = new GeminiIntentInterpreter(client);

      const result = await interpreter.interpret('unclear', emptyState(), logger);

      expect(result.kind).toBe('fallback_append');
      expect(result.fallbackReason).toBe('Ambiguous input');
    });
  });
});
