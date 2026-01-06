import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPricing } from '@intexuraos/llm-contract';

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

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

const { createClaudeClientV2 } = await import('../clientV2.js');
const { logUsage } = await import('@intexuraos/llm-pricing');

const TEST_MODEL = 'claude-sonnet-4-20250514';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1.25,
  webSearchCostPerCall: 0.01,
  ...overrides,
});

describe('createClaudeClientV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and usage from pricing', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Research findings about AI.' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const pricing = createTestPricing();
      const client = createClaudeClientV2({
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
        // Cost: (100/1M * 3.0) + (50/1M * 15.0) = 0.0003 + 0.00075 = 0.00105
        expect(result.value.usage.costUsd).toBeCloseTo(0.00105, 6);
      }
    });

    it('extracts sources from web_search_tool_result blocks', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Research content' },
          {
            type: 'web_search_tool_result',
            content: [{ url: 'https://source1.com' }, { url: 'https://source2.com' }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClientV2({
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

    it('extracts URLs from text content', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Check out https://example.com and https://test.org for more info.',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://example.com');
        expect(result.value.sources).toContain('https://test.org');
      }
    });

    it('counts web search calls and adds cost', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'web_search', id: 'call1' },
          { type: 'tool_use', name: 'web_search', id: 'call2' },
          { type: 'text', text: 'Result' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const pricing = createTestPricing({ webSearchCostPerCall: 0.01 });
      const client = createClaudeClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.webSearchCalls).toBe(2);
        // Cost: tokens + 2 web search calls = 0.00105 + 0.02 = 0.02105
        expect(result.value.usage.costUsd).toBeCloseTo(0.02105, 5);
      }
    });

    it('handles cache read tokens with multiplier', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Content' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
        },
      });

      const pricing = createTestPricing({ cacheReadMultiplier: 0.1 });
      const client = createClaudeClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(30);
        // Regular input: 100-30 = 70 tokens
        // Cache read: 30 * 0.1 = 3 effective tokens for pricing
        // Cost: ((70+3)/1M * 3.0) + (50/1M * 15.0) = 0.000219 + 0.00075 = 0.000969
      }
    });

    it('handles cache creation tokens with multiplier', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Content' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
        },
      });

      const pricing = createTestPricing({ cacheWriteMultiplier: 1.25 });
      const client = createClaudeClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(20);
        // Regular input: 100-20 = 80 tokens at regular price
        // Cache creation: 20 tokens at 1.25x price
        // Cost: (80/1M * 3.0) + (20/1M * 3.0 * 1.25) + (50/1M * 15.0)
        //     = 0.00024 + 0.000075 + 0.00075 = 0.001065
        expect(result.value.usage.costUsd).toBeCloseTo(0.001065, 6);
      }
    });

    it('logs usage on success', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Content' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      await client.research('Test prompt');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: 'anthropic',
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles API error with INVALID_KEY code', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createClaudeClientV2({
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

    it('handles rate limiting error', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createClaudeClientV2({
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

    it('handles overloaded error (529)', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(529, 'Overloaded'));

      const client = createClaudeClientV2({
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
      mockMessagesCreate.mockRejectedValue(new Error('Network error'));

      const client = createClaudeClientV2({
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
  });

  describe('generate', () => {
    it('returns generate result with content and usage from pricing', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Generated text.' }],
        usage: { input_tokens: 50, output_tokens: 100 },
      });

      const pricing = createTestPricing();
      const client = createClaudeClientV2({
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

    it('joins multiple text blocks', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'First paragraph.' },
          { type: 'text', text: 'Second paragraph.' },
        ],
        usage: { input_tokens: 50, output_tokens: 100 },
      });

      const client = createClaudeClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First paragraph.\n\nSecond paragraph.');
      }
    });

    it('logs usage with generate callType', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Generated text.' }],
        usage: { input_tokens: 50, output_tokens: 100 },
      });

      const client = createClaudeClientV2({
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

    it('handles empty content blocks', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [],
        usage: { input_tokens: 50, output_tokens: 0 },
      });

      const client = createClaudeClientV2({
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
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Internal error'));

      const client = createClaudeClientV2({
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
});
