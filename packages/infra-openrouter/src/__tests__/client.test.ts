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

    it('handles 500 API error', async () => {
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
        expect(result.error.code).toBe('API_ERROR');
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

  describe('generate', () => {
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

    it('handles API error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Internal error');

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
      });

      await client.generate('Return JSON', {
        responseFormat: { type: 'json_object' },
        promptType: 'test-prompt',
      });

      expect(capturedBody).toHaveProperty('response_format', { type: 'json_object' });
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
    });

    it('handles empty choices array in generate', async () => {
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

      // Should return empty content when choices is empty
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });
  });

  describe('generateChat', () => {
    it('posts chat messages with top-level session_id and preserves cache_control content blocks', async () => {
      let capturedBody: Record<string, unknown> | undefined;
      const messages = [
        {
          role: 'system' as const,
          content: [
            {
              type: 'text' as const,
              text: 'Answer only from the supplied transcript.',
            },
          ],
        },
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: 'Transcript follows:',
            },
            {
              type: 'text' as const,
              text: '2026-06-30 10:00 You: hello',
              cache_control: { type: 'ephemeral' as const },
            },
          ],
        },
        {
          role: 'user' as const,
          content: 'What happened?',
        },
      ];

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
              message: { content: 'They greeted each other.', role: 'assistant' },
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

      const result = await client.generateChat(messages, {
        promptType: 'whatsapp-conversation-assistant',
        sessionId: 'whatsapp_conv_session_123',
      });

      expect(result.ok).toBe(true);
      expect(capturedBody).toMatchObject({
        model: TEST_MODEL,
        messages,
        temperature: 0.2,
        session_id: 'whatsapp_conv_session_123',
      });
    });

    it('maps OpenRouter cache usage details into the generate result usage', async () => {
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
              message: { content: 'Cached answer.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 30,
            total_tokens: 130,
            cost: 0.004,
            prompt_tokens_details: {
              cached_tokens: 80,
              cache_write_tokens: 20,
            },
          },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const result = await client.generateChat([{ role: 'user', content: 'Hello' }], {
        promptType: 'whatsapp-conversation-assistant',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toMatchObject({
          inputTokens: 100,
          outputTokens: 30,
          totalTokens: 130,
          costUsd: 0.004,
          cachedTokens: 80,
          cacheWriteTokens: 20,
        });
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

    it('handles 500 API error', async () => {
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
        expect(result.error.code).toBe('API_ERROR');
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
