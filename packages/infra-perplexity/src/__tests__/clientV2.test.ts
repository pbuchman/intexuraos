import { beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { ModelPricing } from '@intexuraos/llm-contract';

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

const { createPerplexityClientV2 } = await import('../clientV2.js');
const { logUsage } = await import('@intexuraos/llm-pricing');

const API_BASE_URL = 'https://api.perplexity.ai';
const TEST_MODEL = 'sonar-pro';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  useProviderCost: true,
  ...overrides,
});

describe('createPerplexityClientV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  describe('research', () => {
    it('returns research result with content and usage from pricing', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Research findings about AI.' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        });

      const pricing = createTestPricing({ useProviderCost: false });
      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research findings about AI.');
        expect(result.value.usage).toMatchObject({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
        // Cost from tokens: (100/1M * 3.0) + (50/1M * 15.0) = 0.0003 + 0.00075 = 0.00105
        expect(result.value.usage.costUsd).toBeCloseTo(0.00105, 6);
      }
    });

    it('uses provider cost when useProviderCost is true', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Research findings.' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            cost: { total_cost: 0.005 },
          },
        });

      const pricing = createTestPricing({ useProviderCost: true });
      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.005);
      }
    });

    it('extracts sources from search_results', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Research content' } }],
          search_results: [{ url: 'https://source1.com' }, { url: 'https://source2.com' }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://source1.com');
        expect(result.value.sources).toContain('https://source2.com');
      }
    });

    it('deduplicates sources', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Content' } }],
          search_results: [{ url: 'https://example.com' }, { url: 'https://example.com' }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('handles missing search_results', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Content' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('logs usage on success', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Content' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      await client.research('Test prompt');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: 'perplexity',
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles 401 unauthorized error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Invalid API key');

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Rate limited');

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles 503 overloaded error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(503, 'Overloaded');

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('logs usage on error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      await client.research('Test prompt');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.any(String),
        })
      );
    });

    it('handles network error in research', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Network failure' });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles empty choices array', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 0 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });
  });

  describe('generate', () => {
    it('returns generate result with content and usage from pricing', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Generated text.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const pricing = createTestPricing({ useProviderCost: false });
      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated text.');
        expect(result.value.usage).toMatchObject({
          inputTokens: 50,
          outputTokens: 100,
          totalTokens: 150,
        });
        // Cost: (50/1M * 3.0) + (100/1M * 15.0) = 0.00015 + 0.0015 = 0.00165
        expect(result.value.usage.costUsd).toBeCloseTo(0.00165, 6);
      }
    });

    it('uses provider cost for generate when useProviderCost is true', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Generated text.' } }],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 100,
            total_tokens: 150,
            cost: { total_cost: 0.003 },
          },
        });

      const pricing = createTestPricing({ useProviderCost: true });
      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.003);
      }
    });

    it('logs usage with generate callType', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Generated text.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 100 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      await client.generate('Write something');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'generate',
          success: true,
        })
      );
    });

    it('handles empty response content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: '' } }],
          usage: { prompt_tokens: 50, completion_tokens: 0 },
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles API error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Internal error');

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Connection error' });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('fallback pricing behavior', () => {
    it('uses token-based calculation when useProviderCost is false and no provider cost', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        });

      const pricing = createTestPricing({ useProviderCost: false });
      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // (1000/1M * 3.0) + (500/1M * 15.0) = 0.003 + 0.0075 = 0.0105
        expect(result.value.usage.costUsd).toBeCloseTo(0.0105, 6);
      }
    });

    it('falls back to token calculation when useProviderCost is true but no cost in response', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const pricing = createTestPricing({ useProviderCost: true });
      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Falls back to token calculation: (100/1M * 3.0) + (50/1M * 15.0) = 0.00105
        expect(result.value.usage.costUsd).toBeCloseTo(0.00105, 6);
      }
    });

    it('handles undefined usage in response', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toEqual({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        });
      }
    });

    it('handles undefined usage in generate response', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Response' } }],
        });

      const client = createPerplexityClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toEqual({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        });
      }
    });
  });
});
