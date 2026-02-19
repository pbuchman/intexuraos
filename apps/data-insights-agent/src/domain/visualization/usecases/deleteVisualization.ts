/**
 * Delete visualization use case.
 */

import type { Result } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../ports/index.js';

export interface DeleteVisualizationDeps {
  visualizationRepository: VisualizationRepository;
}

export async function deleteVisualization(
  id: string,
  userId: string,
  deps: DeleteVisualizationDeps
): Promise<Result<void, string>> {
  return await deps.visualizationRepository.delete(id, userId);
}
