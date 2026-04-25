/**
 * Tests for EmbeddingClient.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingClient, type EmbeddingClientDeps } from './embeddingClient.js';
import type { CreateEmbeddingResponse } from 'openai/resources';

/** Mock embedding vector matching text-embedding-3-small dimensions. */
const mockEmbedding = new Array(1536).fill(0.25);

/** Mock successful response from OpenAI embeddings API. */
const mockSuccessResponse: CreateEmbeddingResponse = {
  data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' as const }],
  model: 'text-embedding-3-small',
  object: 'list' as const,
  usage: { prompt_tokens: 10, total_tokens: 10 },
};

describe('EmbeddingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('embed calls OpenAI', () => {
    it('should return embedding for valid text', async () => {
      const mockEmbedFn = vi.fn().mockResolvedValue(mockSuccessResponse);
      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockEmbedding);
        expect(result.value.length).toBe(1536);
      }
      expect(mockEmbedFn).toHaveBeenCalledTimes(1);
      expect(mockEmbedFn).toHaveBeenCalledWith('test query', 'text-embedding-3-small');
    });
  });

  describe('embed handles rate limit', () => {
    it('should retry with exponential backoff on 429 response', async () => {
      const mockEmbedFn = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValueOnce(mockSuccessResponse);

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockEmbedding);
      }

      expect(mockEmbedFn).toHaveBeenCalledTimes(2);
    });

    it('should retry up to max 3 times', async () => {
      const mockEmbedFn = vi.fn().mockRejectedValue(
        new Error('Rate limit exceeded (429)')
      );

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      expect(mockEmbedFn).toHaveBeenCalledTimes(3);
    });

    it('should return error after max retries exhausted', async () => {
      const mockEmbedFn = vi.fn().mockRejectedValue(
        new Error('Rate limit exceeded (429)')
      );

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Rate limit exceeded');
      }
    });
  });

  describe('embed error handling', () => {
    it('should return error when API returns no embedding', async () => {
      const mockEmbedFn = vi.fn().mockResolvedValue({
        data: [],
        model: 'text-embedding-3-small',
        object: 'list' as const,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      } as CreateEmbeddingResponse);

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('No embedding returned');
      }
    });

    it('should return error result for non-retryable errors', async () => {
      const mockEmbedFn = vi.fn().mockRejectedValue(
        new Error('Invalid API key')
      );

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      expect(mockEmbedFn).toHaveBeenCalledTimes(1);
    });

    it('should return error for empty string', async () => {
      const mockEmbedFn = vi.fn().mockResolvedValue(mockSuccessResponse);

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Text cannot be empty');
      }
      // Should not call embedFn for empty input
      expect(mockEmbedFn).not.toHaveBeenCalled();
    });
  });

  describe('retry timing', () => {
    it('should use exponential backoff between retries', async () => {
      const mockEmbedFn = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit (429)'))
        .mockResolvedValueOnce(mockSuccessResponse);

      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn };
      const client = new EmbeddingClient(deps);
      const startTime = Date.now();
      await client.embed('test query');
      const elapsed = Date.now() - startTime;

      // Should have waited approximately 1000ms (first retry delay)
      // Allow 5% variance for timer precision
      expect(elapsed).toBeGreaterThanOrEqual(950);
      expect(mockEmbedFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom configuration', () => {
    it('should use custom model when provided', async () => {
      const mockEmbedFn = vi.fn().mockResolvedValue(mockSuccessResponse);
      const deps: EmbeddingClientDeps = { embedFn: mockEmbedFn, model: 'custom-model' };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(true);
      expect(mockEmbedFn).toHaveBeenCalledWith('test query', 'custom-model');
    });

    // 5 attempts with 500ms base delay use exponential backoff 500+1000+2000+4000 = 7500ms.
    // Default vitest timeout is 5000ms which is insufficient — bump to 15000ms for headroom.
    it('should use custom retry configuration', async () => {
      const mockEmbedFn = vi.fn().mockRejectedValue(new Error('Rate limit (429)'));
      const deps: EmbeddingClientDeps = {
        embedFn: mockEmbedFn,
        maxRetries: 5,
        retryDelayMs: 500,
      };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      expect(mockEmbedFn).toHaveBeenCalledTimes(5);
    }, 15000);
  });
});
