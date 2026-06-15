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
const mockClaudeGenerate = vi.fn();

vi.mock('@intexuraos/infra-claude', () => ({
  createClaudeClient: vi.fn(() => ({
    generate: mockClaudeGenerate,
  })),
}));

const { createClaudeGenerateClient } = await import('../claudeGenerateClient.js');

const baseConfig = {
  apiKey: 'test-key',
  model: LlmModels.ClaudeHaiku35,
  userId: 'user-123',
  logger: mockLogger,
  usageSink: mockUsageSink,
};

describe('createClaudeGenerateClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object with a generate method', () => {
    const client = createClaudeGenerateClient(baseConfig);
    expect(client.generate).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });

  it('forwards generate to the underlying Claude client and returns success', async () => {
    const expectedResult = {
      content: 'Hello from Claude',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    };
    mockClaudeGenerate.mockResolvedValue(ok(expectedResult));

    const client = createClaudeGenerateClient(baseConfig);
    const result = await client.generate('Say hello', { promptType: 'test-prompt' });

    expect(mockClaudeGenerate).toHaveBeenCalledWith('Say hello', { promptType: 'test-prompt' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }
  });

  it('forwards per-call correlation to the underlying Claude client', async () => {
    mockClaudeGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    const client = createClaudeGenerateClient(baseConfig);
    await client.generate('hi', {
      promptType: 'test-prompt',
      correlation: { researchId: 'r-1', sessionId: 's-2' },
    });

    expect(mockClaudeGenerate).toHaveBeenCalledWith('hi', {
      promptType: 'test-prompt',
      correlation: { researchId: 'r-1', sessionId: 's-2' },
    });
  });

  it('passes through errors from Claude generate unchanged', async () => {
    mockClaudeGenerate.mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Bad API key' }));

    const client = createClaudeGenerateClient(baseConfig);
    const result = await client.generate('test', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_KEY');
    }
  });

  it('forwards ownerType to createClaudeClient when set', async () => {
    const { createClaudeClient } = await import('@intexuraos/infra-claude');
    mockClaudeGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createClaudeGenerateClient({ ...baseConfig, ownerType: 'user' });

    expect(createClaudeClient).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user' }));
  });

  it('omits ownerType from createClaudeClient call when not configured', async () => {
    const { createClaudeClient } = await import('@intexuraos/infra-claude');

    createClaudeGenerateClient(baseConfig);

    const callArg = vi.mocked(createClaudeClient).mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(callArg?.['ownerType']).toBeUndefined();
  });
});
