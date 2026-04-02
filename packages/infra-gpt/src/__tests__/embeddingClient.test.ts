import { describe, expect, it, vi } from 'vitest';
import type { CreateEmbeddingResponse } from 'openai/resources';

import { EmbeddingClient } from '../embeddingClient.js';

const mockEmbedding = Array.from({ length: 1536 }, (_, index) => index / 1000);

function createEmbeddingResponse(embedding: number[] = mockEmbedding): CreateEmbeddingResponse {
  return {
    data: [{ embedding, index: 0, object: 'embedding' as const }],
    model: 'text-embedding-3-small',
    object: 'list',
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}

describe('EmbeddingClient', () => {
  it('returns an embedding for valid text', async () => {
    const embedFn = vi.fn().mockResolvedValue(createEmbeddingResponse());
    const client = new EmbeddingClient({ embedFn });

    const result = await client.embed('test query');

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(embedFn).toHaveBeenCalledWith('test query', 'text-embedding-3-small');
    expect(result.value).toEqual(mockEmbedding);
  });

  it('trims input before calling OpenAI', async () => {
    const embedFn = vi.fn().mockResolvedValue(createEmbeddingResponse());
    const client = new EmbeddingClient({ embedFn });

    await client.embed('  trimmed query  ');

    expect(embedFn).toHaveBeenCalledWith('trimmed query', 'text-embedding-3-small');
  });

  it('returns INVALID_INPUT for empty text', async () => {
    const embedFn = vi.fn();
    const client = new EmbeddingClient({ embedFn });

    const result = await client.embed('   ');

    expect(result.ok).toBe(false);
    expect(embedFn).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('uses a custom model when configured', async () => {
    const embedFn = vi.fn().mockResolvedValue(createEmbeddingResponse());
    const client = new EmbeddingClient({ embedFn, model: 'custom-embedding-model' });

    await client.embed('custom model query');

    expect(embedFn).toHaveBeenCalledWith('custom model query', 'custom-embedding-model');
  });

  it('retries rate-limited requests with exponential backoff', async () => {
    vi.useFakeTimers();
    const embedFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockRejectedValueOnce(new Error('rate limited again'))
      .mockResolvedValueOnce(createEmbeddingResponse());
    const client = new EmbeddingClient({ embedFn, retryDelayMs: 100 });

    const resultPromise = client.embed('retry me');

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);
    expect(embedFn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('returns RATE_LIMITED after exhausting retries', async () => {
    vi.useFakeTimers();
    const embedFn = vi.fn().mockRejectedValue(new Error('429 too many requests'));
    const client = new EmbeddingClient({ embedFn, maxRetries: 3, retryDelayMs: 50 });

    const resultPromise = client.embed('retry me');

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(embedFn).toHaveBeenCalledTimes(3);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
    }
    vi.useRealTimers();
  });

  it('returns API_ERROR when OpenAI returns no embedding', async () => {
    const embedFn = vi.fn().mockResolvedValue({
      data: [{ index: 0, object: 'embedding' as const }],
      model: 'text-embedding-3-small',
      object: 'list',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });
    const client = new EmbeddingClient({ embedFn });

    const result = await client.embed('missing embedding');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('No embedding returned');
    }
  });

  it('returns API_ERROR for non-rate-limit failures', async () => {
    const embedFn = vi.fn().mockRejectedValue(new Error('OpenAI unavailable'));
    const client = new EmbeddingClient({ embedFn });

    const result = await client.embed('fail fast');

    expect(result.ok).toBe(false);
    expect(embedFn).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('OpenAI unavailable');
    }
  });
});
