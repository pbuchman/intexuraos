/**
 * Document chunk stored in Firestore with embedding.
 */
export interface DocChunk {
  id: string;
  content: string;
  embedding: number[];
  filePath: string;
  section: string;
  docType: 'markdown' | 'openapi';
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * Port for embedding repository operations.
 */
export interface EmbeddingRepositoryPort {
  /**
   * Find similar documents by vector search.
   */
  findSimilar(embedding: number[], limit: number): Promise<Result<DocChunkWithScore[], unknown>>;

  /**
   * Get a document chunk by ID.
   */
  findById(id: string): Promise<Result<DocChunk | null, unknown>>;
}

/**
 * Document chunk with similarity score.
 */
export interface DocChunkWithScore extends Omit<DocChunk, 'embedding'> {
  score: number;
}

import type { Result } from '@intexuraos/common-core';
