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
const mockGptGenerate = vi.fn();

vi.mock('@intexuraos/infra-gpt', () => ({
  createGptClient: vi.fn(() => ({
    generate: mockGptGenerate,
  })),
}));

const { createGptGenerateClient } = await import('../gptGenerateClient.js');

const baseConfig = {
  apiKey: 'test-key',
  model: LlmModels.GPT4oMini,
  userId: 'user-123',
  logger: mockLogger,
  usageSink: mockUsageSink,
};

describe('createGptGenerateClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object with a generate method', () => {
    const client = createGptGenerateClient(baseConfig);
    expect(client.generate).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('forwards generate to the underlying GPT client and returns success', async () => {
    const expectedResult = {
      content: 'Hello from GPT',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    };
    mockGptGenerate.mockResolvedValue(ok(expectedResult));

    const client = createGptGenerateClient(baseConfig);
    const result = await client.generate('Say hello', { promptType: 'test-prompt' });

    expect(mockGptGenerate).toHaveBeenCalledWith('Say hello', { promptType: 'test-prompt' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }
  });

  it('passes through errors from GPT generate unchanged', async () => {
    mockGptGenerate.mockResolvedValue(err({ code: 'RATE_LIMITED', message: 'Too many requests' }));

    const client = createGptGenerateClient(baseConfig);
    const result = await client.generate('test', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
    }
  });

  it('forwards ownerType to createGptClient when set', async () => {
    const { createGptClient } = await import('@intexuraos/infra-gpt');
    mockGptGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createGptGenerateClient({ ...baseConfig, ownerType: 'user' });

    expect(createGptClient).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user' }));
  });

  it('omits ownerType from createGptClient call when not configured', async () => {
    const { createGptClient } = await import('@intexuraos/infra-gpt');

    createGptGenerateClient(baseConfig);

    const callArg = vi.mocked(createGptClient).mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(callArg?.['ownerType']).toBeUndefined();
  });
});
