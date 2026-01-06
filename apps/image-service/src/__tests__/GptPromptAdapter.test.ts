import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import nock from 'nock';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { GptPromptAdapter } from '../infra/llm/GptPromptAdapter.js';

vi.mock('@intexuraos/llm-audit', (): object => ({
  createAuditContext: (): object => ({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@intexuraos/llm-pricing', (): object => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

const testPricing: ModelPricing = {
  inputPricePerMillion: 1.75,
  outputPricePerMillion: 14.0,
};

describe('GptPromptAdapter', () => {
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
        title: 'AI Technology',
        visualSummary: 'Futuristic tech visualization',
        prompt: 'A futuristic AI interface with holographic displays',
        negativePrompt: 'blurry, low quality',
        parameters: {
          aspectRatio: '16:9',
          framing: 'medium shot',
          textOnImage: 'none',
          realism: 'photorealistic',
          people: 'none',
          logosTrademarks: 'none',
        },
      };

      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          choices: [
            {
              message: {
                content: JSON.stringify(validResponse),
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
          },
        });

      const adapter = new GptPromptAdapter({ apiKey: 'test-key', userId: 'test-user', pricing: testPricing });
      const result = await adapter.generateThumbnailPrompt('AI technology article');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('AI Technology');
        expect(result.value.parameters.realism).toBe('photorealistic');
      }
    });

    it('returns PARSE_ERROR when response is invalid', async () => {
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          choices: [
            {
              message: {
                content: '{"incomplete": true}',
              },
            },
          ],
        });

      const adapter = new GptPromptAdapter({ apiKey: 'test-key', userId: 'test-user', pricing: testPricing });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
      }
    });

    it('returns INVALID_KEY error for API key failure', async () => {
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(401, {
          error: {
            message: 'Incorrect API key provided',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });

      const adapter = new GptPromptAdapter({ apiKey: 'bad-key', userId: 'test-user' });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error for rate limit', async () => {
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .times(3)
        .reply(429, {
          error: {
            message: 'Rate limit reached for requests',
            type: 'requests',
            code: 'rate_limit_exceeded',
          },
        });

      const adapter = new GptPromptAdapter({ apiKey: 'test-key', userId: 'test-user', pricing: testPricing });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns API_ERROR for other errors', async () => {
      nock('https://api.openai.com').post('/v1/chat/completions').replyWithError('Server error');

      const adapter = new GptPromptAdapter({ apiKey: 'test-key', userId: 'test-user', pricing: testPricing });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles empty response', async () => {
      nock('https://api.openai.com').post('/v1/chat/completions').reply(200, {
        choices: [],
      });

      const adapter = new GptPromptAdapter({ apiKey: 'test-key', userId: 'test-user', pricing: testPricing });
      const result = await adapter.generateThumbnailPrompt('Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_ERROR');
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
          realism: 'clean vector',
          people: 'none',
          logosTrademarks: 'none',
        },
      };

      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          choices: [{ message: { content: JSON.stringify(validResponse) } }],
        });

      const adapter = new GptPromptAdapter({
        apiKey: 'test-key',
        model: 'gpt-4o',
        userId: 'test-user',
        pricing: testPricing,
      });
      const result = await adapter.generateThumbnailPrompt('Test');

      expect(result.ok).toBe(true);
    });
  });
});
