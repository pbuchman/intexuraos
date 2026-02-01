/**
 * Tests for EmbeddingClient.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingClient, type EmbeddingClientDeps } from './embeddingClient.js';
// eslint-disable-next-line no-restricted-imports -- OpenAI type needed for mocking embedding client (separate from LLM generation)
import type OpenAI from 'openai';

/** Mock embedding vector matching text-embedding-3-small dimensions. */
const mockEmbedding = new Array(1536).fill(0.25);

/** Mock successful response from OpenAI embeddings API. */
const mockSuccessResponse = {
  data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' as const }],
  model: 'text-embedding-3-small',
  object: 'list' as const,
  usage: { prompt_tokens: 10, total_tokens: 10 },
};

/**
 * Create a mock OpenAI instance with controllable behavior.
 * Uses the dependency injection pattern: new EmbeddingClient({ openai })
 */
function createMockOpenAI(): OpenAI {
  return {
    embeddings: {
      create: vi.fn(),
    },
  } as unknown as OpenAI;
}

describe('EmbeddingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('embed calls OpenAI', () => {
    it('should return embedding for valid text', async () => {
      const mockOpenAI = createMockOpenAI();
      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue(mockSuccessResponse);

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockEmbedding);
        expect(result.value.length).toBe(1536);
      }
    });
  });

  describe('embed handles rate limit', () => {
    it('should retry with exponential backoff on 429 response', async () => {
      const mockOpenAI = createMockOpenAI();

      // First call fails with 429, second succeeds
      vi.mocked(mockOpenAI.embeddings.create)
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValueOnce(mockSuccessResponse);

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockEmbedding);
      }

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(2);
    });

    it('should retry up to max 3 times', async () => {
      const mockOpenAI = createMockOpenAI();

      vi.mocked(mockOpenAI.embeddings.create).mockRejectedValue(
        new Error('Rate limit exceeded (429)')
      );

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(3);
    });

    it('should return error after max retries exhausted', async () => {
      const mockOpenAI = createMockOpenAI();

      vi.mocked(mockOpenAI.embeddings.create).mockRejectedValue(
        new Error('Rate limit exceeded (429)')
      );

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
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
      const mockOpenAI = createMockOpenAI();
      const emptyResponse = {
        data: [],
        model: 'text-embedding-3-small',
        object: 'list' as const,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      };

      vi.mocked(mockOpenAI.embeddings.create).mockResolvedValue(emptyResponse);

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('No embedding returned');
      }
    });

    it('should return error result for non-retryable errors', async () => {
      const mockOpenAI = createMockOpenAI();

      vi.mocked(mockOpenAI.embeddings.create).mockRejectedValue(
        new Error('Invalid API key')
      );

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('test query');

      expect(result.ok).toBe(false);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(1);
    });

    it('should return error for empty string', async () => {
      const mockOpenAI = createMockOpenAI();

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const result = await client.embed('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Text cannot be empty');
      }
      // Should not call OpenAI for empty input
      expect(mockOpenAI.embeddings.create).not.toHaveBeenCalled();
    });
  });

  describe('retry timing', () => {
    it('should use exponential backoff between retries', async () => {
      const mockOpenAI = createMockOpenAI();

      vi.mocked(mockOpenAI.embeddings.create)
        .mockRejectedValueOnce(new Error('Rate limit (429)'))
        .mockResolvedValueOnce(mockSuccessResponse);

      const deps: EmbeddingClientDeps = { openai: mockOpenAI };
      const client = new EmbeddingClient(deps);
      const startTime = Date.now();
      await client.embed('test query');
      const elapsed = Date.now() - startTime;

      // Should have waited at least 1000ms (first retry delay)
      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(2);
    });
  });
});
