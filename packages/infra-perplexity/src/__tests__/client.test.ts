import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import nock from 'nock';

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

const { createAuditContext } = await import('@intexuraos/llm-audit');
const { createPerplexityClient } = await import('../index.js');

const API_BASE_URL = 'https://api.perplexity.ai';
const TEST_MODEL = 'sonar-pro';

describe('createPerplexityClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  describe('research', () => {
    it('returns research result with content and usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Research findings about AI.' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research findings about AI.');
        expect(result.value.usage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
      }
    });

    it('uses default search context for unknown model', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: 'unknown-model',
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
    });

    it('uses default pricing for unknown model', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
          },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: 'unknown-model',
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.0015);
      }
    });

    it('handles empty choices array', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(200, {
        choices: [],
      });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles missing message content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: {} }],
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('extracts sources from search_results', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Research content' } }],
          search_results: [{ url: 'https://source1.com' }, { url: 'https://source2.com' }],
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://source1.com');
        expect(result.value.sources).toContain('https://source2.com');
      }
    });

    it('returns empty sources when no search_results', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Content' } }],
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('deduplicates source URLs', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Content' } }],
          search_results: [{ url: 'https://same.com' }, { url: 'https://same.com' }],
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://same.com']);
      }
    });

    it('skips search_results without URL', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Content' } }],
          search_results: [{ url: 'https://valid.com' }, { title: 'No URL here' }, {}],
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://valid.com']);
      }
    });

    it('returns INVALID_KEY error on 401', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Unauthorized');

      const client = createPerplexityClient({
        apiKey: 'bad-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Too Many Requests');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns API_ERROR on general failure', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns CONTEXT_LENGTH error when message contains context and length', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(400, 'context length exceeded');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTEXT_LENGTH');
      }
    });

    it('returns TIMEOUT error when message contains timeout', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(408, 'Request timeout');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('returns API_ERROR for non-PerplexityApiError', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError('Network failure');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('generate', () => {
    it('returns generated content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Generated response' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated response');
      }
    });

    it('returns empty string on missing content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: {} }],
          usage: { prompt_tokens: 100, completion_tokens: 0 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns error on failure', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Error');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success with usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 75,
          },
        });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      await client.research('Test prompt');

      expect(createAuditContext).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'perplexity',
          method: 'research',
        })
      );
      expect(mockSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 150,
          outputTokens: 75,
        })
      );
    });

    it('includes providerCost when cost.total_cost is present', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            cost: {
              total_cost: 0.0123,
            },
          },
        });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.0123);
      }
    });

    it('calls audit context on error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'API error');

      const mockError = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
