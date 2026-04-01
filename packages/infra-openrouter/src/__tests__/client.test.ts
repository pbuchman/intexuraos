import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { type ModelPricing, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

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

const { createOpenRouterClient } = await import('../client.js');
const { createAuditContext } = await import('@intexuraos/llm-audit');

const API_BASE_URL = 'https://openrouter.ai/api/v1';
const TEST_MODEL = 'anthropic/claude-sonnet-4.6';

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  useProviderCost: true,
  ...overrides,
});

describe('createOpenRouterClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('research', () => {
    it('includes userId and researchId in audit context', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        researchId: 'research-123',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.research('Test prompt');

      expect(vi.mocked(createAuditContext).mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          provider: LlmProviders.OpenRouter,
          model: TEST_MODEL,
          method: 'research',
          prompt: 'Test prompt',
          userId: 'test-user',
          researchId: 'research-123',
        })
      );
    });

    it('excludes researchId from audit context when undefined', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.research('Test prompt');

      const auditArgs = vi.mocked(createAuditContext).mock.calls[0]?.[0] as unknown as Record<
        string,
        unknown
      >;
      expect(auditArgs).not.toHaveProperty('researchId');
      expect(auditArgs?.['userId']).toBe('test-user');
    });

    it('sends request with :online suffix for research', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.research('Test prompt');

      // Verify :online suffix was appended for research
      expect(capturedBody?.['model']).toBe(`${TEST_MODEL}:online`);
    });

    it('does not double-append :online suffix if model already ends with :online', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: `${TEST_MODEL}:online`, // Model already has :online suffix
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.research('Test prompt');

      // Verify :online suffix was NOT double-appended
      expect(capturedBody?.['model']).toBe(`${TEST_MODEL}:online`);
    });

    it('returns research result with content and usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research findings about AI.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
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
        // Cost: 100 * (3.0/1M) + 50 * (15.0/1M) = 0.0003 + 0.00075 = 0.00105
        expect(result.value.usage.costUsd).toBeCloseTo(0.00105, 5);
      }
    });

    it('handles missing choices gracefully with empty content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [], // Empty choices
          usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.research('Test prompt');

      // Should return empty content when choices is empty
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('extracts object annotations with url field', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research content', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          annotations: [
            { url: 'https://example.com/article1', title: 'Example 1' },
            { url: 'https://example.com/article2', title: 'Example 2' },
          ],
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.research('Test prompt');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toContain('https://example.com/article1');
        expect(result.value.sources).toContain('https://example.com/article2');
      }
    });

    it('extracts annotations as sources', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Research content', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          annotations: ['https://source1.com', 'https://source2.com'],
        });

      const client = createOpenRouterClient({
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

    it('logs usage on success', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: `${TEST_MODEL}:online`,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Content', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
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
          provider: LlmProviders.OpenRouter,
          model: TEST_MODEL,
          callType: 'research',
          success: true,
        })
      );
    });

    it('handles 401 unauthorized error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Invalid API key');

      const client = createOpenRouterClient({
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

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Rate limited');

      const client = createOpenRouterClient({
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

    it('handles 500 API error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');

      const client = createOpenRouterClient({
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

    it('logs usage on error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');

      const client = createOpenRouterClient({
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

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Network failure' });

      const client = createOpenRouterClient({
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

    it('handles timeout error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError(new Error('Request timeout'));

      const client = createOpenRouterClient({
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
      }
    });
  });

  describe('generate', () => {
    it('does NOT append :online suffix for synthesis', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.generate('Write something');

      // Verify NO :online suffix for synthesis
      expect(capturedBody?.['model']).toBe(TEST_MODEL);
    });

    it('returns generate result with content and usage', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
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
        // Cost: 50 * (3.0/1M) + 100 * (15.0/1M) = 0.00015 + 0.0015 = 0.00165
        expect(result.value.usage.costUsd).toBeCloseTo(0.00165, 5);
      }
    });

    it('logs usage with generate callType', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Generated text.', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        });

      const client = createOpenRouterClient({
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

    it('handles API error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(500, 'Internal error');

      const client = createOpenRouterClient({
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

    it('handles 401 unauthorized error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(401, 'Invalid API key');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(429, 'Rate limited');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles 503 overloaded error', async () => {
      nock(API_BASE_URL).post('/chat/completions').reply(503, 'Service overloaded');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('OVERLOADED');
      }
    });

    it('handles timeout error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError(new Error('Request timeout'));

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.generate('Write something');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('handles network error', async () => {
      nock(API_BASE_URL).post('/chat/completions').replyWithError({ message: 'Connection error' });

      const client = createOpenRouterClient({
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

    it('handles empty content', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: '', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        });

      const client = createOpenRouterClient({
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

    it('includes response_format in request body when responseFormat option is provided', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: '{"key": "value"}', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.generate('Return JSON', { responseFormat: { type: 'json_object' } });

      expect(capturedBody).toHaveProperty('response_format', { type: 'json_object' });
    });

    it('does NOT include response_format in request body when no options are provided', async () => {
      let capturedBody: Record<string, unknown> | undefined;

      nock(API_BASE_URL)
        .post('/chat/completions', (body) => {
          capturedBody = body as Record<string, unknown>;
          return true;
        })
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { content: 'Plain text response', role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      await client.generate('Write something');

      expect(capturedBody).not.toHaveProperty('response_format');
    });

    it('handles empty choices array in generate', async () => {
      nock(API_BASE_URL)
        .post('/chat/completions')
        .reply(200, {
          id: 'test-id',
          model: TEST_MODEL,
          created: Date.now(),
          object: 'chat.completion',
          choices: [], // Empty choices array
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.generate('Write something');

      // Should return empty content when choices is empty
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });
  });

  describe('validateKey', () => {
    it('returns key info on success', async () => {
      nock(API_BASE_URL).get('/key').reply(200, {
        token: 'sk-1234',
        usage: 1000,
        limit: 10000,
        expiresAt: '2026-12-31T23:59:59Z',
      });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.token).toBe('sk-1234');
        expect(result.value.usage).toBe(1000);
      }
    });

    it('handles 401 invalid key error', async () => {
      nock(API_BASE_URL).get('/key').reply(401, 'Invalid API key');

      const client = createOpenRouterClient({
        apiKey: 'bad-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.validateKey('bad-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('handles 429 rate limit error', async () => {
      nock(API_BASE_URL).get('/key').reply(429, 'Rate limited');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('handles 500 API error', async () => {
      nock(API_BASE_URL).get('/key').reply(500, 'Internal server error');

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('handles network error', async () => {
      nock(API_BASE_URL).get('/key').replyWithError({ message: 'Network failure' });

      const client = createOpenRouterClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      const result = await client.validateKey('test-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });
});
