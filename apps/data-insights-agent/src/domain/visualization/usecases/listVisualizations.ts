/**
 * List visualizations use case.
 */

import type { Result } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../ports/index.js';
import type { Visualization } from '../models/index.js';

export interface ListVisualizationsDeps {
  visualizationRepository: VisualizationRepository;
}

export async function listVisualizations(
  userId: string,
  deps: ListVisualizationsDeps
): Promise<Result<Visualization[], string>> {
  return await deps.visualizationRepository.listByUserId(userId);
}
