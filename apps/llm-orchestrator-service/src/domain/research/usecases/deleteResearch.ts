/**
 * Delete research usecase.
 * Removes a research by ID.
 */

import type { Result } from '@intexuraos/common-core';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export async function deleteResearch(
  id: string,
  deps: { researchRepo: ResearchRepository }
): Promise<Result<void, RepositoryError>> {
  return await deps.researchRepo.delete(id);
}
