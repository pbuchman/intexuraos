/**
 * Repository port for Research persistence.
 * Implemented by Firestore adapter.
 */

import type { Result } from '@intexuraos/common-core';
import type { LlmResult, Research } from '../models/index.js';

export interface RepositoryError {
  code: 'NOT_FOUND' | 'FIRESTORE_ERROR' | 'CONFLICT';
  message: string;
}

export interface ResearchRepository {
  save(research: Research): Promise<Result<Research, RepositoryError>>;

  findById(id: string): Promise<Result<Research | null, RepositoryError>>;

  findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>>;

  update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>>;

  updateLlmResult(
    researchId: string,
    model: string,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>>;

  clearShareInfo(id: string): Promise<Result<Research, RepositoryError>>;

  delete(id: string): Promise<Result<void, RepositoryError>>;
}
