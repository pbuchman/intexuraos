import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink = new FakeUsageSink();
const mockPerplexityGenerate = vi.fn();

vi.mock('@intexuraos/infra-perplexity', () => ({
  createPerplexityClient: vi.fn(() => ({
    generate: mockPerplexityGenerate,
  })),
}));

const { createPerplexityGenerateClient } = await import('../perplexityGenerateClient.js');

const baseConfig = {
  apiKey: 'test-key',
  model: LlmModels.SonarPro,
  userId: 'user-123',
  logger: mockLogger,
  usageSink: mockUsageSink,
};

describe('createPerplexityGenerateClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object with a generate method', () => {
    const client = createPerplexityGenerateClient(baseConfig);
    expect(client.generate).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('forwards generate to the underlying Perplexity client and returns success', async () => {
    const expectedResult = {
      content: 'Hello from Perplexity',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    };
    mockPerplexityGenerate.mockResolvedValue(ok(expectedResult));

    const client = createPerplexityGenerateClient(baseConfig);
    const result = await client.generate('Say hello', { promptType: 'test-prompt' });

    expect(mockPerplexityGenerate).toHaveBeenCalledWith('Say hello', { promptType: 'test-prompt' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }
  });

  it('passes through errors from Perplexity generate unchanged', async () => {
    mockPerplexityGenerate.mockResolvedValue(
      err({ code: 'TIMEOUT', message: 'Request timed out' })
    );

    const client = createPerplexityGenerateClient(baseConfig);
    const result = await client.generate('test', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TIMEOUT');
    }
  });

  it('forwards ownerType to createPerplexityClient when set', async () => {
    const { createPerplexityClient } = await import('@intexuraos/infra-perplexity');
    mockPerplexityGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createPerplexityGenerateClient({ ...baseConfig, ownerType: 'user' });

    expect(createPerplexityClient).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'user' })
    );
  });

  it('omits ownerType from createPerplexityClient call when not configured', async () => {
    const { createPerplexityClient } = await import('@intexuraos/infra-perplexity');

    createPerplexityGenerateClient(baseConfig);

    const callArg = vi.mocked(createPerplexityClient).mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(callArg?.['ownerType']).toBeUndefined();
  });
});
