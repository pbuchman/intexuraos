/**
 * Create visualization use case.
 * Creates a new visualization in pending state. Generation happens async.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../repository.js';
import type { Visualization, CreateVisualizationRequest } from '../types.js';
import { MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '../types.js';

export interface CreateVisualizationDeps {
  visualizationRepository: VisualizationRepository;
}

export interface CreateVisualizationError {
  code: 'VALIDATION_ERROR' | 'REPOSITORY_ERROR';
  message: string;
}

export async function createVisualization(
  feedId: string,
  userId: string,
  request: CreateVisualizationRequest,
  deps: CreateVisualizationDeps
): Promise<Result<Visualization, CreateVisualizationError>> {
  const { visualizationRepository } = deps;

  if (request.title.trim().length === 0) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Title cannot be empty',
    });
  }

  if (request.title.length > MAX_TITLE_LENGTH) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Title cannot exceed ${String(MAX_TITLE_LENGTH)} characters`,
    });
  }

  if (request.description.trim().length === 0) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Description cannot be empty',
    });
  }

  if (request.description.length > MAX_DESCRIPTION_LENGTH) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Description cannot exceed ${String(MAX_DESCRIPTION_LENGTH)} characters`,
    });
  }

  const result = await visualizationRepository.create(feedId, userId, {
    title: request.title.trim(),
    description: request.description.trim(),
    type: request.type,
  });

  if (!result.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: result.error,
    });
  }

  return ok(result.value);
}
