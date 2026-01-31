/**
 * Fake implementations for testing.
 */
import type { ServiceContainer } from '../services.js';
import { setServices, resetServices } from '../services.js';
import type { EmbeddingRepositoryPort, DocChunk, DocChunkWithScore } from '../domain/index.js';
import type { Result } from '@intexuraos/common-core';

/**
 * Fake embedding repository for testing.
 */
export class FakeEmbeddingRepository implements EmbeddingRepositoryPort {
  private chunks: Map<string, DocChunk> = new Map();
  private searchResults: DocChunkWithScore[] = [];

  setChunks(chunks: DocChunk[]): void {
    this.chunks = new Map(chunks.map((c) => [c.id, c]));
  }

  setSearchResults(results: DocChunkWithScore[]): void {
    this.searchResults = results;
  }

  async findSimilar(_embedding: number[], _limit: number): Promise<Result<DocChunkWithScore[], unknown>> {
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
 * Set up fake services for testing.
 */
export function setupFakeServices(): ServiceContainer {
  const services: ServiceContainer = {
    generateId: () => `test-${crypto.randomUUID()}`,
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
