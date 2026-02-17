/**
 * Search documentation use case.
 * Implements RAG (Retrieval-Augmented Generation) search functionality.
 */

import { ok, err, type Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type {
  EmbeddingRepositoryPort,
  DocChunkWithScore,
} from '../models/docChunk.js';
import type { Logger } from 'pino';

/** Error types for search documentation. */
export type SearchErrorCode =
  | 'INVALID_QUERY'
  | 'EMBEDDING_FAILED'
  | 'REPOSITORY_ERROR';

/** Search error with code. */
export class SearchError extends Error {
  readonly code: SearchErrorCode;

  constructor(code: SearchErrorCode, message: string) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

/** Search options for filtering and limiting results. */
export interface SearchOptions {
  readonly limit?: number;
  readonly docType?: 'markdown' | 'openapi';
  readonly minScore?: number;
}

/** Dependencies for search documentation use case. */
export interface SearchDocumentationDeps {
  readonly embeddingRepository: EmbeddingRepositoryPort;
  readonly embeddingClient: EmbeddingClient;
  readonly logger: Logger;
}

/** Embedding client interface. */
export interface EmbeddingClient {
  embed(text: string): Promise<Result<number[]>>;
}

/**
 * Search documentation using semantic vector search.
 *
 * Workflow:
 * 1. Generate embedding for query text
 * 2. Find similar document chunks via vector search
 * 3. Filter results by docType and minScore
 * 4. Return ranked results
 */
export async function searchDocumentation(
  deps: SearchDocumentationDeps,
  query: string,
  options?: SearchOptions
): Promise<Result<DocChunkWithScore[], SearchError>> {
  const { embeddingRepository, embeddingClient, logger } = deps;
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0.7;

  // Validate query
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return err(new SearchError('INVALID_QUERY', 'Query cannot be empty'));
  }

  // Generate embedding for query
  logger.info({ query: trimmedQuery }, 'Generating embedding for search query');
  const embeddingResult = await embeddingClient.embed(trimmedQuery);

  if (!embeddingResult.ok) {
    logger.error({ error: getErrorMessage(embeddingResult.error) }, 'Failed to generate query embedding');
    return err(new SearchError('EMBEDDING_FAILED', getErrorMessage(embeddingResult.error)));
  }

  const embedding = embeddingResult.value;

  // Search for similar documents
  logger.info({ limit }, 'Searching for similar documents');
  const searchResult = await embeddingRepository.findSimilar(embedding, limit);

  if (!searchResult.ok) {
    logger.error({ error: getErrorMessage(searchResult.error) }, 'Repository search failed');
    return err(new SearchError('REPOSITORY_ERROR', getErrorMessage(searchResult.error)));
  }

  let results = searchResult.value;

  // Filter by docType if specified
  if (options?.docType) {
    results = results.filter((r) => r.docType === options.docType);
  }

  // Filter by minScore
  results = results.filter((r) => r.score >= minScore);

  logger.info({ count: results.length }, 'Search completed');

  return ok(results);
}
