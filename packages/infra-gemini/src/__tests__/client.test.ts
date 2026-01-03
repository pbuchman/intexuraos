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
const { createGeminiClient } = await import('../index.js');

const TEST_MODEL = 'gemini-2.5-pro';

describe('createGeminiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and usage', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research findings about AI.',
        candidates: [],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
        },
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Research findings about AI.');
        expect(result.value.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      }
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
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

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
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

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('handles usageMetadata with undefined token counts', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        candidates: [],
        usageMetadata: {
          promptTokenCount: undefined,
          candidatesTokenCount: undefined,
        },
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
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

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
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

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
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

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns API_ERROR on general failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Server error'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns INVALID_KEY error when message contains API_KEY', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Invalid API_KEY provided'));

      const client = createGeminiClient({ apiKey: 'bad-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED error on 429', async () => {
      mockGenerateContent.mockRejectedValue(new Error('429 Too Many Requests'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns RATE_LIMITED error on quota exceeded', async () => {
      mockGenerateContent.mockRejectedValue(new Error('quota exceeded'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns TIMEOUT error on timeout', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
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

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Generated response');
      }
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: TEST_MODEL,
        })
      );
    });

    it('handles null text response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('');
      }
    });

    it('returns error on failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Error'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
    });
  });

  describe('audit logging', () => {
    it('calls audit context on success with usage', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        candidates: [],
        usageMetadata: {
          promptTokenCount: 150,
          candidatesTokenCount: 75,
        },
      });

      const mockSuccess = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: mockSuccess,
        error: vi.fn(),
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      await client.research('Test prompt');

      expect(createAuditContext).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
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

    it('calls audit context on error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API error'));

      const mockError = vi.fn().mockResolvedValue(undefined);
      (createAuditContext as unknown as MockInstance).mockReturnValue({
        success: vi.fn(),
        error: mockError,
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      await client.research('Test prompt');

      expect(mockError).toHaveBeenCalled();
    });
  });
});
