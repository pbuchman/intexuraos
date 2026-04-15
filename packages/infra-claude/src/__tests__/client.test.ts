import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink: UsageSink = { log: vi.fn().mockResolvedValue(undefined) };

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

const mockUsageLoggerLog = vi.fn().mockResolvedValue(undefined);

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
  createUsageLogger: vi.fn().mockReturnValue({
    log: mockUsageLoggerLog,
  }),
}));

const { createClaudeClient } = await import('../client.js');

const TEST_MODEL = 'claude-sonnet-4-20250514';

describe('createClaudeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      const result = await client.generate('Generate something');

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
      const result = await client.generate('Test prompt');

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
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
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
    await client.generate('hello');

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user' }));
  });
});
