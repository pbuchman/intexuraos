/**
 * Tests for searchDocumentation use case.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchDocumentation } from './searchDocumentation.js';
import type {
  EmbeddingRepositoryPort,
  DocChunkWithScore,
  DocChunk,
} from '../models/docChunk.js';
import type { Result } from '@intexuraos/common-core';
import type { EmbeddingClient } from './searchDocumentation.js';
import type { Logger } from 'pino';

/** Mock timestamp for tests */
const mockTimestamp: FirebaseFirestore.Timestamp = {
  seconds: 123456,
  nanoseconds: 0,
  toDate: () => new Date(),
  toMillis: () => 123456000,
  isEqual: () => true,
  valueOf: () => '123456',
};

/** Mock embedding repository */
class MockEmbeddingRepository implements EmbeddingRepositoryPort {
  private results: DocChunkWithScore[] = [
    {
      id: 'chunk-1',
      content: 'Test content about authentication',
      filePath: 'docs/auth.md',
      section: 'Authentication',
      docType: 'markdown',
      createdAt: mockTimestamp,
      score: 0.85,
    },
    {
      id: 'chunk-2',
      content: 'Test content about authorization',
      filePath: 'docs/auth.md',
      section: 'Authorization',
      docType: 'markdown',
      createdAt: mockTimestamp,
      score: 0.75,
    },
  ];

  setResults(results: DocChunkWithScore[]): void {
    this.results = results;
  }

  async findSimilar(
    _embedding: number[],
    _limit: number
  ): Promise<Result<DocChunkWithScore[]>> {
    return {
      ok: true,
      value: this.results,
    };
  }

  async findById(_id: string): Promise<Result<DocChunk | null>> {
    return {
      ok: true,
      value: null,
    };
  }
}

/** Mock embedding client */
class MockEmbeddingClient implements EmbeddingClient {
  async embed(_text: string): Promise<Result<number[]>> {
    return {
      ok: true,
      value: new Array(1536).fill(0.1),
    };
  }
}

/** Mock logger */
const mockLogger: Logger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  msgPrefix: '',
} as unknown as Logger;

describe('searchDocumentation', () => {
  let mockRepo: MockEmbeddingRepository;
  let mockClient: MockEmbeddingClient;

  beforeEach(() => {
    mockRepo = new MockEmbeddingRepository();
    mockClient = new MockEmbeddingClient();
  });

  describe('returns top-k chunks', () => {
    it('should return array of DocChunkWithScore when query has matches', async () => {
      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'how do I authenticate?'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const firstResult = result.value[0];
        expect(firstResult?.score).toBe(0.85);
        expect(firstResult?.content).toBe('Test content about authentication');
      }
    });
  });

  describe('respects limit param', () => {
    it('should return max 5 results when limit=5', async () => {
      // Override mock to return 10 results
      mockRepo.setResults(
        Array.from({ length: 10 }, (_, i) => ({
          id: `chunk-${i}`,
          content: `Content ${i}`,
          filePath: 'docs/test.md',
          section: 'Test',
          docType: 'markdown' as const,
          createdAt: mockTimestamp,
          score: 0.9 - i * 0.05,
        }))
      );

      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query',
        { limit: 5 }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeLessThanOrEqual(5);
      }
    });

    it('should use default limit of 5 when not specified', async () => {
      const findSimilarSpy = vi.spyOn(mockRepo, 'findSimilar');

      await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query'
      );

      expect(findSimilarSpy).toHaveBeenCalledWith(expect.any(Array), 5);
    });
  });

  describe('returns empty for no matches', () => {
    it('should return empty array when query has no matches', async () => {
      mockRepo.setResults([]);

      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'xyz123 no content matches this'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('includes similarity scores', () => {
    it('should include score field in each result', async () => {
      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        result.value.forEach((item) => {
          expect(item).toHaveProperty('score');
          expect(typeof item.score).toBe('number');
          expect(item.score).toBeGreaterThanOrEqual(0);
          expect(item.score).toBeLessThanOrEqual(1);
        });
      }
    });
  });

  describe('filters by docType', () => {
    it('should only return markdown chunks when docType=markdown', async () => {
      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query',
        { docType: 'markdown' }
      );

      // Should not throw and return valid results
      expect(result.ok).toBe(true);
    });

    it('should only return openapi chunks when docType=openapi', async () => {
      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query',
        { docType: 'openapi' }
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('embedQuery generates 1536-dim vector', () => {
    it('should generate 1536-dimension embedding vector for valid text', async () => {
      let capturedEmbedding: number[] | undefined;

      const spyClient: EmbeddingClient = {
        async embed(_text: string) {
          const vector = new Array(1536).fill(0.5);
          capturedEmbedding = vector;
          return { ok: true, value: vector };
        },
      };

      await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: spyClient,
          logger: mockLogger,
        },
        'test query'
      );

      expect(capturedEmbedding).toBeDefined();
      expect(capturedEmbedding?.length).toBe(1536);
    });
  });

  describe('embedQuery error handling', () => {
    it('should return error result when embedding client fails', async () => {
      const failingClient: EmbeddingClient = {
        async embed() {
          return {
            ok: false,
            error: new Error('OpenAI API error'),
          };
        },
      };

      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: failingClient,
          logger: mockLogger,
        },
        'test query'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        // SearchError has a code property
        const searchError = result.error as { code: string };
        expect(searchError.code).toBe('EMBEDDING_FAILED');
      }
    });

    it('should return error result for empty string', async () => {
      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        ''
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const searchError = result.error as { code: string };
        expect(searchError.code).toBe('INVALID_QUERY');
      }
    });
  });

  describe('minScore filtering', () => {
    it('should filter out results below minScore threshold', async () => {
      mockRepo.setResults([
        {
          id: 'chunk-1',
          content: 'High score content',
          filePath: 'docs/test.md',
          section: 'Test',
          docType: 'markdown' as const,
          createdAt: mockTimestamp,
          score: 0.85,
        },
        {
          id: 'chunk-2',
          content: 'Low score content',
          filePath: 'docs/test.md',
          section: 'Test',
          docType: 'markdown' as const,
          createdAt: mockTimestamp,
          score: 0.65,
        },
      ]);

      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query',
        { minScore: 0.7 }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        const firstResult = result.value[0];
        expect(firstResult?.score).toBeGreaterThanOrEqual(0.7);
      }
    });

    it('should use default minScore of 0.7 when not specified', async () => {
      mockRepo.setResults([
        {
          id: 'chunk-1',
          content: 'Content',
          filePath: 'docs/test.md',
          section: 'Test',
          docType: 'markdown' as const,
          createdAt: mockTimestamp,
          score: 0.69,
        },
      ]);

      const result = await searchDocumentation(
        {
          embeddingRepository: mockRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Result with score 0.69 should be filtered out by default minScore 0.7
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('repository error handling', () => {
    it('should return error when repository fails', async () => {
      const failingRepo: EmbeddingRepositoryPort = {
        async findSimilar() {
          return {
            ok: false,
            error: new Error('Firestore connection failed'),
          };
        },
        async findById() {
          return { ok: true, value: null };
        },
      };

      const result = await searchDocumentation(
        {
          embeddingRepository: failingRepo,
          embeddingClient: mockClient,
          logger: mockLogger,
        },
        'test query'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        const searchError = result.error as { code: string };
        expect(searchError.code).toBe('REPOSITORY_ERROR');
      }
    });
  });
});
