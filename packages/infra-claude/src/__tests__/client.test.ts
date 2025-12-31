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
const { createClaudeClient, CLAUDE_DEFAULTS } = await import('../index.js');

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
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toContain('Research findings about AI');
        expect(result.value.sources).toContain('https://example.com');
      }
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: CLAUDE_DEFAULTS.researchModel,
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
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
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
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
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
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('returns error on API failure', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Server error'));

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns INVALID_KEY error on 401', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createClaudeClient({ apiKey: 'bad-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns OVERLOADED error on 529', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(529, 'Overloaded'));

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('returns TIMEOUT error on timeout message', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Request timeout'));

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles non-APIError exceptions', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Network failure'));

      const client = createClaudeClient({ apiKey: 'test-key' });
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

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated response');
      }
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: CLAUDE_DEFAULTS.defaultModel,
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

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('First part\n\nSecond part');
      }
    });

    it('returns error on failure', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Network error'));

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('synthesize', () => {
    it('returns synthesized content', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Synthesized research report.' }],
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Original prompt', [
        { model: 'GPT-4', content: 'GPT findings' },
        { model: 'Gemini', content: 'Gemini findings' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Synthesized research report.');
      }
    });

    it('includes external reports in synthesis', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Combined synthesis.' }],
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.synthesize(
        'Original prompt',
        [{ model: 'GPT-4', content: 'GPT findings' }],
        [{ content: 'External findings', model: 'Custom Model' }]
      );

      expect(result.ok).toBe(true);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('External LLM Reports'),
            }),
          ]),
        })
      );
    });

    it('handles external reports without model name', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Synthesis result.' }],
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.synthesize(
        'Original prompt',
        [{ model: 'GPT-4', content: 'GPT findings' }],
        [{ content: 'Anonymous external report' }]
      );

      expect(result.ok).toBe(true);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('unknown source'),
            }),
          ]),
        })
      );
    });

    it('includes conflict resolution guidelines with external reports', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Result' }],
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      await client.synthesize(
        'Prompt',
        [{ model: 'GPT', content: 'Content' }],
        [{ content: 'External' }]
      );

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('Conflict Resolution Guidelines'),
            }),
          ]),
        })
      );
    });

    it('returns error on API failure', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(500, 'Server error'));

      const client = createClaudeClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Prompt', [{ model: 'Test', content: 'Content' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('validateKey', () => {
    it('returns true when key is valid', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: "Hi! I'm Claude." }],
      });

      const client = createClaudeClient({ apiKey: 'valid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: CLAUDE_DEFAULTS.validationModel,
        })
      );
    });

    it('returns error when key is invalid', async () => {
      mockMessagesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid key'));

      const client = createClaudeClient({ apiKey: 'invalid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });
  });

  describe('custom models', () => {
    it('uses custom researchModel when provided', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        researchModel: 'claude-custom-research',
      });
      await client.research('Test prompt');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-custom-research',
        })
      );
    });

    it('uses custom defaultModel when provided', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        defaultModel: 'claude-custom-default',
      });
      await client.generate('Test prompt');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-custom-default',
        })
      );
    });

    it('uses custom validationModel when provided', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      const client = createClaudeClient({
        apiKey: 'test-key',
        validationModel: 'claude-custom-validation',
      });
      await client.validateKey();

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-custom-validation',
        })
      );
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
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
      (createAuditContext as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createClaudeClient({ apiKey: 'test-key' });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
