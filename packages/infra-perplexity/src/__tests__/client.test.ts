import { beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { type ModelPricing, LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockUsageLoggerLog = vi.fn().mockResolvedValue(undefined);

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
  createUsageLogger: vi.fn().mockReturnValue({
    log: mockUsageLoggerLog,
  }),
}));

const { createPerplexityClient } = await import('../client.js');

const API_BASE_URL = 'https://api.perplexity.ai';
const TEST_MODEL = LlmModels.SonarPro;

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  useProviderCost: true,
  ...overrides,
});

/**
 * Helper to create SSE stream response body for research() tests.
 * Returns a string in SSE format that nock can use.
 */
function createSSEBody(options: {
  content: string;
  citations?: string[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
    cost?: { total_cost?: number };
  };
}): string {
  const { content, citations, usage } = options;
  const chunks: string[] = [];

  // Split content into chunks to simulate streaming
  const contentParts = content.length > 10 ? [content.slice(0, 5), content.slice(5)] : [content];

  for (const part of contentParts) {
    const data: Record<string, unknown> = {
      choices: [{ delta: { content: part } }],
    };
    // Include citations in intermediate chunks if provided
    if (citations !== undefined) {
      data['citations'] = citations;
    }
    chunks.push(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Final chunk with usage
  if (usage !== undefined) {
    const finalData: Record<string, unknown> = {
      choices: [{ delta: {} }],
      usage,
    };
    if (citations !== undefined) {
      finalData['citations'] = citations;
    }
    chunks.push(`data: ${JSON.stringify(finalData)}\n\n`);
  }

  chunks.push('data: [DONE]\n\n');

  return chunks.join('');
}

describe('createPerplexityClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  describe('research', () => {
    it('returns research result with content and usage from pricing (streaming)', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Research findings about AI.',
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const pricing = createTestPricing({ useProviderCost: false });
      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
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

    it('uses provider cost when useProviderCost is true (streaming)', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Research findings.',
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              cost: { total_cost: 0.005 },
            },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const pricing = createTestPricing({ useProviderCost: true });
      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.005);
      }
    });

    it('extracts citations from stream response', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Research content',
            citations: ['https://source1.com', 'https://source2.com'],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://source1.com');
        expect(result.value.sources).toContain('https://source2.com');
      }
    });

    it('returns citations array from stream as-is', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Content',
            citations: ['https://example.com'],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://example.com']);
      }
    });

    it('handles missing citations in stream', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Content',
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('logs usage on success', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Content',
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: LlmProviders.Perplexity,
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles 401 unauthorized error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Invalid API key');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Rate limited');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles 503 overloaded error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(503, 'Overloaded');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('logs usage on error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.any(String),
        })
      );
    });

    it('handles network error in research', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Network failure' });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles empty content in stream', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: '',
            usage: { prompt_tokens: 100, completion_tokens: 0 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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
      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
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
      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.generate('Write something');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles undefined message content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: {} }],
          usage: { prompt_tokens: 50, completion_tokens: 0 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles API error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Internal error');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Connection error' });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Response',
            usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const pricing = createTestPricing({ useProviderCost: false });
      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
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
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Response',
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const pricing = createTestPricing({ useProviderCost: true });
      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Falls back to token calculation: (100/1M * 3.0) + (50/1M * 15.0) = 0.00105
        expect(result.value.usage.costUsd).toBeCloseTo(0.00105, 6);
      }
    });

    it('handles undefined usage in stream response', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,

          createSSEBody({
            content: 'Response',
            // No usage provided
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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

  describe('edge cases', () => {
    it('handles response with empty body in research', async () => {
      // Test line 141: if (!response.body) throw new Error
      // We mock global fetch to return a Response with null body
      const mockFetch = vi.fn().mockResolvedValue(
        Object.create(Response.prototype, {
          ok: { value: true },
          body: { value: null },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Response body is empty');
      }

      vi.unstubAllGlobals();
    });

    it('uses default medium search context for unknown model', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          return body.stream === true && body.messages[0].content.includes('medium');
        })
        .reply(
          200,

          createSSEBody({
            content: 'Research result',
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: 'unknown-model' as (typeof LlmModels)[keyof typeof LlmModels],
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
    });

    it('handles timeout error in research', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError(new Error('Request timeout'));

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles timeout error in generate', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .replyWithError(new Error('Connection timeout occurred'));

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles stream error as timeout', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .replyWithError(new Error('stream ended unexpectedly'));

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles fetch failed error as timeout', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError(new Error('fetch failed'));

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('research sends stream:true in request body', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(
          200,

          createSSEBody({
            content: 'Result',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(capturedBody?.['stream']).toBe(true);
    });

    it('generate does NOT send stream:true in request body', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          choices: [{ message: { content: 'Generated content' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.generate('Test prompt');

      expect(capturedBody?.['stream']).toBeUndefined();
    });

    it('handles AbortError from fetch as timeout', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      nock(API_BASE_URL).post('/chat/completions').replyWithError(abortError);

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toBe('Request timed out');
      }
    });
  });
});
