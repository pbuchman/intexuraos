import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LlmProviders } from '@intexuraos/llm-contract';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink = new FakeUsageSink();

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(tracerProvider);
});

afterAll(async () => {
  await tracerProvider.shutdown();
  trace.disable();
});

const mockMessagesCreate = vi.fn();

class MockAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'APIError';
  }
}

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockMessagesCreate };
    static APIError = MockAPIError;
  }
  return { default: MockAnthropic };
});

// Hoisted so the vi.mock factory below can reference it (vi.mock is hoisted
// to the top of the file; plain `const` bindings are not).
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

const { createClaudeClient } = await import('../client.js');

const TEST_MODEL = 'claude-sonnet-4-20250514';

describe('createClaudeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    mockUsageSink.clear();
  });

  describe('research', () => {
    it('returns research result with content and usage', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Research findings about AI.' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({
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

    it('counts web search calls', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'web_search', id: 'call1' },
          { type: 'tool_use', name: 'web_search', id: 'call2' },
          { type: 'text', text: 'Result' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.webSearchCalls).toBe(2);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('handles cache read tokens', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Content' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
        },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Contract Compliance: expect aggregated 'cacheTokens'
        expect(result.value.usage.cacheTokens).toBe(30);
      }
    });

    it('handles cache creation tokens', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Content' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
        },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Contract Compliance: expect aggregated 'cacheTokens'
        expect(result.value.usage.cacheTokens).toBe(20);
      }
    });

    it('extracts sources from web_search_tool_result blocks', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'web_search_tool_result',
            content: [{ url: 'https://example.com/page1' }, { url: 'https://example.com/page2' }],
          },
          { type: 'text', text: 'Result with source https://example.com/page3' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://example.com/page1');
        expect(result.value.sources).toContain('https://example.com/page2');
        expect(result.value.sources).toContain('https://example.com/page3');
      }
    });

    it('handles web_search_tool_result with non-array content', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'web_search_tool_result',
            content: 'string content instead of array',
          },
          { type: 'text', text: 'Result text' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({
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

    it('returns error on API failure', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid key'));

      const client = createClaudeClient({
        apiKey: 'bad-key',
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

    it('handles rate limit error', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createClaudeClient({
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

    it('handles overloaded error', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(529, 'Overloaded'));

      const client = createClaudeClient({
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

    it('handles timeout error', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Request timeout'));

      const client = createClaudeClient({
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

    it('handles generic API error', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Internal error'));

      const client = createClaudeClient({
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

    it('handles non-APIError exceptions', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Network failure'));

      const client = createClaudeClient({
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
        expect(result.error.message).toBe('Network failure');
      }
    });

    it('forwards per-call correlation to usage logger when provided', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const client = createClaudeClient({
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
          correlation: { researchId: 'r-1' },
        })
      );
    });
  });

  describe('generate', () => {
    it('returns generated content with usage', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Generated text output.' }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Generate something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated text output.');
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('handles cache tokens in generate', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Cached response' }],
        usage: {
          input_tokens: 200,
          output_tokens: 100,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
        },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test prompt', { promptType: 'test-prompt' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(75); // 50 + 25
      }
    });

    it('returns error on API failure in generate', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid key'));

      const client = createClaudeClient({
        apiKey: 'bad-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test prompt', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('retries transient RATE_LIMITED then returns success', async () => {
      vi.useFakeTimers();
      try {
        mockMessagesCreate
          .mockRejectedValueOnce(new MockAPIError(429, 'Rate limited'))
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: 'recovered' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          });

        const client = createClaudeClient({
          apiKey: 'test-key',
          model: TEST_MODEL,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        });

        const promise = client.generate('hi', { promptType: 'test-prompt' });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('recovered');
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('passes ownerType to usage logger when provided', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const client = createClaudeClient({
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
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const client = createClaudeClient({
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

  it('forwards per-call correlation to usage logger when provided', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const client = createClaudeClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
    });
    await client.generate('hello', {
      promptType: 'test-prompt',
      correlation: { researchId: 'r-1', sessionId: 's-2', taskId: 't-3', requestId: 'req-4' },
    });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        correlation: { researchId: 'r-1', sessionId: 's-2', taskId: 't-3', requestId: 'req-4' },
      })
    );
  });

  it('omits correlation from usage logger when not provided', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const client = createClaudeClient({
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

  describe('OTel span emission for generate()', () => {
    it('emits llm.anthropic.generate span with all canonical attributes on success', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 12, output_tokens: 7 },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('hi', { promptType: 'test-prompt' });

      const spans = spanExporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      const span = spans[0];
      if (span === undefined) throw new Error('no span');
      expect(span.name).toBe('llm.anthropic.generate');
      expect(span.attributes['llm.provider']).toBe(LlmProviders.Anthropic);
      expect(span.attributes['llm.model']).toBe(TEST_MODEL);
      expect(span.attributes['llm.input_tokens']).toBe(12);
      expect(span.attributes['llm.output_tokens']).toBe(7);
      expect(span.attributes['llm.cost_usd']).toBeDefined();
      expect(span.attributes['llm.duration_ms']).toBeGreaterThanOrEqual(0);
    });

    it('passes durationMs >= 0 to usage logger on success', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('ok', { promptType: 'test-prompt' });

      const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as { durationMs?: number };
      expect(lastCall?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('passes durationMs >= 0 to usage logger on error', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('boom'));

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('ok', { promptType: 'test-prompt' });

      const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as {
        durationMs?: number;
        success?: boolean;
      };
      expect(lastCall?.success).toBe(false);
      expect(lastCall?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records llm.cached_input_tokens span attribute when cache_read_input_tokens > 0', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 12,
          output_tokens: 7,
          cache_read_input_tokens: 30,
        },
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('ok', { promptType: 'test-prompt' });

      const spans = spanExporter.getFinishedSpans();
      const span = spans[0];
      if (span === undefined) throw new Error('no span');
      expect(span.attributes['llm.cached_input_tokens']).toBe(30);
    });
  });
});
