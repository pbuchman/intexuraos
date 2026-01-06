import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelPricing } from '@intexuraos/llm-contract';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }
  return { GoogleGenAI: MockGoogleGenAI };
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

const { createGeminiClientV2 } = await import('../clientV2.js');
const { logUsage } = await import('@intexuraos/llm-pricing');

const TEST_MODEL = 'gemini-2.5-flash';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 0.15,
  outputPricePerMillion: 0.6,
  groundingCostPerRequest: 0.035,
  imagePricing: {
    '1024x1024': 0.02,
    '1536x1024': 0.04,
    '1024x1536': 0.04,
  },
  ...overrides,
});

describe('createGeminiClientV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and usage from pricing', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research findings about AI.',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{ groundingMetadata: {} }],
      });

      const pricing = createTestPricing();
      const client = createGeminiClientV2({
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
        // Cost with grounding: (100/1M * 0.15) + (50/1M * 0.6) + 0.035 = 0.000015 + 0.00003 + 0.035 = 0.035045
        expect(result.value.usage.costUsd).toBeCloseTo(0.035045, 6);
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

      const client = createGeminiClientV2({
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

      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
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

      const pricing = createTestPricing({ groundingCostPerRequest: 0.035 });
      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.groundingEnabled).toBe(true);
        // Cost includes grounding: tokens + 0.035
        expect(result.value.usage.costUsd).toBeGreaterThan(0.035);
      }
    });

    it('does not add grounding cost when no grounding metadata', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{}],
      });

      const pricing = createTestPricing({ groundingCostPerRequest: 0.035 });
      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Cost without grounding: only token costs
        expect(result.value.usage.costUsd).toBeLessThan(0.001);
      }
    });

    it('logs usage on success', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Content',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        candidates: [{}],
      });

      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      await client.research('Test prompt');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: 'google',
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles API key error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API_KEY invalid'));

      const client = createGeminiClientV2({
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

    it('handles rate limiting / quota error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('429 quota exceeded'));

      const client = createGeminiClientV2({
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

    it('handles content filtered / safety error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('SAFETY blocked'));

      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTENT_FILTERED');
      }
    });

    it('logs usage on error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      const client = createGeminiClientV2({
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
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
      });

      const pricing = createTestPricing();
      const client = createGeminiClientV2({
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
        // Cost without grounding: (50/1M * 0.15) + (100/1M * 0.6) = 0.0000075 + 0.00006 = 0.0000675
        expect(result.value.usage.costUsd).toBeCloseTo(0.0000675, 6);
      }
    });

    it('logs usage with generate callType', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
      });

      const client = createGeminiClientV2({
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

    it('handles empty response text', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0 },
      });

      const client = createGeminiClientV2({
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
      mockGenerateContent.mockRejectedValue(new Error('Internal error'));

      const client = createGeminiClientV2({
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

  describe('generateImage', () => {
    it('returns image result with cost from pricing', async () => {
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

      const pricing = createTestPricing({
        imagePricing: { '1024x1024': 0.02, '1536x1024': 0.04, '1024x1536': 0.04 },
      });
      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe('gemini-2.5-flash-image');
        expect(result.value.imageData).toBeInstanceOf(Buffer);
        expect(result.value.usage.costUsd).toBe(0.02);
      }
    });

    it('uses specified image size for cost calculation', async () => {
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

      const pricing = createTestPricing({
        imagePricing: { '1024x1024': 0.02, '1536x1024': 0.04, '1024x1536': 0.04 },
      });
      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat', { size: '1536x1024' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.04);
      }
    });

    it('uses separate imagePricing when provided', async () => {
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

      const pricing = createTestPricing();
      const imagePricing: ModelPricing = {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.01, '1536x1024': 0.02, '1024x1536': 0.02 },
      };
      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        imagePricing,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.01);
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

      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
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

      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      await client.generateImage('A cat');

      expect(logUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'image_generation',
          success: true,
        })
      );
    });

    it('handles API error during image generation', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Internal server error'));

      const client = createGeminiClientV2({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });
});
