/**
 * Enhance research usecase.
 * Creates a new research based on a completed one, reusing successful LLM results.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { createEnhancedResearch, type Research, type ResearchModel } from '../models/index.js';
import type { RepositoryError, ResearchRepository } from '../ports/index.js';

export interface EnhanceResearchInput {
  sourceResearchId: string;
  userId: string;
  additionalModels?: ResearchModel[];
  additionalContexts?: { content: string; model?: string }[];
  synthesisModel?: ResearchModel;
  removeContextIds?: string[];
}

export interface EnhanceResearchDeps {
  researchRepo: ResearchRepository;
  generateId: () => string;
  logger: Logger;
}

export type EnhanceResearchError =
  | { type: 'NOT_FOUND' }
  | { type: 'FORBIDDEN' }
  | { type: 'INVALID_STATUS'; status: string }
  | { type: 'NO_CHANGES' }
  | { type: 'REPO_ERROR'; error: RepositoryError };

export async function enhanceResearch(
  params: EnhanceResearchInput,
  deps: EnhanceResearchDeps
): Promise<Result<Research, EnhanceResearchError>> {
  const { researchRepo, generateId, logger } = deps;

  logger.info(
    {
      sourceResearchId: params.sourceResearchId,
      userId: params.userId,
      additionalModelsCount: params.additionalModels?.length ?? 0,
      additionalContextsCount: params.additionalContexts?.length ?? 0,
      removeContextIdsCount: params.removeContextIds?.length ?? 0,
      hasSynthesisChange: params.synthesisModel !== undefined,
    },
    'Starting research enhancement'
  );

  const sourceResult = await researchRepo.findById(params.sourceResearchId);
  if (!sourceResult.ok) {
    logger.error(
      {
        sourceResearchId: params.sourceResearchId,
        userId: params.userId,
        error: sourceResult.error.message,
      },
      'Failed to fetch source research for enhancement'
    );
    return err({ type: 'REPO_ERROR', error: sourceResult.error });
  }

  if (sourceResult.value === null) {
    logger.warn(
      {
        sourceResearchId: params.sourceResearchId,
        userId: params.userId,
      },
      'Source research not found for enhancement'
    );
    return err({ type: 'NOT_FOUND' });
  }

  const source = sourceResult.value;

  if (source.userId !== params.userId) {
    logger.warn(
      {
        sourceResearchId: params.sourceResearchId,
        requestedUserId: params.userId,
        actualUserId: source.userId,
      },
      'User forbidden from enhancing research'
    );
    return err({ type: 'FORBIDDEN' });
  }

  if (source.status !== 'completed') {
    logger.warn(
      {
        sourceResearchId: params.sourceResearchId,
        userId: params.userId,
        currentStatus: source.status,
      },
      'Cannot enhance research in non-completed status'
    );
    return err({ type: 'INVALID_STATUS', status: source.status });
  }

  const hasNewModels = (params.additionalModels?.length ?? 0) > 0;
  const hasNewContexts = (params.additionalContexts?.length ?? 0) > 0;
  const hasRemovedContexts = (params.removeContextIds?.length ?? 0) > 0;
  const hasSynthesisChange = params.synthesisModel !== undefined;

  if (!hasNewModels && !hasNewContexts && !hasRemovedContexts && !hasSynthesisChange) {
    logger.info(
      {
        sourceResearchId: params.sourceResearchId,
        userId: params.userId,
      },
      'No changes provided for enhancement'
    );
    return err({ type: 'NO_CHANGES' });
  }

  const enhanceParams: Parameters<typeof createEnhancedResearch>[0] = {
    id: generateId(),
    userId: params.userId,
    sourceResearch: source,
  };
  if (params.additionalModels !== undefined) {
    enhanceParams.additionalModels = params.additionalModels;
  }
  if (params.additionalContexts !== undefined) {
    enhanceParams.additionalContexts = params.additionalContexts;
  }
  if (params.synthesisModel !== undefined) {
    enhanceParams.synthesisModel = params.synthesisModel;
  }
  if (params.removeContextIds !== undefined) {
    enhanceParams.removeContextIds = params.removeContextIds;
  }
  const enhanced = createEnhancedResearch(enhanceParams);

  logger.info(
    {
      sourceResearchId: params.sourceResearchId,
      derivedResearchId: enhanced.id,
      userId: params.userId,
      newSelectedModelsCount: enhanced.selectedModels.length,
    },
    'Created derived research for enhancement'
  );

  const saveResult = await researchRepo.save(enhanced);
  if (!saveResult.ok) {
    logger.error(
      {
        derivedResearchId: enhanced.id,
        sourceResearchId: params.sourceResearchId,
        userId: params.userId,
        error: saveResult.error.message,
      },
      'Failed to save derived research'
    );
    return err({ type: 'REPO_ERROR', error: saveResult.error });
  }

  logger.info(
    {
      derivedResearchId: enhanced.id,
      sourceResearchId: params.sourceResearchId,
      userId: params.userId,
      status: enhanced.status,
    },
    'Derived research saved successfully'
  );

  return ok(saveResult.value);
}
