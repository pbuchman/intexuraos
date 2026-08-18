import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { OPENROUTER_TEXT_EMBEDDING_3_SMALL } from '../modelIds.js';

const { postOpenRouterModalityJson } = vi.hoisted(() => ({
  postOpenRouterModalityJson: vi.fn(),
}));

vi.mock('../modalityClientUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modalityClientUtils.js')>();
  return { ...actual, postOpenRouterModalityJson };
});

const { createOpenRouterEmbeddingsClient } = await import('../embeddingsClient.js');

const logger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const vector = (): number[] =>
  Array.from({ length: OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions }, () => 0.1);

describe('createOpenRouterEmbeddingsClient defensive result handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a single embedding missing after response validation', async () => {
    const validatedVector = vector();
    const embeddingReads: unknown[] = [
      validatedVector,
      validatedVector,
      validatedVector,
      undefined,
    ];
    const responseItem = {
      index: 0,
      get embedding(): unknown {
        return embeddingReads.shift();
      },
    };
    postOpenRouterModalityJson.mockResolvedValue({ data: [responseItem] });
    const client = createOpenRouterEmbeddingsClient({
      apiKey: 'or-test-key',
      userId: 'user-1',
      logger,
      usageSink: new FakeUsageSink(),
      maxAttempts: 1,
    });

    const result = await client.embed('hello');

    expect(result).toEqual({
      ok: false,
      error: { code: 'API_ERROR', message: 'OpenRouter returned an invalid embedding response' },
    });
  });
});
