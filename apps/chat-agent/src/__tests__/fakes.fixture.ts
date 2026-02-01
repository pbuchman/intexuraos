/**
 * Fake implementations for testing.
 */
import { vi } from 'vitest';
import type { ServiceContainer } from '../services.js';
import { setServices, resetServices } from '../services.js';
import type {
  EmbeddingRepositoryPort,
  DocChunk,
  DocChunkWithScore,
} from '../domain/index.js';
import type { Result } from '@intexuraos/common-core';
import type { EmbeddingClient } from '../domain/usecases/searchDocumentation.js';

/**
 * Fake embedding repository for testing.
 */
export class FakeEmbeddingRepository implements EmbeddingRepositoryPort {
  private chunks: Map<string, DocChunk> = new Map<string, DocChunk>();
  private searchResults: DocChunkWithScore[] = [];

  setChunks(chunks: DocChunk[]): void {
    this.chunks = new Map(chunks.map((c) => [c.id, c]));
  }

  setSearchResults(results: DocChunkWithScore[]): void {
    this.searchResults = results;
  }

  async findSimilar(
    _embedding: number[],
    _limit: number
  ): Promise<Result<DocChunkWithScore[], unknown>> {
    return {
      ok: true,
      value: this.searchResults,
    };
  }

  async findById(id: string): Promise<Result<DocChunk | null, unknown>> {
    return {
      ok: true,
      value: this.chunks.get(id) ?? null,
    };
  }
}

/**
 * Fake embedding client for testing.
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  private mockEmbedding: number[] = new Array(1536).fill(0.1);
  private shouldFail = false;
  private failMessage = 'Embedding failed';

  setMockEmbedding(embedding: number[]): void {
    this.mockEmbedding = embedding;
  }

  setFailure(shouldFail: boolean, message = 'Embedding failed'): void {
    this.shouldFail = shouldFail;
    this.failMessage = message;
  }

  async embed(_text: string): Promise<Result<number[]>> {
    if (this.shouldFail) {
      return {
        ok: false,
        error: new Error(this.failMessage),
      };
    }
    return {
      ok: true,
      value: [...this.mockEmbedding],
    };
  }
}

/** Mock logger for testing. */
export const mockLogger: {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
} = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * Set up fake services for testing.
 */
export function setupFakeServices(): ServiceContainer {
  const services: ServiceContainer = {
    generateId: () => `test-${crypto.randomUUID()}`,
    embeddingRepository: new FakeEmbeddingRepository(),
    embeddingClient: new FakeEmbeddingClient(),
  };
  setServices(services);
  return services;
}

/**
 * Reset services after testing.
 */
export function resetFakeServices(): void {
  resetServices();
}
