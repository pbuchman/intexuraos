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

const { createAuditContext } = await import('@intexuraos/llm-audit');
const { createGptClient, GPT_DEFAULTS } = await import('../index.js');

describe('createGptClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Research findings about AI.',
        output: [],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research findings about AI.');
      }
      expect(mockResponsesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GPT_DEFAULTS.researchModel,
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

      const client = createGptClient({ apiKey: 'test-key' });
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

      const client = createGptClient({ apiKey: 'test-key' });
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

      const client = createGptClient({ apiKey: 'test-key' });
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

      const client = createGptClient({ apiKey: 'test-key' });
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

      const client = createGptClient({ apiKey: 'test-key' });
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

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://valid.com']);
      }
    });

    it('returns API_ERROR on general failure', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(500, 'Server error'));

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns INVALID_KEY error on 401', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createGptClient({ apiKey: 'bad-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createGptClient({ apiKey: 'test-key' });
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

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTEXT_LENGTH');
      }
    });

    it('returns TIMEOUT error on timeout', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(500, 'Request timeout'));

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles non-APIError exceptions', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Network failure'));

      const client = createGptClient({ apiKey: 'test-key' });
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
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated response');
      }
      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GPT_DEFAULTS.defaultModel,
        })
      );
    });

    it('handles empty choices', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });

    it('handles null content', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });

    it('returns error on failure', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new Error('Network error'));

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('synthesize', () => {
    it('returns synthesized content', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Synthesized research report.' } }],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Original prompt', [
        { model: 'Claude', content: 'Claude findings' },
        { model: 'Gemini', content: 'Gemini findings' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Synthesized research report.');
      }
    });

    it('includes external reports in synthesis', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Combined synthesis.' } }],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.synthesize(
        'Original prompt',
        [{ model: 'Claude', content: 'Claude findings' }],
        [{ content: 'External findings', model: 'Custom Model' }]
      );

      expect(result.ok).toBe(true);
      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
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
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Synthesis result.' } }],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.synthesize(
        'Original prompt',
        [{ model: 'Claude', content: 'Claude findings' }],
        [{ content: 'Anonymous external report' }]
      );

      expect(result.ok).toBe(true);
      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
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
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Result' } }],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      await client.synthesize(
        'Prompt',
        [{ model: 'Claude', content: 'Content' }],
        [{ content: 'External' }]
      );

      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
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
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(500, 'Server error'));

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Prompt', [{ model: 'Test', content: 'Content' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles null content in response', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Prompt', [{ model: 'Test', content: 'Content' }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });

    it('handles empty choices array', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [],
      });

      const client = createGptClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Prompt', [{ model: 'Test', content: 'Content' }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });
  });

  describe('validateKey', () => {
    it('returns true when key is valid', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: "Hi! I'm GPT." } }],
      });

      const client = createGptClient({ apiKey: 'valid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GPT_DEFAULTS.validationModel,
        })
      );
    });

    it('returns true even with null content', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const client = createGptClient({ apiKey: 'valid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns true even with empty choices', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [],
      });

      const client = createGptClient({ apiKey: 'valid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns error when key is invalid', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(401, 'Invalid key'));

      const client = createGptClient({ apiKey: 'invalid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });
  });

  describe('custom models', () => {
    it('uses custom researchModel when provided', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        researchModel: 'gpt-custom-research',
      });
      await client.research('Test prompt');

      expect(mockResponsesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-custom-research',
        })
      );
    });

    it('uses custom defaultModel when provided', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        defaultModel: 'gpt-custom-default',
      });
      await client.generate('Test prompt');

      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-custom-default',
        })
      );
    });

    it('uses custom validationModel when provided', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        validationModel: 'gpt-custom-validation',
      });
      await client.validateKey();

      expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-custom-validation',
        })
      );
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Response',
        output: [],
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGptClient({ apiKey: 'test-key' });
      await client.research('Test prompt');

      expect(createAuditContext).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          method: 'research',
        })
      );
      expect(mockSuccess).toHaveBeenCalled();
    });

    it('calls audit context on error', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('API error'));

      const mockError = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createGptClient({ apiKey: 'test-key' });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
