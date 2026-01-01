import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
}));

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

const { createAuditContext } = await import('@intexuraos/llm-audit');
const { createGeminiClient, GEMINI_DEFAULTS } = await import('../index.js');

describe('createGeminiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research findings about AI.',
        candidates: [],
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research findings about AI.');
      }
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GEMINI_DEFAULTS.researchModel,
          config: expect.objectContaining({
            tools: [{ googleSearch: {} }],
          }),
        })
      );
    });

    it('extracts sources from grounding metadata', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research content',
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://source1.com' } },
                { web: { uri: 'https://source2.com' } },
              ],
            },
          },
        ],
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://source1.com');
        expect(result.value.sources).toContain('https://source2.com');
      }
    });

    it('returns empty sources when no grounding metadata', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        candidates: [],
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('returns empty sources when groundingChunks is not an array', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: 'not-an-array',
            },
          },
        ],
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('skips chunks without web uri', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://valid.com' } },
                { web: {} },
                { other: 'data' },
              ],
            },
          },
        ],
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://valid.com']);
      }
    });

    it('handles null text response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
        candidates: [],
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns API_ERROR on general failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Server error'));

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns INVALID_KEY error when message contains API_KEY', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Invalid API_KEY provided'));

      const client = createGeminiClient({ apiKey: 'bad-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      mockGenerateContent.mockRejectedValue(new Error('429 Too Many Requests'));

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns RATE_LIMITED error on quota exceeded', async () => {
      mockGenerateContent.mockRejectedValue(new Error('quota exceeded'));

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns TIMEOUT error on timeout', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });
  });

  describe('generate', () => {
    it('returns generated content', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated response',
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated response');
      }
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GEMINI_DEFAULTS.defaultModel,
        })
      );
    });

    it('handles null text response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });

    it('returns error on failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Error'));

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
    });
  });

  describe('synthesize', () => {
    it('returns synthesized content', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Synthesized research report.',
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Original prompt', [
        { model: 'GPT-4', content: 'GPT findings' },
        { model: 'Claude', content: 'Claude findings' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Synthesized research report.');
      }
    });

    it('includes external reports in synthesis', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Combined synthesis.',
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.synthesize(
        'Original prompt',
        [{ model: 'GPT-4', content: 'GPT findings' }],
        [{ content: 'External findings', model: 'Custom Model' }]
      );

      expect(result.ok).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.stringContaining('External LLM Reports'),
        })
      );
    });

    it('handles external reports without model name', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Synthesis result.',
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.synthesize(
        'Original prompt',
        [{ model: 'GPT-4', content: 'GPT findings' }],
        [{ content: 'Anonymous external report' }]
      );

      expect(result.ok).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.stringContaining('unknown source'),
        })
      );
    });

    it('includes conflict resolution guidelines with external reports', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Result',
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      await client.synthesize(
        'Prompt',
        [{ model: 'GPT', content: 'Content' }],
        [{ content: 'External' }]
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.stringContaining('Conflict Resolution Guidelines'),
        })
      );
    });

    it('returns error on API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Server error'));

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Prompt', [{ model: 'Test', content: 'Content' }]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles null text response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      const result = await client.synthesize('Prompt', [{ model: 'Test', content: 'Content' }]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });
  });

  describe('validateKey', () => {
    it('returns true when key is valid', async () => {
      mockGenerateContent.mockResolvedValue({
        text: "Hi! I'm Gemini.",
      });

      const client = createGeminiClient({ apiKey: 'valid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: GEMINI_DEFAULTS.validationModel,
        })
      );
    });

    it('returns true even with null text response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
      });

      const client = createGeminiClient({ apiKey: 'valid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns error when key is invalid', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Invalid API_KEY'));

      const client = createGeminiClient({ apiKey: 'invalid-key' });
      const result = await client.validateKey();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });
  });

  describe('custom models', () => {
    it('uses custom researchModel when provided', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        candidates: [],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        researchModel: 'gemini-custom-research',
      });
      await client.research('Test prompt');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-custom-research',
        })
      );
    });

    it('uses custom defaultModel when provided', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        defaultModel: 'gemini-custom-default',
      });
      await client.generate('Test prompt');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-custom-default',
        })
      );
    });

    it('uses custom validationModel when provided', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        validationModel: 'gemini-custom-validation',
      });
      await client.validateKey();

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-custom-validation',
        })
      );
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        candidates: [],
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      await client.research('Test prompt');

      expect(createAuditContext).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          method: 'research',
        })
      );
      expect(mockSuccess).toHaveBeenCalled();
    });

    it('calls audit context on error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API error'));

      const mockError = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createGeminiClient({ apiKey: 'test-key' });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
