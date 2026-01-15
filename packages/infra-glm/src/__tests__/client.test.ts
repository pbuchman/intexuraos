import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModelPricing, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockChatCompletionsCreate = vi.fn();

class MockAPIError extends Error {
  status: number;
  code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'APIError';
  }
}

vi.mock('openai', () => {
  class MockOpenAI {
    constructor(config: unknown) {
      // Store config for testing
      (this as unknown as { _config: unknown })._config = config;
    }
    chat = { completions: { create: mockChatCompletionsCreate } };
    static APIError = MockAPIError;
  }
  return { default: MockOpenAI };
});

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

const { createGlmClient } = await import('../client.js');
const { logUsage } = await import('@intexuraos/llm-pricing');

const TEST_MODEL = 'glm-4.7';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 0.6,
  outputPricePerMillion: 2.2,
  webSearchCostPerCall: 0.005,
  ...overrides,
});

describe('createGlmClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and usage from pricing', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'GLM research findings about AI.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const pricing = createTestPricing();
      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('GLM research findings about AI.');
        expect(result.value.usage).toMatchObject({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
        // Cost calculated from pricing: (100/1M * 0.6) + (50/1M * 2.2)
        expect(result.value.usage.costUsd).toBeCloseTo(0.00017, 6);
      }
    });

    it('sends correct request format with web_search tool', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content', tool_calls: undefined } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Search query');

      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
          tools: [{ type: 'web_search', web_search: { search_query: 'Search query' } }],
        })
      );
    });

    it('extracts sources from web_search tool_calls', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Research content',
              tool_calls: [
                {
                  type: 'web_search',
                  web_search: {
                    search_result: [
                      { link: 'https://source1.com' },
                      { link: 'https://source2.com' },
                    ],
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
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

    it('deduplicates sources', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Content',
              tool_calls: [
                {
                  type: 'web_search',
                  web_search: {
                    search_result: [
                      { link: 'https://example.com' },
                      { link: 'https://example.com' },
                    ],
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('counts web search calls and adds cost', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Content',
              tool_calls: [
                { type: 'web_search', web_search: {} },
                { type: 'web_search', web_search: {} },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const pricing = createTestPricing({ webSearchCostPerCall: 0.005 });
      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.webSearchCalls).toBe(2);
        // Cost: tokens + 2 web search calls = 0.00017 + 0.01 = 0.01017
        expect(result.value.usage.costUsd).toBeCloseTo(0.01017, 5);
      }
    });

    it('handles missing search_result gracefully', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Content',
              tool_calls: [{ type: 'web_search' }],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
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

    it('handles missing message content gracefully', async () => {
      // This tests the ?? '' branch on line 145
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              // content is undefined
              tool_calls: undefined,
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
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

    it('handles cached tokens with multiplier', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 50 },
        },
      });

      const pricing = createTestPricing({ cacheReadMultiplier: 0.5 });
      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(50);
        // Effective input: (100 - 50) + 50*0.5 = 75 effective tokens
        // Cost: (75/1M * 0.6) + (50/1M * 2.2) = 0.000045 + 0.00011 = 0.000155
        expect(result.value.usage.costUsd).toBeCloseTo(0.000155, 5);
      }
    });

    it('logs usage on success', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: LlmProviders.Zai,
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles missing usage gracefully', async () => {
      // This tests the ?? 0 fallback branches in extractUsageDetails (lines 263-264)
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        // usage is undefined
      } as unknown);

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(0);
        expect(result.value.usage.outputTokens).toBe(0);
        expect(result.value.usage.totalTokens).toBe(0);
      }
    });

    it('handles API error and returns error result', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createGlmClient({
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

    it('handles rate limiting error', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createGlmClient({
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

    it('handles 5xx errors as OVERLOADED', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(503, 'Service unavailable'));

      const client = createGlmClient({
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

    it('handles context length exceeded error', async () => {
      mockChatCompletionsCreate.mockRejectedValue(
        new MockAPIError(400, 'Context too long', 'context_length_exceeded')
      );

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTEXT_LENGTH');
      }
    });

    it('handles content filtered error', async () => {
      mockChatCompletionsCreate.mockRejectedValue(
        new MockAPIError(400, 'Content filtered', 'content_filter')
      );

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('handles generic API error as API_ERROR', async () => {
      // This tests the fallback branch when an APIError doesn't match specific conditions
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(400, 'Bad request'));

      const client = createGlmClient({
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
        expect(result.error.message).toBe('Bad request');
      }
    });

    it('logs usage on error', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new Error('Network error'));

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.any(String),
        })
      );
    });
  });

  describe('generate', () => {
    it('returns generate result with content and usage from pricing', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'GLM generated text.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      });

      const pricing = createTestPricing();
      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('GLM generated text.');
        expect(result.value.usage).toMatchObject({
          inputTokens: 50,
          outputTokens: 100,
          totalTokens: 150,
        });
        // Cost: (50/1M * 0.6) + (100/1M * 2.2) = 0.00003 + 0.00022 = 0.00025
        expect(result.value.usage.costUsd).toBeCloseTo(0.00025, 6);
      }
    });

    it('logs usage with generate callType', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Generated text.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 50, completion_tokens: 0 },
      });

      const client = createGlmClient({
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
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(500, 'Internal error'));

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });
  });

  describe('edge cases', () => {
    it('handles undefined usage', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: undefined,
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(0);
        expect(result.value.usage.outputTokens).toBe(0);
      }
    });

    it('handles usage with missing prompt_tokens_details', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBeUndefined();
      }
    });

    it('handles usage with undefined prompt_tokens and completion_tokens', async () => {
      // Tests the ?? 0 fallback branches in extractUsageDetails (lines 256-257)
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: {} as unknown, // usage exists but prompt_tokens and completion_tokens are undefined
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(0);
        expect(result.value.usage.outputTokens).toBe(0);
        expect(result.value.usage.totalTokens).toBe(0);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('handles usage with undefined prompt_tokens only', async () => {
      // Tests the ?? 0 fallback branch for prompt_tokens (line 256)
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: { completion_tokens: 50 } as unknown, // prompt_tokens is undefined
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(0);
        expect(result.value.usage.outputTokens).toBe(50);
        expect(result.value.usage.totalTokens).toBe(50);
      }
    });

    it('handles usage with undefined completion_tokens only', async () => {
      // Tests the ?? 0 fallback branch for completion_tokens (line 257)
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: { prompt_tokens: 100 } as unknown, // completion_tokens is undefined
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(100);
        expect(result.value.usage.outputTokens).toBe(0);
        expect(result.value.usage.totalTokens).toBe(100);
      }
    });
  });

  describe('timeout error handling', () => {
    it('handles timeout error via message check', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(408, 'Request timeout'));

      const client = createGlmClient({
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

    it('handles non-APIError without timeout detection', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new Error('Network error'));

      const client = createGlmClient({
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
  });

  describe('source extraction edge cases', () => {
    it('handles tool_calls with missing link', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Content',
              tool_calls: [
                {
                  type: 'web_search',
                  web_search: {
                    search_result: [{ link: 'https://valid.com' }, { title: 'No link' }, {}],
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://valid.com']);
      }
    });

    it('handles tool_calls with non-array search_result', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Content',
              tool_calls: [
                {
                  type: 'web_search',
                  web_search: { search_result: 'not-an-array' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('ignores non-web_search tool_calls', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Content',
              tool_calls: [
                { type: 'function', name: 'test' },
                {
                  type: 'web_search',
                  web_search: { search_result: [{ link: 'https://example.com' }] },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://example.com']);
      }
    });

    it('handles missing tool_calls', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Content' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGlmClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });
  });
});
