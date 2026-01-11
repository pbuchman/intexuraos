/**
 * Report render error use case.
 * Increments error count when client reports rendering failure.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../repository.js';
import { MAX_RENDER_ERROR_COUNT } from '../types.js';

export interface ReportRenderErrorDeps {
  visualizationRepository: VisualizationRepository;
}

export interface ReportRenderErrorError {
  code: 'NOT_FOUND' | 'REPOSITORY_ERROR';
  message: string;
}

export async function reportRenderError(
  visualizationId: string,
  feedId: string,
  userId: string,
  errorMessage: string,
  deps: ReportRenderErrorDeps
): Promise<Result<{ errorCount: number; shouldDisable: boolean }, ReportRenderErrorError>> {
  const { visualizationRepository } = deps;

  const vizResult = await visualizationRepository.getById(visualizationId, feedId, userId);
  if (!vizResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: vizResult.error,
    });
  }

  if (vizResult.value === null) {
    return err({
      code: 'NOT_FOUND',
      message: 'Visualization not found',
    });
  }

  const incrementResult = await visualizationRepository.incrementRenderErrorCount(
    visualizationId,
    feedId,
    userId
  );

  if (!incrementResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: incrementResult.error,
    });
  }

  const newErrorCount = incrementResult.value;
  const shouldDisable = newErrorCount >= MAX_RENDER_ERROR_COUNT;

  if (shouldDisable) {
    const updateResult = await visualizationRepository.update(
      visualizationId,
      feedId,
      userId,
      {
        status: 'error',
        errorMessage: `Too many render errors (${String(newErrorCount)}). Last error: ${errorMessage}`,
      }
    );

    if (!updateResult.ok) {
      return err({
        code: 'REPOSITORY_ERROR',
        message: updateResult.error,
      });
    }
  }

  return ok({ errorCount: newErrorCount, shouldDisable });
}
