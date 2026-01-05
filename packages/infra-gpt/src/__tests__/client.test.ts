import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mockResponsesCreate = vi.fn();
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
    responses = { create: mockResponsesCreate };
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

const { createAuditContext } = await import('@intexuraos/llm-audit');
const { createGptClient } = await import('../index.js');

const TEST_MODEL = 'o4-mini-deep-research';

describe('createGptClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and usage', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Research findings about AI.',
        output: [],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
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
      expect(mockResponsesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
          tools: expect.arrayContaining([expect.objectContaining({ type: 'web_search_preview' })]),
        })
      );
    });

    it('extracts sources from web_search_call results', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Research content',
        output: [
          {
            type: 'web_search_call',
            results: [{ url: 'https://source1.com' }, { url: 'https://source2.com' }],
          },
        ],
      });

      const client = createGptClient({
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

    it('deduplicates sources', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [
          {
            type: 'web_search_call',
            results: [{ url: 'https://example.com' }, { url: 'https://example.com' }],
          },
        ],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('returns empty sources when no web_search_call results', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [],
      });

      const client = createGptClient({
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

    it('handles web_search_call without results property', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [{ type: 'web_search_call' }],
      });

      const client = createGptClient({
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

    it('handles undefined results in web_search_call', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [{ type: 'web_search_call', results: undefined }],
      });

      const client = createGptClient({
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

    it('skips results without url property', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [
          {
            type: 'web_search_call',
            results: [{ url: 'https://valid.com' }, { title: 'No URL' }, {}],
          },
        ],
      });

      const client = createGptClient({
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

    it('returns API_ERROR on general failure', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(500, 'Server error'));

      const client = createGptClient({
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

    it('returns INVALID_KEY error on 401', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createGptClient({ apiKey: 'bad-key', model: TEST_MODEL, userId: 'test-user' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createGptClient({
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

    it('returns CONTEXT_LENGTH error on context exceeded', async () => {
      mockResponsesCreate.mockRejectedValue(
        new MockAPIError(400, 'Context length exceeded', 'context_length_exceeded')
      );

      const client = createGptClient({
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

    it('returns TIMEOUT error on timeout', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(500, 'Request timeout'));

      const client = createGptClient({
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

    it('handles non-APIError exceptions', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Network failure'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Network failure');
      }
    });
  });

  describe('generate', () => {
    it('returns generated content', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Generated response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated response');
      }
      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
        })
      );
    });

    it('handles empty choices', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 0 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles null content', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 0 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns error on failure', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new Error('Network error'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success with usage', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
        usage: { input_tokens: 150, output_tokens: 75 },
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      await client.research('Test prompt');

      expect(createAuditContext).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
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

    it('includes cached tokens when present', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          input_tokens_details: { cached_tokens: 100 },
        },
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(100);
      }
    });

    it('handles usage without input_tokens_details', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBeUndefined();
      }
    });

    it('handles input_tokens_details without cached_tokens', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          input_tokens_details: {},
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBeUndefined();
      }
    });

    it('uses default pricing for unknown model', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: 'unknown-model',
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(1000);
        expect(result.value.usage.costUsd).toBeGreaterThan(0);
      }
    });

    it('includes reasoning tokens when present', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          output_tokens_details: { reasoning_tokens: 500 },
        },
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage?.reasoningTokens).toBe(500);
      }
      expect(mockSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 150,
          outputTokens: 75,
        })
      );
    });

    it('includes web search calls count when present', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [
          { type: 'web_search_call', results: [] },
          { type: 'web_search_call', results: [] },
          { type: 'message', content: 'text' },
        ],
        usage: { input_tokens: 150, output_tokens: 75 },
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage?.webSearchCalls).toBe(2);
      }
      expect(mockSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          webSearchCalls: 2,
        })
      );
    });

    it('calls audit context on error', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('API error'));

      const mockError = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
      });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
