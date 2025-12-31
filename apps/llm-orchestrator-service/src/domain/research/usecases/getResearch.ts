/**
 * Get research usecase.
 * Retrieves a single research by ID.
 */

import type { Result } from '@intexuraos/common-core';
import type { Research } from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export async function getResearch(
  id: string,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<Research | null, RepositoryError>> {
  return await deps.researchRepo.findById(id);
}
