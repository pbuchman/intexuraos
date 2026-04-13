import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModelPricing } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink: UsageSink = { log: vi.fn().mockResolvedValue(undefined) };

const mockOrGenerate = vi.fn();

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterClient: vi.fn(() => ({
    generate: mockOrGenerate,
  })),
}));

const { createOpenRouterGenerateClient } = await import('../openRouterGenerateClient.js');

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 0.6,
  outputPricePerMillion: 2.2,
  webSearchCostPerCall: 0.005,
  ...overrides,
});

const baseConfig = {
  apiKey: 'test-key',
  model: 'or:google/gemma-4-31b-it:free' as unknown as import('@intexuraos/llm-contract').LLMModel,
  userId: 'user-123',
  pricing: createTestPricing(),
  logger: mockLogger,
  usageSink: mockUsageSink,
};

describe('createOpenRouterGenerateClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object with a generate method', () => {
    const client = createOpenRouterGenerateClient(baseConfig);
    expect(client.generate).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('satisfies the LlmGenerateClient interface by generating successfully', async () => {
    const expectedResult = {
      content: 'Hello from OpenRouter',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    };
    mockOrGenerate.mockResolvedValue(ok(expectedResult));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('Say hello');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }
  });

  it('strips the or: prefix before passing model to createOpenRouterClient', async () => {
    const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
    mockOrGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createOpenRouterGenerateClient(baseConfig);

    expect(createOpenRouterClient).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'google/gemma-4-31b-it:free' })
    );
  });

  it('passes through non-or: prefixed model as-is to createOpenRouterClient', async () => {
    const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
    mockOrGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createOpenRouterGenerateClient({
      ...baseConfig,
      model:
        'anthropic/claude-sonnet-4.6' as unknown as import('@intexuraos/llm-contract').LLMModel,
    });

    expect(createOpenRouterClient).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-4.6' })
    );
  });

  it('passes through errors from OpenRouter generate unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Bad API key' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_KEY');
      expect(result.error.message).toBe('Bad API key');
    }
  });

  it('passes through RATE_LIMITED errors from OpenRouter unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'RATE_LIMITED', message: 'Too many requests' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.message).toBe('Too many requests');
    }
  });

  it('passes through TIMEOUT errors from OpenRouter unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'TIMEOUT', message: 'Request timed out' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TIMEOUT');
    }
  });

  it('passes through OVERLOADED errors from OpenRouter unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'OVERLOADED', message: 'Server overloaded' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('OVERLOADED');
    }
  });

  describe('ownerType propagation', () => {
    it('forwards ownerType to createOpenRouterClient when set to user', async () => {
      const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
      mockOrGenerate.mockResolvedValue(
        ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
      );

      createOpenRouterGenerateClient({ ...baseConfig, ownerType: 'user' });

      expect(createOpenRouterClient).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('omits ownerType from createOpenRouterClient call when not configured', async () => {
      const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
      mockOrGenerate.mockResolvedValue(
        ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
      );

      createOpenRouterGenerateClient(baseConfig);

      const callArg = vi.mocked(createOpenRouterClient).mock.calls[0]?.[0] as unknown as Record<
        string,
        unknown
      >;
      expect(callArg?.['ownerType']).toBeUndefined();
    });
  });
});
