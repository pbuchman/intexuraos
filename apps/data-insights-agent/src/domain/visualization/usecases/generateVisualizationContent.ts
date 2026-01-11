/**
 * Generate visualization content use case.
 * Calls LLM to generate HTML/JS content and updates the visualization.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../repository.js';
import type { VisualizationGenerationService } from '../types.js';
import type { SnapshotRepository } from '../../snapshot/index.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface GenerateVisualizationContentDeps {
  visualizationRepository: VisualizationRepository;
  visualizationGenerationService: VisualizationGenerationService;
  snapshotRepository: SnapshotRepository;
  logger?: BasicLogger;
}

export interface GenerateVisualizationContentError {
  code: 'NOT_FOUND' | 'GENERATION_ERROR' | 'REPOSITORY_ERROR';
  message: string;
}

export async function generateVisualizationContent(
  visualizationId: string,
  feedId: string,
  userId: string,
  deps: GenerateVisualizationContentDeps
): Promise<Result<void, GenerateVisualizationContentError>> {
  const { visualizationRepository, visualizationGenerationService, snapshotRepository, logger } = deps;

  logger?.info({ visualizationId, feedId, userId }, 'Generating visualization content');

  const vizResult = await visualizationRepository.getById(visualizationId, feedId, userId);
  if (!vizResult.ok) {
    logger?.error({ visualizationId, error: vizResult.error }, 'Failed to fetch visualization');
    return err({
      code: 'REPOSITORY_ERROR',
      message: vizResult.error,
    });
  }

  if (vizResult.value === null) {
    logger?.warn({ visualizationId }, 'Visualization not found');
    return err({
      code: 'NOT_FOUND',
      message: 'Visualization not found',
    });
  }

  const visualization = vizResult.value;

  const snapshotResult = await snapshotRepository.getByFeedId(feedId, userId);
  if (!snapshotResult.ok) {
    logger?.error({ feedId, error: snapshotResult.error }, 'Failed to fetch snapshot');
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  if (snapshotResult.value === null) {
    logger?.warn({ feedId }, 'Snapshot not found for visualization generation');
    return err({
      code: 'NOT_FOUND',
      message: 'Snapshot not found. Generate snapshot first.',
    });
  }

  const snapshot = snapshotResult.value;

  try {
    logger?.info({ visualizationId, feedId }, 'Calling LLM to generate visualization');
    const generated = await visualizationGenerationService.generateContent(snapshot.data, {
      visualizationId: visualization.id,
      feedId: visualization.feedId,
      userId: visualization.userId,
      title: visualization.title,
      description: visualization.description,
      type: visualization.type,
    });

    logger?.info({ visualizationId, contentLength: generated.htmlContent.length }, 'LLM generation successful');

    const updateResult = await visualizationRepository.update(
      visualizationId,
      feedId,
      userId,
      {
        status: 'ready',
        htmlContent: generated.htmlContent,
        errorMessage: null,
        lastGeneratedAt: new Date(),
      }
    );

    if (!updateResult.ok) {
      logger?.error({ visualizationId, error: updateResult.error }, 'Failed to update visualization with content');
      return err({
        code: 'REPOSITORY_ERROR',
        message: updateResult.error,
      });
    }

    logger?.info({ visualizationId }, 'Visualization content generation completed');
    return ok(undefined);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    logger?.error({ visualizationId, error }, 'LLM generation failed');

    const updateResult = await visualizationRepository.update(
      visualizationId,
      feedId,
      userId,
      {
        status: 'error',
        errorMessage,
      }
    );

    if (!updateResult.ok) {
      logger?.warn({ visualizationId, error: updateResult.error }, 'Failed to update visualization with error state');
    }

    return err({
      code: 'GENERATION_ERROR',
      message: errorMessage,
    });
  }
}
