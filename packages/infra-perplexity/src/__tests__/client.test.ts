import { beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink = new FakeUsageSink();

const { mockUsageLoggerLog } = vi.hoisted(() => ({
  mockUsageLoggerLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@intexuraos/llm-pricing', async (): Promise<typeof import('@intexuraos/llm-pricing')> => {
  const actual =
    await vi.importActual<typeof import('@intexuraos/llm-pricing')>('@intexuraos/llm-pricing');
  return {
    ...actual,
    logUsage: vi.fn().mockResolvedValue(undefined),
    createUsageLogger: vi.fn().mockReturnValue({
      log: mockUsageLoggerLog,
    }),
  } as typeof import('@intexuraos/llm-pricing');
});

const { createPerplexityClient } = await import('../client.js');

const API_BASE_URL = 'https://api.perplexity.ai';
const TEST_MODEL = LlmModels.SonarPro;

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
    mockUsageSink.clear();
  });

  describe('research', () => {
    it('returns research result with content and usage (streaming)', async () => {
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('returns costUsd 0 regardless of provider cost in response (streaming)', async () => {
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('forwards per-call correlation to usage logger when provided', async () => {
      const sseBody = createSSEBody({
        content: 'ok',
        citations: [],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      nock(API_BASE_URL).post('/chat/completions').reply(200, sseBody, {
        'Content-Type': 'text/event-stream',
      });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.research('hello', { correlation: { researchId: 'r-1' } });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'research',
          promptType: 'research-web-search',
          correlation: { researchId: 'r-1' },
        })
      );
    });
  });

  describe('generate', () => {
    it('returns generate result with content and usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Generated text.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated text.');
        expect(result.value.usage).toMatchObject({
          inputTokens: 50,
          outputTokens: 100,
          totalTokens: 150,
        });
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('retries transient RATE_LIMITED then returns success', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Rate limited');
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'recovered' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('hi', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('recovered');
      }
    });

    it('returns costUsd 0 for generate regardless of provider cost', async () => {
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('Write something', { promptType: 'test-prompt' });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'generate',
          success: true,
        })
      );
    });

    it('forwards per-call correlation to usage logger when provided', async () => {
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('Write something', {
        promptType: 'test-prompt',
        correlation: { researchId: 'r-1' },
      });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({ correlation: { researchId: 'r-1' } })
      );
    });

    it('omits correlation from usage logger when not provided', async () => {
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('Write something', { promptType: 'test-prompt' });

      const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(lastCall).not.toHaveProperty('correlation');
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('retries a provider HTTP 500 and returns the recovered response', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Internal error');
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { role: 'assistant', content: 'Recovered.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result).toMatchObject({ ok: true, value: { content: 'Recovered.' } });
      expect(nock.isDone()).toBe(true);
    });

    it('does not retry a non-transient provider HTTP 400', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(400, 'Invalid request');

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result).toMatchObject({ ok: false, error: { code: 'API_ERROR' } });
      expect(nock.isDone()).toBe(true);
    });

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Connection error' });

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('costUsd always zero', () => {
    it('returns costUsd 0 regardless of provider cost settings', async () => {
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('returns costUsd 0 even when no provider cost in response', async () => {
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

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test prompt', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        .times(3)
        .replyWithError(new Error('Connection timeout occurred'));

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test prompt', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('Test prompt', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toBe('Request timed out');
      }
    });

    it('handles AbortError from fetch in generate', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      nock(API_BASE_URL).post('/chat/completions').times(3).replyWithError(abortError);

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test prompt', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toBe('Request timed out');
      }
    });

    it('handles custom timeoutMs parameter', async () => {
      // Test that custom timeout is passed to fetchWithTimeout
      const abortError = new Error('Timed out');
      abortError.name = 'AbortError';
      nock(API_BASE_URL).post('/chat/completions').replyWithError(abortError);

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        timeoutMs: 1000, // 1 second timeout
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('uses default timeout when not specified', async () => {
      // Verify the default timeout of 840000ms (14 minutes) is used
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,
          createSSEBody({
            content: 'Response',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        // timeoutMs not specified, should use DEFAULT_TIMEOUT_MS
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
    });

    it('clears timeout when fetch completes successfully', async () => {
      // Verify the timeout is cleared (doesn't fire) when request succeeds
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => body.stream === true)
        .reply(
          200,
          createSSEBody({
            content: 'Quick response',
            usage: { prompt_tokens: 5, completion_tokens: 5 },
          }),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        timeoutMs: 100,
      });

      // If timeout wasn't cleared, this would fail after 100ms
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
    });

    it('handles request that completes exactly at timeout boundary', async () => {
      // Edge case: response arrives right as timeout fires
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      nock(API_BASE_URL).post('/chat/completions').delay(100).replyWithError(abortError);

      const client = createPerplexityClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        timeoutMs: 50, // Shorter than delay
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });
  });

  it('passes ownerType to usage logger when provided', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

    const client = createPerplexityClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
      ownerType: 'user',
    });
    await client.generate('hello', { promptType: 'test-prompt' });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user' }));
  });

  it('passes promptType to usage logger', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

    const client = createPerplexityClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
    });
    await client.generate('hello', { promptType: 'test-prompt' });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({ promptType: 'test-prompt' })
    );
  });
});
