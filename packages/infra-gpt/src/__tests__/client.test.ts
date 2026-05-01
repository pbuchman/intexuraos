import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(tracerProvider);
});

afterAll(async () => {
  await tracerProvider.shutdown();
  trace.disable();
});

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink = new FakeUsageSink();

const mockResponsesCreate = vi.fn();
const mockChatCompletionsCreate = vi.fn();
const mockImagesGenerate = vi.fn();

class MockAPIError extends Error {
  status: number;
  code: string | undefined; // @allow-undefined-type -- property on mock class, cannot use ?: here
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

const { mockUsageLoggerLog } = vi.hoisted(() => ({
  mockUsageLoggerLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@intexuraos/llm-pricing', async (): Promise<typeof import('@intexuraos/llm-pricing')> => {
  const actual =
    await vi.importActual<typeof import('@intexuraos/llm-pricing')>('@intexuraos/llm-pricing');
  return {
    ...actual,
    logUsage: vi.fn().mockResolvedValue(undefined),
    createUsageLogger: vi.fn().mockReturnValue({
      log: mockUsageLoggerLog,
    }),
  } as typeof import('@intexuraos/llm-pricing');
});

const { createGptClient } = await import('../client.js');

const TEST_MODEL = 'gpt-4o';

describe('createGptClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    mockUsageSink.clear();
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources.filter((s) => s === 'https://example.com')).toHaveLength(1);
      }
    });

    it('counts web search calls', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [{ type: 'web_search_call' }, { type: 'web_search_call' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.webSearchCalls).toBe(2);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('handles cached tokens', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'Content',
        output: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_details: { cached_tokens: 50 },
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.cacheTokens).toBe(50);
        expect(result.value.usage.costUsd).toBe(0);
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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

    it('forwards per-call correlation to usage logger when provided', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'ok',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.research('hello', { correlation: { researchId: 'r-1' } });

      expect(mockUsageLoggerLog).toHaveBeenCalledWith(
        expect.objectContaining({
          callType: 'research',
          correlation: { researchId: 'r-1' },
        })
      );
    });
  });

  describe('generate', () => {
    it('returns generate result with content and usage', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Generated text.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

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
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'Generated text.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 100 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('Write something', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Write something', { promptType: 'test-prompt' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('generateImage', () => {
    it('returns image result with zero cost', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const client = createGptClient({
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
        expect(result.value.model).toBe(LlmModels.GPTImage1);
        expect(result.value.imageData).toBeInstanceOf(Buffer);
        expect(result.value.usage.costUsd).toBe(0);
      }
    });

    it('uses specified image size', async () => {
      const imageB64 = Buffer.from('fake-image-data').toString('base64');
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const client = createGptClient({
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
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const client = createGptClient({
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
      mockImagesGenerate.mockResolvedValue({
        data: [{}],
      });

      const client = createGptClient({
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
      mockImagesGenerate.mockResolvedValue({
        data: [{ b64_json: imageB64 }],
      });

      const client = createGptClient({
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.generate('Test', { promptType: 'test-prompt' });

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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      const result = await client.research('Test prompt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toContain('timeout');
      }
    });

    it('handles timeout error in generate via APIError', async () => {
      vi.useFakeTimers();
      try {
        mockChatCompletionsCreate.mockRejectedValue(new MockAPIError(408, 'Connection timeout'));

        const client = createGptClient({
          apiKey: 'test-key',
          model: TEST_MODEL,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        });
        const promise = client.generate('Test prompt', { promptType: 'test-prompt' });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('TIMEOUT');
          expect(result.error.message).toContain('timeout');
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries transient RATE_LIMITED then returns success', async () => {
      vi.useFakeTimers();
      try {
        mockChatCompletionsCreate
          .mockRejectedValueOnce(new MockAPIError(429, 'Rate limited'))
          .mockResolvedValueOnce({
            choices: [{ message: { content: 'recovered' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          });

        const client = createGptClient({
          apiKey: 'test-key',
          model: TEST_MODEL,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        });

        const promise = client.generate('hi', { promptType: 'test-prompt' });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(2);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('recovered');
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles non-APIError without timeout detection', async () => {
      mockResponsesCreate.mockRejectedValue(new Error('Network error'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
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

    it('handles data with neither b64_json nor url', async () => {
      mockImagesGenerate.mockResolvedValue({
        data: [{ revised_prompt: 'A cat' }],
      });

      const client = createGptClient({
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
  });

  it('passes ownerType to usage logger when provided', async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });

    const client = createGptClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
      ownerType: 'user',
    });
    await client.generate('hello', { promptType: 'test-prompt' });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user' }));
  });

  it('passes promptType to usage logger', async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });

    const client = createGptClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
    });
    await client.generate('hello', { promptType: 'test-prompt' });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({ promptType: 'test-prompt' })
    );
  });

  it('forwards per-call correlation to usage logger when provided', async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });

    const client = createGptClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
    });
    await client.generate('hello', {
      promptType: 'test-prompt',
      correlation: { researchId: 'r-1' },
    });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({ correlation: { researchId: 'r-1' } })
    );
  });

  it('omits correlation from usage logger when not provided', async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });

    const client = createGptClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      logger: mockLogger,
      usageSink: mockUsageSink,
    });
    await client.generate('hello', { promptType: 'test-prompt' });

    const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty('correlation');
  });

  describe('OTel span emission for generate()', () => {
    it('emits llm.openai.generate span with all canonical attributes on success', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('hi', { promptType: 'test-prompt' });

      const spans = spanExporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      const span = spans[0];
      if (span === undefined) throw new Error('no span');
      expect(span.name).toBe('llm.openai.generate');
      expect(span.attributes['llm.provider']).toBe(LlmProviders.OpenAI);
      expect(span.attributes['llm.model']).toBe(TEST_MODEL);
      expect(span.attributes['llm.input_tokens']).toBe(3);
      expect(span.attributes['llm.output_tokens']).toBe(4);
      expect(span.attributes['llm.cost_usd']).toBeDefined();
      expect(span.attributes['llm.duration_ms']).toBeGreaterThanOrEqual(0);
    });

    it('passes durationMs >= 0 to usage logger on success', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('hi', { promptType: 'test-prompt' });
      const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as { durationMs?: number };
      expect(lastCall?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('passes durationMs >= 0 to usage logger on error', async () => {
      mockChatCompletionsCreate.mockRejectedValue(new Error('boom'));

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('hi', { promptType: 'test-prompt' });
      const lastCall = mockUsageLoggerLog.mock.calls.at(-1)?.[0] as {
        durationMs?: number;
        success?: boolean;
      };
      expect(lastCall?.success).toBe(false);
      expect(lastCall?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records llm.cached_input_tokens span attribute when cached_tokens > 0', async () => {
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          input_tokens_details: { cached_tokens: 7 },
        },
      });

      const client = createGptClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });
      await client.generate('hi', { promptType: 'test-prompt' });

      const spans = spanExporter.getFinishedSpans();
      const span = spans[0];
      if (span === undefined) throw new Error('no span');
      expect(span.attributes['llm.cached_input_tokens']).toBe(7);
    });
  });
});
