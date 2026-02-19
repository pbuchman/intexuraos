/**
 * Get visualization use case.
 */

import type { Result } from '@intexuraos/common-core';
import { err } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../ports/index.js';
import type { Visualization } from '../models/index.js';

export interface GetVisualizationDeps {
  visualizationRepository: VisualizationRepository;
}

export interface GetVisualizationError {
  code: 'NOT_FOUND' | 'REPOSITORY_ERROR';
  message: string;
}

export async function getVisualization(
  id: string,
  userId: string,
  deps: GetVisualizationDeps
): Promise<Result<Visualization, GetVisualizationError>> {
  const result = await deps.visualizationRepository.getById(id, userId);

  if (!result.ok) {
    return err({ code: 'REPOSITORY_ERROR', message: result.error });
  }

  if (result.value === null) {
    return err({ code: 'NOT_FOUND', message: 'Visualization not found' });
  }

  return result as Result<Visualization, GetVisualizationError>;
}
