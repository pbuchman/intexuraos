import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { LlmProviders } from '@intexuraos/llm-contract';
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

const { createOpenRouterClient } = await import('../client.js');

const API_BASE_URL = 'https://openrouter.ai/api/v1';
const TEST_MODEL = 'anthropic/claude-sonnet-4.6';

function openRouterSse(chunks: string[]): string {
  return chunks.map((chunk) => `data: ${chunk}\n\n`).join('');
}

describe('createOpenRouterClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
    mockUsageSink.clear();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('research', () => {
    it('sends request with :online suffix for research', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.research('Test prompt');

      // Verify :online suffix was appended for research
      expect(capturedBody?.['model']).toBe(`${TEST_MODEL}:online`);
    });

    it('does not double-append :online suffix if model already ends with :online', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: `${TEST_MODEL}:online`, // Model already has :online suffix
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.research('Test prompt');

      // Verify :online suffix was NOT double-appended
      expect(capturedBody?.['model']).toBe(`${TEST_MODEL}:online`);
    });

    it('returns research result with content and usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings about AI.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
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

    it('handles missing choices gracefully with empty content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [], // Empty choices
          usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.research('Test prompt');

      // Should return empty content when choices is empty
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('extracts object annotations with url field', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research content', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          annotations: [
            { url: 'https://example.com/article1', title: 'Example 1' },
            { url: 'https://example.com/article2', title: 'Example 2' },
          ],
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://example.com/article1');
        expect(result.value.sources).toContain('https://example.com/article2');
      }
    });

    it('extracts annotations as sources', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research content', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          annotations: ['https://source1.com', 'https://source2.com'],
        });

      const client = createOpenRouterClient({
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

    it('logs usage on success', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Content', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
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
          provider: LlmProviders.OpenRouter,
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles 401 unauthorized error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Invalid API key');

      const client = createOpenRouterClient({
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

      const client = createOpenRouterClient({
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

    it('handles 500 overloaded error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');

      const client = createOpenRouterClient({
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

      const client = createOpenRouterClient({
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

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Network failure' });

      const client = createOpenRouterClient({
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

    it('handles timeout error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError(new Error('Request timeout'));

      const client = createOpenRouterClient({
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

    it('forwards per-call correlation to usage logger when provided', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

      const client = createOpenRouterClient({
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

  it('classifies native AbortError failures as timeout usage without leaking details', async () => {
    const privateMarker = 'PRIVATE_ABORT_MARKER_82db6d41';
    const abortError = new Error(privateMarker);
    abortError.name = 'AbortError';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);
    const client = createOpenRouterClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
    });

    const result = await client.research('Research this safely');
    fetchSpy.mockRestore();

    expect(result.ok).toBe(false);
    expect(mockUsageLoggerLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        success: false,
        errorMessage: 'OPENROUTER_TIMEOUT',
      })
    );
    expect(JSON.stringify(mockUsageLoggerLog.mock.calls.at(-1))).not.toContain(privateMarker);
  });

  describe('generate', () => {
    it('aborts while a successful response body is still being consumed', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .delayBody(50)
        .reply(200, {
          id: 'chatcmpl-delayed-body',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Too late.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        timeoutMs: 10,
        maxAttempts: 1,
      });

      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    });

    it('honors a configured provider attempt cap', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response('Service overloaded', { status: 503 }));
      try {
        const client = createOpenRouterClient({
          apiKey: 'test-key',
          model: TEST_MODEL,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
          maxAttempts: 2,
        } as Parameters<typeof createOpenRouterClient>[0]);

        const result = await client.generate('Write something', { promptType: 'test-prompt' });

        expect(result).toMatchObject({ ok: false, error: { code: 'OVERLOADED' } });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('retries a provider HTTP 500 within the configured attempt cap', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Server error', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'Recovered.' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      try {
        const client = createOpenRouterClient({
          apiKey: 'test-key',
          model: TEST_MODEL,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
          maxAttempts: 2,
        });

        const result = await client.generate('Write something', { promptType: 'test-prompt' });

        expect(result).toMatchObject({ ok: true, value: { content: 'Recovered.' } });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('does NOT append :online suffix for synthesis', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('Write something', { promptType: 'test-prompt' });

      // Verify NO :online suffix for synthesis
      expect(capturedBody?.['model']).toBe(TEST_MODEL);
    });

    it('returns generate result with content and usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
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

    it('returns exact Matrix context and provider-reported cost for a structured call', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: '{"outcome":"conversation"}', role: 'assistant' } }],
          usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13, cost: 0.00031 },
        });
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        evidenceModelId: 'or:deepseek/deepseek-v4-flash',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const context = {
        version: 1 as const,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'intent_classification' as const,
        callOrdinal: 1,
      };

      const result = await client.generate('Classify', {
        promptType: 'intex-agent-intent-classifier',
        matrixCorpusContext: context,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.providerCall).toEqual({
        context,
        modelId: 'or:deepseek/deepseek-v4-flash',
        inputTokens: 8,
        outputTokens: 5,
        totalTokens: 13,
        providerReportedUsd: 0.00031,
      });
    });

    it('omits Matrix provider-reported cost when OpenRouter does not report it', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: '{"outcome":"conversation"}', role: 'assistant' } }],
          usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
        });
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        evidenceModelId: 'or:deepseek/deepseek-v4-flash',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const context = {
        version: 1 as const,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'intent_classification' as const,
        callOrdinal: 1,
      };

      const result = await client.generate('Classify', {
        promptType: 'intex-agent-intent-classifier',
        matrixCorpusContext: context,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.providerCall).toEqual({
        context,
        modelId: 'or:deepseek/deepseek-v4-flash',
        inputTokens: 8,
        outputTokens: 5,
        totalTokens: 13,
      });
    });

    it('logs usage with generate callType', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
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

    it('handles non-retriable API error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(400, 'Invalid request');

      const client = createOpenRouterClient({
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

    it('handles 401 unauthorized error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Invalid API key');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).post('/chat/completions').times(3).reply(429, 'Rate limited');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles 503 overloaded error', async () => {
      nock(API_BASE_URL).post('/chat/completions').times(3).reply(503, 'Service overloaded');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('handles timeout error', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .times(3)
        .replyWithError(new Error('Request timeout'));

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('retries transient RATE_LIMITED then returns success', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Rate limited');
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'recovered' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        });

      const client = createOpenRouterClient({
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

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Connection error' });

      const client = createOpenRouterClient({
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

    it('handles empty content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: '', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        });

      const client = createOpenRouterClient({
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

    it('includes response_format in request body when responseFormat option is provided', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: '{"key": "value"}', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        providerRouting: { requireParameters: true },
      });

      await client.generate('Return JSON', {
        responseFormat: { type: 'json_object' },
        promptType: 'test-prompt',
      });

      expect(capturedBody).toHaveProperty('response_format', { type: 'json_object' });
      expect(capturedBody).toHaveProperty('provider', { require_parameters: true });
    });

    it('requires a provider that supports strict JSON Schema response formats', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      const responseFormat = {
        type: 'json_schema',
        json_schema: {
          name: 'classification',
          strict: true,
          schema: {
            type: 'object',
            properties: { outcome: { type: 'string' } },
            required: ['outcome'],
            additionalProperties: false,
          },
        },
      } as const;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: '{"outcome":"tool"}', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('Return structured JSON', {
        responseFormat,
        promptType: 'test-prompt',
      });

      expect(capturedBody).toHaveProperty('response_format', responseFormat);
      expect(capturedBody).toHaveProperty('provider', { require_parameters: true });
    });

    it('does NOT include response_format in request body when no options are provided', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Plain text response', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('Write something', { promptType: 'test-prompt' });

      expect(capturedBody).not.toHaveProperty('response_format');
      expect(capturedBody).not.toHaveProperty('provider');
    });

    it('rejects an empty choices array in generate', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [], // Empty choices array
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        });

      const client = createOpenRouterClient({
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

    it('rejects an in-band provider error instead of returning partial content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Partial response that must not escape', role: 'assistant' },
              finish_reason: 'error',
              error: {
                code: 500,
                message: 'Sensitive provider failure text',
                metadata: { provider_name: 'test-provider' },
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        });

      const client = createOpenRouterClient({
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

    it('rejects choice error metadata even when the finish reason is not error', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Partial response that must not escape', role: 'assistant' },
              finish_reason: 'stop',
              error: {
                code: 500,
                message: 'Sensitive provider failure text',
                metadata: { provider_name: 'test-provider' },
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        });

      const client = createOpenRouterClient({
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

  describe('generateChat', () => {
    it('fails before fetch when the shared deadline is already exhausted', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        const client = createOpenRouterClient({
          apiKey: 'test-key',
          model: TEST_MODEL,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
          maxAttempts: 1,
          deadlineAtMs: Date.now() - 1,
        });

        const result = await client.generateChat([{ role: 'user', content: 'hello' }], {
          promptType: 'test-chat',
        });

        expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('returns provider-reported USD separately from normalized chat cost', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Chat response', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            cost: 0.0042,
          },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        providerRouting: {},
      });

      const result = await client.generateChat([{ role: 'user', content: 'hello' }], {
        promptType: 'test-chat-prompt',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toMatchObject({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.0042,
          providerReportedUsd: 0.0042,
        });
      }
      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({ providerReportedUsd: 0.0042 })
      );
      expect(capturedBody).not.toHaveProperty('provider');
    });

    it('forwards reasoning options to OpenRouter chat completions', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      const providerOrder = ['gmicloud', 'minimax', 'morph'];

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: 'minimax/minimax-m3',
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.001 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'minimax/minimax-m3',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        providerRouting: {
          requireParameters: true,
          order: providerOrder,
          allowFallbacks: false,
        },
      });
      providerOrder[0] = 'caller-mutated-provider';

      const result = await client.generateChat([{ role: 'user', content: 'hello' }], {
        promptType: 'whatsapp-conversation-assistant',
        reasoning: {
          enabled: true,
          effort: 'high',
          maxTokens: 2048,
          exclude: true,
        },
      });

      expect(result.ok).toBe(true);
      expect(capturedBody?.['reasoning']).toEqual({
        enabled: true,
        effort: 'high',
        max_tokens: 2048,
        exclude: true,
      });
      expect(capturedBody?.['provider']).toEqual({
        require_parameters: true,
        order: ['gmicloud', 'minimax', 'morph'],
        allow_fallbacks: false,
      });
    });

    it('streams chat completion deltas and final usage', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          const typed = body as Record<string, unknown>;
          capturedBody = typed;
          return (
            typed['stream'] === true && JSON.stringify(typed['reasoning']) === '{"enabled":true}'
          );
        })
        .reply(
          200,
          openRouterSse([
            JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
            JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
            JSON.stringify({
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.001 },
            }),
            '[DONE]',
          ]),
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'minimax/minimax-m3',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        providerRouting: {
          requireParameters: true,
          order: ['gmicloud', 'minimax', 'morph'],
          allowFallbacks: false,
        },
      });
      const events: unknown[] = [];
      const responseFormat = {
        type: 'json_schema',
        json_schema: {
          name: 'streamed_response',
          strict: true,
          schema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      } as const;

      const result = await client.generateChatStream(
        [{ role: 'user', content: 'hello' }],
        {
          promptType: 'whatsapp-conversation-assistant',
          reasoning: { enabled: true },
          sessionId: 'session-123',
          responseFormat,
        },
        (event) => {
          events.push(event);
        }
      );

      expect(result.ok).toBe(true);
      expect(capturedBody).toMatchObject({
        session_id: 'session-123',
        response_format: responseFormat,
        provider: {
          require_parameters: true,
          order: ['gmicloud', 'minimax', 'morph'],
          allow_fallbacks: false,
        },
      });
      expect(events).toContainEqual({ type: 'delta', text: 'Hel' });
      expect(events).toContainEqual({ type: 'delta', text: 'lo' });
      expect(events).toContainEqual({
        type: 'usage',
        usage: expect.objectContaining({
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          costUsd: 0.001,
          providerReportedUsd: 0.001,
        }),
      });
      if (result.ok) {
        expect(result.value.content).toBe('Hello');
        expect(result.value.usage.totalTokens).toBe(5);
        expect(result.value.usage.providerReportedUsd).toBe(0.001);
      }
    });

    it('requires strict-schema support for streaming without configured provider routing', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, openRouterSse(['[DONE]']), {
          'Content-Type': 'text/event-stream',
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'deepseek/deepseek-v4-flash',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const responseFormat = {
        type: 'json_schema',
        json_schema: {
          name: 'streamed_response',
          strict: true,
          schema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      } as const;

      const result = await client.generateChatStream(
        [{ role: 'user', content: 'hello' }],
        {
          promptType: 'test-strict-stream',
          responseFormat,
        },
        vi.fn()
      );

      expect(result.ok).toBe(true);
      expect(capturedBody).toMatchObject({
        response_format: responseFormat,
        provider: { require_parameters: true },
      });
    });

    it('ignores streaming comments and buffers incomplete SSE frames', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(
          200,
          ': keep-alive\n\nevent: completion\n\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
          { 'Content-Type': 'text/event-stream' }
        );

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'minimax/minimax-m3',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChatStream(
        [{ role: 'user', content: 'hello' }],
        { promptType: 'whatsapp-conversation-assistant', reasoning: { enabled: true } },
        vi.fn()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hi');
      }
      expect(capturedBody).not.toHaveProperty('provider');
    });

    it('maps non-ok streaming responses and empty stream bodies to errors', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'stream failed');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'minimax/minimax-m3',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const httpError = await client.generateChatStream(
        [{ role: 'user', content: 'hello' }],
        { promptType: 'whatsapp-conversation-assistant' },
        vi.fn()
      );
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      const emptyBody = await client.generateChatStream(
        [{ role: 'user', content: 'hello again' }],
        { promptType: 'whatsapp-conversation-assistant' },
        vi.fn()
      );
      fetchSpy.mockRestore();

      expect(httpError.ok).toBe(false);
      if (!httpError.ok) expect(httpError.error.message).toContain('stream failed');
      expect(emptyBody.ok).toBe(false);
      if (!emptyBody.ok) expect(emptyBody.error.message).toContain('Response body is empty');
    });

    it('maps streaming provider error chunks to API errors', async () => {
      const privateMarker = 'PRIVATE_WHATSAPP_CONTEXT_MARKER_4f5d57e0';
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(
          200,
          openRouterSse([
            JSON.stringify({ error: { message: `provider failed: ${privateMarker}` } }),
          ]),
          {
            'Content-Type': 'text/event-stream',
          }
        );

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: 'minimax/minimax-m3',
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChatStream(
        [{ role: 'user', content: 'hello' }],
        { promptType: 'whatsapp-conversation-assistant', reasoning: { enabled: true } },
        vi.fn()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain(privateMarker);
      }
      const usagePayload = mockUsageLoggerLog.mock.calls.at(-1)?.[0];
      expect(usagePayload).toEqual(
        expect.objectContaining({
          success: false,
          errorMessage: 'OPENROUTER_HTTP_500',
        })
      );
      expect(JSON.stringify(usagePayload)).not.toContain(privateMarker);
    });

    it('serializes session_id, response_format, temperature, and cache_control blocks', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Chat response', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generateChat(
        [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text: 'System instructions',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Stable transcript',
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'text',
                text: 'Current question',
              },
            ],
          },
        ],
        {
          promptType: 'test-chat-prompt',
          sessionId: 'session-123',
          responseFormat: { type: 'json_object' },
          temperature: 0.35,
        }
      );

      expect(capturedBody).toMatchObject({
        model: TEST_MODEL,
        session_id: 'session-123',
        response_format: { type: 'json_object' },
        temperature: 0.35,
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: 'System instructions' }],
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Stable transcript',
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'text',
                text: 'Current question',
              },
            ],
          },
        ],
      });
    });

    it('maps OpenRouter cache usage fields into chat usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Chat response', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            total_tokens: 125,
            prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 40 },
          },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChat(
        [{ role: 'user', content: 'What happened in this chat?' }],
        { promptType: 'test-chat-prompt' }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          content: 'Chat response',
          usage: {
            inputTokens: 100,
            outputTokens: 25,
            totalTokens: 125,
            costUsd: 0,
            cachedTokens: 80,
            cacheWriteTokens: 40,
          },
        });
        expect(result.value.usage).not.toHaveProperty('providerReportedUsd');
      }
    });

    it('returns zero usage when OpenRouter omits usage in chat response', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Chat response without usage', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChat(
        [{ role: 'user', content: 'What happened in this chat?' }],
        { promptType: 'test-chat-prompt' }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          content: 'Chat response without usage',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          },
        });
      }
      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'generate',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          },
          success: true,
        })
      );
    });

    it('rejects a chat response with empty choices', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [],
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChat(
        [{ role: 'user', content: 'What happened in this chat?' }],
        { promptType: 'test-chat-prompt' }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('rejects null assistant content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: null, role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChat(
        [{ role: 'user', content: 'What happened in this chat?' }],
        { promptType: 'test-chat-prompt' }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('generate cache usage compatibility', () => {
    it('keeps legacy generate usage cacheTokens shape when OpenRouter reports cached tokens', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated response', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 70,
            completion_tokens: 15,
            total_tokens: 85,
            prompt_tokens_details: { cached_tokens: 55, cache_write_tokens: 20 },
          },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('Summarize this', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toEqual({
          inputTokens: 70,
          outputTokens: 15,
          totalTokens: 85,
          costUsd: 0,
          cacheTokens: 55,
        });
        expect(result.value.usage).not.toHaveProperty('cachedTokens');
        expect(result.value.usage).not.toHaveProperty('cacheWriteTokens');
      }
    });
  });

  describe('OpenRouter usage.cost passthrough', () => {
    it('uses usage.cost from API response and forwards it to the sink as providerReportedUsd', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.0042 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('hello', { promptType: 'test-prompt' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.0042);
        expect(result.value.usage.providerReportedUsd).toBe(0.0042);
      }

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({ providerReportedUsd: 0.0042 })
      );
    });

    it('omits providerReportedUsd when usage.cost absent and falls back to token-based costUsd', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('hello', { promptType: 'test-prompt' });

      const callArg = mockUsageLoggerLog.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg['providerReportedUsd']).toBeUndefined();
      expect((callArg['usage'] as { costUsd: number }).costUsd).toBe(0);
    });

    it('preserves an explicitly reported zero provider cost', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generate('hello', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
        expect(result.value.usage.providerReportedUsd).toBe(0);
      }
      const callArg = mockUsageLoggerLog.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg['providerReportedUsd']).toBe(0);
    });

    it('forwards providerReportedUsd on the research callType too', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.011 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.research('hello');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({ callType: 'research', providerReportedUsd: 0.011 })
      );
    });
  });

  describe('usageSink', () => {
    it('passes custom usageSink to createUsageLogger', async () => {
      const { createUsageLogger } = await import('@intexuraos/llm-pricing');

      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

      const fakeSink = new FakeUsageSink();
      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: fakeSink,
      });

      await client.generate('ping', { promptType: 'test-prompt' });

      expect(createUsageLogger).toHaveBeenCalledWith(expect.objectContaining({ sink: fakeSink }));
    });
  });

  describe('validateKey', () => {
    it('returns key info on success', async () => {
      nock(API_BASE_URL).get('/key').reply(200, {
        token: 'sk-1234',
        usage: 1000,
        limit: 10000,
        expiresAt: '2026-12-31T23:59:59Z',
      });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.token).toBe('sk-1234');
        expect(result.value.usage).toBe(1000);
      }
    });

    it('handles 401 invalid key error', async () => {
      nock(API_BASE_URL).get('/key').reply(401, 'Invalid API key');

      const client = createOpenRouterClient({
        apiKey: 'bad-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.validateKey('bad-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).get('/key').reply(429, 'Rate limited');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles 500 overloaded error', async () => {
      nock(API_BASE_URL).get('/key').reply(500, 'Internal server error');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('handles network error', async () => {
      nock(API_BASE_URL).get('/key').replyWithError({ message: 'Network failure' });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  it('passes ownerType to usage logger when provided', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'test-id',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { content: 'ok', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

    const client = createOpenRouterClient({
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

  describe('promptType propagation', () => {
    it('passes promptType to usage logger on success', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('hello', { promptType: 'linear-issue-title' });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({ promptType: 'linear-issue-title' })
      );
    });

    it('passes promptType to usage logger on error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Internal error');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('hello', { promptType: 'code-worker-validation' });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          promptType: 'code-worker-validation',
          success: false,
        })
      );
    });

    it('passes promptType to usage logger', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('hello', { promptType: 'test-prompt' });

      const callArg = mockUsageLoggerLog.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg['promptType']).toBe('test-prompt');
    });

    it('forwards per-call correlation to usage logger when provided', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('hello', {
        promptType: 'test-prompt',
        correlation: { researchId: 'r-1', taskId: 't-2' },
      });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          correlation: { researchId: 'r-1', taskId: 't-2' },
        })
      );
    });

    it('omits correlation from usage logger when not provided', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'ok', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await client.generate('hello', { promptType: 'test-prompt' });

      const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(lastCall).not.toHaveProperty('correlation');
    });
  });
});
