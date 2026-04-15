import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink: UsageSink = { log: vi.fn().mockResolvedValue(undefined) };

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

const mockUsageLoggerLog = vi.fn().mockResolvedValue(undefined);

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
  createUsageLogger: vi.fn().mockReturnValue({
    log: mockUsageLoggerLog,
  }),
}));

const { createGeminiClient } = await import('../client.js');
const { createUsageLogger } = await import('@intexuraos/llm-pricing');

const TEST_MODEL = LlmModels.Gemini25Flash;


describe('createGeminiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes usage sink to createUsageLogger', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      candidates: [{}],
    });
    const usageSink = { log: vi.fn().mockResolvedValue(undefined) };

    const client = createGeminiClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink,
    });

    await client.generate('hello');

    expect(createUsageLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        logger: mockLogger,
        sink: usageSink,
      })
    );
  });

  describe('research', () => {
    it('returns research result with content and usage', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research findings about AI.',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{ groundingMetadata: {} }],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('extracts sources from grounding metadata', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
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

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://source1.com');
        expect(result.value.sources).toContain('https://source2.com');
      }
    });

    it('deduplicates sources', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://example.com' } },
                { web: { uri: 'https://example.com' } },
              ],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('adds grounding cost when grounding metadata is present', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{ groundingMetadata: {} }],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.groundingEnabled).toBe(true);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('does not add grounding cost when no grounding metadata', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{}],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('logs usage on success', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{}],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.research('Test prompt');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: LlmProviders.Google,
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles API key error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API_KEY invalid'));

      const client = createGeminiClient({
        apiKey: 'test-key',
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

    it('handles rate limiting / quota error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('429 quota exceeded'));

      const client = createGeminiClient({
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

    it('handles content filtered / safety error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('SAFETY blocked'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('logs usage on error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.research('Test prompt');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.any(String),
        })
      );
    });

    it('includes thinking tokens in usage when returned by Gemini', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research content',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 200,
        },
        candidates: [{ groundingMetadata: {} }],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBe(200);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });
  });

  describe('generate', () => {
    it('returns generate result with content and usage', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('logs usage with generate callType', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('Write something');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'generate',
          success: true,
        })
      );
    });

    it('handles empty response text', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0 },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles API error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Internal error'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('includes thinking tokens in usage when returned by Gemini', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 500,
        },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBe(500);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('omits thinkingTokens when Gemini returns zero', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 0,
        },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBeUndefined();
      }
    });

    it('omits thinkingTokens when Gemini does not return thoughtsTokenCount', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
        },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBeUndefined();
      }
    });
  });

  describe('generateImage', () => {
    it('returns image result with zero cost', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: imageB64 } }],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe(LlmModels.Gemini25FlashImage);
        expect(result.value.imageData).toBeInstanceOf(Buffer);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('uses specified image size', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: imageB64 } }],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat', { size: '1536x1024' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('returns image with zero cost when no imagePricing', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: imageB64 } }],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('returns error when no image data in response', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: 'no image here' }],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('No image data');
      }
    });

    it('logs usage with image_generation callType', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: imageB64 } }],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      await client.generateImage('A cat');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'image_generation',
          success: true,
        })
      );
    });

    it('handles API error during image generation', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Internal server error'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('mapGeminiError coverage', () => {
    it('maps quota-only error to RATE_LIMITED in research', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Resource quota exhausted'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps 429-only error to RATE_LIMITED in research', async () => {
      mockGenerateContent.mockRejectedValue(new Error('HTTP 429 Too Many Requests'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps blocked-only error to CONTENT_FILTERED in research', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Response was blocked by policy'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('maps SAFETY-only error to CONTENT_FILTERED in research', async () => {
      mockGenerateContent.mockRejectedValue(new Error('SAFETY: violates policy'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('maps timeout error to TIMEOUT in research', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout after 60s'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps API_KEY error to INVALID_KEY in generate', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API_KEY invalid'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps timeout error to TIMEOUT in generate', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Connection timeout'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps rate limit error to RATE_LIMITED in generate', async () => {
      mockGenerateContent.mockRejectedValue(new Error('429 rate limit'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps content filter error to CONTENT_FILTERED in generate', async () => {
      mockGenerateContent.mockRejectedValue(new Error('SAFETY blocked content'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('maps API_KEY error to INVALID_KEY in generateImage', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API_KEY expired'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('maps timeout error to TIMEOUT in generateImage', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('maps rate limit error to RATE_LIMITED in generateImage', async () => {
      mockGenerateContent.mockRejectedValue(new Error('quota limit reached'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('maps content filter error to CONTENT_FILTERED in generateImage', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Content blocked by filters'));

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('maps non-Error thrown value (string) to API_ERROR', async () => {
      mockGenerateContent.mockRejectedValue('raw string error');

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('maps non-Error thrown value (null) to API_ERROR', async () => {
      mockGenerateContent.mockRejectedValue(null);

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('maps non-Error thrown value (undefined) to API_ERROR', async () => {
      mockGenerateContent.mockRejectedValue(undefined);

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('research edge cases', () => {
    it('handles undefined text and usageMetadata', async () => {
      mockGenerateContent.mockResolvedValue({
        text: undefined,
        usageMetadata: undefined,
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
        expect(result.value.usage.inputTokens).toBe(0);
        expect(result.value.usage.outputTokens).toBe(0);
      }
    });

    it('skips grounding chunks with missing uri', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://valid.com' } },
                { web: {} },
                { web: { uri: undefined } },
                { notWeb: true },
              ],
            },
          },
        ],
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://valid.com']);
      }
    });
  });

  it('passes ownerType to usage logger when provided', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });

    const client = createGeminiClient({
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
