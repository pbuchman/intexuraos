/**
 * List researches usecase.
 * Retrieves user's researches with summary projections for list views.
 */

import type { Result } from '@intexuraos/common-core';
import type { ResearchSummary } from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface ListResearchesParams {
  userId: string;
  limit?: number;
  cursor?: string;
}

export interface ListResearchesResult {
  items: ResearchSummary[];
  nextCursor?: string;
}

export async function listResearches(
  params: ListResearchesParams,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<ListResearchesResult, RepositoryError>> {
  const options: { limit?: number; cursor?: string } = {};
  if (params.limit !== undefined) {
    options.limit = params.limit;
  }
  if (params.cursor !== undefined) {
    options.cursor = params.cursor;
  }

  return await deps.researchRepo.findSummariesByUserId(params.userId, options);
}
