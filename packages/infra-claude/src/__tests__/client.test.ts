import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

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

  return {
    default: MockAnthropic,
  };
});

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

const { createAuditContext } = await import('@intexuraos/llm-audit');
const { createClaudeClient } = await import('../index.js');

const TEST_MODEL = 'claude-opus-4-5-20251101';

describe('createClaudeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and sources', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Research findings about AI.' },
          { type: 'text', text: 'See https://example.com for more.' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toContain('Research findings about AI');
        expect(result.value.sources).toContain('https://example.com');
        expect(result.value.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      }
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
          tools: expect.arrayContaining([expect.objectContaining({ type: 'web_search_20250305' })]),
        })
      );
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

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://source1.com');
        expect(result.value.sources).toContain('https://source2.com');
      }
    });

    it('handles web_search_tool_result with non-array content', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Research content with https://text-source.com link' },
          {
            type: 'web_search_tool_result',
            content: 'encrypted_content_string',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://text-source.com');
        expect(result.value.sources).not.toContain('encrypted_content_string');
      }
    });

    it('deduplicates sources', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'See https://example.com and https://example.com again.' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('returns error on API failure', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Server error'));

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns INVALID_KEY error on 401', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createClaudeClient({ apiKey: 'bad-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns OVERLOADED error on 529', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(529, 'Overloaded'));

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('returns TIMEOUT error on timeout message', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Request timeout'));

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles non-APIError exceptions', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Network failure'));

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
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
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Generated response' }],
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated response');
      }
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
        })
      );
    });

    it('joins multiple text blocks', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('First part\n\nSecond part');
      }
    });

    it('returns error on failure', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Network error'));

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      await client.research('Test prompt');

      expect(createAuditContext).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          method: 'research',
        })
      );
      expect(mockSuccess).toHaveBeenCalled();
    });

    it('calls audit context on error', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('API error'));

      const mockError = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createClaudeClient({ apiKey: 'test-key', model: TEST_MODEL });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
