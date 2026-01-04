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
        expect(result.value.usage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
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
        expect(result.value.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
      }
    });

    it('uses default pricing for unknown model', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        candidates: [],
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
        },
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: 'unknown-model' });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(1000);
        expect(result.value.usage.outputTokens).toBe(500);
        expect(result.value.usage.costUsd).toBeGreaterThan(0);
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

    it('returns CONTENT_FILTERED error on SAFETY block', async () => {
      mockGenerateContent.mockRejectedValue(new Error('SAFETY block triggered'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('returns CONTENT_FILTERED error on blocked response', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Content blocked by policy'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });
  });

  describe('generate', () => {
    it('returns generated content', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated response',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Generated response');
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
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0 },
      });

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Generate something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns error on failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Error'));

      const client = createGeminiClient({ apiKey: 'test-key', model: TEST_MODEL });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
    });
  });

  describe('usage logging', () => {
    it('calls usageLogger.log on successful research', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        candidates: [],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const mockUsageLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        usageLogger: mockUsageLogger,
        userId: 'test-user-123',
      });
      await client.research('Test prompt');

      expect(mockUsageLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-123',
          provider: 'google',
          model: TEST_MODEL,
          method: 'research',
          success: true,
        })
      );
    });

    it('calls usageLogger.log on successful generate', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const mockUsageLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        usageLogger: mockUsageLogger,
        userId: 'test-user-456',
      });
      await client.generate('Test prompt');

      expect(mockUsageLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-456',
          provider: 'google',
          method: 'generate',
          success: true,
        })
      );
    });

    it('calls usageLogger.log with errorMessage on failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API error'));

      const mockUsageLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        usageLogger: mockUsageLogger,
      });
      await client.research('Test prompt');

      expect(mockUsageLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'unknown',
          success: false,
          errorMessage: 'API error',
        })
      );
    });

    it('uses "unknown" for userId when not provided', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const mockUsageLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        usageLogger: mockUsageLogger,
      });
      await client.research('Test prompt');

      expect(mockUsageLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'unknown',
        })
      );
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

    it('includes groundingEnabled when grounding metadata is present', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://example.com' } }],
            },
          },
        ],
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
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage?.groundingEnabled).toBe(true);
      }
      expect(mockSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          groundingEnabled: true,
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
