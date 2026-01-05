import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { GeminiPromptAdapter } from '../infra/llm/GeminiPromptAdapter.js';

vi.mock('@intexuraos/llm-audit', (): object => ({
  createAuditContext: (): object => ({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@intexuraos/llm-pricing', (): object => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

describe('GeminiPromptAdapter', () => {
  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  describe('generateThumbnailPrompt', () => {
    it('returns parsed prompt on success', async () => {
      const validResponse = {
        title: 'Machine Learning Overview',
        visualSummary: 'Neural network nodes illuminated',
        prompt: 'A glowing neural network with interconnected nodes on a dark background',
        negativePrompt: 'blurry, text, watermark',
        parameters: {
          aspectRatio: '16:9',
          framing: 'wide shot',
          textOnImage: 'none',
          realism: 'cinematic illustration',
          people: 'none',
          logosTrademarks: 'none',
        },
      };

      nock('https://generativelanguage.googleapis.com')
        .post(/.*/)
        .reply(200, {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(validResponse) }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 200,
          },
        });

      const adapter = new GeminiPromptAdapter({ apiKey: 'test-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Machine learning article');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Machine Learning Overview');
        expect(result.value.parameters.realism).toBe('cinematic illustration');
      }
    });

    it('returns PARSE_ERROR when response is invalid JSON', async () => {
      nock('https://generativelanguage.googleapis.com')
        .post(/.*/)
        .reply(200, {
          candidates: [
            {
              content: {
                parts: [{ text: 'not valid json' }],
              },
            },
          ],
        });

      const adapter = new GeminiPromptAdapter({ apiKey: 'test-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });

    it('returns INVALID_KEY error for authentication failure', async () => {
      nock('https://generativelanguage.googleapis.com')
        .post(/.*/)
        .replyWithError('API_KEY invalid');

      const adapter = new GeminiPromptAdapter({ apiKey: 'bad-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error for 429 response', async () => {
      nock('https://generativelanguage.googleapis.com')
        .post(/.*/)
        .replyWithError('429 Too Many Requests');

      const adapter = new GeminiPromptAdapter({ apiKey: 'test-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns TIMEOUT error for timeout', async () => {
      nock('https://generativelanguage.googleapis.com').post(/.*/).replyWithError('timeout');

      const adapter = new GeminiPromptAdapter({ apiKey: 'test-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('returns API_ERROR for other errors', async () => {
      nock('https://generativelanguage.googleapis.com').post(/.*/).replyWithError('Unknown error');

      const adapter = new GeminiPromptAdapter({ apiKey: 'test-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('uses custom model when specified', async () => {
      const validResponse = {
        title: 'Test',
        visualSummary: 'Summary',
        prompt: 'Prompt',
        negativePrompt: 'Negative',
        parameters: {
          aspectRatio: '16:9',
          framing: 'center',
          textOnImage: 'none',
          realism: 'photorealistic',
          people: 'none',
          logosTrademarks: 'none',
        },
      };

      nock('https://generativelanguage.googleapis.com')
        .post(/.*/)
        .reply(200, {
          candidates: [{ content: { parts: [{ text: JSON.stringify(validResponse) }] } }],
        });

      const adapter = new GeminiPromptAdapter({
        apiKey: 'test-key',
        model: 'gemini-2.0-flash',
        userId: 'test-user',
      });
      const result = await adapter.generateThumbnailPrompt('Test');

      expect(result.ok).toBe(true);
    });
  });
});
