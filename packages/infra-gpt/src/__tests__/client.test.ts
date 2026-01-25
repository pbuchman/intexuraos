import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModelPricing, LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockResponsesCreate = vi.fn();
const mockChatCompletionsCreate = vi.fn();
const mockImagesGenerate = vi.fn();

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
    images = { generate: mockImagesGenerate };
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

const mockUsageLoggerLog = vi.fn().mockResolvedValue(undefined);

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
  createUsageLogger: vi.fn().mockReturnValue({
    log: mockUsageLoggerLog,
  }),
}));

const { createGptClient } = await import('../client.js');

const TEST_MODEL = 'gpt-4o';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 2.5,
  outputPricePerMillion: 10.0,
  cacheReadMultiplier: 0.5,
  webSearchCostPerCall: 0.03,
  imagePricing: {
    '1024x1024': 0.04,
    '1536x1024': 0.08,
    '1024x1536': 0.08,
  },
  ...overrides,
});

describe('createGptClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('research', () => {
    it('returns research result with content and usage from pricing', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Research findings about AI.',
        output: [],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const pricing = createTestPricing();
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
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
        // Cost calculated from pricing: (100/1M * 2.5) + (50/1M * 10)
        expect(result.value.usage.costUsd).toBeCloseTo(0.00075, 6);
      }
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
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('counts web search calls and adds cost', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [{ type: 'web_search_call' }, { type: 'web_search_call' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const pricing = createTestPricing({ webSearchCostPerCall: 0.03 });
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.webSearchCalls).toBe(2);
        // Cost: tokens + 2 web search calls = 0.00075 + 0.06 = 0.06075
        expect(result.value.usage.costUsd).toBeCloseTo(0.06075, 5);
      }
    });

    it('handles cached tokens with multiplier', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_details: { cached_tokens: 50 },
        },
      });

      const pricing = createTestPricing({ cacheReadMultiplier: 0.5 });
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(50);
        // Effective input: 100 - 50*(1-0.5) = 75 tokens charged at full price
        // Cost: (75/1M * 2.5) + (50/1M * 10) = 0.0001875 + 0.0005 = 0.0006875
        expect(result.value.usage.costUsd).toBeCloseTo(0.000688, 5);
      }
    });

    it('logs usage on success', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user',
          provider: LlmProviders.OpenAI,
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles API error and returns error result', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(401, 'Invalid API key'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles rate limiting error', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(429, 'Rate limited'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles context length exceeded error', async () => {
      mockResponsesCreate.mockRejectedValue(
        new MockAPIError(400, 'Context too long', 'context_length_exceeded')
      );

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONTEXT_LENGTH');
      }
    });

    it('logs usage on error', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Network error'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.research('Test prompt');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.any(String),
        })
      );
    });
  });

  describe('generate', () => {
    it('returns generate result with content and usage from pricing', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Generated text.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      });

      const pricing = createTestPricing();
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
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
        // Cost: (50/1M * 2.5) + (100/1M * 10) = 0.000125 + 0.001 = 0.001125
        expect(result.value.usage.costUsd).toBeCloseTo(0.001125, 6);
      }
    });

    it('logs usage with generate callType', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Generated text.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      await client.generate('Write something');

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'generate',
          success: true,
        })
      );
    });

    it('handles empty response content', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 50, completion_tokens: 0 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles API error', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(500, 'Internal error'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const pricing = createTestPricing({
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
      });
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe(LlmModels.GPTImage1);
        expect(result.value.imageData).toBeInstanceOf(Buffer);
        expect(result.value.usage.costUsd).toBe(0.04);
      }
    });

    it('uses specified image size for cost calculation', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const pricing = createTestPricing({
        imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
      });
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat', { size: '1536x1024' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.08);
      }
    });

    it('uses separate imagePricing when provided', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const pricing = createTestPricing();
      const imagePricing: ModelPricing = {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.02, '1536x1024': 0.04, '1024x1536': 0.04 },
      };
      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        imagePricing,
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.costUsd).toBe(0.02);
      }
    });

    it('returns error when no image data in response', async () => {
      mockImagesGenerate.mockResolvedValue({
        data: [{}],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
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

    it('handles URL-based image response', async () => {
      const fakeImageData = Buffer.from('url-fetched-image-data');
      const mockFetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(fakeImageData.buffer),
      });
      vi.stubGlobal('fetch', mockFetch);

      mockImagesGenerate.mockResolvedValue({
        data: [{ url: 'https://example.com/image.png' }],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.imageData).toBeInstanceOf(Buffer);
      }
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.png');

      vi.unstubAllGlobals();
    });

    it('handles API error during image generation', async () => {
      mockImagesGenerate.mockRejectedValue(new MockAPIError(500, 'Internal server error'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('extractUsageDetails edge cases', () => {
    it('handles undefined usage', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: undefined,
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.inputTokens).toBe(0);
        expect(result.value.usage.outputTokens).toBe(0);
      }
    });

    it('handles input_tokens_details without cached_tokens', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_details: {},
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBeUndefined();
      }
    });

    it('handles output_tokens_details with reasoning_tokens', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [],
        usage: {
          input_tokens: 100,
          output_tokens: 150,
          output_tokens_details: { reasoning_tokens: 100 },
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.reasoningTokens).toBe(100);
      }
    });
  });

  describe('extractSourcesFromResponse edge cases', () => {
    it('handles web_search_call with results missing url', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [
          {
            type: 'web_search_call',
            results: [{ url: 'https://valid.com' }, { title: 'No URL result' }, {}],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://valid.com']);
      }
    });

    it('handles web_search_call with non-array results', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [
          {
            type: 'web_search_call',
            results: 'not-an-array',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([]);
      }
    });

    it('ignores non-web_search_call output items', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [
          { type: 'message', content: 'Hello' },
          { type: 'web_search_call', results: [{ url: 'https://example.com' }] },
          { type: 'function_call', name: 'test' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual(['https://example.com']);
      }
    });
  });

  describe('timeout error handling', () => {
    it('handles timeout error in research via APIError', async () => {
      mockResponsesCreate.mockRejectedValue(new MockAPIError(408, 'Request timeout'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toContain('timeout');
      }
    });

    it('handles timeout error in generate via APIError', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(408, 'Connection timeout'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toContain('timeout');
      }
    });

    it('handles non-APIError without timeout detection', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Network error'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('generateImage edge cases', () => {
    it('handles empty data array', async () => {
      mockImagesGenerate.mockResolvedValue({
        data: [],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('No image data');
      }
    });

    it('handles data with neither b64_json nor url', async () => {
      mockImagesGenerate.mockResolvedValue({
        data: [{ revised_prompt: 'A cat' }],
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      if (client.generateImage === undefined) throw new Error('generateImage not defined');
      const result = await client.generateImage('A cat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('No image data');
      }
    });
  });
});
